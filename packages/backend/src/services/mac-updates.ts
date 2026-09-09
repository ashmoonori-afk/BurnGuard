import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { APP_VERSION } from "@bg/shared/app";
import type { AppUpdateStatus, AppUpdateUnsupportedReason } from "@bg/shared/updates";
import { cacheDir as appCacheDir } from "../lib/app-paths";

/**
 * Velopack self-update for the macOS app. Windows updates live in the native
 * shell (packages/desktop-windows); on macOS the Bun backend is the app, so it
 * reads the same GitHub release feed (`releases.osx.json`), verifies the full
 * package against the feed's SHA-256, and hands the staged file to the bundled
 * `UpdateMac` binary, which swaps the bundle after this process exits.
 */

export const UPDATE_REPOSITORY = "ashmoonori-afk/BurnGuard";
export const UPDATE_PACKAGE_ID = "BurnGuard";
export const UPDATE_FEED_NAME = "releases.osx.json";
const UPDATER_BINARY = "UpdateMac";
const MAX_PACKAGE_BYTES = 1024 * 1024 * 1024;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 15_000;

export type VelopackFeedAsset = {
  readonly PackageId: string;
  readonly Version: string;
  readonly Type: "Full" | "Delta";
  readonly FileName: string;
  readonly SHA256: string;
  readonly Size: number;
};

export interface AppUpdateSource {
  /** The raw `releases.osx.json` document for the newest published release. */
  fetchFeed(signal?: AbortSignal): Promise<unknown>;
  /** The package bytes for a file name listed in that feed. */
  openPackage(fileName: string, signal?: AbortSignal): Promise<Response>;
}

export class AppUpdateError extends Error {
  readonly name = "AppUpdateError";
  constructor(readonly code: "invalid_update_feed" | "update_check_failed" | "package_download_failed" | "package_too_large" | "package_digest_mismatch") {
    super(code);
  }
}

const SAFE_FILE_NAME = /^[A-Za-z0-9._-]+\.nupkg$/;
const SHA256_HEX = /^[0-9a-fA-F]{64}$/;

export function parseVelopackFeed(value: unknown): VelopackFeedAsset[] {
  if (typeof value !== "object" || value === null || !("Assets" in value) || !Array.isArray(value.Assets)) throw new AppUpdateError("invalid_update_feed");
  const assets: VelopackFeedAsset[] = [];
  for (const entry of value.Assets) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (
      typeof record.PackageId !== "string" || typeof record.Version !== "string" || parseVersion(record.Version) === null ||
      (record.Type !== "Full" && record.Type !== "Delta") || typeof record.FileName !== "string" || !SAFE_FILE_NAME.test(record.FileName) ||
      typeof record.SHA256 !== "string" || !SHA256_HEX.test(record.SHA256) || typeof record.Size !== "number" || !Number.isSafeInteger(record.Size) || record.Size <= 0
    ) continue;
    assets.push({ PackageId: record.PackageId, Version: record.Version, Type: record.Type, FileName: record.FileName, SHA256: record.SHA256.toUpperCase(), Size: record.Size });
  }
  return assets;
}

type ParsedVersion = { readonly numbers: readonly number[]; readonly prerelease: string | null };

function parseVersion(version: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim());
  if (match === null) return null;
  return { numbers: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] ?? null };
}

/** Negative when `left` is older than `right`, zero when equal, positive when newer. Unparseable versions sort lowest. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a === null || b === null) return a === null && b === null ? 0 : a === null ? -1 : 1;
  for (let index = 0; index < 3; index += 1) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

/** The newest full package for this app that is newer than `currentVersion`, or null. */
export function selectUpdate(assets: readonly VelopackFeedAsset[], currentVersion: string, packageId = UPDATE_PACKAGE_ID): VelopackFeedAsset | null {
  let best: VelopackFeedAsset | null = null;
  for (const asset of assets) {
    if (asset.PackageId !== packageId || asset.Type !== "Full") continue;
    if (compareVersions(asset.Version, currentVersion) <= 0) continue;
    if (best === null || compareVersions(asset.Version, best.Version) > 0) best = asset;
  }
  return best;
}

export type UpdateSupport = { readonly supported: boolean; readonly reason: AppUpdateUnsupportedReason | null };

export function updaterBinaryPath(execPath: string): string {
  return path.join(path.dirname(execPath), UPDATER_BINARY);
}

/** Only a Velopack-packaged macOS bundle (UpdateMac beside the executable) can update itself. */
export function detectUpdateSupport(input: { readonly platform: NodeJS.Platform; readonly execPath: string; readonly desktopShell: boolean }): UpdateSupport {
  if (input.desktopShell) return { supported: false, reason: "windows_shell" };
  if (input.platform !== "darwin") return { supported: false, reason: "platform" };
  return existsSync(updaterBinaryPath(input.execPath)) ? { supported: true, reason: null } : { supported: false, reason: "not_installed" };
}

