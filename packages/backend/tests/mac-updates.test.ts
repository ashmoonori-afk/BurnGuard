import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  compareVersions,
  createAppUpdater,
  detectUpdateSupport,
  parseVelopackFeed,
  selectUpdate,
  type AppUpdateSource,
  type VelopackFeedAsset,
} from "../src/services/mac-updates";

const asset = (overrides: Partial<VelopackFeedAsset> = {}): VelopackFeedAsset => ({
  PackageId: "BurnGuard", Version: "0.5.2", Type: "Full", FileName: "BurnGuard-0.5.2-osx-full.nupkg", SHA256: "AB".repeat(32), Size: 3, ...overrides,
});

function fakeSource(assets: readonly VelopackFeedAsset[], bytes: Record<string, Uint8Array>): AppUpdateSource & { readonly fetches: string[] } {
  const fetches: string[] = [];
  return {
    fetches,
    async fetchFeed() { fetches.push("feed"); return { Assets: assets }; },
    async openPackage(fileName) {
      fetches.push(fileName);
      const body = bytes[fileName];
      if (body === undefined) throw new Error(`missing package ${fileName}`);
      return new Response(body, { headers: { "content-length": String(body.byteLength) } });
    },
  };
}

describe("velopack feed selection", () => {
  test("Given a releases.osx.json feed When parsed Then only well-formed assets survive", () => {
    const parsed = parseVelopackFeed({ Assets: [asset(), { PackageId: "BurnGuard", Version: "x", Type: "Full", FileName: "bad.nupkg", SHA256: "00", Size: 1 }, { Type: "Delta" }] });
    expect(parsed.map((entry) => entry.FileName)).toEqual(["BurnGuard-0.5.2-osx-full.nupkg"]);
    expect(() => parseVelopackFeed({})).toThrow("invalid_update_feed");
    expect(() => parseVelopackFeed("Assets")).toThrow("invalid_update_feed");
  });

  test("Given semantic versions When compared Then numeric order wins and prereleases sort below their release", () => {
    expect(compareVersions("0.5.2", "0.5.1")).toBeGreaterThan(0);
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
  });

  test("Given current 0.5.1 When the feed carries newer, equal, older, delta and foreign packages Then the newest full package above current is selected", () => {
    const assets = [
      asset({ Version: "0.5.1", FileName: "same.nupkg" }),
      asset({ Version: "0.4.9", FileName: "older.nupkg" }),
      asset({ Version: "0.6.0", Type: "Delta", FileName: "delta.nupkg" }),
      asset({ Version: "0.7.0", PackageId: "OtherApp", FileName: "other.nupkg" }),
      asset({ Version: "0.5.2", FileName: "next.nupkg" }),
      asset({ Version: "0.5.3", FileName: "newest.nupkg" }),
    ];
    expect(selectUpdate(assets, "0.5.1")?.FileName).toBe("newest.nupkg");
    expect(selectUpdate([asset({ Version: "0.5.1" })], "0.5.1")).toBeNull();
    expect(selectUpdate([asset({ Version: "0.4.0" })], "0.5.1")).toBeNull();
  });
});

