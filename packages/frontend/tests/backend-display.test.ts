import { describe, expect, test } from "bun:test";
import { BACKEND_IDS, GEMINI_MODELS, type BackendDetection } from "@bg/shared";
import { BACKEND_LABELS, backendLabel, graphicBackendId } from "@/lib/backend-display";

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

  test("Given an undetected backend, then it is never chosen for a graphic project", () => {
    const missingCodex = { id: "codex", found: false, image_generation: true } as BackendDetection;
    const gemini = found("gemini", { models: fixtureImageModels });
    expect(graphicBackendId([missingCodex, gemini], "codex")).toBe("gemini");
  });
});
