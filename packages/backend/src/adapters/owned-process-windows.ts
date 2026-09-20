const RECEIPT_SCHEMA = 1;
const JOB_TOKEN_PATTERN = /^[a-f0-9]{32}$/;

type HostCommandResult = { readonly exitCode: number; readonly stdout: string; readonly stderr: string };
export type HostCommandRunner = (command: readonly string[], timeoutMs: number) => Promise<HostCommandResult>;
export type ReceiptReader = (path: string) => Promise<string>;

export type WindowsJobOwnership = {
  readonly kind: "windows-job";
  readonly token: string;
  readonly helperPath: string;
  readonly receiptRoot: string;
  readonly launchReceipt: string;
  readonly terminateReceipt: string;
  readonly receiptVersion: () => number;
  readonly waitForReceiptChange: (version: number) => { readonly promise: Promise<number>; readonly cancel: () => void };
  readonly closeWatcher: () => void;
};

export class OwnedProcessHostError extends Error {
  readonly code = "owned_process_host_failed";
  cleanupFailure: "launcher_kill_failed" | "launcher_exit_timeout" | null = null;
  constructor(readonly reason: "absent_helper" | "helper_failed" | "invalid_receipt" | "receipt_timeout") {
    super("Owned process host could not prove process cleanup");
  }
  recordCleanupFailure(failure: "launcher_kill_failed" | "launcher_exit_timeout"): void {
    this.cleanupFailure ??= failure;
  }
}

export function windowsOwnedLaunchCommand(ownership: WindowsJobOwnership, target: readonly string[]): string[] {
  if (!validOwnership(ownership) || target.length === 0) throw new OwnedProcessHostError("invalid_receipt");
  return [ownership.helperPath, "launch", "--job", ownership.token, "--receipt", ownership.launchReceipt, "--", ...target];
}

export async function terminateOwnedWindowsJob(input: {
  readonly ownership: WindowsJobOwnership;
  readonly hostPid: number;
  readonly hostExit: Promise<number>;
  readonly timeoutMs: number;
  readonly runCommand: HostCommandRunner;
  readonly readReceipt: ReceiptReader;
  readonly now?: () => number;
}): Promise<void> {
  const { ownership, hostPid, hostExit, timeoutMs, runCommand, readReceipt } = input;
  const now = input.now ?? Date.now;
  if (!validOwnership(ownership) || !positiveInteger(hostPid) || !positiveInteger(timeoutMs)) throw new OwnedProcessHostError("invalid_receipt");
  const deadline = now() + timeoutMs;
  const launchState = await awaitLaunchAuthority({ ownership, hostPid, hostExit, deadline, readReceipt, now });
  if (launchState === "exited") return;
  const remaining = deadline - now();
  if (remaining <= 0) throw new OwnedProcessHostError("receipt_timeout");
  let result: HostCommandResult;
  try {
    result = await runCommand([ownership.helperPath, "terminate", "--job", ownership.token, "--receipt", ownership.terminateReceipt, "--timeout-ms", String(remaining)], remaining);
  } catch {
    throw new OwnedProcessHostError("absent_helper");
  }
  if (result.exitCode !== 0) throw new OwnedProcessHostError("helper_failed");
  const contents = await readTypedReceipt(ownership.terminateReceipt, readReceipt);
  const receipt = parseTerminateReceipt(contents);
  if (receipt === null || receipt.job !== ownership.token || receipt.activeProcesses !== 0) throw new OwnedProcessHostError("invalid_receipt");
}

export function validateLaunchSettlement(contents: string, ownership: WindowsJobOwnership, hostPid: number, exitCode: number): void {
  const receipt = parseLaunchReceipt(contents);
  if (receipt === null || receipt.job !== ownership.token || receipt.hostPid !== hostPid || receipt.targetExitCode !== exitCode || receipt.activeProcesses !== 0) {
    throw new OwnedProcessHostError("invalid_receipt");
  }
}

export async function readTypedReceipt(receiptPath: string, readReceipt: ReceiptReader): Promise<string> {
  try { return await readReceipt(receiptPath); }
  catch { throw new OwnedProcessHostError("invalid_receipt"); }
}

