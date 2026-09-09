import { COMMANDCODE_MODELS, defaultGenerationOptions, parseGenerationOptions, type BackendDetection, type BackendId, type GenerationOptions } from "@bg/shared";
import type { AppConfig } from "../config";

export function resolveGenerationOptions(backendId: BackendId, value: unknown, config: AppConfig, backend: BackendDetection): GenerationOptions {
  const options = parseGenerationOptions(value ?? config.generationDefaults[backendId] ?? defaultGenerationOptions(backendId));
  if (options.provider === "commandcode" && (backendId !== "claude-code" || !config.commandcodeApiKey)) throw new Error("commandcode_unavailable");
  const models = options.provider === "commandcode" ? COMMANDCODE_MODELS : backend.models ?? [];
  const modelId = options.model || models[0]?.id || "";
  const model = models.find((candidate) => candidate.id === modelId);
  // Without model metadata only the explicit LOW default can be requested.
  if (model ? !model.efforts.includes(options.effort) : modelId !== "" || options.effort !== "low") throw new Error("unsupported_generation_model_effort");
  return { ...options, model: modelId };
}
