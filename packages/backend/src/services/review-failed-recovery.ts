import type { Database } from "bun:sqlite";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DESIGN_AUDIT_CHECK_CODES, type DesignAuditResult, type RecoverReviewFailedDraftResponse, type ReviewFailedDraftOffer, type UnverifiedDraftStateV1 } from "@bg/shared";
import { SELECT_ARTIFACT_OPERATION } from "../db/artifact-operation-query";
import { createProjectRecord, getProjectDetail } from "../db/seed";
import { projectsDir, resolveManagedPath } from "../lib/paths";
import { assertSafeName, resolveWithin } from "../security/path-boundary";
import { parsePersistedArtifactOperation, type PersistedArtifactOperationRow } from "./artifact-operation-record";
import { materializeManagedTree } from "./artifact-tree-storage";
import { inspectCanonicalTree, isCanonicalTreeRootMissing } from "./canonical-tree-manifest";
import { readCachedProjectAudit } from "./design-audit";
import { prepareStagedPhotoRecord, writePreparedPhotoRecord } from "./photo-placement-publication";

const RECEIPT_FILE = "review-failure.json";
const DRAFT_FILE = "unverified-draft.json";
const HASH = /^[0-9a-f]{64}$/;
/** Same ceiling as the retained-operation list: a failed generation is rare, a long tail of them is not useful to offer. */
const MAX_OFFERS = 10;

export type ReviewRecoveryErrorCode = "draft_recovery_unavailable" | "draft_recovery_expired" | "draft_recovery_corrupt" | "draft_recovery_disallowed";
export class ReviewRecoveryError extends Error {
  readonly name = "ReviewRecoveryError";
  constructor(readonly code: ReviewRecoveryErrorCode) { super(code); }
}

/** Written next to the retained stage when a turn is refused for its design review; it dies with the operation copy at retention expiry. */
type ReviewFailureReceipt = {
  readonly schema_version: 1;
  readonly code: "design_review_failed";
  readonly stage_digest: string;
  readonly incomplete_checks: readonly string[];
  /** Digests the failed turn's publication policy refused to publish (immutable visual references). */
  readonly forbidden_sha256: readonly string[];
};

export async function writeReviewFailureReceipt(stageDir: string, input: { readonly result: DesignAuditResult | null; readonly forbiddenSha256: ReadonlySet<string> }): Promise<void> {
  const incomplete = input.result === null ? [...DESIGN_AUDIT_CHECK_CODES] : input.result.checks.filter((check) => check.status !== "pass").map((check) => check.code);
  const receipt: ReviewFailureReceipt = { schema_version: 1, code: "design_review_failed", stage_digest: (await inspectCanonicalTree(stageDir)).tree_digest, incomplete_checks: incomplete, forbidden_sha256: [...input.forbiddenSha256].sort() };
  const target = path.join(path.dirname(stageDir), RECEIPT_FILE);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(receipt), { flag: "wx", mode: 0o600 });
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}

async function readSmallJson(file: string): Promise<unknown> {
  const info = await lstat(file);
  if (!info.isFile() || info.size > 64 * 1024) throw new Error("receipt_invalid");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return JSON.parse(await handle.readFile("utf8")); } finally { await handle.close(); }
}

function parseReceipt(value: unknown): ReviewFailureReceipt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("receipt_invalid");
  const item = value as Record<string, unknown>;
  const strings = (entry: unknown, pattern?: RegExp): entry is string[] => Array.isArray(entry) && entry.length <= 64 && entry.every((part) => typeof part === "string" && part.length <= 64 && (pattern === undefined || pattern.test(part)));
  if (Object.keys(item).length !== 5 || item["schema_version"] !== 1 || item["code"] !== "design_review_failed" || typeof item["stage_digest"] !== "string" || !HASH.test(item["stage_digest"]) || !strings(item["incomplete_checks"], /^[a-z0-9_]+$/) || !strings(item["forbidden_sha256"], HASH)) throw new Error("receipt_invalid");
  return { schema_version: 1, code: "design_review_failed", stage_digest: item["stage_digest"], incomplete_checks: item["incomplete_checks"], forbidden_sha256: item["forbidden_sha256"] };
}

