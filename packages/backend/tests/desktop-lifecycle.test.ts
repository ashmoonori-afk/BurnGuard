import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { acquireWindowsProfile } from "../src/profile-ownership";
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
