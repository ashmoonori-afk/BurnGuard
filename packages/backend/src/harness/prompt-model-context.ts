import type { BackendId, GenerationOptions } from "@bg/shared";
import { observeTaskPreset, type TaskPresetObservation } from "./task-preset-observation";
import {
  TASK_PRESET_REGISTRY,
  type PresetStatus,
  type Deliverable,
  type PresetRegistry,
  type ReviewedExample,
  type Route,
  type TextBlock,
} from "./prompt-task-presets";

/**
 * Whole-envelope budget for the task-guidance addition, counted in UTF-16 code units. This bounds
 * prompt growth only; it is not a token count and says nothing about quality.
 */
export const MAX_TASK_PRESET_CHARS = 4000;

export interface SelectedTaskPreset {
  readonly schema_version: 1;
  readonly registry_version: number;
  readonly route: Route;
  /** The server-resolved model ID, preserved verbatim even when an alias matched. */
  readonly model: string;
  readonly effort: GenerationOptions["effort"];
  readonly preset_id: string;
  readonly resolution: "exact" | "alias" | "provider_default";
  readonly status: PresetStatus;
  readonly deliverable: Deliverable;
  readonly blocks: readonly TextBlock[];
  readonly example: ReviewedExample | null;
}

function resolveRoute(backendId: BackendId, generation: GenerationOptions): Route {
  if (generation.provider === "commandcode") {
    // CommandCode is a Claude route. Never silently remap a Codex selection onto it.
    if (backendId !== "claude-code") throw new Error("commandcode_unavailable");
    return "claude-code/commandcode";
  }
  return backendId === "claude-code" ? "claude-code/native" : "codex/native";
}

const own = <T,>(record: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;

/**
 * Pure selection of task guidance. Reads no files, environment, clock or provider metadata, and
 * never normalizes or rewrites the caller's model or effort.
 *
 * Availability and authentication remain `resolveGenerationOptions`' job: this function composes
 * wording for an already-validated selection and authorizes nothing. An unregistered ID takes the
 * route default; it is never downgraded because its name happens to contain "mini" or "small".
 */
export function selectTaskPreset(
  backendId: BackendId,
  generation: GenerationOptions,
  deliverable: Deliverable,
  registry: PresetRegistry = TASK_PRESET_REGISTRY,
): SelectedTaskPreset {
  const route = resolveRoute(backendId, generation);
  const routeRegistry = registry.routes[route];

  let preset = own(routeRegistry.models, generation.model);
  let resolution: SelectedTaskPreset["resolution"] = "exact";
  if (preset === undefined) {
    const aliasTarget = own(routeRegistry.aliases, generation.model);
    const aliased = aliasTarget === undefined ? undefined : own(routeRegistry.models, aliasTarget);
    if (aliased !== undefined) {
      preset = aliased;
      resolution = "alias";
    } else {
      preset = routeRegistry.fallback;
      resolution = "provider_default";
    }
  }

  // An adoption applies only to this exact route, base preset, effort and deliverable. Anything
  // else - another effort, another deliverable, another route - stays on the base draft preset.
  const adopted = generation.effort === "low"
    ? registry.adoptions?.[route]?.[preset.id]?.low?.[deliverable]
    : undefined;
  const effective = adopted?.enabled === true ? adopted : undefined;
  const wording = effective ? effective.wording : preset.wording;

  const blocks: readonly TextBlock[] = [
    registry.shared,
    registry.deliverables[deliverable],
    registry.wording[wording],
    registry.efforts[generation.effort],
  ];

  // An example is eligible only at LOW effort and only at an exact route/preset/deliverable key.
  const candidate = generation.effort === "low"
    ? registry.examples[route]?.[preset.id]?.[deliverable]
    : undefined;
  const example = candidate && candidate.reviewEvidenceId.length > 0 ? candidate : null;

  return {
    schema_version: 1,
    registry_version: registry.version,
    route,
    model: generation.model,
    effort: generation.effort,
    preset_id: effective ? effective.revision_id : preset.id,
    resolution,
    status: effective ? effective.status : preset.status,
    deliverable,
    blocks,
    example,
  };
}

const envelope = (preset: SelectedTaskPreset): string =>
  `<burnguard-task-guidance-v1>\n${JSON.stringify(preset)}\n</burnguard-task-guidance-v1>`;

/**
 * Serialize the selection, dropping the optional reviewed example first when the envelope exceeds
 * the budget. Mandatory blocks are never trimmed and text is never sliced: an envelope that cannot
 * fit without them throws, so an unreviewed prompt cannot silently exceed the stated cap.
 */
export function serializeTaskPreset(preset: SelectedTaskPreset): string {
  const full = envelope(preset);
  if (full.length <= MAX_TASK_PRESET_CHARS) return full;
  if (preset.example !== null) {
    const withoutExample = envelope({ ...preset, example: null });
    if (withoutExample.length <= MAX_TASK_PRESET_CHARS) return withoutExample;
  }
  throw new Error("task_preset_budget_exceeded");
}

/**
 * Appends the guidance envelopes and returns a bounded observation of what was actually emitted,
 * or null when no generation was selected. Callers that ignore the return value are unaffected.
 */
/** QA-only comparison arms. Production always uses "task"; nothing reads this from HTTP or env. */
export interface TaskGuidanceCondition {
  readonly mode: "task" | "cleanup" | "post";
  /** Required by, and only permitted in, the post arm. */
  readonly postBlock?: string;
}

export function appendModelPromptContext(
  lines: string[],
  backendId: BackendId | undefined,
  generation: GenerationOptions | undefined,
  deliverable: Deliverable,
  condition: TaskGuidanceCondition = { mode: "task" },
): TaskPresetObservation | null {
  if (condition.mode !== "post" && condition.postBlock !== undefined) throw new Error("post_block_not_permitted");
  if (condition.mode === "post" && !condition.postBlock) throw new Error("post_block_required");
  if (!backendId || !generation) return null;
  // Serialize before pushing anything so a budget failure leaves the prompt untouched.
  const selection = selectTaskPreset(backendId, generation, deliverable);
  const taskGuidance = serializeTaskPreset(selection);

  // Legacy envelope, unchanged: same keys, same values, same heuristic profile. Its `profile` is
  // legacy metadata and is deliberately not an input to the task selector above.
  const claude = generation.provider === "commandcode" || backendId === "claude-code";
  const profile = claude
    ? /(?:^|[-/])opus(?:[-/]|$)/i.test(generation.model) ? "claude-opus" : "claude"
    : "codex";
  lines.push('<burnguard-model-guidance-v1>');
  lines.push(JSON.stringify({ schema_version: 1, profile, model: generation.model, provider: generation.provider, effort: generation.effort }));
  lines.push("</burnguard-model-guidance-v1>");
  if (condition.mode === "cleanup") {
    lines.push("");
    return null;
  }
  lines.push(taskGuidance);
  if (condition.mode === "post" && condition.postBlock) lines.push(condition.postBlock);
  lines.push("- This task guidance does not override the user's requested content, visual direction, or the output-directory and attachment restrictions.");
  lines.push("");
  return observeTaskPreset(taskGuidance, selection);
}
