import type { Database } from "bun:sqlite";
import { parseLearningNextContext, UpgradeContractError, type LearningNextContext } from "@bg/shared/learning-contract";
import type { ItemInput, ProgressInput } from "../routes/learning-input";

export type LearningStoreCode = "not_found" | "protected_seed" | "expected_revision_conflict" | "artifact_identity_mismatch" | "incompatible_schema" | "invalid_parent" | "duplicate_id" | "corrupt_item";
export class LearningStoreError extends Error {
  readonly name = "LearningStoreError";
  constructor(readonly code: LearningStoreCode, readonly id: string) { super(`${code}: ${id}`); }
}
type Envelope = { readonly schema_revision: 1; readonly owner: "system" | "user"; readonly seed_key: string | null; readonly revision: number; readonly content: { readonly summary: string } };
type ItemRow = { readonly id: string; readonly kind: ItemInput["kind"]; readonly title: string; readonly content_json: string; readonly project_id: string | null; readonly parent_item_id: string | null; readonly deleted_at: number | null; readonly created_at: number; readonly updated_at: number };
type ProgressRow = { readonly state: ProgressInput["state"]; readonly revision: number; readonly feedback_draft: string | null; readonly updated_at: number };
type CheckpointRow = { readonly id: string; readonly item_id: string; readonly project_id: string; readonly parent_checkpoint_id: string | null; readonly artifact_revision: number; readonly artifact_digest: string; readonly feedback: string; readonly next_context_json: string; readonly created_at: number };
export type CheckpointCommit = { readonly id: string; readonly itemId: string; readonly projectId: string; readonly artifactRevision: number; readonly artifactDigest: string; readonly feedback: string; readonly parentCheckpointId: string | null; readonly nextContext: LearningNextContext; readonly createdAt: number };
export type PromptLearning = { readonly context: { readonly checkpoint_id: string; readonly item_id: string; readonly project_id: string; readonly artifact_revision: number; readonly artifact_digest: string; readonly feedback: string; readonly next_context: LearningNextContext } | null; readonly warning: "incompatible_checkpoint" | null };
export const LEARNING_SEEDS = [
  { id: "burnguard-learning-contrast", kind: "lesson", title: "Contrast hierarchy", summary: "Use contrast to establish hierarchy.", seedKey: "contrast" },
  { id: "burnguard-learning-layout", kind: "skill-card", title: "Layout rhythm", summary: "Build a repeatable spatial rhythm.", seedKey: "layout" },
] as const;

export function createLearningItem(db: Database, input: ItemInput, now = Date.now()): ReturnType<typeof getLearningItem> {
  if (input.kind === "example") requireProject(db, input.projectId ?? "");
  const envelope: Envelope = { schema_revision: 1, owner: "user", seed_key: null, revision: 0, content: { summary: input.summary } };
  try {
    db.transaction(() => {
      db.prepare("INSERT INTO learning_items (id,kind,title,content_json,project_id,parent_item_id,created_at,updated_at) VALUES (?,?,?,?,?,NULL,?,?)").run(input.id, input.kind, input.title, JSON.stringify(envelope), input.projectId, now, now);
      db.prepare("INSERT INTO learning_progress (item_id,state,revision,feedback_draft,updated_at) VALUES (?,'not_started',0,NULL,?)").run(input.id, now);
    })();
  } catch (error) { if (isConstraint(error)) throw new LearningStoreError("duplicate_id", input.id); throw error; }
  return getLearningItem(db, input.id, true);
}

export function getLearningItem(db: Database, id: string, includeDeleted = false) {
  const row = db.query<ItemRow, [string]>("SELECT * FROM learning_items WHERE id=?").get(id);
  if (row === null || (!includeDeleted && row.deleted_at !== null)) throw new LearningStoreError("not_found", id);
  const envelope = parseEnvelope(row.content_json, row);
  const progress = db.query<ProgressRow, [string]>("SELECT state,revision,feedback_draft,updated_at FROM learning_progress WHERE item_id=?").get(id);
  if (progress === null) throw new LearningStoreError("corrupt_item", id);
  const checkpoint = db.query<CheckpointRow, [string]>("SELECT * FROM learning_checkpoints WHERE item_id=? ORDER BY created_at DESC,id DESC LIMIT 1").get(id);
  return { id: row.id, kind: row.kind, title: row.title, content: envelope.content, owner: envelope.owner, revision: envelope.revision, project_id: row.project_id, parent_item_id: row.parent_item_id, deleted_at: row.deleted_at, progress, checkpoint: checkpoint === null ? null : checkpointResult(checkpoint) };
}

