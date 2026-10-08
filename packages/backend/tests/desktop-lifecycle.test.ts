import { expect, test } from "bun:test";
import { createServer, type Server } from "node:net";
import { PassThrough } from "node:stream";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { acquirePosixProfile, acquireWindowsProfile } from "../src/profile-ownership";
import { activeTurnsMessage, desktopPort, watchDesktopParent } from "../src/desktop-lifecycle";
import { activeUserTurnCount, releaseUserTurnReservation, reserveUserTurn } from "../src/services/turns";

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

test.skipIf(process.platform === "win32")("Given a new or an existing world-readable profile lock When the profile is acquired Then only the owner can open the lock file", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "burnguard-owner-"));
  const other = await mkdtemp(path.join(tmpdir(), "burnguard-owner-"));
  try {
    // Another account could otherwise hold a read lock on it and keep BurnGuard from starting.
    await writeFile(path.join(other, ".profile.lock"), "", { mode: 0o644 });
    for (const root of [profile, other]) {
      const owner = await acquirePosixProfile(root);
      try { expect((await stat(path.join(root, ".profile.lock"))).mode & 0o777).toBe(0o600); }
      finally { owner.close(); }
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
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

const mainEntry = path.join(import.meta.dir, "../src/main.ts");

/** Runs the real entrypoint as the desktop shell would and returns its protocol lines and exit code. */
async function startDesktopBackend(env: Record<string, string>, profile: string): Promise<{ readonly protocol: Array<Record<string, unknown>>; readonly exitCode: number }> {
  const child = Bun.spawn([process.execPath, mainEntry], {
    env: { ...process.env, BG_DESKTOP: "1", BG_NO_OPEN: "1", BG_DEV: "0", BG_APP_ROOT: profile, ...env },
    stdin: "pipe", stdout: "pipe", stderr: "ignore", timeout: 30_000,
  });
  const text = await new Response(child.stdout).text();
  const exitCode = await child.exited;
  const prefix = "[burnguard-desktop] ";
  const protocol = text.split("\n").filter((line) => line.startsWith(prefix)).map((line) => JSON.parse(line.slice(prefix.length)) as Record<string, unknown>);
  return { protocol, exitCode };
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

test("Given a desktop BG_PORT that is not a valid port When the backend starts Then it reports invalid_port and exits non-zero", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "burnguard-startup-"));
  try {
    const result = await startDesktopBackend({ BG_PORT: "80" }, profile);
    expect(result.protocol).toEqual([{ protocol: 1, event: "startup_failed", code: "invalid_port" }]);
    expect(result.exitCode).not.toBe(0);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("Given another program already listening on the desktop port When the backend starts Then it reports port_busy and exits non-zero", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "burnguard-startup-"));
  const port = await freePort();
  const squatter = createServer();
  await new Promise<void>((resolve) => squatter.listen(port, "127.0.0.1", resolve));
  try {
    const result = await startDesktopBackend({ BG_PORT: String(port) }, profile);
    expect(result.protocol).toEqual([{ protocol: 1, event: "startup_failed", code: "port_busy" }]);
    expect(result.exitCode).not.toBe(0);
  } finally {
    await new Promise<void>((resolve) => squatter.close(() => resolve()));
    await rm(profile, { recursive: true, force: true });
  }
});

test("Given a profile already owned by another process When the desktop backend starts on a free port Then it reports profile_owned and exits non-zero", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "burnguard-startup-"));
  const owner = process.platform === "win32" ? await acquireWindowsProfile(profile) : await acquirePosixProfile(profile);
  try {
    const result = await startDesktopBackend({ BG_PORT: String(await freePort()) }, profile);
    expect(result.protocol).toEqual([{ protocol: 1, event: "startup_failed", code: "profile_owned" }]);
    expect(result.exitCode).not.toBe(0);
  } finally {
    if (process.platform === "win32") await new Promise<void>((resolve) => (owner as Server).close(() => resolve()));
    else owner.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("Given the parent pipe When it asks for active turns Then each well-formed query is answered and none arrive after shutdown", () => {
  const pipe = new PassThrough();
  let queries = 0;
  let stops = 0;
  watchDesktopParent(pipe, () => { stops += 1; }, () => { queries += 1; });
  pipe.write("active-turns\nactive-turns\r\n active-turns\nactive-turns extra\nactive-");
  expect(queries).toBe(2);
  pipe.write("turns\nshutdown\nactive-turns\n");
  expect(queries).toBe(3);
  expect(stops).toBe(1);
});

test("Given a running-turn count When the reply is formatted Then it is one prefixed protocol 1 line the shells parse", () => {
  const line = activeTurnsMessage(2);
  expect(line.startsWith("[burnguard-desktop] ")).toBe(true);
  expect(line).not.toContain("\n");
  expect(JSON.parse(line.slice("[burnguard-desktop] ".length))).toEqual({ protocol: 1, event: "active-turns", count: 2 });
});

test("Given a reserved user turn When the active-turn count is read Then it counts the turn until the reservation is released", () => {
  const before = activeUserTurnCount();
  const reservation = reserveUserTurn(`desktop-close-guard-${crypto.randomUUID()}`);
  if (reservation === null) throw new TypeError("expected a turn reservation");
  try { expect(activeUserTurnCount()).toBe(before + 1); }
  finally { releaseUserTurnReservation(reservation); }
  expect(activeUserTurnCount()).toBe(before);
});