export type AppUpdaterDependencies = {
  readonly currentVersion: string;
  readonly cacheDir: string;
  readonly source: AppUpdateSource;
  readonly support: UpdateSupport;
  readonly updaterPath: string;
  /** Starts the detached updater process; must not throw for a well-formed command. */
  readonly spawn: (cmd: readonly string[]) => void;
  /** The application's graceful shutdown; the updater swaps the bundle once this pid exits. */
  readonly shutdown: () => Promise<void>;
  /** Defers the shutdown so the HTTP response that accepted the apply can leave the socket first. */
  readonly scheduleShutdown?: (run: () => void) => void;
};

export type AppUpdater = {
  status(): AppUpdateStatus;
  /** Checks the feed and stages a newer package. Concurrent calls share one run. */
  check(): Promise<void>;
  apply(): Promise<"unsupported" | "not_ready" | "applying">;
};

export function createAppUpdater(deps: AppUpdaterDependencies): AppUpdater {
  let state: AppUpdateStatus = {
    supported: deps.support.supported,
    unsupported_reason: deps.support.reason,
    state: deps.support.supported ? "idle" : "unsupported",
    current_version: deps.currentVersion,
    available_version: null,
    progress: null,
    checked_at: null,
    error: null,
  };
  let staged: { readonly asset: VelopackFeedAsset; readonly file: string } | null = null;
  let running: Promise<void> | null = null;
  const patch = (next: Partial<AppUpdateStatus>): void => { state = { ...state, ...next }; };

  async function run(): Promise<void> {
    patch({ state: "checking", error: null, progress: null });
    let asset: VelopackFeedAsset | null;
    try {
      asset = selectUpdate(parseVelopackFeed(await deps.source.fetchFeed()), deps.currentVersion);
    } catch (error) {
      patch({ state: "error", checked_at: Date.now(), error: error instanceof AppUpdateError ? error.code : "update_check_failed" });
      return;
    }
    if (asset === null) {
      staged = null;
      patch({ state: "idle", available_version: null, checked_at: Date.now() });
      return;
    }
    if (staged !== null && staged.asset.FileName === asset.FileName && staged.asset.SHA256 === asset.SHA256 && existsSync(staged.file)) {
      patch({ state: "ready", available_version: asset.Version, checked_at: Date.now() });
      return;
    }
    patch({ state: "downloading", available_version: asset.Version, progress: 0 });
    try {
      const file = await downloadPackage(deps, asset, (progress) => patch({ progress }));
      staged = { asset, file };
      patch({ state: "ready", progress: null, checked_at: Date.now() });
    } catch (error) {
      staged = null;
      patch({ state: "error", progress: null, checked_at: Date.now(), error: error instanceof AppUpdateError ? error.code : "package_download_failed" });
    }
  }

  return {
    status: () => state,
    check() {
      if (!deps.support.supported) return Promise.resolve();
      running ??= run().finally(() => { running = null; });
      return running;
    },
    async apply() {
      if (!deps.support.supported) return "unsupported";
      if (staged === null || state.state !== "ready") return "not_ready";
      deps.spawn([deps.updaterPath, "apply", "--package", staged.file, "--waitPid", String(process.pid)]);
      (deps.scheduleShutdown ?? ((run) => { setTimeout(run, 250); }))(() => { void deps.shutdown(); });
      return "applying";
    },
  };
}

async function downloadPackage(deps: AppUpdaterDependencies, asset: VelopackFeedAsset, onProgress: (percent: number) => void): Promise<string> {
  if (asset.Size > MAX_PACKAGE_BYTES) throw new AppUpdateError("package_too_large");
  const directory = path.join(deps.cacheDir, "updates");
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, asset.FileName);
  const partial = `${target}.partial`;
  let response: Response;
  try { response = await deps.source.openPackage(asset.FileName); }
  catch { throw new AppUpdateError("package_download_failed"); }
  if (!response.ok || response.body === null) throw new AppUpdateError("package_download_failed");
  const hash = createHash("sha256");
  const writer = Bun.file(partial).writer();
  let received = 0;
  let open = true;
  const close = async (): Promise<void> => { if (!open) return; open = false; try { await writer.end(); } catch { /* the sink is already closed */ } };
  try {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > asset.Size) throw new AppUpdateError("package_too_large");
        hash.update(value);
        writer.write(value);
        onProgress(Math.floor((received / asset.Size) * 100));
      }
    } finally {
      reader.releaseLock();
    }
    await close();
    if (received !== asset.Size || hash.digest("hex").toUpperCase() !== asset.SHA256) throw new AppUpdateError("package_digest_mismatch");
    await rename(partial, target);
    return target;
  } catch (error) {
    await close();
    await rm(partial, { force: true });
    throw error;
  }
}

type GithubRelease = { readonly draft: boolean; readonly prerelease: boolean; readonly assets: readonly { readonly name: string; readonly browser_download_url: string }[] };

