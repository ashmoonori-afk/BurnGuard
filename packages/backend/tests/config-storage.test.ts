import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { DEFAULT_DISPLAY_NAME } from "@bg/shared";
import { defaultConfig, ensureConfig, loadConfig, loadConfigForPlatform, saveConfig, saveConfigForPlatform } from "../src/config";
import { configFilePath, localConfigFilePath } from "../src/lib/app-paths";
import { homeRoutes } from "../src/routes/home";

const platforms: NodeJS.Platform[] = ["darwin", "win32", "linux"];

async function reset(): Promise<void> {
  await rm(configFilePath, { force: true });
  await Promise.all(platforms.map((platform) => rm(localConfigFilePath(platform), { force: true })));
  await saveConfig(structuredClone(defaultConfig));
}

beforeEach(reset);
afterAll(reset);

describe("settings storage", () => {
  test("Given shared and OS-local values When saved Then each canonical file contains only its classification", async () => {
    await saveConfig({
      ...structuredClone(defaultConfig), theme: "dark", locale: "en", port: 15432,
      commandcodeApiKey: "fixture-commandcode-private", figmaPersonalAccessToken: "fixture-figma-private",
      llmApiKeys: { gemini: "fixture-gemini-private", deepseek: null, xai: null },
      playwright: { installed: true, installPath: "/fixture/browser" },
    });
    const shared = JSON.parse(await readFile(configFilePath, "utf8"));
    const local = JSON.parse(await readFile(localConfigFilePath(), "utf8"));
    expect(shared).toEqual({
      schemaVersion: 1, generationDefaults: {}, defaultBackend: "claude-code", theme: "dark", locale: "en",
      chat: defaultConfig.chat, user: { displayName: DEFAULT_DISPLAY_NAME },
    });
    expect(JSON.stringify(shared)).not.toContain("private");
    expect(Object.keys(local).sort()).toEqual(["autoOpenBrowser", "commandcodeApiKey", "figmaPersonalAccessToken", "harness", "llmApiKeys", "logs", "platform", "playwright", "port", "schemaVersion"].sort());
    expect(local.platform).toBe(process.platform);
    expect((await loadConfig()).port).toBe(15432);
  });

  test("Given CommandCode credentials, locale, and generation defaults When patched and cleared Then credentials remain write-only", async () => {
    const generation = { model: "", effort: "low", vanilla: true, provider: "commandcode" } as const;
    const response = await homeRoutes.request("http://local/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandcode_api_key: "fixture-commandcode-private", locale: "zh-CN", generation_defaults: { "claude-code": generation } }) });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain("fixture-commandcode-private");
    expect(JSON.parse(body).data).toMatchObject({ commandcode_api_key_set: true, locale: "zh-CN" });
    expect((await loadConfig()).generationDefaults["claude-code"]).toEqual(generation);
    const cleared = await homeRoutes.request("http://local/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandcode_api_key: null }) });
    expect((await cleared.json()).data.commandcode_api_key_set).toBe(false);
    const invalid = await homeRoutes.request("http://local/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ locale: "fr" }) });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe("invalid_locale");
  });

  test("Given canonical settings When GET and startup read them Then neither file is rewritten", async () => {
    const before = [await stat(configFilePath), await stat(localConfigFilePath())];
    expect((await homeRoutes.request("http://local/api/settings")).status).toBe(200);
    await ensureConfig();
    const after = [await stat(configFilePath), await stat(localConfigFilePath())];
    expect(after.map(({ mtimeMs, ino }) => [mtimeMs, ino])).toEqual(before.map(({ mtimeMs, ino }) => [mtimeMs, ino]));
  });

  test("Given simultaneous independent patches When stored Then all changes survive and secrets stay local", async () => {
    const patches = [{ theme: "dark" }, { user: { display_name: "동시 수정" } }, { figma_personal_access_token: "fixture-private-token" }, { chat_context_mode: "full" }];
    const responses = await Promise.all(patches.map((patch) => homeRoutes.request("http://local/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) })));
    for (const response of responses) { expect(response.status).toBe(200); expect(await response.text()).not.toContain("fixture-private-token"); }
    const config = await loadConfig();
    expect(config).toMatchObject({ theme: "dark", figmaPersonalAccessToken: "fixture-private-token", chat: { contextMode: "full" }, user: { displayName: "동시 수정" } });
    expect(await readFile(configFilePath, "utf8")).not.toContain("fixture-private-token");
    expect(await readFile(localConfigFilePath(), "utf8")).toContain("fixture-private-token");
  });

  test("Given a complete legacy file When migrated and restarted twice Then every recognized value survives and migration is idempotent", async () => {
    const legacy = {
      generationDefaults: { codex: { model: "gpt-5", effort: "high", vanilla: false } }, commandcodeApiKey: "legacy-commandcode",
      llmApiKeys: { gemini: "legacy-gemini", deepseek: "legacy-deepseek", xai: "legacy-xai" }, defaultBackend: "codex", theme: "auto", locale: "en",
      port: 15555, autoOpenBrowser: false, playwright: { installed: true, installPath: "/legacy/browser" },
      harness: { maxConcurrentSessions: 8, checkpointEveryTurns: 11, toolAutoAllow: false }, chat: { abortThresholdMs: 1234, contextMode: "full" },
      logs: { level: "warn" }, user: { id: "local", displayName: "Legacy User" }, figmaPersonalAccessToken: "legacy-figma", unknown: "discard",
    };
    await rm(localConfigFilePath(), { force: true }); await writeFile(configFilePath, JSON.stringify(legacy));
    const first = await loadConfig();
    const firstShared = await readFile(configFilePath, "utf8"); const firstLocal = await readFile(localConfigFilePath(), "utf8");
    expect(first).toMatchObject({ commandcodeApiKey: "legacy-commandcode", llmApiKeys: legacy.llmApiKeys, defaultBackend: "codex", theme: "auto", locale: "en", port: 15555, autoOpenBrowser: false, playwright: legacy.playwright, harness: legacy.harness, chat: legacy.chat, logs: legacy.logs, user: { displayName: "Legacy User" }, figmaPersonalAccessToken: "legacy-figma" });
    expect(await loadConfig()).toEqual(first); expect(await loadConfig()).toEqual(first);
    expect(await readFile(configFilePath, "utf8")).toBe(firstShared); expect(await readFile(localConfigFilePath(), "utf8")).toBe(firstLocal);
    expect(firstShared).not.toContain("legacy-commandcode"); expect(firstShared).not.toContain("unknown"); expect(firstLocal).not.toContain("unknown");
  });

  test("Given an existing current local file during legacy migration When loaded Then current local values are authoritative", async () => {
    const current = { ...structuredClone(defaultConfig), commandcodeApiKey: "current-secret", port: 16666 };
    await saveConfig(current);
    const localBytes = await readFile(localConfigFilePath(), "utf8");
    await writeFile(configFilePath, JSON.stringify({ theme: "dark", commandcodeApiKey: "legacy-secret", port: 17777 }));
    const loaded = await loadConfig();
    expect(loaded).toMatchObject({ theme: "dark", commandcodeApiKey: "current-secret", port: 16666 });
    expect(JSON.parse(localBytes).commandcodeApiKey).toBe("current-secret");
  });

  test("Given local-first publication was interrupted When restarted Then pending shared values publish and clean up idempotently", async () => {
    const shared = JSON.parse(await readFile(configFilePath, "utf8"));
    const local = JSON.parse(await readFile(localConfigFilePath(), "utf8"));
    await writeFile(localConfigFilePath(), JSON.stringify({ ...local, port: 18888, pendingShared: { ...shared, theme: "dark", locale: "zh-CN" } }));
    const recovered = await loadConfig();
    expect(recovered).toMatchObject({ theme: "dark", locale: "zh-CN", port: 18888 });
    expect(JSON.parse(await readFile(localConfigFilePath(), "utf8"))).not.toHaveProperty("pendingShared");
    const bytes = [await readFile(configFilePath, "utf8"), await readFile(localConfigFilePath(), "utf8")];
    await loadConfig();
    expect([await readFile(configFilePath, "utf8"), await readFile(localConfigFilePath(), "utf8")]).toEqual(bytes);
  });

  test("Given a malformed pending shared snapshot When loaded Then both canonical files fail closed without byte changes", async () => {
    const sharedBefore = await readFile(configFilePath, "utf8");
    const local = JSON.parse(await readFile(localConfigFilePath(), "utf8"));
    await writeFile(localConfigFilePath(), JSON.stringify({ ...local, pendingShared: { schemaVersion: 2, theme: "dark" } }));
    const localBefore = await readFile(localConfigFilePath(), "utf8");
    await expect(loadConfig()).rejects.toThrow("config_read_failed");
    expect(await readFile(configFilePath, "utf8")).toBe(sharedBefore);
    expect(await readFile(localConfigFilePath(), "utf8")).toBe(localBefore);
  });

  test("Given two simulated OSes When shared and local settings change Then shared preferences cross OSes and local values do not", async () => {
    await saveConfigForPlatform({ ...structuredClone(defaultConfig), theme: "dark", commandcodeApiKey: "darwin-secret", port: 15001 }, "darwin");
    const windowsInitial = await loadConfigForPlatform("win32");
    expect(windowsInitial).toMatchObject({ theme: "dark", commandcodeApiKey: null, port: null });
    await saveConfigForPlatform({ ...windowsInitial, commandcodeApiKey: "windows-secret", port: 15002, defaultBackend: "codex" }, "win32");
    expect(await loadConfigForPlatform("darwin")).toMatchObject({ theme: "dark", defaultBackend: "codex", commandcodeApiKey: "darwin-secret", port: 15001 });
    expect(await loadConfigForPlatform("win32")).toMatchObject({ commandcodeApiKey: "windows-secret", port: 15002 });
  });

  test("Given corrupt shared or mismatched current-platform data When loaded Then bytes are preserved and foreign OS bytes are untouched", async () => {
    const corrupt = "{broken-config"; await writeFile(configFilePath, corrupt);
    await expect(loadConfig()).rejects.toThrow("config_read_failed"); expect(await readFile(configFilePath, "utf8")).toBe(corrupt);
    await reset();
    const localPath = localConfigFilePath(); const mismatch = JSON.stringify({ schemaVersion: 1, platform: process.platform === "win32" ? "darwin" : "win32" });
    await writeFile(localPath, mismatch);
    const foreignPlatform: NodeJS.Platform = process.platform === "win32" ? "darwin" : "win32";
    const foreignPath = localConfigFilePath(foreignPlatform); const foreign = '{"foreign":"bytes"}'; await writeFile(foreignPath, foreign);
    await expect(loadConfig()).rejects.toThrow("config_read_failed");
    expect(await readFile(localPath, "utf8")).toBe(mismatch); expect(await readFile(foreignPath, "utf8")).toBe(foreign);
  });
});
