import { bootstrapLocalAppData } from "./bootstrap";
import { loadConfig } from "./config";
import { activeTurnsMessage, desktopPort, watchDesktopParent } from "./desktop-lifecycle";
import { openBrowser } from "./lib/browser";
import { pickPort } from "./lib/port";
import { appRootDir } from "./lib/app-paths";
import { acquirePosixProfile, acquireWindowsProfile } from "./profile-ownership";
import { generateLaunchCapability } from "./security/request-authority";
import { MAX_REQUEST_BODY_BYTES } from "./security/request-limits";
import { createApp } from "./server";
import { closeActiveExportBrowsers } from "./services/export-browser-registry";
import { configureAppUpdater, startAppUpdateScheduler } from "./services/mac-updates";
import { startProjectDeletionPurgeScheduler } from "./services/project-deletion";
import { getSqlite } from "./db/sqlite-client";
import { activeUserTurnCount, interruptAllUserTurns } from "./services/turns";
import { shutdownProjectWatchers, startProjectWatchers, type ProjectWatcherStartup } from "./services/watchers";

const isDesktop = process.env.BG_DESKTOP === "1";
const ownedPort = isDesktop ? desktopPort(process.env.BG_PORT) : undefined;
// Refuse an existing owner before any migration/recovery writes to its profile.
// The native host also holds a profile mutex throughout this child's lifetime.
if (ownedPort !== undefined) await pickPort(ownedPort, ownedPort);
const profileOwner = process.platform === "win32" ? await acquireWindowsProfile(appRootDir) : await acquirePosixProfile(appRootDir);
await bootstrapLocalAppData();
startProjectDeletionPurgeScheduler(getSqlite());
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
// A launcher that opens the page itself (dev launcher, packaged smoke) may choose the one-time bootstrap secret;
// it is removed from the environment so provider CLIs spawned later never inherit it.
const launcherBootstrapSecret = process.env.BG_BOOTSTRAP_SECRET;
delete process.env.BG_BOOTSTRAP_SECRET;
if (launcherBootstrapSecret !== undefined && !/^[A-Za-z0-9_-]{16,}$/.test(launcherBootstrapSecret)) {
  throw new Error("BG_BOOTSTRAP_SECRET must be at least 16 base64url characters.");
}
// Outlives any realistic backend run; the per-launch capability, not this age, is what ends access on restart.
const BROWSER_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const bootstrapSecret = launcherBootstrapSecret ?? generateLaunchCapability();
const app = createApp({
  capability: generateLaunchCapability(),
  bootstrapSecret,
  persistentCookieMaxAgeSeconds: isDesktop ? undefined : BROWSER_COOKIE_MAX_AGE_SECONDS,
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
const launchFragment = `#bg-bootstrap:${bootstrapSecret}`;

// In dev (package.json sets BG_DEV=1), the React SPA is served by Vite on a
// separate port (5173-ish) and this backend only serves /api/*. Auto-opening
// 14070 would show the Phase 0 hello page instead of the app — skip it.
const handsOffLaunchUrl = config.autoOpenBrowser && !isDev && !isDesktop && process.env.BG_NO_OPEN !== "1";
if (handsOffLaunchUrl) {
  openBrowser(`${url}/${launchFragment}`);
}
// Nobody else opens the page: show the one-time launch URL to an interactive terminal only, never to a captured log.
// Dev output is a local terminal even when `bun run --filter` pipes it, so dev always shows the URL.
const showLaunchUrl = !handsOffLaunchUrl && !isDesktop && launcherBootstrapSecret === undefined &&
  (isDev || process.stdout.isTTY === true);
if (isDev) {
  console.log(
    `[burnguard] dev mode — open the Vite frontend at http://127.0.0.1:5173/${showLaunchUrl ? launchFragment : ""}`,
  );
} else if (showLaunchUrl) {
  console.log(`[burnguard] open ${url}/${launchFragment}`);
}

// Keep the process alive and close renderer-owned Chromium before shutdown.
let shuttingDown = false;
let projectWatcherStartup: ProjectWatcherStartup | null = null;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return; shuttingDown = true; console.log("\n[burnguard] shutting down");
  if (isDesktop) console.log('[burnguard-desktop] {"protocol":1,"event":"shutdown"}');
  // Turns first: an in-flight CLI subprocess owns the project directory and
  // would keep writing into it after the server is gone.
  // Watcher startup may still be observing projects: halt queued ones first, but never wait on in-flight hashing
  // before turns are interrupted (desktop hosts kill the backend after 10-15 s).
  server.stop(false);
  await shutdownProjectWatchers(projectWatcherStartup, async () => { await interruptAllUserTurns(); await closeActiveExportBrowsers(); });
  server.stop(true); profileOwner?.close(); process.exit(0);
};
// macOS self-update: the staged package is applied by the bundled updater once this process has shut down.
startAppUpdateScheduler(configureAppUpdater({ shutdown }));
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
// Closing the launching terminal hangs up its foreground group, backend included.
process.on("SIGHUP", () => { void shutdown(); });
// Announce only once the handlers exist: a signal that arrives earlier takes the default action and skips the ordered shutdown.
console.log(`[burnguard] listening on ${url}`);
if (isDesktop) {
  // The shell asks before closing so it can confirm over a running generation.
  watchDesktopParent(process.stdin, () => { void shutdown(); }, () => console.log(activeTurnsMessage(activeUserTurnCount())));
  console.log(`[burnguard-desktop] ${JSON.stringify({ protocol: 1, url, pid: process.pid, bootstrap: bootstrapSecret })}`);
}
// Reconciliation already converged in bootstrap; observing every project tree must not delay the window.
// Artifact mutations wait for their own project's first observation (`waitForProjectReady`).
projectWatcherStartup = startProjectWatchers();
