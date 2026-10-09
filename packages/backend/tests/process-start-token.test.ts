import { expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createProcessStartTokenReader, ProcessStartTokenError, readProcessStartToken } from "../src/adapters/process-start-token";

const BOOT = "12345678-1234-1234-1234-123456789abc";
const MOUNT = "25 1 0:5 / /proc rw,nosuid - proc proc rw";
const PID = 123;
const STAT = `${PID} (a (nested) comm)\nname)) S ${Array(18).fill("0").join(" ")} 9007199254740993 0\n`;
type IO = Parameters<typeof createProcessStartTokenReader>[1];

function reader(platform: NodeJS.Platform, overrides: Partial<IO> = {}): (pid: number) => string | null {
  return createProcessStartTokenReader(platform, {
    readText: () => { throw new Error("Unexpected filesystem read"); },
    readDarwinInfo: () => { throw new Error("Unexpected native read"); },
    ...overrides,
  });
}

function linux(stat: string | Error, overrides: Readonly<Record<string, string | Error>> = {}): (pid: number) => string | null {
  const files: Readonly<Record<string, string | Error>> = {
    "/proc/sys/kernel/random/boot_id": BOOT,
    "/proc/123/stat": stat,
    "/proc/self/mountinfo": MOUNT,
    ...overrides,
  };
  return reader("linux", { readText: (path) => {
    const value = files[path];
    if (value === undefined) throw new Error(`Unexpected read: ${path}`);
    if (value instanceof Error) throw value;
    return value;
  } });
}

function bsdInfo(): Uint8Array {
  const buffer = new Uint8Array(136);
  const view = new DataView(buffer.buffer);
  view.setUint32(4, 2, true);
  view.setUint32(12, PID, true);
  view.setBigUint64(112, 999n, true); // Adjacent fields must not be mistaken for birth.
  view.setBigUint64(120, 9007199254740993n, true);
  view.setBigUint64(128, 123456n, true);
  return buffer;
}

function darwin(buffer: Uint8Array): (pid: number) => string | null {
  return reader("darwin", { readDarwinInfo: (pid, output) => {
    expect(pid).toBe(PID);
    output.set(buffer);
    return { bytes: buffer.byteLength, errno: 0 };
  } });
}

test("Given parenthesized and multiline Linux comm When identity is read Then field 22 retains integer precision", () => {
  expect(linux(STAT)(PID)).toBe(`linux:${BOOT}:9007199254740993`);
});

test("Given canonicalizable Linux machine values When identity is read Then UUID and ticks are normalized", () => {
  expect(linux(STAT.replace("9007199254740993", "00042"), { "/proc/sys/kernel/random/boot_id": ` ${BOOT.toUpperCase()}\n` })(PID))
    .toBe(`linux:${BOOT}:42`);
});

test("Given a Linux zombie When identity is read Then it retains the same birth token", () => {
  expect(linux(STAT.replace(" S ", " Z "))(PID)).toBe(`linux:${BOOT}:9007199254740993`);
});

for (const stat of [
  STAT.replace(`${PID} (`, "124 ("),
  STAT.replace(" S ", " unknown "),
  STAT.replace("9007199254740993", "-1"),
  STAT.replace("9007199254740993", "4.2"),
  STAT.replace("9007199254740993", "18446744073709551616"),
  "123 (comm) S 0",
  "123 comm S 0",
]) test(`Given malformed Linux stat ${JSON.stringify(stat)} When read Then identity throws`, () => {
  expect(() => linux(stat)(PID)).toThrow(ProcessStartTokenError);
});

for (const value of ["", "not-a-boot-id", "12345678-1234-1234-1234-123456789abc-extra"]) {
  test(`Given malformed boot ID ${JSON.stringify(value)} When read Then it never reports absence`, () => {
    expect(() => linux(Object.assign(new Error("missing"), { code: "ENOENT" }), { "/proc/sys/kernel/random/boot_id": value })(PID))
      .toThrow(ProcessStartTokenError);
  });
}

for (const code of ["EACCES", "EPERM", "EIO", "ESRCH"]) {
  test(`Given Linux stat read error ${code} When read Then the error propagates instead of absence`, () => {
    const error = Object.assign(new Error(code), { code });
    expect(() => linux(error)(PID)).toThrow(error);
  });
}

test("Given ENOENT on an unrestricted Linux proc root When read Then PID absence is proved", () => {
  expect(linux(Object.assign(new Error("missing"), { code: "ENOENT" }))(PID)).toBeNull();
});

for (const mount of [
  MOUNT + ",hidepid=2",
  MOUNT + ",hidepid=4",
  MOUNT.replace(" - proc ", " - tmpfs "),
  MOUNT.replace(" / /proc ", " /123 /proc "),
  `${MOUNT}\n26 25 0:6 / /proc/123 rw - tmpfs tmpfs rw`,
  "",
]) test(`Given proc visibility cannot prove absence ${JSON.stringify(mount)} When stat is missing Then read throws`, () => {
  expect(() => linux(Object.assign(new Error("missing"), { code: "ENOENT" }), { "/proc/self/mountinfo": mount })(PID))
    .toThrow(ProcessStartTokenError);
});

