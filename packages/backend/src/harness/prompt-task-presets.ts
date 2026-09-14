import type { GenerationEffort } from "@bg/shared";
import { TASK_WORK_CONTRACT } from "./design-craft";
import { TASK_PRESET_ADOPTIONS, type AdoptionTable } from "./task-preset-adoptions";

/**
 * Static task-guidance presets selected by route, model and reasoning effort.
 *
 * This module owns wording data only. It grants no capability, validates nothing and ranks no
 * model: `resolveGenerationOptions` remains the sole authority on which model and effort pairs may
 * run. Every entry is draft wording, never evidence of measured quality or account availability.
 */

/** Provider route. A model ID alone never implies equivalence across routes. */
export type Route = "codex/native" | "claude-code/native" | "claude-code/commandcode";

export type Deliverable = "prototype" | "slide_deck" | "graphic" | "diagram" | "generic";

export type ModelWording =
  | "luna" | "spark" | "terra" | "sol" | "gpt55" | "astra" | "sonnet" | "opus"
  | "default-codex" | "default-claude" | "default-commandcode";

export interface TextBlock {
  readonly id: string;
  readonly text: string;
}

export interface ReviewedExample extends TextBlock {
  /** Opaque reviewed-case identifier. Never a private path. */
  readonly reviewEvidenceId: string;
}

/** A preset is draft until an exact combination has been adopted against captured evidence. */
export type PresetStatus = "draft" | "validated";

export interface ModelPreset {
  readonly id: string;
  readonly wording: ModelWording;
  /** Base entries stay draft; adoption is per exact combination, never per model. */
  readonly status: PresetStatus;
}

export interface RouteRegistry {
  readonly models: Readonly<Record<string, ModelPreset>>;
  /** Alias to an exact registry model key. Exactly one hop, never a chain. */
  readonly aliases: Readonly<Record<string, string>>;
  readonly fallback: ModelPreset;
}

type ExampleByDeliverable = Readonly<Partial<Record<Deliverable, ReviewedExample>>>;
type ExampleByPreset = Readonly<Record<string, ExampleByDeliverable>>;
type Examples = Readonly<Partial<Record<Route, ExampleByPreset>>>;

export interface PresetRegistry {
  readonly version: number;
  readonly shared: TextBlock;
  readonly deliverables: Readonly<Record<Deliverable, TextBlock>>;
  readonly wording: Readonly<Record<ModelWording, TextBlock>>;
  readonly efforts: Readonly<Record<GenerationEffort, TextBlock>>;
  readonly routes: Readonly<Record<Route, RouteRegistry>>;
  readonly examples: Examples;
  /** Adopted combinations; absent means every combination stays draft. */
  readonly adoptions?: AdoptionTable;
  /** Only a QA registry turns reviewed development examples on. */
  readonly developmentExamplesEnabled?: boolean;
}

const DELIVERABLES: Readonly<Record<Deliverable, TextBlock>> = {
  prototype: {
    id: "deliverable-prototype-v1",
    text: "Work from page role to sections to shared navigation and linked routes, using the supplied brief and site map for exact scope. Associate each unit with its real-file/link, primary-action, keyboard, narrow-screen and long Korean-text checks. Check shared-token and navigation dependencies together.",
  },
  slide_deck: {
    id: "deliverable-slide_deck-v1",
    text: "Work from overall narrative to each slide's claim and evidence to composition. Use the supplied count, order and dimensions; never add or remove slides to fit a workflow. Associate each slide with projection typography, chart-unit, image and overflow checks, including hidden slides. Embedded diagrams inherit deck typography and dimensions.",
  },
  graphic: {
    id: "deliverable-graphic-v1",
    text: "Work from message to each requested frame's composition to image and copy placement. Use every frame in burnguard-graphic-output-v1 with its own dimensions, aspect ratio and order. Associate each frame with safe-area, distinct-image and substantive-content checks through the final CTA. Embedded diagrams inherit the artboard contract.",
  },
  diagram: {
    id: "deliverable-diagram-v1",
    text: "Use the diagram skill for authored information relationships and accessible SVG structure. Preserve source facts and target dimensions; choose content units without deleting requested information. Verify connections, labels and reading order.",
  },
  generic: {
    id: "deliverable-generic-v1",
    text: "Use the explicit requested output and existing target contract; do not infer a deck or website from starter files. Split work by the requested deliverables and attach the applicable content, dimension and interaction checks.",
  },
};

