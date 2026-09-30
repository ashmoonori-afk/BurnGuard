import { expect, test } from "bun:test";
import { CLAUDE_MODELS, GEMINI_MODELS, defaultGenerationOptions, resolveModelCapabilityProfile } from "@bg/shared";
import { TASK_PRESET_REGISTRY } from "../src/harness/prompt-task-presets";

const ids = (models: readonly { readonly id: string }[]): string[] => models.map((model) => model.id);

test("Given the Claude picker When refreshed Then aliases stay first and current IDs carry every effort level", () => {
  expect(ids(CLAUDE_MODELS).slice(0, 2)).toEqual(["sonnet", "opus"]);
  expect(defaultGenerationOptions("claude-code", CLAUDE_MODELS).effort).toBe("medium");
  for (const id of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"]) {
    const model = CLAUDE_MODELS.find((candidate) => candidate.id === id);
    expect(model?.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
  }
});

test("Given the Gemini picker When refreshed Then the previous default stays first and newer models are listed", () => {
  expect(ids(GEMINI_MODELS)[0]).toBe("gemini-2.5-pro");
  expect(ids(GEMINI_MODELS)).toEqual(expect.arrayContaining(["gemini-2.5-flash", "gemini-3.1-pro-preview", "gemini-3.5-flash", "gemini-3.8-flash"]));
});

test("Given the preset registry When models are refreshed Then old IDs still resolve and new IDs are registered", () => {
  const codex = TASK_PRESET_REGISTRY.routes["codex/native"].models;
  for (const id of ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-6-astra", "gpt-6-luna", "gpt-6.1-sol"]) expect(codex[id]).toBeDefined();
  for (const route of ["claude-code/native", "claude-code/commandcode"] as const) {
    const claude = TASK_PRESET_REGISTRY.routes[route].models;
    for (const id of ["claude-sonnet-4-6", "claude-opus-4-6", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"]) expect(claude[id]).toBeDefined();
  }
});

test("Given a new Claude or GPT ID When resolving the capability profile Then the frontier profile applies", () => {
  const frontier = (model: string) => resolveModelCapabilityProfile("claude-code", { model, provider: "native" }).id;
  expect(frontier("claude-opus-5-5")).toBe("claude-frontier");
  expect(frontier("claude-fable-5-1")).toBe("claude-frontier");
  expect(frontier("fable")).toBe("claude-frontier");
  expect(resolveModelCapabilityProfile("codex", { model: "gpt-6.1-sol", provider: "native" }).id).toBe("gpt-image");
});
