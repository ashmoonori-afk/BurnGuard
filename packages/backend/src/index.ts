import { bootstrapLocalAppData } from "./bootstrap";
import { loadConfig } from "./config";
import { desktopPort, watchDesktopParent } from "./desktop-lifecycle";
import { openBrowser } from "./lib/browser";
import { pickPort } from "./lib/port";
import { appRootDir } from "./lib/app-paths";
import { acquireWindowsProfile } from "./profile-ownership";
import { generateLaunchCapability } from "./security/request-authority";
import { MAX_REQUEST_BODY_BYTES } from "./security/request-limits";
import { createApp } from "./server";
import { closeActiveExportBrowsers } from "./services/export-browser-registry";
import { interruptAllUserTurns } from "./services/turns";

if (process.argv.includes("--bg-chromium-probe")) {
  const { runChromiumProbeProcess } = await import("./services/chromium-capability");
  await runChromiumProbeProcess();
}

const isDesktop = process.env.BG_DESKTOP === "1";
const ownedPort = isDesktop ? desktopPort(process.env.BG_PORT) : undefined;
// Refuse an existing owner before any migration/recovery writes to its profile.
// The native host also holds a profile mutex throughout this child's lifetime.
if (ownedPort !== undefined) await pickPort(ownedPort, ownedPort);
const profileOwner = process.platform === "win32" ? await acquireWindowsProfile(appRootDir) : undefined;
await bootstrapLocalAppData();
const config = await loadConfig();
// Dev + binary both prefer the canonical port 14070 (Vite proxy target).
// `pickPort` remains as a fallback only when a BG_SCAN_PORT env var is set —
// useful if a user explicitly runs two instances. For the normal case, a
// hard-coded port gives loud ECONNREFUSED if a zombie backend is lingering.
const envPort = process.env.BG_PORT
  ? Number.parseInt(process.env.BG_PORT, 10)
  : undefined;
const port =
  ownedPort ??
  envPort ??
  config.port ??
  (process.env.BG_SCAN_PORT === "1" ? await pickPort() : 14070);
const host = "127.0.0.1";
const isDev = process.env.BG_DEV === "1";
const app = createApp({
  capability: generateLaunchCapability(),
  appAuthority: `${host}:${port}`,
  devAuthority: isDev ? "127.0.0.1:5173" : undefined,
});

const server = Bun.serve({
  port,
  hostname: host,
  // Bun's default is 10 seconds, which kills SSE streams (long-lived) and
  // any POST that awaits a multi-minute LLM CLI subprocess. 255 is the max
  // a single uint8 allows; SSE routes also write periodic heartbeats.
  idleTimeout: 255,
  // The largest body any API route accepts; per-route ceilings are lower.
  maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
  fetch: app.fetch,
});

const url = `http://${host}:${server.port}`;
console.log(`[burnguard] listening on ${url}`);

// In dev (package.json sets BG_DEV=1), the React SPA is served by Vite on a
// separate port (5173-ish) and this backend only serves /api/*. Auto-opening
// 14070 would show the Phase 0 hello page instead of the app — skip it.
if (config.autoOpenBrowser && !isDev && !isDesktop) {
  openBrowser(url);
}
if (isDev) {
  console.log(
    "[burnguard] dev mode — open the Vite frontend at http://127.0.0.1:5173/",
  );
}

// Keep the process alive and close renderer-owned Chromium before shutdown.
let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return; shuttingDown = true; console.log("\n[burnguard] shutting down");
  // Turns first: an in-flight CLI subprocess owns the project directory and
  // would keep writing into it after the server is gone.
  server.stop(false); await interruptAllUserTurns(); await closeActiveExportBrowsers(); server.stop(true); profileOwner?.close(); process.exit(0);
};
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
if (isDesktop) {
  watchDesktopParent(process.stdin, () => { void shutdown(); });
  console.log(`[burnguard-desktop] ${JSON.stringify({ protocol: 1, url, pid: process.pid })}`);
}
