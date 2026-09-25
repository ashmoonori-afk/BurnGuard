import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { acquirePosixProfile, acquireWindowsProfile } from "../src/profile-ownership";
import { desktopPort, watchDesktopParent } from "../src/desktop-lifecycle";

test.skipIf(process.platform !== "win32")("Given one Windows profile owner When another server claims the same canonical profile Then it is rejected until release", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "burnguard-owner-"));
  const first = await acquireWindowsProfile(profile);
  try {
    await expect(acquireWindowsProfile(profile.toUpperCase())).rejects.toThrow("profile ownership unavailable");
  } finally {
    await new Promise<void>((resolve) => first.close(() => resolve()));
  }
  const replacement = await acquireWindowsProfile(profile);
  await new Promise<void>((resolve) => replacement.close(() => resolve()));
  await rm(profile, { recursive: true, force: true });
});

// POSIX file locks are held per process, so every competing claim runs in its own Bun child.
async function claimInChild(profile: string, hold = false): Promise<{ readonly child: Bun.Subprocess<"pipe", "pipe", "ignore">; readonly result: string }> {
  const child = Bun.spawn([process.execPath, "-e", `
import { acquirePosixProfile } from ${JSON.stringify(path.join(import.meta.dir, "../src/profile-ownership.ts"))};
try { await acquirePosixProfile(${JSON.stringify(profile)}); console.log("acquired"); } catch (error) { console.log(error instanceof Error ? error.message : String(error)); }
if (${hold}) for await (const _ of process.stdin) { /* hold ownership until the parent closes stdin or kills this child */ }
`], { stdin: "pipe", stdout: "pipe", stderr: "ignore", timeout: 20_000 });
  const reader = child.stdout.getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  return { child, result: new TextDecoder().decode(value).trim() };
}

test.skipIf(process.platform === "win32")("Given one POSIX profile owner When another process claims the same canonical profile Then it is rejected until release", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "burnguard-owner-"));
  try {
    const first = await acquirePosixProfile(profile);
    try {
      const rival = await claimInChild(`${profile}/`);
      await rival.child.exited;
      expect(rival.result).toContain("profile ownership unavailable");
    } finally {
      first.close();
    }
    const replacement = await claimInChild(profile);
    await replacement.child.exited;
    expect(replacement.result).toBe("acquired");
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")("Given a POSIX profile owner that is killed without releasing When a new backend claims the profile Then the OS has released ownership", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "burnguard-owner-"));
  try {
    const crashed = await claimInChild(profile, true);
    expect(crashed.result).toBe("acquired");
    await expect(acquirePosixProfile(profile)).rejects.toThrow("profile ownership unavailable");
    crashed.child.kill("SIGKILL");
    await crashed.child.exited;
    (await acquirePosixProfile(profile)).close();
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("Given a desktop port override When parsed before bootstrap Then only valid explicit ports or the canonical default are accepted", () => {
  expect(desktopPort(undefined)).toBe(14070);
  expect(desktopPort("14175")).toBe(14175);
  for (const value of ["", "0", "1023", "65536", "-1", "NaN", "14070junk", "14070.5", " 14070"]) {
    expect(() => desktopPort(value)).toThrow("Invalid desktop BG_PORT");
  }
});

test("Given the parent pipe When fragmented shutdown or EOF arrives Then shutdown runs once and malformed lines are ignored", async () => {
  const pipe = new PassThrough();
  let stops = 0;
  watchDesktopParent(pipe, () => { stops += 1; });
  pipe.write(` shutdown\nshutdown extra\n${"x".repeat(100_000)}shutdown\n`);
  expect(stops).toBe(0);
  pipe.write("shut");
  pipe.write("down\r\nshutdown\n");
  expect(stops).toBe(1);
  pipe.end();
  await new Promise<void>((resolve) => pipe.once("end", resolve));
  expect(stops).toBe(1);

  const disconnected = new PassThrough();
  watchDesktopParent(disconnected, () => { stops += 1; });
  disconnected.end("malformed");
  await new Promise<void>((resolve) => disconnected.once("end", resolve));
  expect(stops).toBe(2);
});
