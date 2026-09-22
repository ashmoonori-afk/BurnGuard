import { expect, test } from "bun:test";
import { COMMANDCODE_MODELS, GENERATION_EFFORTS, defaultGenerationOptions, parseGenerationOptions, type BackendDetection, type GenerationOptions } from "@bg/shared";
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
  expect(buildCodexCommand("codex", generation)).toContain("suppress_unstable_features_warning=true");
  expect(buildCodexCommand("codex", generation)).toContain("features.image_generation=true");
  expect(buildCodexCommand("codex", { ...generation, vanilla: false })).toContain("features.image_generation=true");
  // A repair of a finished deliverable loses the capability itself, not just the permission to use it.
  expect(buildCodexCommand("codex", generation, "linux", "forbidden")).toContain("features.image_generation=false");
  expect(buildCodexCommand("codex", generation, "linux", "forbidden")).not.toContain("features.image_generation=true");
  expect(buildCodexCommand("codex", generation, "linux", "allowed")).toContain("features.image_generation=true");
  expect(buildCodexCommand("codex", { ...generation, vanilla: false })).toContain("suppress_unstable_features_warning=true");
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

test("Given the installed Claude CLI option set When building the command Then no unknown permission flag is passed", () => {
  const command = buildClaudeCommand({ binaryPath: "claude", generation: undefined });
  expect(command).not.toContain("--permission-prompts");
  expect(command.slice(command.indexOf("--permission-mode"), command.indexOf("--permission-mode") + 2)).toEqual(["--permission-mode", "acceptEdits"]);
});

test("Given initial graphic HTML When provider leaves it unchanged Then publication fails while existing image-backed edits remain valid", () => {
  const starter = '<p data-bg-node-id="graphic-copy">Start with one clear visual message.</p>';
  expect(() => assertGraphicStarterReplaced(starter, starter)).toThrow("graphic_starter_unchanged");
  expect(() => assertGraphicStarterReplaced(starter, "<main>Created</main>")).not.toThrow();
  expect(() => assertGraphicStarterReplaced('<img src="poster.png">', '<img src="poster.png">')).not.toThrow();
});

test("Given dynamic supported metadata When resolving Then validation stays authoritative", () => {
  // Fixture-only model names/effort lists below (e.g. "luna", "spark", "gpt-5.5") describe test
  // capabilities constructed for this suite. They are NOT assertions about any live Codex
  // installation or real account; the resolver under test never contacts a network or CLI.
  const metadataBackend: BackendDetection = {
    id: "codex",
    found: true,
    models: [
      { id: "luna", label: "Luna (fixture)", efforts: ["low", "medium", "high", "xhigh", "max"] },
      { id: "spark", label: "Spark (fixture)", efforts: ["low", "medium", "high", "xhigh"] },
      { id: "gpt-5.5", label: "GPT-5.5 (fixture)", efforts: ["low", "medium", "high", "xhigh"] },
      { id: "low-high-only", label: "Low/High only (fixture)", efforts: ["low", "high"] },
      { id: "all-efforts", label: "All efforts (fixture)", efforts: GENERATION_EFFORTS },
    ],
  };

  function resolve(model: string, effort: (typeof GENERATION_EFFORTS)[number]) {
    return resolveGenerationOptions("codex", { model, effort, vanilla: true, provider: "native" }, defaultConfig, metadataBackend);
  }

  // A registered model is accepted only for the efforts its own fixture metadata lists.
  for (const effort of ["low", "medium", "high", "xhigh", "max"] as const) expect(resolve("luna", effort).effort).toBe(effort);
  expect(() => resolve("luna", "ultra")).toThrow("unsupported_generation_model_effort");
  for (const effort of ["low", "medium", "high", "xhigh"] as const) expect(resolve("spark", effort).effort).toBe(effort);
  expect(() => resolve("spark", "max")).toThrow("unsupported_generation_model_effort");
  expect(() => resolve("spark", "ultra")).toThrow("unsupported_generation_model_effort");
  for (const effort of ["low", "medium", "high", "xhigh"] as const) expect(resolve("gpt-5.5", effort).effort).toBe(effort);
  expect(() => resolve("gpt-5.5", "max")).toThrow("unsupported_generation_model_effort");
  expect(() => resolve("gpt-5.5", "ultra")).toThrow("unsupported_generation_model_effort");

  // A fixture that lists exactly LOW and HIGH accepts exactly those two efforts.
  expect(resolve("low-high-only", "low").effort).toBe("low");
  expect(resolve("low-high-only", "high").effort).toBe("high");
  for (const effort of ["medium", "xhigh", "max", "ultra"] as const) expect(() => resolve("low-high-only", effort)).toThrow("unsupported_generation_model_effort");

  // A fixture that explicitly lists all six efforts preserves each requested effort exactly as requested.
  for (const effort of GENERATION_EFFORTS) expect(resolve("all-efforts", effort)).toEqual({ model: "all-efforts", effort, vanilla: true, provider: "native" });

  // A model ID absent from metadata is rejected regardless of the requested effort.
  expect(() => resolve("nova-unregistered", "low")).toThrow("unsupported_generation_model_effort");

  // No fallback to a different model or a different effort occurs after a validation failure.
  let substituted: GenerationOptions | undefined;
  let thrown: unknown;
  try {
    substituted = resolve("luna", "ultra");
  } catch (error) {
    thrown = error;
  }
  expect(substituted).toBeUndefined();
  expect((thrown as Error).message).toBe("unsupported_generation_model_effort");
});

