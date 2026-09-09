#!/usr/bin/env bun
/**
 * One-click dev stack launcher.
 *
 * Invoked by Start-BurnGuard.bat (Windows) and Start-BurnGuard.command (macOS).
 * Replaces a naive `bun run --filter '*' dev` so that:
 *
 *   - the backend is fully responsive on 14070 BEFORE the Vite proxy starts,
 *     killing the startup race that produced ECONNREFUSED on first paint;
 *   - a port already in use is detected and explained instead of hidden behind
 *     "the app loaded but /api 404s";
 *   - if the backend dies during boot we fail loudly instead of polling for
 *     the full health timeout;
 *   - SIGINT / window-close brings down both child processes together.
 */
import { spawn, type Subprocess } from "bun";
import path from "node:path";
import { APP_NAME } from "../packages/shared/src/app";
import { isPortFree } from "./qa/port";
import { bootstrapAuthority } from "./qa/runtime";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const BACKEND_HEALTH_URL = "http://127.0.0.1:14070/api/health";
const FRONTEND_URL = "http://127.0.0.1:5173/";
const BACKEND_TIMEOUT_MS = 60_000;
const FRONTEND_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;
const PROBE_TIMEOUT_MS = 800;

type PortState = "burnguard" | "other" | "free";

export async function isBurnGuardHealth(response: Response): Promise<boolean> {
  if (!response.ok) return false;
  const value: unknown = await response.json().catch(() => null);
  return typeof value === "object" && value !== null && "ok" in value && value.ok === true &&
    "name" in value && value.name === APP_NAME && "version" in value && typeof value.version === "string" &&
    "runtime" in value && value.runtime === "bun";
}

export async function probePort(url: string): Promise<PortState> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return await isBurnGuardHealth(r) ? "burnguard" : "other";
  } catch {
    // An occupied but unresponsive socket is not a free port.
    return await isPortFree(Number(new URL(url).port)) ? "free" : "other";
  }
}

async function waitForUrl(url: string, timeoutMs: number, accept: (response: Response) => boolean | Promise<boolean> = (response) => response.ok): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (stopping) return false;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      if (await accept(r)) return true;
    } catch {
      // not up yet
    }
    await Bun.sleep(POLL_INTERVAL_MS);
  }
  return false;
}

function openBrowser(url: string): void {
  if (process.env.BG_LAUNCHER_NO_OPEN === "1") return;
  const cmd =
    process.platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : process.platform === "darwin"
        ? ["open", url]
        : ["xdg-open", url];
  try {
    spawn({ cmd, stdout: "ignore", stderr: "ignore", stdin: "ignore" });
  } catch {
    // best-effort; user can navigate manually
  }
}

let stopping = false;
let backend: Subprocess | null = null;
let frontend: Subprocess | null = null;

function stop(reason: string, code = 0): never {
  if (!stopping) {
    stopping = true;
    console.log(`\n[launcher] stopping (${reason})`);
    if (backend) {
      try {
        backend.kill();
      } catch {}
    }
    if (frontend) {
      try {
        frontend.kill();
      } catch {}
    }
  }
  process.exit(code);
}

const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

async function main(): Promise<void> {
  // 1. Pre-flight: is 14070 already busy?
  const initial = await probePort(BACKEND_HEALTH_URL);
  if (initial === "burnguard") {
    console.error(
      "[launcher] BurnGuard backend is already running on 14070.",
    );
    console.error(
      "           Close that window first (or use the existing app), then re-run this launcher.",
    );
    process.exit(1);
  }
  if (initial === "other") {
    console.error(
      "[launcher] Port 14070 is occupied by a non-BurnGuard process.",
    );
    console.error(
      "           Free the port (Resource Monitor on Windows, `lsof -i :14070` on macOS) and try again.",
    );
    process.exit(1);
  }

  // 2. Start backend.
  console.log("[launcher] starting backend...");
  backend = spawn({
    cmd: [process.execPath, "run", "--cwd", "packages/backend", "dev"],
    cwd: REPO_ROOT,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
  });

  // If backend dies during boot, fail fast instead of polling for the full
  // BACKEND_TIMEOUT_MS — the user just wants to see the error.
  backend.exited.then((code) => {
    if (stopping) return;
    console.error(`[launcher] backend exited (code ${code}) — see logs above`);
    stop("backend exited", typeof code === "number" ? code : 1);
  });

  // 3. Wait for backend health.
  console.log("[launcher] waiting for backend on 14070...");
  const backendStart = Date.now();
  const backendUp = await waitForUrl(BACKEND_HEALTH_URL, BACKEND_TIMEOUT_MS, isBurnGuardHealth);
  if (!backendUp) {
    console.error(
      `[launcher] backend did not respond within ${BACKEND_TIMEOUT_MS / 1000}s`,
    );
    stop("backend health timeout", 1);
  }
  console.log(
    `[launcher] backend ready (${((Date.now() - backendStart) / 1000).toFixed(1)}s)`,
  );

  const authority = await bootstrapAuthority(new URL(BACKEND_HEALTH_URL).origin);
  if (!Object.values(authority).every(Boolean)) stop("backend bootstrap failed", 1);

  // 4. Start frontend.
  console.log("[launcher] starting frontend...");
  frontend = spawn({
    cmd: [process.execPath, "run", "--cwd", "packages/frontend", "dev"],
    cwd: REPO_ROOT,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
  });

  frontend.exited.then((code) => {
    if (stopping) return;
    console.error(`[launcher] frontend exited (code ${code})`);
    stop("frontend exited", typeof code === "number" ? code : 1);
  });

  // 5. Wait for Vite, then open the browser.
  const frontendUp = await waitForUrl(FRONTEND_URL, FRONTEND_TIMEOUT_MS);
  if (frontendUp) {
    console.log(`[launcher] frontend ready — opening ${FRONTEND_URL}`);
    openBrowser(FRONTEND_URL);
  } else {
    console.warn(
      `[launcher] frontend did not answer within ${FRONTEND_TIMEOUT_MS / 1000}s — open ${FRONTEND_URL} manually`,
    );
  }

  // 6. Block on either child exiting; signal handlers cover Ctrl+C / window close.
  await Promise.race([backend.exited, frontend.exited]);
  stop("a child exited", 0);
}

if (import.meta.main) {
  for (const signal of signals) process.on(signal, () => stop(signal));
  main().catch((err) => {
    console.error("[launcher] unexpected error:", err);
    stop("crash", 1);
  });
}