async function awaitLaunchAuthority(input: {
  readonly ownership: WindowsJobOwnership;
  readonly hostPid: number;
  readonly hostExit: Promise<number>;
  readonly deadline: number;
  readonly readReceipt: ReceiptReader;
  readonly now: () => number;
}): Promise<"running" | "exited"> {
  let version = input.ownership.receiptVersion();
  let hostExited = false;
  for (;;) {
    try {
      const contents = await input.readReceipt(input.ownership.launchReceipt);
      const running = parseRunningReceipt(contents);
      if (running !== null && running.job === input.ownership.token && running.hostPid === input.hostPid && running.activeProcesses >= 1) return "running";
      const exited = parseLaunchReceipt(contents);
      if (exited !== null && exited.job === input.ownership.token && exited.hostPid === input.hostPid && exited.activeProcesses === 0) return "exited";
    } catch {
      if (hostExited) throw new OwnedProcessHostError("invalid_receipt");
    }
    const remaining = input.deadline - input.now();
    if (remaining <= 0) throw new OwnedProcessHostError("receipt_timeout");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), remaining); });
    const change = input.ownership.waitForReceiptChange(version);
    try {
      const wake = await Promise.race([
        change.promise.then((next) => ({ kind: "receipt" as const, next })),
        input.hostExit.then(() => ({ kind: "exit" as const, next: version })),
        timeout.then(() => ({ kind: "timeout" as const, next: version })),
      ]);
      if (wake.kind === "timeout") throw new OwnedProcessHostError("receipt_timeout");
      if (wake.kind === "exit") hostExited = true;
      version = wake.next;
    } finally {
      change.cancel();
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

function parseRunningReceipt(output: string): { readonly job: string; readonly hostPid: number; readonly activeProcesses: number } | null {
  const value = parseReceipt(output);
  if (value === null || value.operation !== "launch" || value.state !== "running" || !positiveInteger(value.host_pid) || !positiveInteger(value.target_pid) || !positiveInteger(value.active_processes)) return null;
  return { job: value.job_token, hostPid: value.host_pid, activeProcesses: value.active_processes };
}

function parseLaunchReceipt(output: string): { readonly job: string; readonly hostPid: number; readonly targetExitCode: number; readonly activeProcesses: number } | null {
  const value = parseReceipt(output);
  if (value === null || value.operation !== "launch" || value.state !== "exited" || !positiveInteger(value.host_pid) || !positiveInteger(value.target_pid) || !integer(value.target_exit_code) || value.active_processes !== 0) return null;
  return { job: value.job_token, hostPid: value.host_pid, targetExitCode: value.target_exit_code, activeProcesses: value.active_processes };
}

function parseTerminateReceipt(output: string): { readonly job: string; readonly activeProcesses: number } | null {
  const value = parseReceipt(output);
  if (value === null || value.operation !== "terminate" || value.state !== "terminated" || value.active_processes !== 0) return null;
  return { job: value.job_token, activeProcesses: value.active_processes };
}

function parseReceipt(output: string): Record<string, unknown> & { readonly job_token: string } | null {
  let value: unknown;
  try { value = JSON.parse(output); } catch { return null; }
  if (!isReceiptRecord(value) || value.schema_version !== RECEIPT_SCHEMA || !JOB_TOKEN_PATTERN.test(value.job_token)) return null;
  return value;
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function positiveInteger(value: unknown): value is number {
  return integer(value) && value > 0;
}

function validOwnership(ownership: WindowsJobOwnership): boolean {
  return JOB_TOKEN_PATTERN.test(ownership.token) && pathIsAbsolute(ownership.launchReceipt) && pathIsAbsolute(ownership.terminateReceipt);
}

function pathIsAbsolute(value: string): boolean {
  return /^(?:[a-zA-Z]:[\\/]|\/)/.test(value);
}

function isReceiptRecord(value: unknown): value is Record<string, unknown> & { readonly job_token: string } {
  return typeof value === "object" && value !== null && "job_token" in value && typeof value.job_token === "string";
}
