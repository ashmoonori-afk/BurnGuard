import type {
  PypdfInstallStatus,
  PythonHealth,
} from "@bg/shared";
import { PYPDF_REQUIRED_VERSION, isSupportedPypdfVersion } from "./pypdf-version";

const MAX_TAIL = 120;
const CHECK_TIMEOUT_MS = 3_000;

let installStatus: PypdfInstallStatus = {
  state: "idle",
  started_at: null,
  finished_at: null,
  exit_code: null,
  error: null,
  tail: [],
};

let runningInstall: ReturnType<typeof Bun.spawn> | null = null;
let cachedHealth: PythonHealth | null = null;

function pythonCandidates(): string[][] {
  return process.platform === "win32"
    ? [["py", "-3"], ["python3"], ["python"]]
    : [["python3"], ["python"]];
}

async function probe(cmd: string[]): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  try {
    const proc = Bun.spawn({
      cmd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already exited */
      }
    }, CHECK_TIMEOUT_MS);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    return { ok: exitCode === 0, stdout, stderr, exitCode };
  } catch (err) {
    return {
      ok: false,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      exitCode: -1,
    };
  }
}

export function parsePythonVersion(raw: string): string | null {
  const firstLine = raw.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!firstLine) return null;
  if (/^Python\s+\d/i.test(firstLine)) return firstLine;
  return firstLine;
}

export function parsePypdfVersion(raw: string): string | null {
  const firstLine = raw.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!firstLine) return null;
  // Expect a version-ish token like "4.3.1" or "4.3.1+local".
  return /^\d+(?:\.\d+)+/.test(firstLine) ? firstLine : null;
}

/** Health summary for an importable pypdf; only the reviewed line or newer is usable. */
export function pypdfHealth(version: string | null): PythonHealth["pypdf"] {
  return { found: version !== null, version, supported: isSupportedPypdfVersion(version), required_version: PYPDF_REQUIRED_VERSION };
}

/** `python -m pip install --user pypdf==<reviewed version>`: the installer never floats to latest. */
export function pypdfInstallCommand(prefix: readonly string[]): string[] {
  return [...prefix, "-m", "pip", "install", "--user", `pypdf==${PYPDF_REQUIRED_VERSION}`];
}

export async function checkPythonRuntime(): Promise<PythonHealth> {
  let pythonExecutable: string[] | null = null;
  let pythonVersion: string | null = null;
  let pypdfVersion: string | null = null;

  for (const prefix of pythonCandidates()) {
    const versionResult = await probe([...prefix, "--version"]);
    // Python 2.x prints the version to stderr; newer Python uses stdout.
    const combined = `${versionResult.stdout}\n${versionResult.stderr}`.trim();
    if (!versionResult.ok) continue;
    const parsedVersion = parsePythonVersion(combined);
    if (!parsedVersion) continue;
    pythonExecutable = [...prefix];
    pythonVersion = parsedVersion;
    break;
  }

  if (pythonExecutable) {
    const pypdfResult = await probe([
      ...pythonExecutable,
      "-c",
      "import pypdf; print(pypdf.__version__)",
    ]);
    if (pypdfResult.ok) {
      pypdfVersion = parsePypdfVersion(pypdfResult.stdout);
    }
  }

  const next: PythonHealth = {
    python: {
      found: pythonExecutable !== null,
      executable: pythonExecutable,
      version: pythonVersion,
    },
    pypdf: pypdfHealth(pypdfVersion),
    checked_at: Date.now(),
  };
  cachedHealth = next;
  return next;
}

export function getCachedPythonHealth(): PythonHealth | null {
  return cachedHealth;
}

export function getPypdfInstallStatus(): PypdfInstallStatus {
  return { ...installStatus, tail: [...installStatus.tail] };
}

/**
 * Spawns `python -m pip install --user pypdf==<pinned>` so PDF uploads start
 * working without asking the user for a shell. `--user` avoids needing
 * admin on Windows / sudo on Unix for system-wide installs.
 *
 * Returns `{ started: false }` if an install is already running (409
 * from the route handler). On completion, re-runs the health probe so
 * the Settings UI flips straight to green without a manual refresh.
 */
export function startPypdfInstall(): { started: boolean; reason?: string } {
  if (installStatus.state === "installing") {
    return { started: false, reason: "install_in_progress" };
  }

  const health = cachedHealth;
  const prefix = health?.python.executable;
  if (!prefix) {
    return { started: false, reason: "python_not_found" };
  }

  installStatus = {
    state: "installing",
    started_at: Date.now(),
    finished_at: null,
    exit_code: null,
    error: null,
    tail: [],
  };

  try {
    runningInstall = Bun.spawn({
      cmd: pypdfInstallCommand(prefix),
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: { ...process.env },
    });
  } catch (err) {
    installStatus = {
      ...installStatus,
      state: "error",
      finished_at: Date.now(),
      error: err instanceof Error ? err.message : String(err),
    };
    return { started: false, reason: "spawn_failed" };
  }

  const proc = runningInstall;
  const pushLine = (line: string) => {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed) return;
    installStatus.tail.push(trimmed);
    if (installStatus.tail.length > MAX_TAIL) installStatus.tail.shift();
  };

  if (proc.stdout instanceof ReadableStream) void readStream(proc.stdout, pushLine);
  if (proc.stderr instanceof ReadableStream) void readStream(proc.stderr, pushLine);

  void proc.exited.then(async (exitCode) => {
    installStatus = {
      ...installStatus,
      state: exitCode === 0 ? "success" : "error",
      finished_at: Date.now(),
      exit_code: exitCode,
      error:
        exitCode === 0
          ? null
          : `pip install pypdf exited with code ${exitCode}. See tail for details.`,
    };
    runningInstall = null;
    // Refresh the cached health so the next GET reflects the new state.
    await checkPythonRuntime().catch(() => {});
  });

  return { started: true };
}

async function readStream(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n");
      while (idx >= 0) {
        onLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf("\n");
      }
    }
    if (buffer.length > 0) onLine(buffer);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}
