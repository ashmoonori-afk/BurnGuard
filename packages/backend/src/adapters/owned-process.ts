import { randomBytes } from "node:crypto";
import { existsSync, type FSWatcher, mkdtempSync, watch } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeOwnedProcessTree, terminateOwnedProcessTree } from "./owned-process-tree";
import {
  type HostCommandRunner,
  OwnedProcessHostError,
  type ReceiptReader,
  terminateOwnedWindowsJob,
  validateLaunchSettlement,
  type WindowsJobOwnership,
  windowsOwnedLaunchCommand,
} from "./owned-process-windows";

export { OwnedProcessHostError, terminateOwnedWindowsJob, type WindowsJobOwnership, windowsOwnedLaunchCommand } from "./owned-process-windows";

export type PosixProcessOwnership = { readonly kind: "posix-process"; readonly pid: number };
export type ProcessOwnership = WindowsJobOwnership | PosixProcessOwnership;
export type OwnedProcess<Process extends ProcessHandle> = { readonly proc: Process; readonly ownership: ProcessOwnership };

type ProcessHandle = { readonly pid: number; readonly exited: Promise<number>; kill: () => void };
type InputMode = "ignore" | "pipe" | Blob;
type OutputMode = "ignore" | "pipe";
type OwnedSpawnOptions<Stdin extends InputMode, Stdout extends OutputMode, Stderr extends OutputMode> = {
  readonly cmd: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly stdin: Stdin;
  readonly stdout: Stdout;
  readonly stderr: Stderr;
  readonly windowsHide?: boolean;
};
type WindowsLifecycle = {
  proc?: ProcessHandle;
  control?: Promise<void>;
  settlement?: Promise<void>;
  disposal?: Promise<void>;
};

const lifecycles = new WeakMap<WindowsJobOwnership, WindowsLifecycle>();
const WINDOWS_PROCESS_HOST = "burnguard-windows-process-host.exe";

export function spawnOwnedProcess<Stdin extends InputMode, Stdout extends OutputMode, Stderr extends OutputMode>(
  options: OwnedSpawnOptions<Stdin, Stdout, Stderr>,
) {
  if (process.platform !== "win32") {
    const proc = Bun.spawn({ ...options, cmd: [...options.cmd], detached: true });
    return { proc, ownership: { kind: "posix-process", pid: proc.pid } as const };
  }
  const ownership = createWindowsOwnership();
  const environment = { ...(options.env ?? process.env) };
  delete environment.BG_WINDOWS_PROCESS_HOST;
  try {
    const proc = Bun.spawn({ ...options, env: environment, cmd: windowsOwnedLaunchCommand(ownership, options.cmd), detached: false });
    bindWindowsProcess(ownership, proc);
    return { proc, ownership };
  } catch (error) {
    void disposeWindowsOwnership(ownership);
    throw error;
  }
}

export function settleOwnedProcess(
  owned: OwnedProcess<ProcessHandle>,
  exitCode: number,
  readReceipt: ReceiptReader = readReceiptFile,
): Promise<void> {
  if (owned.ownership.kind === "posix-process") return Promise.resolve();
  const ownership = owned.ownership;
  const lifecycle = bindWindowsProcess(ownership, owned.proc);
  lifecycle.settlement ??= (async () => {
    try {
      if (lifecycle.control !== undefined) await lifecycle.control;
      const contents = await readReceipt(ownership.launchReceipt).catch(() => { throw new OwnedProcessHostError("invalid_receipt"); });
      validateLaunchSettlement(contents, ownership, owned.proc.pid, exitCode);
    } finally {
      await disposeWindowsOwnership(ownership);
    }
  })();
  return lifecycle.settlement;
}

export async function terminateOwnedProcess(
  owned: OwnedProcess<ProcessHandle>,
  termGraceMs: number,
  killGraceMs: number,
): Promise<{ readonly exitCode: number; readonly killSent: boolean }> {
  if (owned.ownership.kind === "posix-process") return terminateOwnedProcessTree(owned.proc, termGraceMs, killGraceMs);
  await closeOwnedProcess(owned, { timeoutMs: termGraceMs + killGraceMs });
  const exitCode = await owned.proc.exited;
  await settleOwnedProcess(owned, exitCode);
  return { exitCode, killSent: true };
}

export function closeOwnedProcess(
  owned: OwnedProcess<ProcessHandle>,
  options: { readonly timeoutMs: number; readonly runCommand?: HostCommandRunner; readonly readReceipt?: ReceiptReader; readonly now?: () => number },
): Promise<void> {
  if (owned.ownership.kind === "posix-process") return closeOwnedProcessTree(owned.ownership.pid);
  const ownership = owned.ownership;
  const lifecycle = bindWindowsProcess(ownership, owned.proc);
  lifecycle.control ??= controlWindowsJob({ proc: owned.proc, ownership }, options);
  return lifecycle.control;
}