const WORDING: Readonly<Record<ModelWording, TextBlock>> = {
  luna: { id: "wording-luna-v1", text: "Keep work units small and name their concrete target and output." },
  spark: { id: "wording-spark-v1", text: "Specify edit locations, preserved content and completion conditions; avoid broad exploration." },
  terra: { id: "wording-terra-v1", text: "Execute by page or component and recheck shared tokens and linked routes." },
  sol: { id: "wording-sol-v1", text: "Connect the deliverable plan to completion criteria and recheck dependent areas." },
  gpt55: { id: "wording-gpt55-v1", text: "Use concise goals, constraints and completion evidence." },
  astra: { id: "wording-astra-v1", text: "Prioritize consequential design judgments and success criteria without excessive procedure." },
  sonnet: { id: "wording-sonnet-v1", text: "Inspect necessary material, build the relevant composition, then verify its checklist." },
  opus: { id: "wording-opus-v1", text: "Summarize major decisions while preserving the selected direction; do not explore unrequested alternatives." },
  "default-codex": { id: "wording-default-codex-v1", text: "Target the requested artifact, preservation constraints and acceptance evidence directly." },
  "default-claude": { id: "wording-default-claude-v1", text: "Inspect relevant material, complete the requested artifact and verify its acceptance evidence." },
  "default-commandcode": { id: "wording-default-commandcode-v1", text: "Use the current route's available tools to complete the requested artifact, preserve constraints and verify acceptance evidence." },
};

const EFFORTS: Readonly<Record<GenerationEffort, TextBlock>> = {
  low: {
    id: "effort-low-v1",
    text: "Briefly establish the goal and preservation constraints. Complete one page, slide or region at a time and put easily missed criteria beside its work. Keep decision summaries short.",
  },
  medium: {
    id: "effort-medium-v1",
    text: "Group related pages or sections; check shared tokens and link dependencies together. Summarize only major decisions and validation criteria.",
  },
  high: {
    id: "effort-high-v1",
    text: "Exercise judgment on information structure and composition; identify choices needing brief justification and explicit success criteria. Explore alternatives only on request or to resolve conflicting requirements.",
  },
  xhigh: {
    id: "effort-xhigh-v1",
    text: "Track shared structure, change propagation, narrative and consistency across deliverables. Focus on identified risks, not unrelated redesign or research.",
  },
  max: {
    id: "effort-max-v1",
    text: "Connect edge cases and missing content to work units across dense or multi-format outputs. Identify gaps in validation evidence without increasing repetition or explanation length.",
  },
  ultra: {
    id: "effort-ultra-v1",
    text: "Resolve conflicting constraints and requested complex judgments explicitly. State stopping conditions and reconsider only when new evidence appears; avoid endless self-critique.",
  },
};

const preset = (route: Route, model: string, wording: ModelWording): ModelPreset =>
  ({ id: `${route}/${model}/v1`, wording, status: "draft" });

const CODEX_MODELS: Readonly<Record<string, ModelPreset>> = {
  "gpt-5.6-luna": preset("codex/native", "gpt-5.6-luna", "luna"),
  "gpt-5.3-codex-spark": preset("codex/native", "gpt-5.3-codex-spark", "spark"),
  "gpt-5.6-terra": preset("codex/native", "gpt-5.6-terra", "terra"),
  "gpt-5.6-sol": preset("codex/native", "gpt-5.6-sol", "sol"),
  "gpt-5.5": preset("codex/native", "gpt-5.5", "gpt55"),
  "gpt-6-astra": preset("codex/native", "gpt-6-astra", "astra"),
};

const claudeModels = (route: Route): Readonly<Record<string, ModelPreset>> => ({
  "claude-sonnet-4-6": preset(route, "claude-sonnet-4-6", "sonnet"),
  "claude-opus-4-6": preset(route, "claude-opus-4-6", "opus"),
});

const CLAUDE_ALIASES: Readonly<Record<string, string>> = {
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
};

export const TASK_PRESET_REGISTRY: PresetRegistry = {
  version: 1,
  shared: TASK_WORK_CONTRACT,
  deliverables: DELIVERABLES,
  wording: WORDING,
  efforts: EFFORTS,
  routes: {
    // Codex registers no aliases; Daybreak is deliberately unregistered and takes the route default.
    "codex/native": {
      models: CODEX_MODELS,
      aliases: {},
      fallback: { id: "codex/native/default/v1", wording: "default-codex", status: "draft" },
    },
    "claude-code/native": {
      models: claudeModels("claude-code/native"),
      aliases: CLAUDE_ALIASES,
      fallback: { id: "claude-code/native/default/v1", wording: "default-claude", status: "draft" },
    },
    "claude-code/commandcode": {
      models: claudeModels("claude-code/commandcode"),
      aliases: CLAUDE_ALIASES,
      fallback: { id: "claude-code/commandcode/default/v1", wording: "default-commandcode", status: "draft" },
    },
  },
  // P0 ships no reviewed example. An example is eligible only at LOW and only when present at an
  // exact route/preset/deliverable key with a nonempty reviewEvidenceId.
  examples: {},
  adoptions: TASK_PRESET_ADOPTIONS,
  developmentExamplesEnabled: false,
};
