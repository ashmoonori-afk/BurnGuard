import type { BackendId } from "./app";

export const GENERATION_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type GenerationEffort = typeof GENERATION_EFFORTS[number];
export interface GenerationOptions {
  readonly model: string;
  readonly effort: GenerationEffort;
  readonly vanilla: boolean;
  readonly provider: "native" | "commandcode";
}
export interface GenerationModel {
  readonly id: string;
  readonly label: string;
  readonly efforts: readonly GenerationEffort[];
  /**
   * The model itself can produce raster imagery. Omitted means "ask the backend": a provider whose
   * model list is discovered at runtime (Codex reads its own cache) carries the capability on the
   * backend instead, so a missing flag here must never be read as "cannot".
   */
  readonly image_generation?: boolean;
}
/**
 * Static by necessity: no supported CLI except Codex offers a scriptable model listing. Claude Code has
 * no list command (only aliases in `--help`), Gemini CLI has open requests for one (gemini-cli #7512,
 * #27847), and Copilot CLI shows model strings only in the interactive `/model` picker (copilot-cli
 * #700). Codex is discovered at runtime from its own `models_cache.json` (see `readCodexModelCatalog`).
 */
export const CLAUDE_MODELS: readonly GenerationModel[] = [
  { id: "sonnet", label: "Sonnet", efforts: ["low", "medium", "high"] },
  { id: "opus", label: "Opus", efforts: ["low", "medium", "high"] },
  // Explicit IDs: platform.claude.com/docs/en/models/overview; effort levels: .../build-with-claude/effort.
  { id: "fable", label: "Fable", efforts: ["low", "medium", "high", "xhigh", "max"] },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", efforts: ["low", "medium", "high", "xhigh", "max"] },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", efforts: ["low", "medium", "high", "xhigh", "max"] },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", efforts: ["low", "medium", "high", "xhigh", "max"] },
];
export const COMMANDCODE_MODELS: readonly GenerationModel[] = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", efforts: ["low", "medium", "high"] },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", efforts: ["low", "medium", "high"] },
];
/** Coding models supported by the CLI; a raster API model alone supplies no CLI image tool. */
export const GEMINI_MODELS: readonly GenerationModel[] = [
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", efforts: ["low", "medium", "high"], image_generation: false },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", efforts: ["low", "medium"], image_generation: false },
  // Model IDs from the Gemini CLI configuration reference (geminicli.com/docs/reference/configuration).
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)", efforts: ["low", "medium", "high"], image_generation: false },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", efforts: ["low", "medium"], image_generation: false },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", efforts: ["low", "medium"], image_generation: false },
];
/**
 * GitHub Copilot CLI models: deliberately empty. The CLI selects a model from the account's
 * entitlement and publishes no stable id list, so the picker offers only "tool default" rather than
 * shipping ids that a real run would reject.
 */
export const COPILOT_MODELS: readonly GenerationModel[] = [];

/** Capability of the selected model, falling back to the backend when the model does not state one. */
export function supportsImageGeneration(
  backend: { readonly image_generation?: boolean } | undefined,
  models: readonly GenerationModel[] | undefined,
  modelId: string,
): boolean {
  const list = models ?? [];
  // An empty selection is "the tool default", which the picker renders as the first listed model.
  const model = list.find((candidate) => candidate.id === modelId) ?? (modelId === "" ? list[0] : undefined);
  return model?.image_generation ?? backend?.image_generation ?? false;
}

/**
 * Whether a graphic project may run on this backend. Authentication is only ever a blocker when the
 * probe actually resolved it: an indeterminate probe must not silently downgrade to "logged out".
 */
export function canGenerateGraphics(
  backend: {
    readonly found?: boolean;
    readonly authenticated?: boolean;
    readonly image_generation?: boolean;
    readonly models?: readonly GenerationModel[];
  } | undefined,
  modelId: string,
): boolean {
  if (!backend?.found || backend.authenticated === false) return false;
  return supportsImageGeneration(backend, backend.models, modelId);
}

/**
 * Medium wherever the model offers it, matching the capable-model note that recommends medium or
 * higher. Without model metadata the backend accepts only LOW, so an unknown model stays on LOW.
 */
export function defaultEffortFor(model: GenerationModel | undefined): GenerationEffort {
  if (!model) return "low";
  return model.efforts.includes("medium") ? "medium" : model.efforts[0] ?? "low";
}

/** `models` is the backend's list; the empty model id resolves to its first entry. */
export function defaultGenerationOptions(_backendId: BackendId, models: readonly GenerationModel[] = []): GenerationOptions {
  return { model: "", effort: defaultEffortFor(models[0]), vanilla: true, provider: "native" };
}
export function parseGenerationOptions(value: unknown): GenerationOptions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid_generation_options");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((key) => !["model", "effort", "vanilla", "provider"].includes(key)) ||
    typeof v.model !== "string" || v.model.length > 120 || !/^[a-zA-Z0-9._:/-]*$/.test(v.model) ||
    !GENERATION_EFFORTS.some((effort) => effort === v.effort) || typeof v.vanilla !== "boolean" ||
    (v.provider !== "native" && v.provider !== "commandcode")) throw new Error("invalid_generation_options");
  return { model: v.model, effort: v.effort as GenerationEffort, vanilla: v.vanilla, provider: v.provider };
}
