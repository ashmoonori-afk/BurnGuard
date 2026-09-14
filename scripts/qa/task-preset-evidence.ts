/**
 * Strict parser and promotion gate for task-preset example review receipts.
 *
 * A receipt attests that one stronger-model run produced an artifact that a human reviewed and
 * approved. Only a receipt that passes BOTH this parser and `promotionRejections` may accompany a
 * new entry in the reviewed example corpus. Nothing here promotes anything automatically: promotion
 * is always a reviewed source-control change.
 */

const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[a-z0-9][a-z0-9._-]{0,95}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** Shapes that must never appear anywhere in a receipt, in any field. */
const FORBIDDEN = [
  /[a-zA-Z]:[\\/]/u,          // Windows drive path
  /^\\\\/u,                   // UNC path
  /\\\\[^\\]+\\/u,            // UNC path embedded
  /\/(?:Users|home)\//u,      // POSIX home path
  /\bsk-[A-Za-z0-9]{8,}/u,    // provider key
  /\bghp_[A-Za-z0-9]{8,}/u,   // GitHub token
  /\bBearer\s+\S+/iu,         // authorization header
];

export type ReceiptParse =
  | { readonly ok: true; readonly receipt: ExampleReviewReceipt }
  | { readonly ok: false; readonly errors: readonly string[] };

