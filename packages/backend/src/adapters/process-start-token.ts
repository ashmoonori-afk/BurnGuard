import { dlopen, ptr, read } from "bun:ffi";
import { readFileSync } from "node:fs";

export class ProcessStartTokenError extends Error {
  readonly code = "PROCESS_IDENTITY_UNAVAILABLE";
  constructor(readonly pid: number, readonly reason: "invalid_pid" | "unsupported" | "malformed" | "unreadable", options?: ErrorOptions) {
    super(`Process identity unavailable (${reason})`, options);
  }
}

type IdentityIO = {
  readonly readText: (path: string) => string;
  readonly readDarwinInfo: (pid: number, buffer: Uint8Array) => { readonly bytes: number; readonly errno: number };
};

// Apple xnu bsd/sys/proc_info.h: PROC_PIDTBSDINFO=3; proc_bsdinfo is
// twelve uint32s, char[16], char[32], six uint32s, then two uint64s:
// pid at 12, status at 4, birth seconds at 120, microseconds at 128; size 136.
// https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info.h
// https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/param.h
function readDarwinInfo(pid: number, buffer: Uint8Array): { readonly bytes: number; readonly errno: number } {
  const system = dlopen("/usr/lib/libSystem.B.dylib", {
    __error: { args: [], returns: "ptr" },
  });
  try {
    const libproc = dlopen("/usr/lib/libproc.dylib", {
      proc_pidinfo: { args: ["i32", "i32", "u64", "ptr", "i32"], returns: "i32" },
    });
    try {
      // Nonzero arg includes zombies. Without it ESRCH can mean a present zombie.
      // xnu bsd/kern/proc_info.c: proc_pidinfo checks live AND zombie tables.
      // libsyscall/wrappers/libproc/libproc.c returns 0 with errno on failure.
      const bytes = libproc.symbols.proc_pidinfo(pid, 3, 1, ptr(buffer), buffer.byteLength);
      const errnoPointer = system.symbols.__error();
      if (errnoPointer === null) throw new ProcessStartTokenError(pid, "unreadable");
      return { bytes, errno: bytes === 0 ? read.i32(errnoPointer) : 0 };
    } finally {
      libproc.close();
    }
  } finally {
    system.close();
  }
}

/** Inject OS reads without mutating process.platform, filesystem, or native globals. */
export function createProcessStartTokenReader(platform: NodeJS.Platform, io: IdentityIO): (pid: number) => string | null {
  return (pid) => {
    if (!Number.isInteger(pid) || pid <= 0 || pid > 0x7fffffff) throw new ProcessStartTokenError(pid, "invalid_pid");
    switch (platform) {
      case "linux": {
        const boot = io.readText("/proc/sys/kernel/random/boot_id").trim();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(boot)) {
          throw new ProcessStartTokenError(pid, "malformed");
        }
        let stat: string;
        try { stat = io.readText(`/proc/${pid}/stat`); }
        catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
          // hidepid=2/4 can hide a PRESENT PID with ENOENT. Only an unrestricted
          // proc root supports an absence proof; also reject overmounted PID paths.
          const mounts = io.readText("/proc/self/mountinfo").trim().split("\n");
          const target = `/proc/${pid}/stat`;
          const relevant = mounts.map((line) => line.split(" ")).filter((fields) => {
            const mount = fields[4];
            return mount !== undefined && (target === mount || target.startsWith(`${mount}/`));
          }).sort((a, b) => (b[4]?.length ?? 0) - (a[4]?.length ?? 0));
          const mount = relevant[0];
          const separator = mount?.indexOf("-") ?? -1;
          const options = mount?.[separator + 3]?.split(",");
          if (mount?.[4] !== "/proc" || mount[3] !== "/" || separator < 6 || mount[separator + 1] !== "proc"
            || !options || options.some((option) => option.startsWith("hidepid=") && option !== "hidepid=0" && option !== "hidepid=off")) {
            throw new ProcessStartTokenError(pid, "unsupported", { cause: error });
          }
          return null;
        }
        // comm may contain spaces, newlines, and either parenthesis. All fields
        // after comm are scalar, so its LAST ')' is the delimiter, not its first.
        const end = stat.lastIndexOf(")");
        const fields = stat.slice(end + 1).trim().split(/\s+/);
        const ticks = fields[19]; // state is field 3; starttime is field 22.
        if (!stat.startsWith(`${pid} (`) || end < `${pid} (`.length || !/^\s/.test(stat.slice(end + 1))
          || !/^[RSDZTWtXxKIP]$/.test(fields[0] ?? "") || !ticks || !/^\d+$/.test(ticks)) {
          throw new ProcessStartTokenError(pid, "malformed");
        }
        const startTicks = BigInt(ticks);
        if (startTicks > 0xffffffffffffffffn) throw new ProcessStartTokenError(pid, "malformed");
        return `linux:${boot.toLowerCase()}:${startTicks}`;
      }
      case "darwin": {
        const buffer = new Uint8Array(136);
        const result = io.readDarwinInfo(pid, buffer);
        if (result.bytes === 0) {
          if (result.errno === 3) return null; // ESRCH, including zombie lookup.
          throw new ProcessStartTokenError(pid, "unreadable");
        }
        if (result.bytes !== buffer.byteLength) throw new ProcessStartTokenError(pid, "malformed");
        const view = new DataView(buffer.buffer);
        const seconds = view.getBigUint64(120, true);
        const micros = view.getBigUint64(128, true);
        if (view.getUint32(12, true) !== pid || seconds === 0n || micros >= 1_000_000n) {
          throw new ProcessStartTokenError(pid, "malformed");
        }
        return `darwin:${seconds}:${micros}`;
      }
      default:
        // Windows callers must use the named Job token, never a bare PID.
        throw new ProcessStartTokenError(pid, "unsupported");
    }
  };
}

/**
 * Synchronous, read-only identity snapshot, not a handle or a signalling lease.
 * null proves absence at the OS read; errors never imply absence.
 * Zombies keep their birth token: identity alone cannot establish writer liveness.
 * A caller needing non-writer proof must observe/reap its owned child, or read
 * Linux stat state Z / Darwin pbi_status SZOMB (5) WITH the same birth identity.
 * Never encode state in the token: it changes during the same process lifetime.
 */
export const readProcessStartToken: (pid: number) => string | null = createProcessStartTokenReader(process.platform, {
  readText: (path) => readFileSync(path, "utf8"),
  readDarwinInfo,
});
