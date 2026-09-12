const CLEANUP_POLL_MS = 25;
const CLEANUP_TIMEOUT_MS = 3_000;

export function ownedProcessSpawnOptions(): { readonly detached: boolean } {
  return { detached: process.platform !== "win32" };
}

export async function closeOwnedProcessTree(processId: number): Promise<void> {
  if (process.platform === "win32") {
    const result = Bun.spawnSync(["taskkill", "/PID", String(processId), "/T", "/F"], { stdout: "ignore", stderr: "ignore" });
    // A non-zero taskkill exit usually means the root already exited on its
    // own, which is the normal path — only an actually surviving process is
    // worth reporting, and never by throwing (see warnCleanupIncomplete).
    if (result.exitCode !== 0 && isProcessPresent(processId)) warnCleanupIncomplete(processId);
    return;
  }
  // Snapshot before signalling any ancestor: detached tools have their own
  // process group and lose their ownership link when the CLI exits. Do not
  // yield between discovering these exact descendants and signalling them.
  const descendants = snapshotDescendants(processId);
  for (const pid of descendants.reverse()) killIfPresent(pid);
  killIfPresent(-processId);
  // Real elapsed time, not scheduler ticks: the previous setImmediate loop
  // drained in a couple of milliseconds and reported failure long before a
  // signalled process group had a chance to be reaped.
  const deadline = Date.now() + CLEANUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isProcessGroupPresent(processId) && !descendants.some(isProcessPresent)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, CLEANUP_POLL_MS));
  }
  if (isProcessGroupPresent(processId) || descendants.some(isProcessPresent)) warnCleanupIncomplete(processId);
}

function snapshotDescendants(processId: number): number[] {
  const result = Bun.spawnSync(["ps", "-axo", "pid=,ppid=,pgid="], { stdout: "pipe", stderr: "pipe", timeout: 1_000 });
  if (result.exitCode !== 0) throw new Error(`Cannot snapshot owned process tree ${processId}: ${result.stderr.toString()}`);
  const children = new Map<number, number[]>();
  const owned = new Set([processId]);
  for (const line of result.stdout.toString().trim().split("\n")) {
    const [pid, parent, group] = line.trim().split(/\s+/).map(Number);
    if (!pid || !parent) continue;
    const siblings = children.get(parent) ?? [];
    siblings.push(pid);
    children.set(parent, siblings);
    // Group members remain attributable even if the root exited naturally.
    if (group === processId) owned.add(pid);
  }
  for (const pid of owned) {
    for (const child of children.get(pid) ?? []) owned.add(child);
  }
  owned.delete(processId);
  return [...owned];
}

function killIfPresent(pid: number): void {
  try { process.kill(pid, "SIGKILL"); }
  catch (error) {
    if (error instanceof Error && "code" in error) {
      if (error.code === "ESRCH") return;
      if (error.code === "EPERM") {
        console.warn(`[adapter] cannot signal process ${pid}: EPERM`);
        return;
      }
    }
    throw error;
  }
}

/**
 * Cleanup runs on the success path of every turn as well as on abort. A
 * straggler is worth a log line but must never turn a completed turn into
 * a failed one, so this warns where the previous implementation threw.
 */
function warnCleanupIncomplete(processId: number): void {
  // eslint-disable-next-line no-console
  console.warn(`[adapter] owned process tree ${processId} did not fully exit`);
}

function isProcessPresent(processId: number): boolean {
  try { process.kill(processId, 0); return true; }
  catch (error) { return !(error instanceof Error && "code" in error && error.code === "ESRCH"); }
}

function isProcessGroupPresent(processId: number): boolean {
  try { process.kill(-processId, 0); return true; }
  catch (error) { return !(error instanceof Error && "code" in error && error.code === "ESRCH"); }
}