export interface ExampleReviewReceipt {
  readonly schema_version: 1;
  readonly evidence_id: string;
  readonly case_id: string;
  readonly split: string;
  readonly source: {
    readonly route: string; readonly model: string; readonly effort: string;
    readonly cli_version: string; readonly source_revision: string;
    readonly prompt_sha256: string; readonly invocation_hashes: readonly string[];
  };
  readonly target: { readonly route: string; readonly preset_id: string; readonly effort: string; readonly deliverable: string };
  readonly example: { readonly id: string; readonly text_sha256: string };
  readonly artifact: { readonly tree_sha256: string; readonly archive_sha256: string; readonly object_id: string };
  readonly validation: {
    readonly run_id: string; readonly terminal: string;
    readonly audit_policy_version: string; readonly audit_object_sha256: string;
    readonly observations_sha256: string; readonly screenshots_sha256: readonly string[];
    readonly mandatory: readonly { readonly check_id: string; readonly status: string; readonly evidence_sha256: string }[];
    readonly human?: { readonly reviewer_id: string; readonly verdict: string; readonly reviewed_at: string; readonly rubric_version: number };
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function scanForbidden(value: unknown, path: string, errors: string[]): void {
  if (typeof value === "string") {
    for (const pattern of FORBIDDEN) {
      if (pattern.test(value)) errors.push(`${path}: forbidden content`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) scanForbidden(item, `${path}[${index}]`, errors);
    return;
  }
  if (isRecord(value)) for (const [key, item] of Object.entries(value)) scanForbidden(item, `${path}.${key}`, errors);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, errors: string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${path}.${key}: unknown key`);
}

function str(value: unknown, pattern: RegExp, path: string, errors: string[]): void {
  if (typeof value !== "string" || !pattern.test(value)) errors.push(`${path}: invalid`);
}

/** Parses untrusted input. Unknown keys, malformed values and forbidden content all reject. */
export function parseExampleReviewReceipt(input: unknown): ReceiptParse {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["receipt: not an object"] };
  scanForbidden(input, "receipt", errors);
  exactKeys(input, ["schema_version", "evidence_id", "case_id", "split", "source", "target", "example", "artifact", "validation"], "receipt", errors);

  if (input.schema_version !== 1) errors.push("receipt.schema_version: invalid");
  str(input.evidence_id, /^ex-[0-9a-f]{64}$/u, "receipt.evidence_id", errors);
  str(input.case_id, ID, "receipt.case_id", errors);
  if (typeof input.split !== "string") errors.push("receipt.split: invalid");

  const source = input.source;
  if (!isRecord(source)) errors.push("receipt.source: invalid");
  else {
    exactKeys(source, ["route", "model", "effort", "cli_version", "source_revision", "prompt_sha256", "invocation_hashes"], "receipt.source", errors);
    for (const key of ["route", "model", "effort", "cli_version"] as const) {
      if (typeof source[key] !== "string" || source[key] === "") errors.push(`receipt.source.${key}: invalid`);
    }
    str(source.source_revision, GIT_OBJECT, "receipt.source.source_revision", errors);
    str(source.prompt_sha256, SHA256, "receipt.source.prompt_sha256", errors);
    if (!Array.isArray(source.invocation_hashes) || source.invocation_hashes.length === 0) errors.push("receipt.source.invocation_hashes: invalid");
    else for (const [i, hash] of source.invocation_hashes.entries()) str(hash, SHA256, `receipt.source.invocation_hashes[${i}]`, errors);
  }

  const target = input.target;
  if (!isRecord(target)) errors.push("receipt.target: invalid");
  else {
    exactKeys(target, ["route", "preset_id", "effort", "deliverable"], "receipt.target", errors);
    for (const key of ["route", "preset_id", "deliverable"] as const) {
      if (typeof target[key] !== "string" || target[key] === "") errors.push(`receipt.target.${key}: invalid`);
    }
    if (target.effort !== "low") errors.push("receipt.target.effort: invalid");
  }

  const example = input.example;
  if (!isRecord(example)) errors.push("receipt.example: invalid");
  else {
    exactKeys(example, ["id", "text_sha256"], "receipt.example", errors);
    str(example.id, ID, "receipt.example.id", errors);
    str(example.text_sha256, SHA256, "receipt.example.text_sha256", errors);
  }

  const artifact = input.artifact;
  if (!isRecord(artifact)) errors.push("receipt.artifact: invalid");
  else {
    exactKeys(artifact, ["tree_sha256", "archive_sha256", "object_id"], "receipt.artifact", errors);
    str(artifact.tree_sha256, SHA256, "receipt.artifact.tree_sha256", errors);
    str(artifact.archive_sha256, SHA256, "receipt.artifact.archive_sha256", errors);
    str(artifact.object_id, ID, "receipt.artifact.object_id", errors);
  }

  const validation = input.validation;
  if (!isRecord(validation)) errors.push("receipt.validation: invalid");
  else {
    exactKeys(validation, ["run_id", "terminal", "audit_policy_version", "audit_object_sha256", "observations_sha256", "screenshots_sha256", "mandatory", "human"], "receipt.validation", errors);
    str(validation.run_id, ID, "receipt.validation.run_id", errors);
    if (typeof validation.terminal !== "string") errors.push("receipt.validation.terminal: invalid");
    if (typeof validation.audit_policy_version !== "string") errors.push("receipt.validation.audit_policy_version: invalid");
    str(validation.audit_object_sha256, SHA256, "receipt.validation.audit_object_sha256", errors);
    str(validation.observations_sha256, SHA256, "receipt.validation.observations_sha256", errors);
    if (!Array.isArray(validation.screenshots_sha256)) errors.push("receipt.validation.screenshots_sha256: invalid");
    else for (const [i, hash] of validation.screenshots_sha256.entries()) str(hash, SHA256, `receipt.validation.screenshots_sha256[${i}]`, errors);
    if (!Array.isArray(validation.mandatory)) errors.push("receipt.validation.mandatory: invalid");
    else for (const [i, check] of validation.mandatory.entries()) {
      if (!isRecord(check)) { errors.push(`receipt.validation.mandatory[${i}]: invalid`); continue; }
      exactKeys(check, ["check_id", "status", "evidence_sha256"], `receipt.validation.mandatory[${i}]`, errors);
      str(check.check_id, ID, `receipt.validation.mandatory[${i}].check_id`, errors);
      if (typeof check.status !== "string") errors.push(`receipt.validation.mandatory[${i}].status: invalid`);
      str(check.evidence_sha256, SHA256, `receipt.validation.mandatory[${i}].evidence_sha256`, errors);
    }
    if (validation.human !== undefined) {
      if (!isRecord(validation.human)) errors.push("receipt.validation.human: invalid");
      else {
        exactKeys(validation.human, ["reviewer_id", "verdict", "reviewed_at", "rubric_version"], "receipt.validation.human", errors);
        str(validation.human.reviewer_id, ID, "receipt.validation.human.reviewer_id", errors);
        if (typeof validation.human.verdict !== "string") errors.push("receipt.validation.human.verdict: invalid");
        str(validation.human.reviewed_at, ISO_INSTANT, "receipt.validation.human.reviewed_at", errors);
        if (validation.human.rubric_version !== 1) errors.push("receipt.validation.human.rubric_version: invalid");
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, receipt: input as unknown as ExampleReviewReceipt };
}

/**
 * Every reason this receipt may NOT back a corpus entry. An empty array is the only thing that
 * permits promotion; absence of evidence is refusal, never approval.
 */
export function promotionRejections(input: unknown): readonly string[] {
  const parsed = parseExampleReviewReceipt(input);
  if (!parsed.ok) return parsed.errors;
  const { split, validation } = parsed.receipt;
  const rejections: string[] = [];

  // Holdout cases evaluate the presets; teaching from them would contaminate the comparison.
  if (split !== "development") rejections.push("split: only a development case may teach");
  if (validation.terminal !== "completed") rejections.push("validation.terminal: the run did not complete");
  if (validation.mandatory.length === 0) rejections.push("validation.mandatory: no mandatory check was recorded");
  for (const check of validation.mandatory) {
    if (check.status !== "pass") rejections.push(`validation.mandatory.${check.check_id}: not passed`);
  }
  if (!validation.human) rejections.push("validation.human: no human review");
  else if (validation.human.verdict !== "approved") rejections.push("validation.human.verdict: not approved");

  return rejections;
}
