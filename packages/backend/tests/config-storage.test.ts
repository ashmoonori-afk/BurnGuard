import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { readFile, stat, writeFile } from "node:fs/promises";
import { defaultConfig, ensureConfig, loadConfig, saveConfig } from "../src/config";
import { configFilePath } from "../src/lib/app-paths";
import { homeRoutes } from "../src/routes/home";

beforeEach(() => saveConfig(structuredClone(defaultConfig)));
afterAll(() => saveConfig(structuredClone(defaultConfig)));

describe("settings storage", () => {
  test("Given existing settings When GET and startup read them Then neither rewrites the file", async () => {
    const before = await stat(configFilePath);
    expect((await homeRoutes.request("http://local/api/settings")).status).toBe(200);
    await ensureConfig();
    const after = await stat(configFilePath);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.ino).toBe(before.ino);
  });

  test("Given simultaneous independent patches When stored Then all changes survive and secrets stay private", async () => {
    const patches = [{ theme: "dark" }, { user: { display_name: "동시 수정" } }, { figma_personal_access_token: "fixture-private-token" }, { chat_context_mode: "full" }];
    const responses = await Promise.all(patches.map((patch) => homeRoutes.request("http://local/api/settings", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch),
    })));
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain("fixture-private-token");
    }
    const config = await loadConfig();
    expect(config.theme).toBe("dark");
    expect(config.user.displayName).toBe("동시 수정");
    expect(config.figmaPersonalAccessToken).toBe("fixture-private-token");
    expect(config.chat.contextMode).toBe("full");
    expect(JSON.parse(await readFile(configFilePath, "utf8"))).toEqual(config);
  });

  test("Given a corrupt settings file When loaded or bootstrapped Then its original bytes are preserved", async () => {
    const corrupt = "{broken-config";
    await writeFile(configFilePath, corrupt);
    await expect(loadConfig()).rejects.toThrow("config_read_failed");
    await expect(ensureConfig()).rejects.toThrow("config_read_failed");
    expect(await readFile(configFilePath, "utf8")).toBe(corrupt);
  });

  test("Given invalid persisted field types When loaded Then runtime settings remain valid", async () => {
    await writeFile(configFilePath, JSON.stringify({ user: null, harness: { maxConcurrentSessions: -1 }, chat: { abortThresholdMs: "never" }, theme: "invalid", port: -2 }));
    expect(await loadConfig()).toEqual(defaultConfig);
  });
});
