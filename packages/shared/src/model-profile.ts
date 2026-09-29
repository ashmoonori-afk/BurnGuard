import type { BackendId } from "./app";
import { GENERATION_EFFORTS, type GenerationEffort, type GenerationOptions } from "./generation";

/**
 * What a model family can be trusted to do well, which decides the design-system guidance and injection blocks
 * a turn receives. The profile is derived from the already-validated backend and model selection; it authorizes
 * nothing by itself (availability stays with `resolveGenerationOptions`).
 */
export const MODEL_CAPABILITY_PROFILE_IDS = ["claude-frontier", "gpt-image", "standard"] as const;
export type ModelCapabilityProfileId = typeof MODEL_CAPABILITY_PROFILE_IDS[number];

export interface ModelCapabilityProfile {
  readonly id: ModelCapabilityProfileId;
  /**
   * `css_svg`: when no logo file is supplied the model may author the logo or wordmark in HTML/CSS or inline SVG
   * from the design-system tokens. `supplied_or_text`: reuse a supplied logo or set the name as plain text.
   */
  readonly logo_authoring: "css_svg" | "supplied_or_text";
  /**
   * `web_search`: the model has no image tool, so it sources real, licensed assets from the web.
   * `generate`: the model generates imagery with its own image tool. `supplied_only`: neither.
   */
  readonly asset_strategy: "web_search" | "generate" | "supplied_only";
  /** Lowest reasoning effort at which the profile's extra capabilities are recommended, or null when none. */
  readonly recommended_min_effort: GenerationEffort | null;
}

export const MODEL_CAPABILITY_PROFILES: Readonly<Record<ModelCapabilityProfileId, ModelCapabilityProfile>> = {
  "claude-frontier": { id: "claude-frontier", logo_authoring: "css_svg", asset_strategy: "web_search", recommended_min_effort: "medium" },
  "gpt-image": { id: "gpt-image", logo_authoring: "supplied_or_text", asset_strategy: "generate", recommended_min_effort: null },
  standard: { id: "standard", logo_authoring: "supplied_or_text", asset_strategy: "supplied_only", recommended_min_effort: null },
};

/** Opus and Sonnet in any id shape: `opus`, `claude-sonnet-4-6`, `claude-opus-5-5`, `opus[1m]`. Haiku is not frontier. */
const CLAUDE_FRONTIER_MODEL = /(?:^|[^a-z])(?:opus|sonnet)(?:[^a-z]|$)/i;
const GPT_MODEL = /(?:^|[^a-z])gpt(?:[^a-z]|$)/i;

/**
 * Pure profile selection. An empty model means the tool default: Claude Code and the CommandCode route default to
 * Sonnet or Opus, and Codex defaults to a GPT model, so both keep their family's profile.
 */
export function resolveModelCapabilityProfile(
  backendId: BackendId,
  generation: Pick<GenerationOptions, "model" | "provider">,
): ModelCapabilityProfile {
  const model = generation.model.trim();
  if (backendId === "claude-code" || generation.provider === "commandcode") {
    return model === "" || CLAUDE_FRONTIER_MODEL.test(model) ? MODEL_CAPABILITY_PROFILES["claude-frontier"] : MODEL_CAPABILITY_PROFILES.standard;
  }
  if (backendId === "codex") {
    return model === "" || GPT_MODEL.test(model) ? MODEL_CAPABILITY_PROFILES["gpt-image"] : MODEL_CAPABILITY_PROFILES.standard;
  }
  return MODEL_CAPABILITY_PROFILES.standard;
}

export function effortBelowRecommendation(profile: ModelCapabilityProfile, effort: GenerationEffort): boolean {
  if (profile.recommended_min_effort === null) return false;
  return GENERATION_EFFORTS.indexOf(effort) < GENERATION_EFFORTS.indexOf(profile.recommended_min_effort);
}
