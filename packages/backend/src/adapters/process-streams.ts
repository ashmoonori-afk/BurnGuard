import { closeOwnedProcess, type OwnedProcess, settleOwnedProcess } from "./owned-process";
import type { AdapterRunInput } from "./types";

type ProcessHandle = { readonly pid: number; readonly exited: Promise<number>; kill: () => void };
const PROCESS_CLEANUP_TIMEOUT_MS = 3_000;

/** Observe reader rejection immediately, then stop the writer before draining. */
export async function settleProcessStreams(owned: OwnedProcess<ProcessHandle>, readers: readonly Promise<void>[], signal?: AbortSignal, onProcessStarted?: AdapterRunInput["onProcessStarted"]): Promise<number> {
  const proc = owned.proc;
  let onStopped: (() => void) | undefined;
  // Execute before yielding, but capture persistence failure as a reader failure
  // so the existing owner teardown still runs before the error escapes.
  const recorded = (async () => { onStopped = onProcessStarted?.(owned); })();
  const allReaders = [recorded, ...readers];
  const finishRecord = () => {
    const finish = onStopped;
    onStopped = undefined;
    finish?.();
  };
  // Cancellation owns the platform authority: a POSIX process group or a
  // Windows Job token. Exit still waits for cleanup proof before publication.
  let cleanup: Promise<void> | undefined;
  const close = () => cleanup ??= (async () => {
    await closeOwnedProcess(owned, { timeoutMs: PROCESS_CLEANUP_TIMEOUT_MS, requireTermination: onProcessStarted !== undefined });
    finishRecord();
  })();
  const onAbort = () => {
    void close().catch((error: unknown) => {
      console.error(`[adapter] failed to close owned process tree ${proc.pid}`, error);
      proc.kill(); // The exit path below still propagates the cleanup failure.
    });
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  // Attach rejection handlers to every reader before awaiting process exit.
  const exit = proc.exited.then(async (code) => {
    if (owned.ownership.kind === "windows-job") {
      await settleOwnedProcess(owned, code);
      finishRecord();
    }
    else await close();
    return code;
  });
  try {
    const [code] = await Promise.all([exit, ...allReaders]);
    return code;
  } catch (error) {
    try { await close(); }
    finally {
      proc.kill();
      await Promise.allSettled([exit, ...allReaders]);
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
