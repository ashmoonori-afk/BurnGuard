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
}
export const CLAUDE_MODELS: readonly GenerationModel[] = [
  { id: "sonnet", label: "Sonnet", efforts: ["low", "medium", "high"] },
  { id: "opus", label: "Opus", efforts: ["low", "medium", "high"] },
];
export const COMMANDCODE_MODELS: readonly GenerationModel[] = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", efforts: ["low", "medium", "high"] },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", efforts: ["low", "medium", "high"] },
];
export function defaultGenerationOptions(_backendId: BackendId): GenerationOptions {
  return { model: "", effort: "low", vanilla: true, provider: "native" };
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
