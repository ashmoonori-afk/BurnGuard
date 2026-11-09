import { UpgradeContractError, decodeContract, isRecord, type UnknownRecord } from "./contract-parser";
import type { LogoType } from "./logo";

/**
 * The gated flow of the geometric logo method (doc/28). Two questions come first, then one
 * candidate per step with Approve or Revise: symbol -> review -> wordmark -> review -> lockup.
 *
 * Like the raster flow, the position in the flow is never stored. It is derived from the project
 * files (the answers, each step's record and the record hash an approval names) and the action
 * sentinel on the person's message, so a stale directory cannot lie about where the flow is. An
 * approval only counts while it names the hash of the record on disk; rewriting an approved
 * record reopens that step and every step after it.
 *
 * The flow has its own sentinel tag, so the raster flow's `parseLogoAction` and
 * `resolveLogoPhase` are unchanged.
 */
export const LOGO_GEOMETRIC_TAG = "burnguard-logo-geometric-v1";

/** Pictorial and mascot marks need drawing, not construction; they stay on the raster method. */
export const LOGO_RASTER_TYPES: readonly LogoType[] = ["pictorial", "mascot"];
export type LogoMethod = "geometric" | "raster";

export function logoMethodFor(type: LogoType): LogoMethod {
  return LOGO_RASTER_TYPES.includes(type) ? "raster" : "geometric";
}

export const LOGO_GEOMETRIC_PARTS = ["symbol_wordmark", "symbol", "wordmark"] as const;
export type LogoGeometricParts = (typeof LOGO_GEOMETRIC_PARTS)[number];
export const LOGO_GEOMETRIC_DIRECTIONS = ["sharp_geometric", "bold_abstract", "auto"] as const;
export type LogoGeometricDirection = (typeof LOGO_GEOMETRIC_DIRECTIONS)[number];
export const LOGO_GEOMETRIC_OTHER_MAX = 200;
export const LOGO_GEOMETRIC_NOTE_MAX = 500;

export const LOGO_GEOMETRIC_STEPS = ["symbol", "wordmark", "lockup"] as const;
export type LogoGeometricStep = (typeof LOGO_GEOMETRIC_STEPS)[number];
/** The lockup is computed, not authored, so nobody reviews it; it is done once it exists. */
const REVIEWED: Readonly<Record<LogoGeometricStep, boolean>> = { symbol: true, wordmark: true, lockup: false };

export const LOGO_GEOMETRIC_ANSWERS_FILE = "geometric/answers.json";

/** A multiple-choice answer: one of the offered options, or the person's own words. */
export type LogoGeometricChoice<T extends string> = { readonly choice: T } | { readonly other: string };

export type LogoGeometricAnswersV1 = {
  readonly schema_version: 1;
  readonly parts: LogoGeometricChoice<LogoGeometricParts>;
  readonly direction: LogoGeometricChoice<LogoGeometricDirection>;
};

export type LogoGeometricActionV1 =
  | { readonly action: "answer"; readonly parts: LogoGeometricAnswersV1["parts"]; readonly direction: LogoGeometricAnswersV1["direction"] }
  | { readonly action: "approve"; readonly step: LogoGeometricStep; readonly record_sha256: string }
  | { readonly action: "revise"; readonly step: LogoGeometricStep; readonly record_sha256: string; readonly note: string };

/** What the server read from disk before the turn: the answers and, per step, two hashes. */
export type LogoGeometricStepFiles = {
  /** SHA-256 of the step's record, or null when it has not been made. */
  readonly record_sha256: string | null;
  /** The record hash the person approved, or null. Counts only while it equals `record_sha256`. */
  readonly approved_sha256: string | null;
};

export type LogoGeometricFilesState = {
  readonly answers: LogoGeometricAnswersV1 | null;
  readonly steps: Readonly<Record<LogoGeometricStep, LogoGeometricStepFiles>>;
};

