import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_DISPLAY_NAME } from "@bg/shared";
import { defaultConfig, ensureConfig, loadConfig, loadConfigForPlatform, saveConfig, saveConfigForPlatform } from "../src/config";
import { codexSpawnOptions } from "../src/adapters/codex";
import type { AdapterRunInput } from "../src/adapters/types";
import { getSqlite } from "../src/db/sqlite-client";
import { configFilePath, localConfigFilePath } from "../src/lib/app-paths";
import { projectsDir } from "../src/lib/paths";
import { startUserTurn } from "../src/services/turns";
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
      chat: defaultConfig.chat, user: { displayName: DEFAULT_DISPLAY_NAME }, publish: { madeWithBadge: true },
      webAssets: { searchEnabled: true },
    });
    expect(JSON.stringify(shared)).not.toContain("private");
    expect(Object.keys(local).sort()).toEqual(["autoOpenBrowser", "codexProgressMetrics", "commandcodeApiKey", "figmaPersonalAccessToken", "harness", "llmApiKeys", "logs", "platform", "playwright", "port", "schemaVersion", "vercelToken"].sort());
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

  test("Given a Vercel token and badge preference When patched Then only a boolean leaves the API and the token stays OS-local", async () => {
    const fixtureValue = "vercel-fixture-aaaaaaaaaaaa";
    const response = await homeRoutes.request("http://local/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ vercel_token: ` ${fixtureValue} `, publish_made_with_badge: false }) });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain(fixtureValue);
    expect(JSON.parse(body).data).toMatchObject({ vercel_token_set: true, publish_made_with_badge: false });
    const status = await (await homeRoutes.request("http://local/api/settings")).text();
    expect(status).not.toContain(fixtureValue);
    expect(JSON.parse(status).data.vercel_token_set).toBe(true);
    expect(await readFile(configFilePath, "utf8")).not.toContain(fixtureValue);
    expect(JSON.parse(await readFile(localConfigFilePath(), "utf8")).vercelToken).toBe(fixtureValue);
    expect(JSON.parse(await readFile(configFilePath, "utf8")).publish).toEqual({ madeWithBadge: false });
    const cleared = await homeRoutes.request("http://local/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ vercel_token: "" }) });
    expect((await cleared.json()).data.vercel_token_set).toBe(false);
    for (const [patch, code] of [[{ vercel_token: "short" }, "invalid_vercel_token"], [{ vercel_token: 42 }, "invalid_vercel_token"], [{ publish_made_with_badge: "yes" }, "invalid_publish_badge"]] as const) {
      const invalid = await homeRoutes.request("http://local/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
      expect(invalid.status).toBe(400);
      expect((await invalid.json()).error.code).toBe(code);
    }
  });

  test("Given malformed publish settings on disk When loaded Then the badge defaults on and an invalid token is dropped", async () => {
    const shared = JSON.parse(await readFile(configFilePath, "utf8"));
    await writeFile(configFilePath, JSON.stringify({ ...shared, publish: { madeWithBadge: "false" } }));
    const local = JSON.parse(await readFile(localConfigFilePath(), "utf8"));
    await writeFile(localConfigFilePath(), JSON.stringify({ ...local, vercelToken: "bad token with spaces" }));
    const loaded = await loadConfig();
    expect(loaded.publish).toEqual({ madeWithBadge: true });
    expect(loaded.vercelToken).toBeNull();
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

describe("Codex progress metrics setting", () => {
  const patch = (body: unknown) => homeRoutes.request("http://local/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const summary = async () => (await (await homeRoutes.request("http://local/api/settings")).json()).data;
  const codexConfig = () => path.join(process.env.CODEX_HOME ?? "", "config.toml");
  const USER_OTEL_TOML = '[otel]\nmetrics_exporter = { otlp-http = { endpoint = "https://collector.example/v1/metrics", protocol = "json" } }\n';
  const inheritedOtel = Object.entries(process.env).filter(([name]) => name.startsWith("OTEL_EXPORTER_OTLP_"));

  beforeEach(async () => {
    for (const [name] of inheritedOtel) delete process.env[name];
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    await rm(codexConfig(), { force: true });
  });
  afterAll(async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    for (const [name, value] of inheritedOtel) process.env[name] = value;
    await rm(codexConfig(), { force: true });
  });

  test("Given no stored choice and no user OTel destination When settings load Then the signal is on by default and the choice stays unset", async () => {
    expect(defaultConfig.codexProgressMetrics).toBeNull();
    expect((await loadConfig()).codexProgressMetrics).toBeNull();
    expect(await summary()).toMatchObject({ codex_progress_metrics: true, codex_user_otel_configured: false });
    expect(JSON.parse(await readFile(localConfigFilePath(), "utf8")).codexProgressMetrics).toBeNull();
  });

  test("Given a user OTel destination in the Codex config or the environment When settings load Then the signal is off and the flag is set, without storing the detection", async () => {
    await writeFile(codexConfig(), USER_OTEL_TOML);
    expect(await summary()).toMatchObject({ codex_progress_metrics: false, codex_user_otel_configured: true });
    await rm(codexConfig());
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://collector.example";
    expect(await summary()).toMatchObject({ codex_progress_metrics: false, codex_user_otel_configured: true });
    expect((await loadConfig()).codexProgressMetrics).toBeNull();
    expect(await readFile(localConfigFilePath(), "utf8")).not.toContain("collector.example");
  });

  test("Given a user OTel destination When the user turns the signal on or off Then the explicit choice wins and persists OS-local only", async () => {
    await writeFile(codexConfig(), USER_OTEL_TOML);
    const on = await patch({ codex_progress_metrics: true });
    expect(on.status).toBe(200);
    expect((await on.json()).data).toMatchObject({ codex_progress_metrics: true, codex_user_otel_configured: true });
    expect(JSON.parse(await readFile(localConfigFilePath(), "utf8")).codexProgressMetrics).toBe(true);
    expect(JSON.parse(await readFile(configFilePath, "utf8"))).not.toHaveProperty("codexProgressMetrics");
    const other = process.platform === "win32" ? "darwin" : "win32";
    expect((await loadConfigForPlatform(other)).codexProgressMetrics).toBeNull();
    await rm(codexConfig());
    expect((await (await patch({ codex_progress_metrics: false })).json()).data).toMatchObject({ codex_progress_metrics: false, codex_user_otel_configured: false });
    expect((await loadConfig()).codexProgressMetrics).toBe(false);
    const invalid = await patch({ codex_progress_metrics: "yes" });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe("invalid_codex_progress_metrics");
    expect((await loadConfig()).codexProgressMetrics).toBe(false);
  });

  test("Given a non-boolean stored value When loaded Then the choice reads as unset", async () => {
    await writeFile(localConfigFilePath(), JSON.stringify({ ...JSON.parse(await readFile(localConfigFilePath(), "utf8")), codexProgressMetrics: "true" }));
    expect((await loadConfig()).codexProgressMetrics).toBeNull();
  });

  test("Given each default, detection and explicit state When a Codex turn runs Then the adapter is asked for the progress signal only while it is effectively on", async () => {
    const projectId = `codex-progress-${crypto.randomUUID()}`;
    const sessionId = `${projectId}-session`;
    const projectDir = path.join(projectsDir, projectId);
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, "index.html"), "<main>Base</main>");
    getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, projectId, projectDir);
    getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
    const seen: (boolean | undefined)[] = [];
    const plainSpawnKeys: string[] = [];
    const runTurn = async () => {
      const turn = startUserTurn(sessionId, { type: "user.message", text: "Edit the heading" }, undefined, {
        reviewDesign: async () => ({ status: "unavailable", repairs: 0, result: null }),
        detectBackends: async () => ({ backends: [{ id: "codex", found: true, binary_path: "unused", version: "fixture", authenticated: true, image_generation: true }] }),
        runAdapter: async (_backend, input: AdapterRunInput) => {
          seen.push(input.codexProgressMetrics);
          // Without the flag the Codex adapter takes the plain launch (codex-runner pins it to main's spawn).
          if (input.codexProgressMetrics !== true) plainSpawnKeys.push(Object.keys(codexSpawnOptions(input, undefined)).sort().join());
          await input.onEvent({ id: crypto.randomUUID(), ts: 5, type: "chat.message_end", turnId: input.turnId });
          await input.onEvent({ id: crypto.randomUUID(), ts: 6, type: "status.idle", stopReason: "end_turn" });
          return { exitCode: 0 };
        },
      });
      if (turn === null) throw new Error("turn_reservation_missing");
      await turn.promise.catch(() => undefined);
    };
    try {
      await runTurn(); // default, no user destination: on
      await writeFile(codexConfig(), USER_OTEL_TOML);
      await runTurn(); // user destination in the Codex config: off
      await rm(codexConfig());
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://collector.example";
      await runTurn(); // user destination in the environment: off
      expect((await patch({ codex_progress_metrics: true })).status).toBe(200);
      await runTurn(); // explicitly on despite the user destination: on
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      expect((await patch({ codex_progress_metrics: false })).status).toBe(200);
      await runTurn(); // explicitly off: off
      expect(seen).toEqual([true, undefined, undefined, true, undefined]);
      expect(plainSpawnKeys).toEqual(Array(3).fill("cmd,cwd,stderr,stdin,stdout"));
    } finally {
      getSqlite().prepare("DELETE FROM sessions WHERE id=?").run(sessionId);
      getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});
