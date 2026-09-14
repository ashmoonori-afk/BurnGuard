import type { Deliverable, ReviewedExample, Route } from "./prompt-task-presets";

/** route -> target preset ID -> deliverable -> the one reviewed example for that cell. */
export type ReviewedExampleCorpus = Readonly<Partial<Record<Route,
  Readonly<Record<string, Readonly<Partial<Record<Deliverable, ReviewedExample>>>>>>>>;

/** Reference example text stays short; it is guidance, never a transcript. */
export const MAX_REVIEWED_EXAMPLE_CHARS = 600;

/**
 * Reviewed development examples that may be shown to a weaker model at LOW effort.
 *
 * Empty on purpose. An entry may be added only by a source-control change that carries a matching
 * review receipt under `doc/evidence/task-presets/examples/`, and only when that receipt passes
 * every promotion condition in `scripts/qa/task-preset-evidence.ts`. A run that failed, was
 * cancelled, skipped a mandatory check or was never reviewed by a human can never become a
 * reference solution, and an invented example is not a substitute for missing evidence.
 */
export const REVIEWED_TASK_EXAMPLES: ReviewedExampleCorpus = {};