export type LogoGeometricRefusal = "unanswered" | "stale_record" | "out_of_order" | "flow_complete";

/** What one turn does. Only `make` runs the model; `approve_step` is recorded alongside it. */
export type LogoGeometricTurn =
  | {
    readonly kind: "make";
    readonly step: LogoGeometricStep;
    readonly answers: LogoGeometricAnswersV1;
    /** The person's revision note, when the turn revises a shown candidate. */
    readonly note: string | null;
    /** A step this turn approves before making the next one, with the hash it approves. */
    readonly approve: { readonly step: LogoGeometricStep; readonly record_sha256: string } | null;
  }
  | { readonly kind: "complete"; readonly approve: { readonly step: LogoGeometricStep; readonly record_sha256: string } | null }
  | { readonly kind: "refused"; readonly code: LogoGeometricRefusal };

export type LogoGeometricPlanItem = {
  readonly step: LogoGeometricStep;
  readonly status: "done" | "awaiting_review" | "next" | "pending";
};

const SHA256 = /^[0-9a-f]{64}$/;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

/** The steps the answers ask for, in order. Free-text parts get the whole set. */
export function logoGeometricSteps(answers: LogoGeometricAnswersV1): readonly LogoGeometricStep[] {
  if ("other" in answers.parts) return LOGO_GEOMETRIC_STEPS;
  switch (answers.parts.choice) {
    case "symbol_wordmark": return LOGO_GEOMETRIC_STEPS;
    case "symbol": return ["symbol"];
    case "wordmark": return ["wordmark"];
  }
}

function stepDone(step: LogoGeometricStep, files: LogoGeometricStepFiles): boolean {
  if (files.record_sha256 === null) return false;
  return !REVIEWED[step] || files.approved_sha256 === files.record_sha256;
}

/**
 * The first step that is not done. Every step after a reopened one counts as not done too: the
 * wordmark takes its metrics from the symbol and the lockup from both.
 */
function currentStep(state: LogoGeometricFilesState, steps: readonly LogoGeometricStep[]): LogoGeometricStep | null {
  return steps.find((step) => !stepDone(step, state.steps[step])) ?? null;
}

/** The plan checklist, derived like everything else. Empty until the questions are answered. */
export function logoGeometricPlan(state: LogoGeometricFilesState): readonly LogoGeometricPlanItem[] {
  if (state.answers === null) return [];
  const steps = logoGeometricSteps(state.answers);
  const current = currentStep(state, steps);
  const currentIndex = current === null ? steps.length : steps.indexOf(current);
  return steps.map((step, index) => {
    if (index < currentIndex) return { step, status: "done" };
    if (index > currentIndex) return { step, status: "pending" };
    const shown = state.steps[step].record_sha256 !== null && REVIEWED[step];
    return { step, status: shown ? "awaiting_review" : "next" };
  });
}

/** Decides what a turn does from the files on disk and the sentinel on the message. */
export function resolveLogoGeometricTurn(state: LogoGeometricFilesState, action: LogoGeometricActionV1 | null): LogoGeometricTurn {
  if (action?.action === "answer") {
    // Answering again starts over from the first step with the new answers.
    const answers: LogoGeometricAnswersV1 = { schema_version: 1, parts: action.parts, direction: action.direction };
    return { kind: "make", step: logoGeometricSteps(answers)[0]!, answers, note: null, approve: null };
  }
  const answers = state.answers;
  if (answers === null) return { kind: "refused", code: "unanswered" };
  const steps = logoGeometricSteps(answers);
  const current = currentStep(state, steps);
  if (current === null) return { kind: "refused", code: "flow_complete" };
  // A plain message works on the current step; the message itself is the guidance.
  if (action === null) return { kind: "make", step: current, answers, note: null, approve: null };
  if (action.step !== current) return { kind: "refused", code: "out_of_order" };
  if (action.record_sha256 !== state.steps[current].record_sha256) return { kind: "refused", code: "stale_record" };
  if (action.action === "revise") return { kind: "make", step: current, answers, note: action.note, approve: null };
  const approve = { step: current, record_sha256: action.record_sha256 };
  const next = steps[steps.indexOf(current) + 1];
  return next === undefined ? { kind: "complete", approve } : { kind: "make", step: next, answers, note: null, approve };
}

