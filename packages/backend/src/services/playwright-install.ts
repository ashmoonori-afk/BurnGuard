import { stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { PlaywrightInstallStatus } from "@bg/shared";
import { chromiumNodeCommand } from "./chromium-node-launch";
import { resetChromiumCapability } from "./chromium-capability";
import { playwrightCoreDirectory } from "./playwright-runtime";

const MAX_TAIL = 120;

let status: PlaywrightInstallStatus = {
  state: "idle",
  started_at: null,
  finished_at: null,
  exit_code: null,
  error: null,
  tail: [],
};

let runningProc: ReturnType<typeof Bun.spawn> | null = null;

/**
 * A restart resets the in-memory install state to `idle`, which the Settings
 * card reads as "not installed" even when Chromium is on disk. The browser is
 * probed off the request path — `getPlaywrightInstallStatus` is synchronous,
 * and playwright-core is imported lazily so a probe failure costs nothing —
 * and a present executable is reported as an already finished install.
 */
let chromiumOnDisk = false;
let probe: Promise<void> | null = null;

function probeChromiumOnDisk(): Promise<void> {
  probe ??= (async () => {
    try {
      const { chromium } = await import("./playwright-runtime");
      chromiumOnDisk = (await stat(chromium.executablePath())).isFile();
    } catch {
      chromiumOnDisk = false;
    } finally {
      probe = null;
    }
  })();
  return probe;
}

// Warmed at import: the Settings card is read once per open, so the answer has
// to be ready before the first read rather than after it.
void probeChromiumOnDisk();

export function getPlaywrightInstallStatus(): PlaywrightInstallStatus {
  if (status.state !== "idle") return { ...status, tail: [...status.tail] };
  void probeChromiumOnDisk();
  return { ...status, state: chromiumOnDisk ? "success" : "idle", tail: [...status.tail] };
}

/**
 * Installs the Chromium build required by this app's exact Playwright version.
 * Returns `{ started: true }` when a fresh install begins, or
 * `{ started: false }` if one is already running.
 *
 * The stream outputs are buffered into `status.tail` so the UI can surface
 * a short log without subscribing to a stream. Final state is `success` or
 * `error`. Single global slot — concurrent requests are ignored.
 */
export function startPlaywrightInstall(): { started: boolean } {
  if (status.state === "installing") return { started: false };

  status = {
    state: "installing",
    started_at: Date.now(),
    finished_at: null,
    exit_code: null,
    error: null,
    tail: [],
  };

  try {
    const cmd = playwrightInstallCommand();

    runningProc = Bun.spawn({
      cmd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: { ...process.env },
    });
  } catch {
    status = {
      ...status,
      state: "error",
      finished_at: Date.now(),
      error: "The bundled browser installer runtime is unavailable. Reinstall BurnGuard to restore it.",
    };
    return { started: false };
  }

  const proc = runningProc;
  const pushLine = (line: string) => {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed) return;
    status.tail.push(trimmed);
    if (status.tail.length > MAX_TAIL) status.tail.shift();
  };

  if (proc.stdout instanceof ReadableStream) void readStream(proc.stdout, pushLine);
  if (proc.stderr instanceof ReadableStream) void readStream(proc.stderr, pushLine);

  void proc.exited.then((exitCode) => {
    status = {
      ...status,
      state: exitCode === 0 ? "success" : "error",
      finished_at: Date.now(),
      exit_code: exitCode,
      error:
        exitCode === 0
          ? null
          : `Chromium installation exited with code ${exitCode}. See tail for details.`,
    };
    runningProc = null;
    if (exitCode === 0) { resetChromiumCapability(); void probeChromiumOnDisk(); }
  });

  return { started: true };
}

export function playwrightInstallCommand(): string[] {
  const node = chromiumNodeCommand()?.node;
  if (node === undefined) throw new Error("Browser installer runtime is unavailable");
  const cli = path.join(playwrightCoreDirectory(), "cli.js");
  if (!existsSync(cli)) throw new Error("Browser installer is unavailable");
  return [node, cli, "install", "chromium"];
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