describe("update support detection", () => {
  test("Given the packed bundle layout When the updater binary sits beside the executable Then macOS updates are supported, otherwise not", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-mac-updates-"));
    try {
      const macos = path.join(root, "BurnGuard.app", "Contents", "MacOS");
      await Bun.write(path.join(macos, "burnguard-design"), "bin");
      expect(detectUpdateSupport({ platform: "darwin", execPath: path.join(macos, "burnguard-design"), desktopShell: false })).toEqual({ supported: false, reason: "not_installed" });
      await writeFile(path.join(macos, "UpdateMac"), "#!/bin/sh\n", "utf8");
      await chmod(path.join(macos, "UpdateMac"), 0o755);
      expect(detectUpdateSupport({ platform: "darwin", execPath: path.join(macos, "burnguard-design"), desktopShell: false })).toEqual({ supported: true, reason: null });
      expect(detectUpdateSupport({ platform: "win32", execPath: path.join(macos, "burnguard-design"), desktopShell: true })).toEqual({ supported: false, reason: "windows_shell" });
      expect(detectUpdateSupport({ platform: "linux", execPath: path.join(macos, "burnguard-design"), desktopShell: false })).toEqual({ supported: false, reason: "platform" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("Given a native macOS shell with UpdateMac When support is detected Then updates remain enabled", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-mac-native-support-"));
    try {
      const macos = path.join(root, "BurnGuard.app", "Contents", "MacOS");
      await Bun.write(path.join(macos, "burnguard-design"), "bin");
      await writeFile(path.join(macos, "UpdateMac"), "#!/bin/sh\n", "utf8");
      await chmod(path.join(macos, "UpdateMac"), 0o755);
      expect(
        detectUpdateSupport({
          platform: "darwin",
          execPath: path.join(macos, "burnguard-design"),
          desktopShell: true,
        }),
      ).toEqual({ supported: true, reason: null });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("app updater flow", () => {
  test("Given a newer full package When checked Then it is downloaded, verified and staged; equal versions stay idle; corrupt bytes fail closed", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-updater-"));
    try {
      const good = new TextEncoder().encode("pkg");
      const sha = createHash("sha256").update(good).digest("hex").toUpperCase();
      const upToDate = createAppUpdater({ currentVersion: "0.5.2", cacheDir: root, source: fakeSource([asset({ SHA256: sha })], { "BurnGuard-0.5.2-osx-full.nupkg": good }), support: { supported: true, reason: null }, updaterPath: "/unused", spawn: () => { throw new Error("must not spawn"); }, shutdown: async () => {} });
      await upToDate.check();
      expect(upToDate.status()).toMatchObject({ state: "idle", available_version: null, error: null });

      const updater = createAppUpdater({ currentVersion: "0.5.1", cacheDir: root, source: fakeSource([asset({ SHA256: sha })], { "BurnGuard-0.5.2-osx-full.nupkg": good }), support: { supported: true, reason: null }, updaterPath: "/unused", spawn: () => { throw new Error("must not spawn"); }, shutdown: async () => {} });
      await updater.check();
      expect(updater.status()).toMatchObject({ state: "ready", available_version: "0.5.2", current_version: "0.5.1", error: null });
      expect(await readFile(path.join(root, "updates", "BurnGuard-0.5.2-osx-full.nupkg"))).toEqual(Buffer.from(good));

      const corrupt = createAppUpdater({ currentVersion: "0.5.1", cacheDir: root, source: fakeSource([asset({ SHA256: sha })], { "BurnGuard-0.5.2-osx-full.nupkg": new TextEncoder().encode("bad") }), support: { supported: true, reason: null }, updaterPath: "/unused", spawn: () => { throw new Error("must not spawn"); }, shutdown: async () => {} });
      await corrupt.check();
      expect(corrupt.status()).toMatchObject({ state: "error", error: "package_digest_mismatch" });
      expect(await Bun.file(path.join(root, "updates", "BurnGuard-0.5.2-osx-full.nupkg.partial")).exists()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("Given a staged package When applied Then the bundled updater is started with the package and this pid, then shutdown runs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-updater-apply-"));
    try {
      const good = new TextEncoder().encode("pkg");
      const sha = createHash("sha256").update(good).digest("hex").toUpperCase();
      const spawned: string[][] = [];
      let shutdowns = 0;
      const updater = createAppUpdater({ currentVersion: "0.5.1", cacheDir: root, source: fakeSource([asset({ SHA256: sha })], { "BurnGuard-0.5.2-osx-full.nupkg": good }), support: { supported: true, reason: null }, updaterPath: "/Applications/BurnGuard.app/Contents/MacOS/UpdateMac", waitPid: 4242, spawn: (cmd) => { spawned.push(cmd); }, shutdown: async () => { shutdowns += 1; }, scheduleShutdown: (run) => run() });
      expect(await updater.apply()).toBe("not_ready");
      await updater.check();
      expect(await updater.apply()).toBe("applying");
      expect(spawned).toEqual([["/Applications/BurnGuard.app/Contents/MacOS/UpdateMac", "apply", "--package", path.join(root, "updates", "BurnGuard-0.5.2-osx-full.nupkg"), "--waitPid", "4242"]]);
      expect(shutdowns).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("Given a staged package modified after download When checked again Then tampering clears readiness and blocks apply", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-updater-tamper-"));
    try {
      const good = new TextEncoder().encode("pkg");
      const sha = createHash("sha256").update(good).digest("hex").toUpperCase();
      const spawned: string[][] = [];
      let shutdowns = 0;
      const updater = createAppUpdater({
        currentVersion: "0.5.1",
        cacheDir: root,
        source: fakeSource(
          [asset({ SHA256: sha })],
          { "BurnGuard-0.5.2-osx-full.nupkg": good },
        ),
        support: { supported: true, reason: null },
        updaterPath: "/Applications/BurnGuard.app/Contents/MacOS/UpdateMac",
        spawn: (cmd) => { spawned.push([...cmd]); },
        shutdown: async () => { shutdowns += 1; },
        scheduleShutdown: (run) => run(),
      });
      await updater.check();
      await writeFile(
        path.join(root, "updates", "BurnGuard-0.5.2-osx-full.nupkg"),
        "tampered",
        "utf8",
      );

      expect(await updater.apply()).toBe("not_ready");
      expect(updater.status()).toMatchObject({
        state: "error",
        error: "package_digest_mismatch",
      });
      expect(spawned).toEqual([]);
      expect(shutdowns).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("Given an offline feed When checked Then the error is typed and a later check recovers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-updater-offline-"));
    try {
      let online = false;
      const good = new TextEncoder().encode("pkg");
      const sha = createHash("sha256").update(good).digest("hex").toUpperCase();
      const source: AppUpdateSource = { async fetchFeed() { if (!online) throw new Error("ECONNREFUSED"); return { Assets: [asset({ SHA256: sha })] }; }, async openPackage() { return new Response(good); } };
      const updater = createAppUpdater({ currentVersion: "0.5.1", cacheDir: root, source, support: { supported: true, reason: null }, updaterPath: "/unused", spawn: () => {}, shutdown: async () => {} });
      await updater.check();
      expect(updater.status()).toMatchObject({ state: "error", error: "update_check_failed" });
      online = true;
      await updater.check();
      expect(updater.status().state).toBe("ready");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("Given an unsupported host When checked or applied Then nothing is fetched", async () => {
    const source = fakeSource([asset()], {});
    const updater = createAppUpdater({ currentVersion: "0.5.1", cacheDir: tmpdir(), source, support: { supported: false, reason: "platform" }, updaterPath: "/unused", spawn: () => {}, shutdown: async () => {} });
    await updater.check();
    expect(await updater.apply()).toBe("unsupported");
    expect(updater.status()).toMatchObject({ supported: false, unsupported_reason: "platform", state: "unsupported" });
    expect(source.fetches).toEqual([]);
  });
});