for (const path of ["/proc/sys/kernel/random/boot_id", "/proc/self/mountinfo"]) {
  test(`Given missing identity infrastructure ${path} When read Then it is not mistaken for a missing PID`, () => {
    const error = Object.assign(new Error("infrastructure missing"), { code: "ENOENT" });
    expect(() => linux(Object.assign(new Error("pid missing"), { code: "ENOENT" }), { [path]: error })(PID)).toThrow(error);
  });
}

test("Given Darwin kernel birth time When decoded Then microseconds and 64-bit seconds are retained", () => {
  expect(darwin(bsdInfo())(PID)).toBe("darwin:9007199254740993:123456");
});

test("Given two Darwin births in one second When decoded Then fast PID reuse changes the token", () => {
  const first = bsdInfo(), second = bsdInfo();
  new DataView(second.buffer).setBigUint64(128, 123457n, true);
  expect(darwin(first)(PID)).not.toBe(darwin(second)(PID));
});

test("Given a Darwin zombie When decoded Then identity does not claim absence", () => {
  const buffer = bsdInfo();
  new DataView(buffer.buffer).setUint32(4, 5, true);
  expect(darwin(buffer)(PID)).toBe("darwin:9007199254740993:123456");
});

test("Given Darwin ESRCH including zombie lookup When read Then PID absence is proved", () => {
  expect(reader("darwin", { readDarwinInfo: () => ({ bytes: 0, errno: 3 }) })(PID)).toBeNull();
});

test("Given unavailable Darwin native API When read Then its error propagates instead of absence", () => {
  const error = new Error("native loader unavailable");
  expect(() => reader("darwin", { readDarwinInfo: () => { throw error; } })(PID)).toThrow(error);
});

for (const errno of [0, 1, 5, 13, 22, 45]) test(`Given Darwin native failure errno ${errno} When read Then it throws`, () => {
  expect(() => reader("darwin", { readDarwinInfo: () => ({ bytes: 0, errno }) })(PID)).toThrow(ProcessStartTokenError);
});

for (const bytes of [-1, 1, 135, 137]) test(`Given Darwin native result length ${bytes} When read Then it throws`, () => {
  expect(() => reader("darwin", { readDarwinInfo: () => ({ bytes, errno: 3 }) })(PID)).toThrow(ProcessStartTokenError);
});

for (const field of ["pid", "seconds", "microseconds"] as const) {
  test(`Given malformed Darwin birth ${field} When decoded Then it throws`, () => {
    const buffer = bsdInfo(), view = new DataView(buffer.buffer);
    switch (field) {
      case "pid": view.setUint32(12, 124, true); break;
      case "seconds": view.setBigUint64(120, 0n, true); break;
      case "microseconds": view.setBigUint64(128, 1_000_000n, true); break;
    }
    expect(() => darwin(buffer)(PID)).toThrow(ProcessStartTokenError);
  });
}

for (const platform of ["win32", "freebsd"] as const) test(`Given ${platform} When a bare PID is read Then unsupported throws`, () => {
  expect(() => reader(platform)(PID)).toThrow(ProcessStartTokenError);
});

for (const pid of [0, -1, NaN, Infinity, 1.5, 0x80000000]) test(`Given invalid PID ${pid} When read Then no OS reads occur`, () => {
  expect(() => reader("linux")(pid)).toThrow(ProcessStartTokenError);
});

test("Given the actual host process When read Then supported native identity is stable without signals", () => {
  const signal = spyOn(process, "kill");
  try {
    if (process.platform === "win32") {
      expect(() => readProcessStartToken(process.pid)).toThrow(ProcessStartTokenError);
    } else {
      const token = readProcessStartToken(process.pid);
      if (process.platform === "linux") {
        const raw = readFileSync(`/proc/${process.pid}/stat`, "utf8");
        const ticks = raw.match(/^\d+ \(.*\) \S(?: \S+){18} (\d+)/s)?.[1];
        expect(ticks).toBeDefined();
        expect(token).toBe(`linux:${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}:${ticks}`);
      } else {
        expect(token).toMatch(/^darwin:\d+:\d+$/);
      }
      expect(readProcessStartToken(process.pid)).toBe(token);
    }
    expect(signal).not.toHaveBeenCalled();
  } finally {
    signal.mockRestore();
  }
});

test("Given an actual reaped child When read Then supported native APIs prove absence", async () => {
  const child = Bun.spawn([process.execPath, "-e", "process.exit(0)"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([child.exited, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Child exit deadline")), 5000);
    })]);
    if (process.platform === "win32") expect(() => readProcessStartToken(child.pid)).toThrow(ProcessStartTokenError);
    else expect(readProcessStartToken(child.pid)).toBeNull();
  } finally {
    clearTimeout(timer);
    child.kill();
    await child.exited;
  }
});
