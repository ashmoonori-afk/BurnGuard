import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { settingsRoutes } from "../src/routes/settings";
import { configureAppUpdater, type AppUpdateSource } from "../src/services/mac-updates";

const bytes = new TextEncoder().encode("pkg");
const sha = createHash("sha256").update(bytes).digest("hex").toUpperCase();
const feed = { Assets: [{ PackageId: "BurnGuard", Version: "9.9.9", Type: "Full", FileName: "BurnGuard-9.9.9-osx-full.nupkg", SHA256: sha, Size: bytes.byteLength }] };
const tempDirs: string[] = [];

afterAll(async () => { for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe("application update routes", () => {
  test("Given a supported host When status, check and apply are requested Then the contract states flow idle -> ready -> applying and shutdown runs once", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "bg-update-routes-"));
    tempDirs.push(cacheDir);
    const spawned: string[][] = [];
    let shutdowns = 0;
    const source: AppUpdateSource = { async fetchFeed() { return feed; }, async openPackage() { return new Response(bytes); } };
    configureAppUpdater({ currentVersion: "0.5.1", cacheDir, source, support: { supported: true, reason: null }, updaterPath: "/bundle/UpdateMac", spawn: (cmd) => { spawned.push([...cmd]); }, shutdown: async () => { shutdowns += 1; }, scheduleShutdown: (run) => run() });

    const initial = await settingsRoutes.request("http://local/api/settings/updates");
    expect(initial.status).toBe(200);
    expect((await initial.json()).data).toMatchObject({ supported: true, state: "idle", current_version: "0.5.1", available_version: null });

    const early = await settingsRoutes.request("http://local/api/settings/updates/apply", { method: "POST" });
    expect(early.status).toBe(409);
    expect((await early.json()).error.code).toBe("update_not_ready");

    const checked = await settingsRoutes.request("http://local/api/settings/updates/check", { method: "POST" });
    expect(checked.status).toBe(200);
    expect((await checked.json()).data).toMatchObject({ state: "ready", available_version: "9.9.9" });

    const applied = await settingsRoutes.request("http://local/api/settings/updates/apply", { method: "POST" });
    expect(applied.status).toBe(202);
    expect((await applied.json()).data).toEqual({ accepted: true });
    expect(spawned).toEqual([["/bundle/UpdateMac", "apply", "--package", path.join(cacheDir, "updates", "BurnGuard-9.9.9-osx-full.nupkg"), "--waitPid", String(process.pid)]]);
    expect(shutdowns).toBe(1);
  });

  test("Given an unsupported host When check or apply is requested Then the routes refuse without touching the feed", async () => {
    let fetches = 0;
    const source: AppUpdateSource = { async fetchFeed() { fetches += 1; return feed; }, async openPackage() { return new Response(bytes); } };
    configureAppUpdater({ currentVersion: "0.5.1", cacheDir: tmpdir(), source, support: { supported: false, reason: "windows_shell" }, updaterPath: "/unused", spawn: () => {}, shutdown: async () => {} });
    const status = await settingsRoutes.request("http://local/api/settings/updates");
    expect((await status.json()).data).toMatchObject({ supported: false, unsupported_reason: "windows_shell", state: "unsupported" });
    const checked = await settingsRoutes.request("http://local/api/settings/updates/check", { method: "POST" });
    expect(checked.status).toBe(409);
    expect((await checked.json()).error.code).toBe("update_unsupported");
    const applied = await settingsRoutes.request("http://local/api/settings/updates/apply", { method: "POST" });
    expect(applied.status).toBe(409);
    expect((await applied.json()).error.code).toBe("update_unsupported");
    expect(fetches).toBe(0);
  });
});
