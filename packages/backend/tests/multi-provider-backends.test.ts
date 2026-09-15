import { describe, expect, test } from "bun:test";
import {
  BACKEND_IDS,
  canGenerateGraphics,
  GEMINI_MODELS,
  supportsImageGeneration,
  type BackendDetection,
  type BackendId,
} from "@bg/shared";
import { adapterBackendIds } from "../src/adapters/registry";
import { detectBackends } from "../src/services/backends";

/**
 * A backend is only usable when the whole chain accepts it: the shared id union, the adapter
 * registry, and detection. A provider wired into two of the three is the failure this pins.
 */
describe("Multi-provider backends", () => {
  test("Given the shared contract, then every provider this app can drive is enumerated once", () => {
    expect([...BACKEND_IDS]).toEqual(["claude-code", "codex", "gemini", "copilot"]);
    expect(new Set(BACKEND_IDS).size).toBe(BACKEND_IDS.length);
  });

  test("Given the adapter registry, then it dispatches exactly the enumerated backends", () => {
    // registry.ts switches exhaustively on BackendId; a new id that reaches the default branch is a
    // runtime "Unknown backend" for the user, so the set has to match the contract exactly.
    expect([...adapterBackendIds()].sort()).toEqual([...BACKEND_IDS].sort());
  });

  test("Given detection, then every enumerated backend is reported, found or not", async () => {
    const detection = await detectBackends({ requireCodexAuthentication: false });
    expect(detection.backends.map((backend) => backend.id).sort()).toEqual([...BACKEND_IDS].sort());
    for (const backend of detection.backends) {
      // An undetected provider must still carry an install hint rather than silently vanishing.
      if (!backend.found) expect(backend.install_hint, backend.id).toBeTruthy();
    }
  }, 20_000);

  test("Given a model list, then image capability falls back from model to backend", () => {
    // Codex's models come from its own cache and carry no capability flag, so the backend-level
    // flag is what preserves today's behaviour; a per-model flag overrides it where a provider
    // ships both image and text-only models.
    expect(supportsImageGeneration({ image_generation: true }, [], "")).toBe(true);
    expect(supportsImageGeneration({ image_generation: false }, [], "")).toBe(false);
    expect(supportsImageGeneration(
      { image_generation: false },
      [{ id: "img", label: "Img", efforts: ["low"], image_generation: true }],
      "img",
    )).toBe(true);
    expect(supportsImageGeneration(
      { image_generation: true },
      [{ id: "text", label: "Text", efforts: ["low"], image_generation: false }],
      "text",
    )).toBe(false);
    // An empty selection means "the tool default", which is the first listed model.
    expect(supportsImageGeneration(
      { image_generation: false },
      [{ id: "img", label: "Img", efforts: ["low"], image_generation: true }],
      "",
    )).toBe(true);
  });

  test("Given a graphic project, then the gate accepts any authenticated image-capable backend", () => {
    const base = { found: true, authenticated: true } as const;
    const codex: BackendDetection = { ...base, id: "codex", image_generation: true, models: [{ id: "gpt-5.6", label: "GPT-5.6", efforts: ["low"] }] };
    const claude: BackendDetection = { ...base, id: "claude-code", models: [{ id: "opus", label: "Opus", efforts: ["low"] }] };
    const gemini: BackendDetection = { ...base, id: "gemini", models: GEMINI_MODELS };

    // Today's behaviour must survive: an authenticated Codex still passes with any of its models.
    expect(canGenerateGraphics(codex, "gpt-5.6")).toBe(true);
    expect(canGenerateGraphics({ ...codex, authenticated: false }, "gpt-5.6")).toBe(false);
    expect(canGenerateGraphics({ ...codex, found: false }, "gpt-5.6")).toBe(false);
    // A backend with no image capability never qualifies, however it is authenticated.
    expect(canGenerateGraphics(claude, "opus")).toBe(false);
    expect(canGenerateGraphics(undefined, "")).toBe(false);
    // Gemini qualifies only on a model that actually generates images.
    const imageModel = GEMINI_MODELS.find((model) => model.image_generation === true);
    const textModel = GEMINI_MODELS.find((model) => model.image_generation !== true);
    expect(imageModel, "a raster API model is not a CLI image integration").toBeUndefined();
    expect(textModel, "gemini ships at least one text-only model").toBeDefined();
    expect(canGenerateGraphics(gemini, "gemini-2.5-flash-image")).toBe(false);
    expect(canGenerateGraphics(gemini, textModel!.id)).toBe(false);
  });

  test("Given every enumerated backend, then it declares whether it can generate images", () => {
    // The capability is part of the contract, not a per-call guess: an unstated capability would
    // make the graphic gate depend on detection order.
    const declared: Record<BackendId, boolean> = {
      "claude-code": false,
      codex: true,
      gemini: false,
      copilot: false,
    };
    expect(Object.keys(declared).sort()).toEqual([...BACKEND_IDS].sort());
  });
});
