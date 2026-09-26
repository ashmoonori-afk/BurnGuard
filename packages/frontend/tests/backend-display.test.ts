import { describe, expect, test } from "bun:test";
import { BACKEND_IDS, GEMINI_MODELS, canGenerateGraphics, type BackendDetection } from "@bg/shared";
import { BACKEND_LABELS, backendLabel, backendOptionLabel, backendSelectState, graphicBackendId, graphicGateCopy, hasGraphicBackend } from "@/lib/backend-display";
import { useLocaleStore } from "@/i18n/locale";
import { t } from "@/i18n/t";

const found = (id: BackendDetection["id"], over: Partial<BackendDetection> = {}): BackendDetection => ({
  id,
  found: true,
  ...over,
});
const fixtureImageModels = [...GEMINI_MODELS, { id: "fixture-image-tool", label: "Fixture", efforts: ["low"] as const, image_generation: true }];

/**
 * The picker used to name backends with an inline ternary that fell through to "Codex", so a new
 * provider rendered under the wrong name, and the creation panel listed two hardcoded options. These
 * pin the derived versions.
 */
describe("Backend display", () => {
  test("Given every backend in the contract, then it has its own display name", () => {
    expect(Object.keys(BACKEND_LABELS).sort()).toEqual([...BACKEND_IDS].sort());
    // A fall-through label is the actual bug: two backends must never share a name.
    const labels = Object.values(BACKEND_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
    for (const id of BACKEND_IDS) expect(backendLabel(id), id).toBe(BACKEND_LABELS[id]);
    expect(backendLabel("gemini")).toBe("Gemini CLI");
    expect(backendLabel("copilot")).not.toBe(backendLabel("codex"));
  });

  test("Given a graphic project, then it runs on a backend that can actually draw", () => {
    const codex = found("codex", { authenticated: true, image_generation: true });
    const gemini = found("gemini", { models: fixtureImageModels });
    const claude = found("claude-code", { models: [{ id: "opus", label: "Opus", efforts: ["low"] }] });

    // Codex stays the choice whenever it is usable: that is today's behaviour.
    expect(graphicBackendId([claude, codex, gemini], "claude-code")).toBe("codex");
    // A selection that can already draw is respected rather than overridden.
    expect(graphicBackendId([claude, codex, gemini], "gemini")).toBe("gemini");
    // With Codex logged out, an image-capable provider takes over instead of refusing outright.
    expect(graphicBackendId([claude, { ...codex, authenticated: false }, gemini], "claude-code")).toBe("gemini");
    // Nothing capable detected: fall back to Codex so the existing refusal copy still explains why.
    expect(graphicBackendId([claude], "claude-code")).toBe("codex");
    expect(graphicBackendId([], "claude-code")).toBe("codex");
  });

  test("Given a backend that is not installed When its creation option label is derived Then it names the product and the localized marker, never a bare dash", () => {
    const original = useLocaleStore.getState().locale;
    useLocaleStore.setState({ locale: "en" });
    try {
      const missing = backendOptionLabel({ id: "gemini", found: false });
      expect(missing).toBe(t("home.creation.backendNotFound", { name: BACKEND_LABELS.gemini }));
      expect(missing).toContain("Gemini CLI");
      expect(missing).not.toContain(" —");
      expect(backendOptionLabel({ id: "gemini", found: true })).toBe(BACKEND_LABELS.gemini);
    } finally {
      useLocaleStore.setState({ locale: original });
    }
  });

  test("Given an undetected backend, then it is never chosen for a graphic project", () => {
    const missingCodex = { id: "codex", found: false, image_generation: true } as BackendDetection;
    const gemini = found("gemini", { models: fixtureImageModels });
    expect(graphicBackendId([missingCodex, gemini], "codex")).toBe("gemini");
  });
});

describe("Home graphic readiness (UX-06)", () => {
  test("Given a found image-capable non-Codex backend When readiness is derived Then graphics are ready", () => {
    expect(hasGraphicBackend([found("claude-code"), found("gemini", { models: fixtureImageModels })])).toBe(true);
  });

  test("Given Codex found but signed out When readiness is derived Then graphics are not ready", () => {
    expect(hasGraphicBackend([found("codex", { authenticated: false, image_generation: true })])).toBe(false);
  });

  test("Given Codex found with no authentication verdict When readiness is derived Then it follows the shared rule", () => {
    const codex = found("codex", { image_generation: true });
    expect(hasGraphicBackend([codex])).toBe(canGenerateGraphics(codex, ""));
    expect(hasGraphicBackend([])).toBe(false);
    expect(hasGraphicBackend([found("claude-code")])).toBe(false);
  });
});

describe("Backend detection state on Home (UX-05)", () => {
  test("Given detection failed When the panel's select state is derived Then no backend is invented and the placeholder names the failure", () => {
    expect(backendSelectState({ isPending: false, isError: true })).toEqual({ backends: [], placeholder: "home.creation.detectionFailed" });
  });

  test("Given detection pending When the panel's select state is derived Then the placeholder says it is checking", () => {
    expect(backendSelectState({ isPending: true, isError: false })).toEqual({ backends: [], placeholder: "home.creation.detecting" });
  });

  test("Given detection data When the panel's select state is derived Then exactly the reported backends are listed", () => {
    const backends = [found("claude-code"), { id: "codex", found: false } as BackendDetection];
    expect(backendSelectState({ isPending: false, isError: false, data: { backends } })).toEqual({ backends, placeholder: null });
  });

  test("Given a gated graphic tile When detection failed Then its reason is the detection failure, otherwise the Codex requirement", () => {
    expect(graphicGateCopy(true).title).toBe("home.detectionFailed");
    expect(graphicGateCopy(false).title).toBe("home.codexRequired");
    expect(graphicGateCopy(false).hint).toBe("home.graphicAvailability");
    expect(graphicGateCopy(true).hint).toBe("home.detectionFailed");
  });
});
