import type { GenerationEffort } from "@bg/shared";
import { createHash } from "node:crypto";
import { TASK_PRESET_REGISTRY, type PresetRegistry, type Route } from "./prompt-task-presets";

/** Stand-in recorded instead of a model ID the registry does not know. */
export const UNREGISTERED_MODEL = "[unregistered]";

/**
 * Bounded description of the task guidance a turn actually shipped. Identifiers, one hash and two
 * sizes — never prompt text, block text, example text or any filesystem path.
 */
export interface TaskPresetObservation {
  readonly preset_id: string;
  readonly registry_version: number;
  readonly model: string;
  readonly effort: GenerationEffort;
  readonly block_sha256: string;
  readonly size_chars: number;
  readonly size_bytes: number;
}

/**
 * A resolver-valid model ID is not proof that the string carries no private path or secret, so only
 * a spelling the static registry already knows for that route is recorded. Everything else — including
 * legitimate future public models — is reduced to a constant. Selection and the adapter keep the real ID.
 */
function allowlistModel(route: Route, model: string, registry: PresetRegistry): string {
  const routeRegistry = registry.routes[route];
  const known = Object.prototype.hasOwnProperty.call(routeRegistry.models, model)
    || Object.prototype.hasOwnProperty.call(routeRegistry.aliases, model);
  return known ? model : UNREGISTERED_MODEL;
}

/**
 * Observe the serialized envelope that was actually emitted. The hash covers those exact bytes —
 * opening tag, LF, JSON, LF, closing tag, after any example elision — so two runs are comparable
 * without retaining the guidance itself.
 */
export function observeTaskPreset(
  serialized: string,
  selection: { preset_id: string; registry_version: number; route: Route; model: string; effort: GenerationEffort },
  registry: PresetRegistry = TASK_PRESET_REGISTRY,
): TaskPresetObservation {
  return {
    preset_id: selection.preset_id,
    registry_version: selection.registry_version,
    model: allowlistModel(selection.route, selection.model, registry),
    effort: selection.effort,
    block_sha256: createHash("sha256").update(serialized, "utf8").digest("hex"),
    size_chars: serialized.length,
    size_bytes: Buffer.byteLength(serialized, "utf8"),
  };
}
