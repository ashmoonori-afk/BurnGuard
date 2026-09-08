export const DEFAULT_EXPORT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export type PruneOptions = { readonly retentionMs?: number; readonly now?: number; readonly dryRun?: boolean; readonly signal?: AbortSignal; readonly phase?: (attemptId: string, phase: "gc_after_tombstone_before_unlink" | "gc_after_unlink", signal: AbortSignal) => Promise<void> };
export type ExpiredAttempt = { readonly attemptId: string; readonly jobId: string; readonly retainedUntil: number; readonly outputAvailable: boolean };
export type PruneResult = { readonly removedJobs: number; readonly removedBytes: number; readonly removedFiles: readonly string[]; readonly missingFiles: readonly string[]; readonly warnings: readonly string[] };
export type PruneDeps = {
  readonly listExpired?: (cutoff: number) => Promise<readonly ExpiredAttempt[]>;
  readonly claim?: (attemptId: string, now: number) => Promise<boolean>;
  readonly removeDirectory?: (attemptId: string) => Promise<number>;
};

export async function pruneOldExports(options: PruneOptions = {}, deps: PruneDeps = {}): Promise<PruneResult> {
  const now = options.now ?? Date.now();
  // retained_until already contains the default retention period; an explicit override shifts that deadline once.
  const cutoff = now + DEFAULT_EXPORT_RETENTION_MS - (options.retentionMs ?? DEFAULT_EXPORT_RETENTION_MS);
  const signal = options.signal ?? AbortSignal.timeout(120_000);
  const defaults = deps.listExpired === undefined || deps.claim === undefined || deps.removeDirectory === undefined ? (await import("./export-gc-storage")).exportGcStorage : null;
  const listExpired = deps.listExpired ?? defaults?.listExpired; const claim = deps.claim ?? defaults?.claim; const removeDirectory = deps.removeDirectory ?? defaults?.removeDirectory;
  if (listExpired === undefined || claim === undefined || removeDirectory === undefined) throw new TypeError("Export GC dependencies unavailable");
  const result = { removedJobs: 0, removedBytes: 0, removedFiles: [] as string[], missingFiles: [] as string[], warnings: [] as string[] };
  for (const attempt of await listExpired(cutoff)) {
    if (options.dryRun) { result.removedJobs += 1; continue; }
    if (attempt.outputAvailable && !await claim(attempt.attemptId, now)) continue;
    await options.phase?.(attempt.attemptId, "gc_after_tombstone_before_unlink", signal);
    try { const bytes = await removeDirectory(attempt.attemptId); result.removedBytes += bytes; result.removedFiles.push(attempt.attemptId); await options.phase?.(attempt.attemptId, "gc_after_unlink", signal); }
    catch (error) { result.warnings.push(error instanceof Error ? error.message : String(error)); continue; }
    result.removedJobs += 1;
  }
  return result;
}
