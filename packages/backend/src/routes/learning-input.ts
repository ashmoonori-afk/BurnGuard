import type { LearningNextContext } from "@bg/shared/learning-contract";

/** Feedback reaches the generation prompt verbatim, so it is bounded here rather than by the JSON body limit. */
export const MAX_CHECKPOINT_FEEDBACK_CHARS = 2000;

export class LearningInputError extends Error {
  readonly name = "LearningInputError";
  readonly code = "invalid_learning_body" as const;
  constructor(readonly field: string) { super(`Invalid learning body field: ${field}`); }
}

export class LearningIdentifierError extends Error {
  readonly name = "LearningIdentifierError";
  readonly code = "invalid_learning_id" as const;
  readonly field = "id" as const;
  constructor() { super("Invalid learning identifier"); }
}

export function parseLearningId(input: unknown): string {
  if (typeof input !== "string") throw new LearningIdentifierError();
  const value = input.normalize("NFC");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value)) {
    throw new LearningIdentifierError();
  }
  return value;
}

export type ItemInput = {
  readonly id: string;
  readonly kind: "lesson" | "example" | "skill-card";
  readonly title: string;
  readonly summary: string;
  readonly projectId: string | null;
};
export type ProgressInput = {
  readonly expectedRevision: number;
  readonly state: "not_started" | "in_progress" | "completed";
  readonly feedbackDraft: string | null;
};
export type CheckpointInput = {
  readonly id: string;
  readonly projectId: string;
  readonly artifactRevision: number;
  readonly artifactDigest: string;
  readonly feedback: string;
  readonly parentCheckpointId: string | null;
  readonly nextContext: LearningNextContext;
  readonly evidence: { readonly kind: "complete" } | { readonly kind: "partial"; readonly code: "missing_artifact_evidence" };
};

export function parseItem(input: unknown): ItemInput {
  const body = record(input);
  exact(body, ["id", "kind", "title", "content", "project_id"]);
  const kind = itemKind(body["kind"]);
  const projectId = nullableIdentifier(body, "project_id");
  if (kind === "example" && projectId === null) throw new LearningInputError("project_id");
  const content = record(body["content"]);
  exact(content, ["summary"]);
  return { id: identifier(body, "id"), kind, title: string(body, "title"), summary: string(content, "summary"), projectId };
}

export function parseRename(input: unknown): { readonly expectedRevision: number; readonly title: string } {
  const body = record(input); exact(body, ["expected_revision", "title"]);
  return { expectedRevision: integer(body, "expected_revision"), title: string(body, "title") };
}
export function parseDuplicate(input: unknown): { readonly id: string; readonly title: string } {
  const body = record(input); exact(body, ["id", "title"]);
  return { id: identifier(body, "id"), title: string(body, "title") };
}
export function parseProgress(input: unknown): ProgressInput {
  const body = record(input); exact(body, ["expected_revision", "state", "feedback_draft"]);
  return { expectedRevision: integer(body, "expected_revision"), state: progressState(body["state"]), feedbackDraft: nullableString(body, "feedback_draft") };
}
export function parseExpectedRevision(input: unknown): number {
  const body = record(input); exact(body, ["expected_revision"]); return integer(body, "expected_revision");
}
export function parseCheckpoint(input: unknown): CheckpointInput {
  const body = record(input);
  exact(body, ["id", "project_id", "artifact_revision", "artifact_digest", "feedback", "parent_checkpoint_id", "next_context", "evidence"]);
  const context = record(body["next_context"]); exact(context, ["kind", "parent_checkpoint_id", "schema_revision", "artifact_revision", "artifact_digest"]);
  if (context["kind"] !== "iteration") throw new LearningInputError("next_context.kind");
  const evidence = record(body["evidence"]);
  const evidenceKind = evidence["kind"];
  if (evidenceKind === "complete") { exact(evidence, ["kind"]); }
  else if (evidenceKind === "partial") { exact(evidence, ["kind", "code"]); if (evidence["code"] !== "missing_artifact_evidence") throw new LearningInputError("evidence.code"); }
  else throw new LearningInputError("evidence.kind");
  return {
    id: identifier(body, "id"), projectId: identifier(body, "project_id"), artifactRevision: integer(body, "artifact_revision"),
    artifactDigest: string(body, "artifact_digest"), feedback: boundedString(body, "feedback", MAX_CHECKPOINT_FEEDBACK_CHARS), parentCheckpointId: nullableIdentifier(body, "parent_checkpoint_id"),
    nextContext: { kind: "iteration", parent_checkpoint_id: identifier(context, "parent_checkpoint_id"), schema_revision: integer(context, "schema_revision"), artifact_revision: integer(context, "artifact_revision"), artifact_digest: string(context, "artifact_digest") },
    evidence: evidenceKind === "complete" ? { kind: "complete" } : { kind: "partial", code: "missing_artifact_evidence" },
  };
}
export function parseEmpty(input: unknown): void { exact(record(input), []); }

function record(input: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(input)) throw new LearningInputError("body");
  return input;
}
function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
function exact(body: Readonly<Record<string, unknown>>, fields: readonly string[]): void {
  const allowed = new Set(fields); const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown !== undefined) throw new LearningInputError(unknown);
}
function string(body: Readonly<Record<string, unknown>>, field: string): string {
  const value = body[field]; if (typeof value !== "string" || value.trim().length === 0) throw new LearningInputError(field); return value.trim();
}
function boundedString(body: Readonly<Record<string, unknown>>, field: string, maximum: number): string {
  const value = string(body, field); if (value.length > maximum) throw new LearningInputError(field); return value;
}
function nullableString(body: Readonly<Record<string, unknown>>, field: string): string | null {
  const value = body[field]; if (value === null) return null; return string(body, field);
}
function identifier(body: Readonly<Record<string, unknown>>, field: string): string {
  try { return parseLearningId(body[field]); }
  catch (error) { if (error instanceof LearningIdentifierError) throw new LearningInputError(field); throw error; }
}
function nullableIdentifier(body: Readonly<Record<string, unknown>>, field: string): string | null {
  return body[field] === null ? null : identifier(body, field);
}
function integer(body: Readonly<Record<string, unknown>>, field: string): number {
  const value = body[field]; if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new LearningInputError(field); return value;
}
function itemKind(value: unknown): ItemInput["kind"] {
  switch (value) { case "lesson": case "example": case "skill-card": return value; default: throw new LearningInputError("kind"); }
}
function progressState(value: unknown): ProgressInput["state"] {
  switch (value) { case "not_started": case "in_progress": case "completed": return value; default: throw new LearningInputError("state"); }
}