/**
 * Finds the flow sentinel in a user message. Malformed sentinels are treated as absent rather
 * than thrown, as in the raster flow: the message is untrusted text.
 */
export function parseLogoGeometricAction(text: string): LogoGeometricActionV1 | null {
  const match = new RegExp(`<${LOGO_GEOMETRIC_TAG}>([\\s\\S]*?)</${LOGO_GEOMETRIC_TAG}>`).exec(text);
  if (match === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]!);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (!isRecord(parsed)) return null;
  const keys = Object.keys(parsed).sort().join(",");
  if (parsed.action === "answer" && keys === "action,direction,parts") {
    const parts = choiceOf(parsed.parts, LOGO_GEOMETRIC_PARTS);
    const direction = choiceOf(parsed.direction, LOGO_GEOMETRIC_DIRECTIONS);
    return parts === null || direction === null ? null : { action: "answer", parts, direction };
  }
  const step = LOGO_GEOMETRIC_STEPS.find((candidate) => candidate === parsed.step);
  if (step === undefined || typeof parsed.record_sha256 !== "string" || !SHA256.test(parsed.record_sha256)) return null;
  if (parsed.action === "approve" && keys === "action,record_sha256,step") return { action: "approve", step, record_sha256: parsed.record_sha256 };
  if (parsed.action === "revise" && keys === "action,note,record_sha256,step") {
    const note = textOf(parsed.note, LOGO_GEOMETRIC_NOTE_MAX);
    return note === null ? null : { action: "revise", step, record_sha256: parsed.record_sha256, note };
  }
  return null;
}

/** The answers file is written by the server, so anything else in it is refused, not repaired. */
export function parseLogoGeometricAnswersV1(input: unknown): LogoGeometricAnswersV1 {
  const record = decodeContract(input);
  exact(record, ["schema_version", "parts", "direction"]);
  if (record.schema_version !== 1) invalid("schema_version");
  const parts = choiceOf(record.parts, LOGO_GEOMETRIC_PARTS) ?? invalid("parts");
  const direction = choiceOf(record.direction, LOGO_GEOMETRIC_DIRECTIONS) ?? invalid("direction");
  return { schema_version: 1, parts, direction };
}

/** Canonical bytes for the answers file: fixed key order, one trailing newline. */
export function serializeLogoGeometricAnswers(answers: LogoGeometricAnswersV1): string {
  const choice = (value: LogoGeometricChoice<string>) => "other" in value ? { other: value.other } : { choice: value.choice };
  return `${JSON.stringify({ schema_version: 1, parts: choice(answers.parts), direction: choice(answers.direction) }, null, 2)}\n`;
}

function choiceOf<T extends string>(value: unknown, options: readonly T[]): LogoGeometricChoice<T> | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1) return null;
  if (keys[0] === "choice") {
    const found = options.find((option) => option === value.choice);
    return found === undefined ? null : { choice: found };
  }
  if (keys[0] === "other") {
    const other = textOf(value.other, LOGO_GEOMETRIC_OTHER_MAX);
    return other === null ? null : { other };
  }
  return null;
}

function textOf(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length === 0 || text.length > max || CONTROL_CHARACTERS.test(text) ? null : text;
}

function exact(record: UnknownRecord, keys: readonly string[]): void {
  for (const key of Object.keys(record)) if (!keys.includes(key)) invalid(key);
  for (const key of keys) if (!(key in record)) throw new UpgradeContractError("missing_required_field", key);
}

function invalid(path: string): never {
  throw new UpgradeContractError("invalid_field", path);
}