async function controlWindowsJob(
  owned: OwnedProcess<ProcessHandle> & { readonly ownership: WindowsJobOwnership },
  options: { readonly timeoutMs: number; readonly runCommand?: HostCommandRunner; readonly readReceipt?: ReceiptReader; readonly now?: () => number },
): Promise<void> {
  const started = (options.now ?? Date.now)();
  const reserveMs = Math.min(250, options.timeoutMs);
  const controlBudget = options.timeoutMs - reserveMs;
  try {
    if (controlBudget <= 0) throw new OwnedProcessHostError("receipt_timeout");
    await terminateOwnedWindowsJob({
      ownership: owned.ownership,
      hostPid: owned.proc.pid,
      hostExit: owned.proc.exited,
      timeoutMs: controlBudget,
      runCommand: options.runCommand ?? runHostCommand,
      readReceipt: options.readReceipt ?? readReceiptFile,
      now: options.now,
    });
  } catch (error) {
    const failure = error instanceof OwnedProcessHostError ? error : new OwnedProcessHostError("helper_failed");
    try { owned.proc.kill(); }
    catch { failure.recordCleanupFailure("launcher_kill_failed"); }
    const elapsed = (options.now ?? Date.now)() - started;
    const exited = await awaitHostExitBounded(owned.proc.exited, Math.max(0, options.timeoutMs - elapsed));
    if (!exited) failure.recordCleanupFailure("launcher_exit_timeout");
    await disposeWindowsOwnership(owned.ownership);
    throw failure;
  }
}

async function awaitHostExitBounded(hostExit: Promise<number>, timeoutMs: number): Promise<boolean> {
  if (timeoutMs <= 0) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
  try { return await Promise.race([hostExit.then(() => true), timeout]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

/** An explicit host is authoritative; otherwise the packaged helper beside execPath, then, from source only, the checkout's dist build. */
export function resolveWindowsProcessHost(input: { readonly env: NodeJS.ProcessEnv; readonly execPath: string; readonly compiled: boolean; readonly exists: (candidate: string) => boolean }): string {
  const configured = input.env.BG_WINDOWS_PROCESS_HOST;
  const besideExecPath = path.join(path.dirname(input.execPath), WINDOWS_PROCESS_HOST);
  // A compiled binary's import.meta.dir is Bun's virtual root, so the dist path would leave the install directory.
  const candidates = configured !== undefined ? [configured] : input.compiled ? [besideExecPath] : [besideExecPath, path.resolve(import.meta.dir, "../../../../dist/windows-process-host", WINDOWS_PROCESS_HOST)];
  const helper = candidates.find((candidate) => input.exists(candidate));
  if (helper === undefined) throw new OwnedProcessHostError("absent_helper");
  return helper;
}

function createWindowsOwnership(): WindowsJobOwnership {
  const helperPath = resolveWindowsProcessHost({ env: process.env, execPath: process.execPath, compiled: /\$bunfs|~BUN/i.test(import.meta.url), exists: existsSync });
  const token = randomBytes(16).toString("hex");
  const receiptRoot = mkdtempSync(path.join(tmpdir(), "burnguard-owned-process-"));
  const launchReceipt = path.join(receiptRoot, "launch.json");
  const terminateReceipt = path.join(receiptRoot, "terminate.json");
  let version = 0;
  const waiters = new Set<(next: number) => void>();
  const watcher: FSWatcher = watch(receiptRoot, () => {
    version += 1;
    for (const resolve of waiters) resolve(version);
    waiters.clear();
  });
  const ownership: WindowsJobOwnership = {
    kind: "windows-job",
    token,
    helperPath,
    receiptRoot,
    launchReceipt,
    terminateReceipt,
    receiptVersion: () => version,
    waitForReceiptChange: (observed) => {
      if (observed !== version) return { promise: Promise.resolve(version), cancel: () => {} };
      let resolveChange: ((next: number) => void) | undefined;
      const promise = new Promise<number>((resolve) => { resolveChange = resolve; waiters.add(resolve); });
      return { promise, cancel: () => { if (resolveChange !== undefined) waiters.delete(resolveChange); } };
    },
    closeWatcher: () => watcher.close(),
  };
  lifecycles.set(ownership, {});
  return ownership;
}

function bindWindowsProcess(ownership: WindowsJobOwnership, proc: ProcessHandle): WindowsLifecycle {
  const lifecycle = lifecycles.get(ownership) ?? {};
  lifecycle.proc ??= proc;
  lifecycles.set(ownership, lifecycle);
  return lifecycle;
}

function disposeWindowsOwnership(ownership: WindowsJobOwnership): Promise<void> {
  const lifecycle = lifecycles.get(ownership) ?? {};
  lifecycle.disposal ??= (async () => {
    ownership.closeWatcher();
    await rm(ownership.receiptRoot, { recursive: true, force: true });
  })();
  lifecycles.set(ownership, lifecycle);
  return lifecycle.disposal;
}

async function runHostCommand(command: readonly string[], timeoutMs: number) {
  const child = Bun.spawn([...command], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  timer = setTimeout(() => child.kill(), timeoutMs);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { exitCode, stdout, stderr };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readReceiptFile(receiptPath: string): Promise<string> {
  return readFile(receiptPath, "utf8");
}