type Located = { readonly operationId: string; readonly failedAt: number; readonly retainedUntil: number; readonly stagePath: string; readonly receiptPath: string };

/** Resolves the failed operation's own storage; every refusal here is a typed code, never a path. */
function locate(db: Database, project: { readonly id: string; readonly dir_path: string }, operationId: string, now: number, projectsRoot: string): Located {
  const row = db.query<PersistedArtifactOperationRow, [string, string]>(`${SELECT_ARTIFACT_OPERATION} WHERE id=? AND project_id=?`).get(operationId, project.id);
  if (row === null) throw new ReviewRecoveryError("draft_recovery_unavailable");
  let operation: ReturnType<typeof parsePersistedArtifactOperation>;
  try { operation = parsePersistedArtifactOperation(row); } catch { throw new ReviewRecoveryError("draft_recovery_corrupt"); }
  if (operation.status !== "failed" || operation.replay.kind !== "turn") throw new ReviewRecoveryError("draft_recovery_unavailable");
  if (!operation.retention.replayable || operation.retention.retained_until <= now) throw new ReviewRecoveryError("draft_recovery_expired");
  let root: string;
  try { root = resolveWithin(resolveManagedPath(projectsRoot, project.dir_path), ".meta", "artifact-operations", assertSafeName(operation.id)); }
  catch { throw new ReviewRecoveryError("draft_recovery_corrupt"); }
  const stagePath = path.join(root, "stage");
  if (path.resolve(operation.snapshot.stage_path) !== stagePath) throw new ReviewRecoveryError("draft_recovery_corrupt");
  return { operationId: operation.id, failedAt: operation.updated_at, retainedUntil: operation.retention.retained_until, stagePath, receiptPath: path.join(root, RECEIPT_FILE) };
}

async function loadReceipt(located: Located): Promise<ReviewFailureReceipt> {
  if (await isCanonicalTreeRootMissing(located.stagePath)) throw new ReviewRecoveryError("draft_recovery_unavailable");
  let raw: unknown;
  try { raw = await readSmallJson(located.receiptPath); }
  catch (error) { throw new ReviewRecoveryError((error as NodeJS.ErrnoException).code === "ENOENT" ? "draft_recovery_unavailable" : "draft_recovery_corrupt"); }
  try { return parseReceipt(raw); } catch { throw new ReviewRecoveryError("draft_recovery_corrupt"); }
}

/** Failed generations whose retained output can still be opened as a draft. Unreadable ones are simply not offered. */
export async function listReviewFailedDrafts(db: Database, projectId: string, options: { readonly now?: number; readonly projectsRoot?: string } = {}): Promise<ReviewFailedDraftOffer[]> {
  const now = options.now ?? Date.now();
  const project = await getProjectDetail(projectId);
  if (project === null) return [];
  const rows = db.query<{ id: string }, [string, number]>("SELECT id FROM artifact_operations WHERE project_id=? AND status='failed' AND json_extract(replay_json,'$.kind')='turn' AND json_extract(retention_json,'$.replayable')=1 AND json_extract(retention_json,'$.retained_until')>? ORDER BY created_at DESC,id DESC LIMIT 50").all(projectId, now);
  const offers: ReviewFailedDraftOffer[] = [];
  for (const { id } of rows) {
    if (offers.length >= MAX_OFFERS) break;
    try {
      const located = locate(db, project, id, now, options.projectsRoot ?? projectsDir);
      const receipt = await loadReceipt(located);
      offers.push({ operation_id: located.operationId, failed_at: located.failedAt, retained_until: located.retainedUntil, incomplete_checks: [...receipt.incomplete_checks] });
    } catch (error) { if (!(error instanceof ReviewRecoveryError)) throw error; }
  }
  return offers;
}