export function renameLearningItem(db: Database, input: { readonly id: string; readonly expectedRevision: number; readonly title: string }) {
  const item = getLearningItem(db, input.id, true);
  if (item.owner === "system") throw new LearningStoreError("protected_seed", input.id);
  if (item.revision !== input.expectedRevision) throw new LearningStoreError("expected_revision_conflict", input.id);
  const row = db.query<{ readonly content_json: string }, [string]>("SELECT content_json FROM learning_items WHERE id=?").get(input.id);
  if (row === null) throw new LearningStoreError("not_found", input.id);
  const envelope = parseEnvelope(row.content_json, { id: input.id, kind: item.kind });
  db.prepare("UPDATE learning_items SET title=?,content_json=?,updated_at=? WHERE id=? AND content_json=?").run(input.title, JSON.stringify({ ...envelope, revision: input.expectedRevision + 1 }), Date.now(), input.id, row.content_json);
  requireChanged(db, input.id);
  return getLearningItem(db, input.id, true);
}

export function duplicateLearningItem(db: Database, input: { readonly sourceId: string; readonly id: string; readonly title: string }) {
  const source = getLearningItem(db, input.sourceId, true);
  if (source.kind === "example") requireProject(db, source.project_id ?? "");
  const now = Date.now();
  const envelope: Envelope = { schema_revision: 1, owner: "user", seed_key: null, revision: 0, content: { summary: source.content.summary } };
  try {
    db.transaction(() => {
      db.prepare("INSERT INTO learning_items (id,kind,title,content_json,project_id,parent_item_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(input.id, source.kind, input.title, JSON.stringify(envelope), source.project_id, input.sourceId, now, now);
      db.prepare("INSERT INTO learning_progress (item_id,state,revision,feedback_draft,updated_at) VALUES (?,'not_started',0,NULL,?)").run(input.id, now);
    })();
  } catch (error) { if (isConstraint(error)) throw new LearningStoreError("duplicate_id", input.id); throw error; }
  return getLearningItem(db, input.id, true);
}

export function setLearningDeleted(db: Database, id: string, expectedRevision: number, deleted: boolean) {
  const item = getLearningItem(db, id, true);
  if (item.owner === "system") throw new LearningStoreError("protected_seed", id);
  if (item.revision !== expectedRevision || (item.deleted_at !== null) === deleted) throw new LearningStoreError("expected_revision_conflict", id);
  const row = db.query<{ readonly content_json: string }, [string]>("SELECT content_json FROM learning_items WHERE id=?").get(id);
  if (row === null) throw new LearningStoreError("not_found", id);
  const envelope = parseEnvelope(row.content_json, { id, kind: item.kind });
  const next = JSON.stringify({ ...envelope, revision: expectedRevision + 1 });
  db.prepare("UPDATE learning_items SET deleted_at=?,content_json=?,updated_at=? WHERE id=? AND content_json=?").run(deleted ? Date.now() : null, next, Date.now(), id, row.content_json);
  requireChanged(db, id);
  return getLearningItem(db, id, true);
}

export function updateStoredProgress(db: Database, id: string, input: ProgressInput) {
  getLearningItem(db, id);
  db.prepare("UPDATE learning_progress SET state=?,revision=revision+1,feedback_draft=?,updated_at=? WHERE item_id=? AND revision=?").run(input.state, input.feedbackDraft, Date.now(), id, input.expectedRevision);
  requireChanged(db, id);
  return getLearningItem(db, id);
}
export function resetStoredProgress(db: Database, id: string, expectedRevision: number) {
  return updateStoredProgress(db, id, { expectedRevision, state: "not_started", feedbackDraft: null });
}

export function commitStoredCheckpoint(db: Database, input: CheckpointCommit) {
  getLearningItem(db, input.itemId);
  const project = requireProject(db, input.projectId);
  if (project.current_revision !== input.artifactRevision || project.current_digest !== input.artifactDigest || input.nextContext.artifact_revision !== input.artifactRevision || input.nextContext.artifact_digest !== input.artifactDigest) throw new LearningStoreError("artifact_identity_mismatch", input.id);
  if (input.nextContext.schema_revision !== 1) throw new LearningStoreError("incompatible_schema", input.id);
  if (input.nextContext.parent_checkpoint_id !== input.id) throw new LearningStoreError("invalid_parent", input.id);
  if (input.parentCheckpointId !== null) {
    const parent = db.query<CheckpointRow, [string]>("SELECT * FROM learning_checkpoints WHERE id=?").get(input.parentCheckpointId);
    if (parent === null || !validLineage(db, parent, input.itemId, input.projectId, input.artifactRevision, input.artifactDigest)) throw new LearningStoreError("invalid_parent", input.id);
  }
  try {
    db.prepare("INSERT INTO learning_checkpoints (id,item_id,project_id,parent_checkpoint_id,artifact_revision,artifact_digest,feedback,next_context_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(input.id, input.itemId, input.projectId, input.parentCheckpointId, input.artifactRevision, input.artifactDigest, input.feedback, JSON.stringify(input.nextContext), input.createdAt);
  } catch (error) { if (isConstraint(error)) throw new LearningStoreError("duplicate_id", input.id); throw error; }
  return getLearningItem(db, input.itemId);
}

export function selectPromptLearning(db: Database, projectId: string): PromptLearning {
  const project = db.query<{ readonly current_revision: number; readonly current_digest: string | null }, [string]>("SELECT current_revision,current_digest FROM projects WHERE id=?").get(projectId);
  if (project === null) return { context: null, warning: null };
  const row = db.query<CheckpointRow, [string]>("SELECT * FROM learning_checkpoints WHERE project_id=? ORDER BY artifact_revision DESC,created_at DESC,id DESC LIMIT 1").get(projectId);
  if (row === null) return { context: null, warning: null };
  const item = db.query<{ readonly deleted_at: number | null }, [string]>("SELECT deleted_at FROM learning_items WHERE id=?").get(row.item_id);
  if (item === null || item.deleted_at !== null || !validLineage(db, row, row.item_id, projectId, row.artifact_revision, row.artifact_digest)) return { context: null, warning: "incompatible_checkpoint" };
  // An intact checkpoint that names an earlier artifact is superseded by later work, not corrupt: nothing to inject and nothing to warn about.
  if (row.artifact_revision !== project.current_revision || row.artifact_digest !== project.current_digest) return { context: null, warning: null };
  const context = parseContext(row);
  if (context === null) return { context: null, warning: "incompatible_checkpoint" };
  return { context: { checkpoint_id: row.id, item_id: row.item_id, project_id: row.project_id, artifact_revision: row.artifact_revision, artifact_digest: row.artifact_digest, feedback: row.feedback, next_context: context }, warning: null };
}

function validLineage(db: Database, start: CheckpointRow, itemId: string, projectId: string, revision: number, digest: string): boolean {
  const seen = new Set<string>();
  let row: CheckpointRow | null = start;
  while (row !== null) {
    if (seen.has(row.id) || row.item_id !== itemId || row.project_id !== projectId || row.artifact_revision !== revision || row.artifact_digest !== digest) return false;
    seen.add(row.id);
    const context = parseContext(row);
    if (context === null || context.schema_revision !== 1 || context.parent_checkpoint_id !== row.id || context.artifact_revision !== revision || context.artifact_digest !== digest) return false;
    if (row.parent_checkpoint_id === null) return true;
    row = db.query<CheckpointRow, [string]>("SELECT * FROM learning_checkpoints WHERE id=?").get(row.parent_checkpoint_id);
  }
  return false;
}
function checkpointResult(row: CheckpointRow) {
  const context = parseContext(row);
  if (context === null) throw new LearningStoreError("corrupt_item", row.item_id);
  return { id: row.id, project_id: row.project_id, parent_checkpoint_id: row.parent_checkpoint_id, artifact_revision: row.artifact_revision, artifact_digest: row.artifact_digest, feedback: row.feedback, next_context: context, created_at: row.created_at };
}
function parseContext(row: CheckpointRow): LearningNextContext | null {
  try { return parseLearningNextContext(row.next_context_json); }
  catch (error) { if (error instanceof UpgradeContractError) return null; throw error; }
}
function parseEnvelope(raw: string, identity: { readonly id: string; readonly kind: ItemInput["kind"] }): Envelope {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !exact(value, ["schema_revision", "owner", "seed_key", "revision", "content"]) || value["schema_revision"] !== 1 || (value["owner"] !== "system" && value["owner"] !== "user") || !Number.isSafeInteger(value["revision"]) || typeof value["revision"] !== "number" || value["revision"] < 0 || !isRecord(value["content"]) || !exact(value["content"], ["summary"]) || typeof value["content"]["summary"] !== "string") throw new LearningStoreError("corrupt_item", identity.id);
    const seed = LEARNING_SEEDS.find((entry) => entry.id === identity.id);
    const validSystem = value["owner"] === "system" && seed !== undefined && seed.kind === identity.kind && value["seed_key"] === seed.seedKey && value["content"]["summary"] === seed.summary;
    const validUser = value["owner"] === "user" && value["seed_key"] === null;
    if (!validSystem && !validUser) throw new LearningStoreError("corrupt_item", identity.id);
    const seedKey = value["owner"] === "system" ? seed?.seedKey ?? null : null;
    return { schema_revision: 1, owner: value["owner"], seed_key: seedKey, revision: value["revision"], content: { summary: value["content"]["summary"] } };
  } catch (error) { if (error instanceof SyntaxError) throw new LearningStoreError("corrupt_item", identity.id); throw error; }
}
function requireProject(db: Database, id: string) { const row = db.query<{ readonly current_revision: number; readonly current_digest: string | null }, [string]>("SELECT current_revision,current_digest FROM projects WHERE id=?").get(id); if (row === null) throw new LearningStoreError("not_found", id); return row; }
function requireChanged(db: Database, id: string): void { if (db.query<{ readonly changed: number }, []>("SELECT changes() changed").get()?.changed !== 1) throw new LearningStoreError("expected_revision_conflict", id); }
function exact(value: Readonly<Record<string, unknown>>, fields: readonly string[]): boolean { return Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field)); }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isConstraint(error: unknown): boolean { return error instanceof Error && /constraint|unique/i.test(error.message); }
