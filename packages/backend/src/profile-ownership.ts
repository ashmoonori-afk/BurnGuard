import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import path from "node:path";

const OWNERSHIP_UNAVAILABLE = "BurnGuard profile ownership unavailable; stop other BurnGuard instances and retry.";

/** Windows releases the exclusive pipe automatically even after a crash. */
export async function acquireWindowsProfile(profile: string): Promise<Server> {
  await mkdir(profile, { recursive: true });
  const canonical = (await realpath(profile)).replace(/[\\/]+$/, "").toLowerCase();
  const identity = createHash("sha256").update(canonical).digest("hex");
  const owner = createServer((socket) => socket.destroy());
  return new Promise((resolve, reject) => {
    owner.once("error", () => {
      owner.close();
      // Bun reports named-pipe collisions as ERR_INVALID_ARG_TYPE on Windows.
      reject(new Error(OWNERSHIP_UNAVAILABLE));
    });
    owner.listen(`\\\\.\\pipe\\BurnGuard.Profile.${identity}`, () => resolve(owner));
  });
}

/** POSIX releases SQLite's exclusive file lock when the process exits, even after a crash; the lock follows the inode, so every spelling of the profile path shares it. */
export async function acquirePosixProfile(profile: string): Promise<{ close(): void }> {
  await mkdir(profile, { recursive: true });
  const lock = new Database(path.join(profile, ".profile.lock"), { create: true });
  try {
    lock.run("PRAGMA busy_timeout=0");
    lock.run("PRAGMA locking_mode=EXCLUSIVE");
    lock.run("BEGIN EXCLUSIVE");
  } catch {
    lock.close();
    throw new Error(OWNERSHIP_UNAVAILABLE);
  }
  return { close: () => lock.close() };
}
