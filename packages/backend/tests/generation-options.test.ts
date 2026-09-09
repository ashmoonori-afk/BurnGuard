import { expect, test } from "bun:test";
import { defaultGenerationOptions, parseGenerationOptions, type BackendDetection } from "@bg/shared";
import { defaultConfig } from "../src/config";
import { buildCodexCommand } from "../src/adapters/codex";
import { buildClaudeCommand, buildClaudeEnvironment } from "../src/adapters/claude-code/runner";
import { resolveGenerationOptions } from "../src/services/generation-options";
import { assertGraphicStarterReplaced } from "../src/services/turns";

const backend: BackendDetection = { id: "codex", found: true, models: [{ id: "fixture-model", label: "Fixture", efforts: ["low", "high"] }] };

test("Given dynamic model capabilities When selecting effort Then unsupported values fail and omitted options use LOW", () => {
  const generation = resolveGenerationOptions("codex", undefined, defaultConfig, backend);
  expect(generation).toEqual({ model: "fixture-model", effort: "low", vanilla: true, provider: "native" });
  expect(() => resolveGenerationOptions("codex", { ...generation, effort: "medium" }, defaultConfig, backend)).toThrow("unsupported_generation_model_effort");
  expect(() => resolveGenerationOptions("codex", { ...generation, model: "unknown" }, defaultConfig, backend)).toThrow("unsupported_generation_model_effort");
  expect(() => parseGenerationOptions({ ...generation, apiKey: "not-a-field" })).toThrow();
  expect(() => parseGenerationOptions({ ...generation, model: "unsafe model" })).toThrow();
  expect(buildCodexCommand("codex", generation)).toContain('model_reasoning_effort="low"');
  expect(buildCodexCommand("codex", generation)).toContain("fixture-model");
  expect(buildCodexCommand("codex", generation)).toContain("--ignore-user-config");
  expect(buildCodexCommand("codex", generation)).toContain("features.plugins=false");
  expect(buildCodexCommand("codex", generation)).toContain("features.skip_host_skill_discovery=true");
  expect(buildCodexCommand("codex", generation, "win32")).toContain('windows.sandbox="unelevated"');
  expect(buildCodexCommand("codex", generation, "linux")).not.toContain('windows.sandbox="unelevated"');
  expect(buildCodexCommand("codex", { ...generation, vanilla: false }, "win32")).not.toContain('windows.sandbox="unelevated"');
});

test("Given CommandCode selection When building Claude invocation Then native secrets cannot override its Messages endpoint", () => {
  const value = { ...defaultGenerationOptions("claude-code"), provider: "commandcode" as const };
  const config = { ...defaultConfig, commandcodeApiKey: "fixture-commandcode-key" };
  const generation = resolveGenerationOptions("claude-code", value, config, { id: "claude-code", found: true });
  expect(generation.model).toBe("claude-sonnet-4-6");
  expect(() => resolveGenerationOptions("codex", value, config, backend)).toThrow("commandcode_unavailable");
  expect(() => resolveGenerationOptions("claude-code", value, defaultConfig, { id: "claude-code", found: true })).toThrow("commandcode_unavailable");
  const env = buildClaudeEnvironment({ generation, commandcodeApiKey: config.commandcodeApiKey }, { PATH: "fixture", ANTHROPIC_API_KEY: "native-key", CLAUDE_CODE_OAUTH_TOKEN: "native-oauth" });
  expect(env.ANTHROPIC_BASE_URL).toBe("https://api.commandcode.ai/provider");
  expect(env.ANTHROPIC_AUTH_TOKEN).toBe(config.commandcodeApiKey);
  expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  const command = buildClaudeCommand({ binaryPath: "claude", generation });
  expect(command).toContain("--safe-mode");
  expect(command).toContain("acceptEdits");
  expect(command).not.toContain("bypassPermissions");
  expect(command.slice(command.indexOf("--effort"), command.indexOf("--effort") + 2)).toEqual(["--effort", "low"]);
  expect(command.join(" ")).not.toContain(config.commandcodeApiKey);
});

test("Given initial graphic HTML When provider leaves it unchanged Then publication fails while existing image-backed edits remain valid", () => {
  const starter = '<p data-bg-node-id="graphic-copy">Start with one clear visual message.</p>';
  expect(() => assertGraphicStarterReplaced(starter, starter)).toThrow("graphic_starter_unchanged");
  expect(() => assertGraphicStarterReplaced(starter, "<main>Created</main>")).not.toThrow();
  expect(() => assertGraphicStarterReplaced('<img src="poster.png">', '<img src="poster.png">')).not.toThrow();
});
