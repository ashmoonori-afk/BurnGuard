/**
 * Structural mirror of the backend's QA-only guidance condition. Declared here rather than imported
 * so the QA project stays independent of backend internals; the backend asserts compatibility by
 * passing these values straight into its own parameter.
 */
export interface TaskGuidanceCondition {
  readonly mode: "task" | "cleanup" | "post";
  readonly postBlock?: string;
}

/**
 * The five comparison arms from doc/18 section 10.
 *
 * An arm is chosen by CLI argument, never by editing source between runs and never by changing the
 * user's stored model, effort or brand. Arms differ only in the guidance assembled into the prompt;
 * audit, security and publication remain the real service in every arm.
 */
export type ConditionId = "original-low" | "cleanup-low" | "task-low" | "post-low" | "same-model-high";

export const CONDITION_IDS: readonly ConditionId[] = [
  "original-low", "cleanup-low", "task-low", "post-low", "same-model-high",
];

/**
 * The Post-Reasoning experimental wording. It asks for the result first and a short rationale after,
 * which is a presentation instruction, not a chain-of-thought request. It is an experiment arm only
 * and is never installed as a production default.
 */
export const POST_REASONING_BLOCK =
  "Present the result first, then explain in no more than two sentences why the key design choices meet the requirements. "
  + "Keep the rationale distinct from actual validation results; do not substitute claims of passing checks for an explanation. "
  + "End with a one-sentence change summary.";

export interface ConditionPlan {
  readonly id: ConditionId;
  readonly effort: "low" | "high";
  readonly guidance: TaskGuidanceCondition;
  readonly examples: "on" | "off";
  /** Set when the arm cannot run from current sources alone. */
  readonly requiresArchive?: true;
}

/** Resolve an arm to the exact prompt-shaping inputs it needs. */
export function planCondition(id: ConditionId): ConditionPlan {
  switch (id) {
    // The pre-P0 assembly is not reconstructable from current sources; it must be recovered from
    // history. Rather than relabel cleanup as original, this arm declares the dependency.
    case "original-low":
      return { id, effort: "low", guidance: { mode: "cleanup" }, examples: "off", requiresArchive: true };
    case "cleanup-low":
      return { id, effort: "low", guidance: { mode: "cleanup" }, examples: "off" };
    case "task-low":
      return { id, effort: "low", guidance: { mode: "task" }, examples: "on" };
    case "post-low":
      return { id, effort: "low", guidance: { mode: "post", postBlock: POST_REASONING_BLOCK }, examples: "on" };
    case "same-model-high":
      return { id, effort: "high", guidance: { mode: "task" }, examples: "off" };
  }
}

export function isConditionId(value: string): value is ConditionId {
  return (CONDITION_IDS as readonly string[]).includes(value);
}
