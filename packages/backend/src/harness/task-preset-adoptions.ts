import type { Deliverable, ModelWording, Route } from "./prompt-task-presets";

/**
 * Adoption of one exact combination that review has accepted.
 *
 * A combination is `route x base preset x effort x deliverable`, never a whole model: one prototype
 * LOW case passing says nothing about that model's decks or its HIGH effort. Adoption is static data,
 * so rolling a combination back is a data change - flip `enabled` or drop the entry - that touches no
 * user setting, no model or effort selection and no brand.
 */
export interface CombinationAdoption {
  readonly route: Route;
  readonly base_preset_id: string;
  readonly effort: "low";
  readonly deliverable: Deliverable;
  readonly status: "validated";
  /** A distinct static preset ID for the adopted revision, ending /v2, /v3, ... */
  readonly revision_id: string;
  readonly wording: ModelWording;
  readonly example: "on" | "off";
  readonly content_sha256: string;
  readonly adoption_evidence_id: string;
  readonly enabled: boolean;
}

/** route -> base preset ID -> effort -> deliverable -> adoption. */
export type AdoptionTable = Readonly<Partial<Record<Route,
  Readonly<Record<string, Readonly<Partial<Record<"low",
    Readonly<Partial<Record<Deliverable, CombinationAdoption>>>>>>>>>>>;

/**
 * Empty until a combination has actually been reviewed against captured evidence. Shipping an entry
 * here is the only way a preset becomes `validated`; nothing promotes itself at runtime.
 */
export const TASK_PRESET_ADOPTIONS: AdoptionTable = {};
