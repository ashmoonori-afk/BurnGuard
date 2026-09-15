import { describe, expect, test } from "bun:test";
import { GEMINI_MODELS, type BackendDetection } from "@bg/shared";
import { backendCanEverGenerateGraphics, ensureGraphicCapableBackend, isGraphicCapableBackend } from "../src/services/graphic-capability";

const IMAGE_MODEL = GEMINI_MODELS.find((model) => model.image_generation === true)!.id;
const TEXT_MODEL = GEMINI_MODELS.find((model) => model.image_generation !== true)!.id;

const codex = (over: Partial<BackendDetection> = {}): BackendDetection => ({
  id: "codex",
  found: true,
  authenticated: true,
  image_generation: true,
  models: [{ id: "gpt-5.6", label: "GPT-5.6", efforts: ["low"] }],
  ...over,
});
const gemini = (over: Partial<BackendDetection> = {}): BackendDetection => ({
  id: "gemini",
  found: true,
  image_generation: false,
  models: GEMINI_MODELS,
  ...over,
});

/**
 * Graphic projects need a backend that can actually draw. The rule lived inline in three places
 * (project creation, turn start, turn execution) hardcoded to Codex; this pins the single predicate
 * they now share, including the Codex behaviour that must not regress.
 */
describe("Graphic capability gate", () => {
  test("Given an authenticated Codex, then graphics stay allowed exactly as before", () => {
    expect(isGraphicCapableBackend(codex(), "gpt-5.6")).toBe(true);
    // The tool default (empty selection) must keep working: it is what every existing project uses.
    expect(isGraphicCapableBackend(codex(), "")).toBe(true);
    expect(() => ensureGraphicCapableBackend(codex(), "")).not.toThrow();
  });

  test("Given a Codex that is logged out or missing, then graphics stay blocked", () => {
    expect(isGraphicCapableBackend(codex({ authenticated: false }), "")).toBe(false);
    expect(isGraphicCapableBackend(codex({ found: false }), "")).toBe(false);
    expect(isGraphicCapableBackend(undefined, "")).toBe(false);
    expect(() => ensureGraphicCapableBackend(codex({ authenticated: false }), "")).toThrow("graphic_requires_authenticated_codex");
  });

  test("Given an image-capable model on another provider, then graphics are allowed", () => {
    expect(isGraphicCapableBackend(gemini(), IMAGE_MODEL)).toBe(true);
    expect(() => ensureGraphicCapableBackend(gemini(), IMAGE_MODEL)).not.toThrow();
  });

  test("Given a text-only model, then graphics are blocked however the backend is authenticated", () => {
    expect(isGraphicCapableBackend(gemini(), TEXT_MODEL)).toBe(false);
    expect(isGraphicCapableBackend(gemini({ authenticated: true }), TEXT_MODEL)).toBe(false);
    // Claude Code has no image capability at all, so no model selection can unlock it.
    expect(isGraphicCapableBackend({ id: "claude-code", found: true, authenticated: true, models: [{ id: "opus", label: "Opus", efforts: ["low"] }] }, "opus")).toBe(false);
    expect(() => ensureGraphicCapableBackend(gemini(), TEXT_MODEL)).toThrow("graphic_requires_authenticated_codex");
  });

  test("Given project creation, then admission asks whether the backend can draw at all", () => {
    // At creation no model is chosen yet. Gemini's first listed model is text-only, so a
    // selected-model check here would refuse a project the user could perfectly well run.
    expect(backendCanEverGenerateGraphics(gemini())).toBe(true);
    expect(isGraphicCapableBackend(gemini(), "")).toBe(false);
    // Codex draws with every model, and Claude Code with none.
    expect(backendCanEverGenerateGraphics(codex())).toBe(true);
    expect(backendCanEverGenerateGraphics({ id: "claude-code", found: true, authenticated: true, models: [{ id: "opus", label: "Opus", efforts: ["low"] }] })).toBe(false);
    // Admission still respects presence and a confirmed logout.
    expect(backendCanEverGenerateGraphics(gemini({ found: false }))).toBe(false);
    expect(backendCanEverGenerateGraphics(codex({ authenticated: false }))).toBe(false);
    expect(backendCanEverGenerateGraphics(undefined)).toBe(false);
  });

  test("Given a known logout on an image-capable provider, then graphics are blocked", () => {
    // An indeterminate probe is not a logout, but a confirmed logout always blocks.
    expect(isGraphicCapableBackend(gemini({ authenticated: false }), IMAGE_MODEL)).toBe(false);
    expect(isGraphicCapableBackend(gemini({ authenticated: undefined }), IMAGE_MODEL)).toBe(true);
  });
});