/**
 * Opens the retained stage of a review-failed operation as a NEW project. The original project, its revision and its
 * audit are never touched, and the new project is flagged unverified until a later revision replaces the recovered bytes.
 */
export async function recoverReviewFailedDraft(db: Database, input: { readonly projectId: string; readonly operationId: string; readonly now?: number; readonly projectsRoot?: string }): Promise<RecoverReviewFailedDraftResponse> {
  const now = input.now ?? Date.now();
  const project = await getProjectDetail(input.projectId);
  if (project === null) throw new ReviewRecoveryError("draft_recovery_unavailable");
  const located = locate(db, project, input.operationId, now, input.projectsRoot ?? projectsDir);
  const receipt = await loadReceipt(located);
  let manifest: Awaited<ReturnType<typeof inspectCanonicalTree>>;
  try { manifest = await inspectCanonicalTree(located.stagePath); } catch { throw new ReviewRecoveryError("draft_recovery_corrupt"); }
  if (manifest.tree_digest !== receipt.stage_digest || !manifest.files.some((file) => file.path === project.entrypoint)) throw new ReviewRecoveryError("draft_recovery_corrupt");
  const forbidden = new Set(receipt.forbidden_sha256);
  if (manifest.files.some((file) => forbidden.has(file.sha256))) throw new ReviewRecoveryError("draft_recovery_disallowed");
  const state: UnverifiedDraftStateV1 = { schema_version: 1, reason: "design_review_failed", incomplete_checks: [...receipt.incomplete_checks], retained_until: located.retainedUntil, recovered_at: now, source_project_id: project.id, source_operation_id: located.operationId };
  const created = await createProjectRecord({
    name: `${project.name} (recovered)`, type: project.type, designSystemId: project.design_system_id, backendId: project.backend_id,
    optionsJson: project.options_json, entrypoint: project.entrypoint, thumbnailPath: null,
    // The flag is written before the project row exists, so a draft can never be visible without it.
    beforeInsert: async (dirPath) => {
      await mkdir(path.join(dirPath, ".meta"), { recursive: true });
      await writeFile(path.join(dirPath, ".meta", DRAFT_FILE), JSON.stringify(state), { flag: "wx", mode: 0o600 });
      // The draft carries the validated photo placement record of the retained stage; nothing else under .meta is copied.
      const photoRecord = await prepareStagedPhotoRecord(located.stagePath);
      if (photoRecord.kind === "ready") await writePreparedPhotoRecord(photoRecord, dirPath);
    },
    initializeArtifact: async (stage) => { await materializeManagedTree(located.stagePath, stage); },
  });
  return { project_id: created.id, session_id: created.session_id, entrypoint: created.entrypoint };
}

/**
 * The unverified flag of a project. Edits do not clear it: only a design audit of the project's CURRENT revision
 * (the cache keyed by revision and digest, written by a passing turn review or the Quality audit) with no must_fix
 * result does, the same bar the review that refused the original output applied.
 */
export async function readUnverifiedDraft(projectDir: string, project: { readonly id: string; readonly current_revision: number; readonly current_digest: string | null }): Promise<UnverifiedDraftStateV1 | null> {
  let raw: unknown;
  try { raw = await readSmallJson(path.join(projectDir, ".meta", DRAFT_FILE)); } catch { return null; }
  if (typeof raw !== "object" || raw === null) return null;
  const state = raw as UnverifiedDraftStateV1;
  if (state.schema_version !== 1 || state.reason !== "design_review_failed") return null;
  if (project.current_digest === null) return state;
  const audit = await readCachedProjectAudit(projectDir, project.id, project.current_revision, project.current_digest);
  return audit !== null && audit.overall_status !== "must_fix" ? null : state;
}
