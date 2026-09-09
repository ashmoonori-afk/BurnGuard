import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { createServer, type Server } from "node:net";

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
      reject(new Error("BurnGuard profile ownership unavailable; stop other BurnGuard instances and retry."));
    });
    owner.listen(`\\\\.\\pipe\\BurnGuard.Profile.${identity}`, () => resolve(owner));
  });
}
