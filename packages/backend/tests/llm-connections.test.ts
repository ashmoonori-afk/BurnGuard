import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { readFile, stat, writeFile } from "node:fs/promises";
import * as shared from "@bg/shared";
import { defaultConfig, loadConfig, saveConfig } from "../src/config";
import { configFilePath } from "../src/lib/app-paths";
import { homeRoutes } from "../src/routes/home";

const ids = ["gemini", "deepseek", "xai"] as const;
const keys = { gemini: "fixture-gemini-private", deepseek: "fixture-deepseek-private", xai: "fixture-xai-private" };
const emptyKeys = { gemini: null, deepseek: null, xai: null };
const patch = (body: unknown) => homeRoutes.request("http://local/api/settings", {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => saveConfig(structuredClone(defaultConfig)));
afterAll(() => saveConfig(structuredClone(defaultConfig)));

describe("configuration-only LLM connections", () => {
  test("registry and public defaults contain only the three non-generating connections", async () => {
    expect(shared.LLM_CONNECTIONS.map((connection) => connection.id)).toEqual(ids);
    const response = await homeRoutes.request("http://local/api/settings");
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.llm_connections).toEqual(shared.LLM_CONNECTIONS.map((connection) => ({ ...connection, api_key_set: false })));
    for (const connection of data.llm_connections) expect(connection.generation_status).toBe("not_implemented");
    expect((await loadConfig()).llmApiKeys).toEqual(emptyKeys);
  });

  test("legacy config loads unset connections without rewriting or losing CommandCode and unrelated settings", async () => {
    const legacy = { ...defaultConfig, commandcodeApiKey: "fixture-commandcode-private", theme: "dark", llmApiKeys: undefined };
    await writeFile(configFilePath, JSON.stringify(legacy));
    const before = await readFile(configFilePath, "utf8");
    const response = await homeRoutes.request("http://local/api/settings");
    expect(response.status).toBe(200);
    expect((await response.json()).data.llm_connections.map((connection: { api_key_set: boolean }) => connection.api_key_set)).toEqual([false, false, false]);
    expect(await readFile(configFilePath, "utf8")).toBe(before);
    expect(await loadConfig()).toMatchObject({ llmApiKeys: emptyKeys, commandcodeApiKey: legacy.commandcodeApiKey, theme: "dark" });
  });

  for (const id of ids) {
    test(`${id} key can be saved, replaced and deleted without appearing in GET or PATCH`, async () => {
      for (const value of [`  ${keys[id]}  `, `${keys[id]}-replacement`, null, keys[id], "   "]) {
        const response = await patch({ llm_api_keys: { [id]: value } });
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).not.toContain(keys[id]);
        const data = JSON.parse(text).data;
        expect(data.llm_api_keys).toBeUndefined();
        expect(data.llm_connections.find((connection: { id: string }) => connection.id === id)).toMatchObject({ api_key_set: Boolean(value?.trim()), generation_status: "not_implemented" });
        const get = await homeRoutes.request("http://local/api/settings");
        const getText = await get.text();
        expect(getText).not.toContain(keys[id]);
        expect(JSON.parse(getText).data).toEqual(data);
        expect((await loadConfig()).llmApiKeys).toEqual({ ...emptyKeys, [id]: value?.trim() || null });
      }
      const maximum = "k".repeat(4096);
      expect((await patch({ llm_api_keys: { [id]: maximum } })).status).toBe(200);
      expect((await loadConfig()).llmApiKeys[id]).toBe(maximum);
      if (process.platform !== "win32") expect((await stat(configFilePath)).mode & 0o777).toBe(0o600);
    });
  }

  test("independent concurrent key and existing-settings updates all survive atomic storage", async () => {
    const generation = { model: "", effort: "low", vanilla: true, provider: "commandcode" };
    const patches = [
      ...ids.map((id) => ({ llm_api_keys: { [id]: keys[id] } })),
      { commandcode_api_key: "fixture-commandcode-private", generation_defaults: { "claude-code": generation } },
      { theme: "dark", user: { display_name: "Concurrent" }, figma_personal_access_token: "fixture-figma-private", chat_context_mode: "full" },
    ];
    const responses = await Promise.all(patches.map(patch));
    for (const response of responses) {
      expect(response.status).toBe(200);
      const text = await response.text();
      for (const secret of [...Object.values(keys), "fixture-commandcode-private", "fixture-figma-private"]) expect(text).not.toContain(secret);
    }
    const config = await loadConfig();
    expect(config).toMatchObject({ llmApiKeys: keys, commandcodeApiKey: "fixture-commandcode-private", generationDefaults: { "claude-code": generation }, theme: "dark", user: { displayName: "Concurrent" }, figmaPersonalAccessToken: "fixture-figma-private", chat: { contextMode: "full" } });
    expect(JSON.parse(await readFile(configFilePath, "utf8"))).toEqual(config);
    expect((await patch({ llm_api_keys: {} })).status).toBe(200);
    expect((await loadConfig()).llmApiKeys).toEqual(keys);
  });

  const invalidMaps: unknown[] = [
    null, [], "key", true, 12,
    { gemini: "replacement", unknown: "secret" }, { grok: "secret" },
    JSON.parse('{"__proto__":"secret"}'), { constructor: "secret" },
    ...[false, 1, {}, [], "key\n", "key\r", "k".repeat(4097)].map((value) => ({ gemini: "replacement", deepseek: value })),
  ];
  for (const [index, value] of invalidMaps.entries()) {
    test(`invalid connection patch ${index} is rejected before any settings mutation`, async () => {
      expect((await patch({ llm_api_keys: keys, commandcode_api_key: "fixture-commandcode-private" })).status).toBe(200);
      const before = await readFile(configFilePath, "utf8");
      const inode = (await stat(configFilePath)).ino;
      const response = await patch({ llm_api_keys: value, theme: "dark", commandcode_api_key: "replacement-commandcode" });
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(JSON.parse(text).error.code).toBe("invalid_llm_api_keys");
      expect(text).not.toContain("replacement");
      expect(await readFile(configFilePath, "utf8")).toBe(before);
      expect((await stat(configFilePath)).ino).toBe(inode);
    });
  }

  test("valid keys are not saved if another field fails validation", async () => {
    const before = await readFile(configFilePath, "utf8");
    const response = await patch({ llm_api_keys: keys, theme: "invalid" });
    expect(response.status).toBe(400);
    expect(await readFile(configFilePath, "utf8")).toBe(before);
  });

  for (const id of ids) {
    test(`${id} remains unavailable for generation even after its key is saved`, async () => {
      expect((await patch({ llm_api_keys: { [id]: keys[id] } })).status).toBe(200);
      const before = await readFile(configFilePath, "utf8");
      const generation = { model: "", effort: "low", vanilla: true, provider: id };
      expect(() => shared.parseGenerationOptions(generation)).toThrow("invalid_generation_options");
      for (const [body, code] of [
        [{ default_backend: id }, "invalid_backend"],
        [{ generation_defaults: { [id]: shared.defaultGenerationOptions("claude-code") } }, "invalid_generation_options"],
        [{ generation_defaults: { "claude-code": generation } }, "invalid_generation_options"],
      ] as const) {
        const response = await patch(body);
        expect(response.status).toBe(400);
        expect((await response.json()).error.code).toBe(code);
      }
      const project = await homeRoutes.request("http://local/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Unsupported", type: "prototype", design_system_id: null, backend_id: id }) });
      expect(project.status).toBe(400);
      expect((await project.json()).error.code).toBe("invalid_backend");
      expect(await readFile(configFilePath, "utf8")).toBe(before);
    });
  }
});
