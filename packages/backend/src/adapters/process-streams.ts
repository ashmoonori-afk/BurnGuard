import { closeOwnedProcessTree } from "./owned-process-tree";

type OwnedProcess = { readonly pid: number; readonly exited: Promise<number>; kill: () => void };

/** Observe reader rejection immediately, then stop the writer before draining. */
export async function settleProcessStreams(proc: OwnedProcess, readers: readonly Promise<void>[], signal?: AbortSignal): Promise<number> {
  // Own cancellation instead of Bun.spawn's root-only signal handler. The
  // snapshot must run while ancestry still exists, and exit must await the
  // same cleanup rather than publish idle while detached tools are dying.
  let cleanup: Promise<void> | undefined;
  const close = () => cleanup ??= closeOwnedProcessTree(proc.pid);
  const onAbort = () => {
    void close().catch((error: unknown) => {
      console.error(`[adapter] failed to close owned process tree ${proc.pid}`, error);
      proc.kill(); // The exit path below still propagates the cleanup failure.
    });
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  // Attach rejection handlers to every reader before awaiting process exit.
  const exit = proc.exited.then(async (code) => { await close(); return code; });
  try {
    const [code] = await Promise.all([exit, ...readers]);
    return code;
  } catch (error) {
    try { await close(); }
    finally {
      proc.kill();
      await Promise.allSettled([proc.exited, ...readers]);
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
