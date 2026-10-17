import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readReceiptFile, resolveWindowsProcessHost, runHostCommand, type OwnedProcess } from "./owned-process";
import { closeOwnedProcessTree } from "./owned-process-tree";
import { readProcessStartToken } from "./process-start-token";

export type OwnedProcessRecord =
  | { readonly kind: "posix-process"; readonly pid: number; readonly start: string }
  | { readonly kind: "windows-job"; readonly pid: number; readonly token: string; readonly receipt_root: string };

export type RecordedProcessReaper = {
  readonly platform: NodeJS.Platform;
  readonly tempRoot: string;
  readonly startToken: (pid: number) => string | null;
  /** Resolves only after every attributable writer has stopped. */
  readonly closeProcessTree: (pid: number, expectedStart: string) => Promise<void>;
  readonly recoverWindowsJob: (record: Extract<OwnedProcessRecord, { kind: "windows-job" }>) => Promise<void>;
};

export class RecordedProcessRecoveryError extends Error {
  readonly code = "owned_process_recovery_failed";
  constructor(message: string) { super(message); }
}

const JOB_TOKEN = /^[a-f0-9]{32}$/;
const RECEIPT_DIRECTORY = /^burnguard-owned-process-[A-Za-z0-9]{1,32}$/;

export function describeOwnedProcess(owned: OwnedProcess<{ readonly pid: number; readonly exited: Promise<number>; kill: () => void }>): OwnedProcessRecord | null {
  if (owned.ownership.kind === "windows-job") {
    return { kind: "windows-job", pid: owned.proc.pid, token: owned.ownership.token, receipt_root: owned.ownership.receiptRoot };
  }
  const start = readProcessStartToken(owned.ownership.pid);
  return start === null ? null : { kind: "posix-process", pid: owned.ownership.pid, start };
}

export function parseOwnedProcessRecord(json: string): OwnedProcessRecord {
  let value: unknown;
  try { value = JSON.parse(json); }
  catch { throw new RecordedProcessRecoveryError("Process ownership receipt is invalid JSON"); }
  if (typeof value !== "object" || value === null || !("pid" in value) || typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid <= 0 || !("kind" in value)) {
    throw new RecordedProcessRecoveryError("Process ownership receipt is invalid");
  }
  if (value.kind === "posix-process" && "start" in value && typeof value.start === "string" && value.start.length > 0) {
    return { kind: "posix-process", pid: value.pid, start: value.start };
  }
  if (value.kind === "windows-job" && "token" in value && typeof value.token === "string" && JOB_TOKEN.test(value.token) && "receipt_root" in value && typeof value.receipt_root === "string") {
    return { kind: "windows-job", pid: value.pid, token: value.token, receipt_root: value.receipt_root };
  }
  throw new RecordedProcessRecoveryError("Process ownership receipt is invalid");
}

/** A reused PID is never signalled; unreadable identity never proves absence. */
export async function reapRecordedProcess(record: OwnedProcessRecord, reaper: RecordedProcessReaper = defaultRecordedProcessReaper()): Promise<void> {
  if (record.kind === "posix-process") {
    if (reaper.platform === "win32") throw new RecordedProcessRecoveryError("POSIX ownership cannot be verified on Windows");
    const liveStart = reaper.startToken(record.pid);
    // The root may have exited while its detached process group still owns
    // descendants. Absence of the root alone does not prove the tree stopped.
    if (liveStart !== null && liveStart !== record.start) return;
    await reaper.closeProcessTree(record.pid, record.start);
    return;
  }
  if (reaper.platform !== "win32") throw new RecordedProcessRecoveryError("Windows Job ownership cannot be verified on POSIX");
  const flavor = path.win32;
  if (!flavor.isAbsolute(record.receipt_root) || flavor.resolve(flavor.dirname(record.receipt_root)).toLowerCase() !== flavor.resolve(reaper.tempRoot).toLowerCase() || !RECEIPT_DIRECTORY.test(flavor.basename(record.receipt_root))) {
    throw new RecordedProcessRecoveryError("Windows Job receipt directory is invalid");
  }
  await reaper.recoverWindowsJob(record);
}

export function defaultRecordedProcessReaper(): RecordedProcessReaper {
  return {
    platform: process.platform,
    tempRoot: tmpdir(),
    startToken: readProcessStartToken,
    closeProcessTree: (pid, expectedStart) => closeOwnedProcessTree(pid, {
      requireTermination: true,
      verifyOwnership: () => {
        const liveStart = readProcessStartToken(pid);
        return liveStart === null || liveStart === expectedStart;
      },
    }),
    recoverWindowsJob: async (record) => {
      const helper = resolveWindowsProcessHost({ env: process.env, execPath: process.execPath, compiled: /\$bunfs|~BUN/i.test(import.meta.url), exists: existsSync });
      // Normal settlement may have removed the old receipt directory before a
      // crash prevented DB acknowledgement. The named Job is the authority.
      const scratch = await mkdtemp(path.join(tmpdir(), "burnguard-owned-recovery-"));
      try {
        const receiptPath = path.join(scratch, "recovery.json");
        const result = await runHostCommand([helper, "recover", "--job", record.token, "--receipt", receiptPath, "--timeout-ms", "5000"], 5_000);
        if (result.exitCode !== 0) throw new RecordedProcessRecoveryError("Windows Job recovery helper failed");
        const value: unknown = JSON.parse(await readReceiptFile(receiptPath));
        if (typeof value !== "object" || value === null || !("schema_version" in value) || value.schema_version !== 1 || !("job_token" in value) || value.job_token !== record.token || !("operation" in value) || !("state" in value)) {
          throw new RecordedProcessRecoveryError("Windows Job recovery proof is invalid");
        }
        if (value.operation === "recovery" && value.state === "absent") return;
        if (value.operation === "terminate" && value.state === "terminated" && "active_processes" in value && value.active_processes === 0) return;
        throw new RecordedProcessRecoveryError("Windows Job recovery did not prove termination");
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    },
  };
}
