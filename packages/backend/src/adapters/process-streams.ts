import { closeOwnedProcess, type OwnedProcess, settleOwnedProcess } from "./owned-process";

type ProcessHandle = { readonly pid: number; readonly exited: Promise<number>; kill: () => void };
const PROCESS_CLEANUP_TIMEOUT_MS = 3_000;

/** Observe reader rejection immediately, then stop the writer before draining. */
export async function settleProcessStreams(owned: OwnedProcess<ProcessHandle>, readers: readonly Promise<void>[], signal?: AbortSignal): Promise<number> {
  const proc = owned.proc;
  // Cancellation owns the platform authority: a POSIX process group or a
  // Windows Job token. Exit still waits for cleanup proof before publication.
  let cleanup: Promise<void> | undefined;
  const close = () => cleanup ??= closeOwnedProcess(owned, { timeoutMs: PROCESS_CLEANUP_TIMEOUT_MS });
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
    if (owned.ownership.kind === "windows-job") await settleOwnedProcess(owned, code);
    else await close();
    return code;
  });
  try {
    const [code] = await Promise.all([exit, ...readers]);
    return code;
  } catch (error) {
    try { await close(); }
    finally {
      proc.kill();
      await Promise.allSettled([exit, ...readers]);
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
