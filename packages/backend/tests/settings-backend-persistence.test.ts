import { describe, expect, test } from "bun:test";
import { BACKEND_IDS } from "@bg/shared";
import { defaultConfig, loadConfig, saveConfig } from "../src/config";

/**
 * Selecting a backend in settings has to survive a round trip through the config file.
 *
 * Driving the real picker found that it did not: the save reported success and the value silently
 * reverted to Claude Code. Three hardcoded two-value gates were the cause - the route's isBackendId,
 * the config parser's `=== "codex" ? "codex" : "claude-code"` coercion, and a generationDefaults loop
 * over a literal pair. This exercises the same path the UI uses: write the config, read it back.
 */
describe("Settings backend persistence", () => {
  test("Given any supported backend, then saving and reloading keeps it", async () => {
    for (const id of BACKEND_IDS) {
      await saveConfig({ ...defaultConfig, defaultBackend: id });
      expect((await loadConfig()).defaultBackend, id).toBe(id);
    }
  });

  test("Given per-backend generation defaults, then every provider's entry survives", async () => {
    const generationDefaults = Object.fromEntries(
      BACKEND_IDS.map((id) => [id, { model: "", effort: "low" as const, vanilla: true, provider: "native" as const }]),
    );
    await saveConfig({ ...defaultConfig, generationDefaults });
    const loaded = await loadConfig();
    expect(Object.keys(loaded.generationDefaults).sort()).toEqual([...BACKEND_IDS].sort());
  });

  test("Given an unknown backend on disk, then it falls back instead of being trusted", async () => {
    await saveConfig({ ...defaultConfig, defaultBackend: "not-a-backend" as never });
    expect((await loadConfig()).defaultBackend).toBe("claude-code");
    await saveConfig({ ...defaultConfig, defaultBackend: defaultConfig.defaultBackend });
  });
});
