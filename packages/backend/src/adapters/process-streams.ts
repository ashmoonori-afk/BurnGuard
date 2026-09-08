import { closeOwnedProcessTree } from "./owned-process-tree";

type OwnedProcess = { readonly pid: number; readonly exited: Promise<number>; kill: () => void };

/** Observe reader rejection immediately, then stop the writer before draining. */
export async function settleProcessStreams(proc: OwnedProcess, readers: readonly Promise<void>[]): Promise<number> {
  // Attach rejection handlers to every reader before awaiting process exit.
  const exit = proc.exited.then(async (code) => { await closeOwnedProcessTree(proc.pid); return code; });
  try {
    const [code] = await Promise.all([exit, ...readers]);
    return code;
  } catch (error) {
    try { await closeOwnedProcessTree(proc.pid); }
    finally {
      proc.kill();
      await Promise.allSettled([proc.exited, ...readers]);
    }
    throw error;
  }
}