test("Given Claude and CommandCode listings and missing metadata When resolving Then restrictions survive", () => {
  const claudeVersionedBackend: BackendDetection = {
    id: "claude-code",
    found: true,
    models: [{ id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (fixture)", efforts: ["low", "medium", "high"] }],
  };
  const commandcodeConfig = { ...defaultConfig, commandcodeApiKey: "fixture-commandcode-key" };
  const commandcodeModelId = COMMANDCODE_MODELS[0]!.id;

  // Native Claude versioned IDs accept LOW/MEDIUM/HIGH and reject XHIGH/MAX/ULTRA.
  for (const effort of ["low", "medium", "high"] as const) {
    const generation = resolveGenerationOptions("claude-code", { model: "claude-sonnet-4-6", effort, vanilla: true, provider: "native" }, defaultConfig, claudeVersionedBackend);
    expect(generation.effort).toBe(effort);
  }
  for (const effort of ["xhigh", "max", "ultra"] as const) {
    expect(() => resolveGenerationOptions("claude-code", { model: "claude-sonnet-4-6", effort, vanilla: true, provider: "native" }, defaultConfig, claudeVersionedBackend)).toThrow(
      "unsupported_generation_model_effort",
    );
  }

  // CommandCode version IDs accept LOW/MEDIUM/HIGH and reject XHIGH/MAX/ULTRA.
  for (const effort of ["low", "medium", "high"] as const) {
    const generation = resolveGenerationOptions(
      "claude-code",
      { model: commandcodeModelId, effort, vanilla: true, provider: "commandcode" },
      commandcodeConfig,
      { id: "claude-code", found: true },
    );
    expect(generation.effort).toBe(effort);
  }
  for (const effort of ["xhigh", "max", "ultra"] as const) {
    expect(() =>
      resolveGenerationOptions("claude-code", { model: commandcodeModelId, effort, vanilla: true, provider: "commandcode" }, commandcodeConfig, { id: "claude-code", found: true }),
    ).toThrow("unsupported_generation_model_effort");
  }

  // A missing CommandCode key throws commandcode_unavailable: the resolver does model this condition.
  expect(() =>
    resolveGenerationOptions("claude-code", { model: commandcodeModelId, effort: "low", vanilla: true, provider: "commandcode" }, defaultConfig, { id: "claude-code", found: true }),
  ).toThrow("commandcode_unavailable");
  // The wrong backend for the CommandCode route also throws commandcode_unavailable: also modeled by the resolver.
  expect(() =>
    resolveGenerationOptions("codex", { model: commandcodeModelId, effort: "low", vanilla: true, provider: "commandcode" }, commandcodeConfig, { id: "codex", found: true }),
  ).toThrow("commandcode_unavailable");

  // With no model and no metadata, only empty-model LOW is accepted; every other pair is rejected.
  const emptyBackend: BackendDetection = { id: "codex", found: true, models: [] };
  const emptyGeneration = resolveGenerationOptions("codex", { model: "", effort: "low", vanilla: true, provider: "native" }, defaultConfig, emptyBackend);
  expect(emptyGeneration).toEqual({ model: "", effort: "low", vanilla: true, provider: "native" });
  for (const effort of ["medium", "high", "xhigh", "max", "ultra"] as const) {
    expect(() => resolveGenerationOptions("codex", { model: "", effort, vanilla: true, provider: "native" }, defaultConfig, emptyBackend)).toThrow("unsupported_generation_model_effort");
  }
  for (const effort of GENERATION_EFFORTS) {
    expect(() => resolveGenerationOptions("codex", { model: "anything", effort, vanilla: true, provider: "native" }, defaultConfig, emptyBackend)).toThrow(
      "unsupported_generation_model_effort",
    );
  }
});