function isGithubRelease(value: unknown): value is GithubRelease {
  return typeof value === "object" && value !== null && "assets" in value && Array.isArray(value.assets) && "draft" in value && "prerelease" in value;
}

/** The same selection rule as Velopack's GithubSource: the newest published, non-prerelease release that carries the feed. */
export function githubReleaseSource(repository: string, fetchImpl: typeof fetch = fetch): AppUpdateSource {
  const headers = { accept: "application/vnd.github+json", "user-agent": `BurnGuard/${APP_VERSION} updater` };
  let release: GithubRelease | null = null;
  const locate = async (signal?: AbortSignal): Promise<GithubRelease> => {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases?per_page=30`, { headers, signal });
    if (!response.ok) throw new AppUpdateError("update_check_failed");
    const releases: unknown = await response.json();
    if (!Array.isArray(releases)) throw new AppUpdateError("update_check_failed");
    const found = releases.find((entry): entry is GithubRelease => isGithubRelease(entry) && !entry.draft && !entry.prerelease && entry.assets.some((asset) => asset.name === UPDATE_FEED_NAME));
    if (found === undefined) throw new AppUpdateError("invalid_update_feed");
    release = found;
    return found;
  };
  return {
    async fetchFeed(signal) {
      const current = await locate(signal);
      const feed = current.assets.find((asset) => asset.name === UPDATE_FEED_NAME);
      if (feed === undefined) throw new AppUpdateError("invalid_update_feed");
      const response = await fetchImpl(feed.browser_download_url, { headers: { accept: "application/octet-stream", "user-agent": headers["user-agent"] }, signal });
      if (!response.ok) throw new AppUpdateError("update_check_failed");
      return response.json();
    },
    async openPackage(fileName, signal) {
      const current = release ?? await locate(signal);
      const asset = current.assets.find((entry) => entry.name === fileName);
      if (asset === undefined) throw new AppUpdateError("package_download_failed");
      return fetchImpl(asset.browser_download_url, { headers: { accept: "application/octet-stream", "user-agent": headers["user-agent"] }, signal });
    },
  };
}

/** A plain directory listing served over HTTP(S); used for local rehearsals of the update flow. */
export function webFeedSource(baseUrl: URL, fetchImpl: typeof fetch = fetch): AppUpdateSource {
  const resolve = (name: string): URL => new URL(name, baseUrl.href.endsWith("/") ? baseUrl : `${baseUrl.href}/`);
  return {
    async fetchFeed(signal) {
      const response = await fetchImpl(resolve(UPDATE_FEED_NAME), { signal });
      if (!response.ok) throw new AppUpdateError("update_check_failed");
      return response.json();
    },
    openPackage(fileName, signal) { return fetchImpl(resolve(fileName), { signal }); },
  };
}

/** `BG_UPDATE_FEED_URL` must be loopback or HTTPS; anything else keeps the GitHub feed. */
export function resolveUpdateSource(env: NodeJS.ProcessEnv = process.env): AppUpdateSource {
  const override = env.BG_UPDATE_FEED_URL;
  if (override !== undefined && override !== "") {
    try {
      const url = new URL(override);
      const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
      if (url.protocol === "https:" || (url.protocol === "http:" && loopback)) return webFeedSource(url);
    } catch { /* fall through to the GitHub feed */ }
  }
  return githubReleaseSource(UPDATE_REPOSITORY);
}

let instance: AppUpdater | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/** Wires the process-wide updater; `index.ts` calls this once with the real shutdown. */
export function configureAppUpdater(overrides: Partial<AppUpdaterDependencies> & { readonly shutdown: () => Promise<void> }): AppUpdater {
  const execPath = process.execPath;
  const support = overrides.support ?? detectUpdateSupport({ platform: process.platform, execPath, desktopShell: process.env.BG_DESKTOP === "1" });
  instance = createAppUpdater({
    currentVersion: overrides.currentVersion ?? APP_VERSION,
    cacheDir: overrides.cacheDir ?? appCacheDir,
    source: overrides.source ?? resolveUpdateSource(),
    support,
    updaterPath: overrides.updaterPath ?? updaterBinaryPath(execPath),
    spawn: overrides.spawn ?? ((cmd) => { Bun.spawn([...cmd], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref(); }),
    shutdown: overrides.shutdown,
    ...(overrides.scheduleShutdown === undefined ? {} : { scheduleShutdown: overrides.scheduleShutdown }),
  });
  return instance;
}

export function getAppUpdater(): AppUpdater {
  return instance ?? configureAppUpdater({ shutdown: async () => {} });
}

/** Background checks mirror the Windows shell: once shortly after launch, then every six hours. */
export function startAppUpdateScheduler(updater: AppUpdater): void {
  if (!updater.status().supported || timer !== null) return;
  const first = setTimeout(() => { void updater.check(); }, FIRST_CHECK_DELAY_MS);
  first.unref();
  timer = setInterval(() => { void updater.check(); }, CHECK_INTERVAL_MS);
  timer.unref();
}
