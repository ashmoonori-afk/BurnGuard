import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import path from "node:path";
import type { TurnErrorCode, TurnRejectionReason } from "@bg/shared/events";
import { requiredArray, requiredBoolean, stringArray } from "@bg/shared/contract-parser";
import { parseLearningContract } from "@bg/shared/learning-contract";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { createArtifactOperation, transitionArtifactOperation } from "../src/db/artifact-operation-repository";
import { commitDesignSystemReceipt, getDesignSystemPipeline, prepareDesignSystemReceipt, updateDesignSystemMetadata } from "../src/db/design-system-repository";
import { insertSequencedEvent, listSequencedSessionEvents, parsePersistedNormalizedEvent, parsePersistedUserEvent } from "../src/db/event-sequence-repository";
import { persistNormalizedEvent } from "../src/db/events";
import { createExportAttempt, createExportRetry, getExportAttempt } from "../src/db/export-attempt-repository";
import { createLearningCheckpoint, getLearningCheckpoint, updateLearningProgress } from "../src/db/learning-repository";
import { runMigrationsFrom } from "../src/db/migrate";
import { PipelineRepositoryError, reconcilePipelineRows } from "../src/db/pipeline-repository";
import { LogoDeliverableError } from "../src/services/logo-deliverables";
import { sanitizeTurnEvent } from "../src/services/turn-error-sanitizer";

let sqlite: Database;
let db: ReturnType<typeof drizzle>;
const migrations = path.join(import.meta.dir, "../src/db/migrations");

beforeEach(async () => {
  sqlite = new Database(":memory:");
  db = drizzle(sqlite);
  sqlite.exec("PRAGMA foreign_keys = ON");
  await runMigrationsFrom(sqlite, migrations);
  sqlite.exec(`
    INSERT INTO design_systems (id,name,status,dir_path,created_at,updated_at) VALUES ('ds','Original','draft','/missing/ds',1,1);
    INSERT INTO projects (id,name,type,dir_path,backend_id,current_revision,current_digest,created_at,updated_at) VALUES ('p','Project','prototype','/missing/p','codex',3,'project-digest',1,1);
    INSERT INTO sessions (id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES ('s','p','codex','idle',1,1,1);
    INSERT INTO exports (id,project_id,format,status,options_json,created_at) VALUES ('job','p','pdf','pending','{"pdf_paper":"a4"}',1);
    INSERT INTO learning_items (id,kind,title,content_json,created_at,updated_at) VALUES ('lesson','lesson','Lesson','{}',1,1);
    INSERT INTO learning_progress (item_id,state,revision,feedback_draft,updated_at) VALUES ('lesson','not_started',0,NULL,1);
  `);
});
afterEach(() => sqlite.close());

function repositoryError(error: unknown): PipelineRepositoryError {
  expect(error).toBeInstanceOf(PipelineRepositoryError);
  if (!(error instanceof PipelineRepositoryError)) throw error;
  return error;
}

describe("design system repository", () => {
  test("Given Unicode-equivalent tags and a content receipt When metadata updates Then tags are NFC stable and content identity is unchanged", () => {
    // Given
    prepareDesignSystemReceipt(db, { id: "r1", designSystemId: "ds", contentRevision: 1, schemaVersion: 1, digest: "digest", manifest: { files: [] }, provenance: { state: "unknown" }, createdAt: 2 });
    commitDesignSystemReceipt(db, { id: "r1", digest: "digest", updatedAt: 2 });
    const before = getDesignSystemPipeline(db, "ds");

    // When
    const result = updateDesignSystemMetadata(db, { id: "ds", expectedRevision: 0, name: "Renamed", description: null, tags: ["z", "e\u0301", "é", " a "], updatedAt: 3 });

    // Then
    expect(result).toEqual({ id: "ds", metadataRevision: 1, tags: ["a", "z", "é"] });
    expect(getDesignSystemPipeline(db, "ds").receipt).toEqual(before.receipt);
    expect(sqlite.query("SELECT name,metadata_revision FROM design_systems WHERE id='ds'").get()).toEqual({ name: "Renamed", metadata_revision: 1 });
  });

  test("Given stale metadata and conflicting receipt writes When attempted Then typed conflicts leave all rows unchanged", () => {
    // Given
    prepareDesignSystemReceipt(db, { id: "r1", designSystemId: "ds", contentRevision: 1, schemaVersion: 1, digest: "digest", manifest: {}, provenance: { state: "unknown" }, createdAt: 2 });
    const before = sqlite.serialize();

    // When / Then
    try { updateDesignSystemMetadata(db, { id: "ds", expectedRevision: 9, name: "Bad", description: null, tags: ["bad"], updatedAt: 3 }); } catch (error) { expect(repositoryError(error).code).toBe("expected_revision_conflict"); }
    try { prepareDesignSystemReceipt(db, { id: "r2", designSystemId: "ds", contentRevision: 1, schemaVersion: 1, digest: "other", manifest: {}, provenance: { state: "unknown" }, createdAt: 3 }); } catch (error) { expect(repositoryError(error).code).toBe("content_receipt_mismatch"); }
    expect(sqlite.serialize()).toEqual(before);
  });

  test("Given malformed normalized tags When catalog state is read Then a typed corruption code is returned", () => {
    // Given
    sqlite.exec("INSERT INTO design_system_tags (design_system_id,tag,ordinal) VALUES ('ds','é',0)");

    // When / Then
    try { getDesignSystemPipeline(db, "ds"); } catch (error) { expect(repositoryError(error).code).toBe("corrupt_tag"); }
  });

  test("Given a corrupted receipt payload When catalog state is read Then a typed JSON code is returned", () => {
    // Given
    prepareDesignSystemReceipt(db, { id: "r1", designSystemId: "ds", contentRevision: 1, schemaVersion: 1, digest: "digest", manifest: {}, provenance: { state: "unknown" }, createdAt: 2 });
    sqlite.exec("UPDATE design_system_receipts SET manifest_json='{' WHERE id='r1'");

    // When / Then
    try { getDesignSystemPipeline(db, "ds"); } catch (error) { expect(repositoryError(error).code).toBe("corrupt_json"); }
  });
});

describe("learning repository", () => {
  test("Given a complete learning contract When canonical parsing runs Then context and progress remain typed", () => {
    // Given
    const input = {
      id: "lesson", kind: "lesson", revision: 1,
      progress: { state: "in_progress", revision: 1, expected_revision: 1, feedback_draft: null },
      checkpoint: { id: "cp", parent_checkpoint_id: null, artifact_revision: 3, artifact_digest: "project-digest", next_context: { kind: "iteration", parent_checkpoint_id: "cp", schema_revision: 1, artifact_revision: 3, artifact_digest: "project-digest" } },
    };

    // When
    const parsed = parseLearningContract(input);

    // Then
    expect(parsed.kind).toBe("lesson");
    expect(parsed.progress.state).toBe("in_progress");
    expect(parsed.checkpoint?.next_context.artifact_digest).toBe("project-digest");
    expect(requiredBoolean({ enabled: true }, "enabled")).toBe(true);
    expect(requiredArray({ items: [] }, "items")).toEqual([]);
    expect(stringArray({ tags: ["a"] }, "tags")).toEqual(["a"]);
  });

  test("Given valid JSON with incomplete next context When checkpoint is read Then every shape is rejected as corrupt", () => {
    // Given
    const invalidContexts = [
      {},
      { kind: "iteration" },
      { kind: "iteration", parent_checkpoint_id: "cp" },
      { kind: "iteration", parent_checkpoint_id: "cp", schema_revision: 1 },
      { kind: "iteration", parent_checkpoint_id: "cp", schema_revision: 1, artifact_revision: 3 },
    ];
    for (const [index, context] of invalidContexts.entries()) {
      sqlite.prepare("INSERT INTO learning_checkpoints (id,item_id,project_id,artifact_revision,artifact_digest,feedback,next_context_json,created_at) VALUES (?,?,?,?,?,?,?,?)").run(`bad-${index}`, "lesson", "p", 3, "project-digest", "done", JSON.stringify(context), index + 3);
    }

    // When / Then
    for (const index of invalidContexts.keys()) {
      try { getLearningCheckpoint(db, `bad-${index}`); } catch (error) { expect(repositoryError(error).code).toBe("corrupt_json"); }
    }
    expect.assertions(invalidContexts.length * 2);
  });

  test("Given progress revision zero When CAS and digest-bound checkpoint commit Then stale writers fail and checkpoint remains immutable", () => {
    // Given / When
    expect(updateLearningProgress(db, { itemId: "lesson", expectedRevision: 0, state: "in_progress", feedbackDraft: "draft", updatedAt: 2 }).revision).toBe(1);
    createLearningCheckpoint(db, { id: "cp", itemId: "lesson", projectId: "p", artifactRevision: 3, artifactDigest: "project-digest", parentCheckpointId: null, feedback: "done", nextContext: { kind: "iteration", parent_checkpoint_id: "cp", schema_revision: 1, artifact_revision: 3, artifact_digest: "project-digest" }, createdAt: 3 });

    // Then
    try { updateLearningProgress(db, { itemId: "lesson", expectedRevision: 0, state: "completed", feedbackDraft: null, updatedAt: 4 }); } catch (error) { expect(repositoryError(error).code).toBe("expected_revision_conflict"); }
    try { createLearningCheckpoint(db, { id: "cp", itemId: "lesson", projectId: "p", artifactRevision: 3, artifactDigest: "wrong", parentCheckpointId: null, feedback: "bad", nextContext: { kind: "iteration", parent_checkpoint_id: "cp", schema_revision: 1, artifact_revision: 3, artifact_digest: "wrong" }, createdAt: 4 }); } catch (error) { expect(repositoryError(error).code).toBe("artifact_identity_mismatch"); }
    expect(() => sqlite.exec("UPDATE learning_checkpoints SET artifact_digest='changed' WHERE id='cp'")).toThrow();
    expect(getLearningCheckpoint(db, "cp").artifactDigest).toBe("project-digest");
  });
});

describe("artifact, export, event, and recovery repositories", () => {
  test("Given a working artifact operation When another starts and startup reconciles Then one authority and deterministic recovery hold", () => {
    // Given
    createArtifactOperation(db, { id: "op1", projectId: "p", baseRevision: 3, baseDigest: "project-digest", expectedRevision: 3, expectedFileHash: "file", nodeFingerprint: "node", diff: { exact: true }, snapshot: { id: "snap" }, retention: { retained: true }, replay: { cursor: 1 }, createdAt: 2 });
    prepareDesignSystemReceipt(db, { id: "r1", designSystemId: "ds", contentRevision: 1, schemaVersion: 1, digest: "digest", manifest: {}, provenance: { state: "unknown" }, createdAt: 2 });

    // When / Then
    expect(() => createArtifactOperation(db, { id: "op2", projectId: "p", baseRevision: 3, baseDigest: "project-digest", expectedRevision: 3, expectedFileHash: "file", nodeFingerprint: "node", diff: {}, snapshot: {}, retention: {}, replay: {}, createdAt: 3 })).toThrow();
    expect(reconcilePipelineRows(db, 4)).toEqual({ receipts: 1, operations: 1, attempts: 0 });
    expect(reconcilePipelineRows(db, 5)).toEqual({ receipts: 0, operations: 0, attempts: 0 });
    expect(transitionArtifactOperation(db, { id: "op1", from: "recovering", to: "failed", resultRevision: null, resultDigest: null, updatedAt: 6 }).status).toBe("failed");
  });

  test("Given a committed operation When it transitions Then project stable revision and digest advance atomically", () => {
    // Given
    createArtifactOperation(db, { id: "op", projectId: "p", baseRevision: 3, baseDigest: "project-digest", expectedRevision: 3, expectedFileHash: "file", nodeFingerprint: "node", diff: {}, snapshot: {}, retention: {}, replay: {}, createdAt: 2 });

    // When
    transitionArtifactOperation(db, { id: "op", from: "working", to: "committed", resultRevision: 4, resultDigest: "next-digest", updatedAt: 3 });

    // Then
    expect(sqlite.query("SELECT current_revision,current_digest FROM projects WHERE id='p'").get()).toEqual({ current_revision: 4, current_digest: "next-digest" });
  });

  test("Given canonical export options When attempt progresses and job options mutate Then retry preserves the parent snapshot", () => {
    // Given
    const canonical = "{\"pdf_paper\":\"a4\"}";
    createExportAttempt(db, { id: "a1", jobId: "job", parentAttemptId: null, projectRevision: 3, projectDigest: "project-digest", status: "failed", progress: { stage: "render", completed: 1, total: 2 }, stopReason: "render_failed", digests: { options: "ignored", input_closure: "i", renderer: "r", capture: "c", output: "out", receipt: "rec" }, findings: [], retention: { retained_until: 9, output_available: false }, createdAt: 2 });
    sqlite.exec("UPDATE exports SET options_json='{\"pdf_paper\":\"letter\"}' WHERE id='job'");

    // When
    const retry = createExportRetry(db, { id: "a2", parentAttemptId: "a1", createdAt: 3 });

    // Then
    expect(retry).toMatchObject({ id: "a2", parentAttemptId: "a1", canonicalOptions: { pdf_paper: "a4" } });
    expect(sqlite.query("SELECT canonical_options_json,options_digest FROM export_attempts WHERE id='a1'").get()).toEqual({ canonical_options_json: canonical, options_digest: createHash("sha256").update(canonical).digest("hex") });
    expect(reconcilePipelineRows(db, 4).attempts).toBe(1);
    expect(getExportAttempt(db, "a1")).toMatchObject({ stopReason: "render_failed", progress: { stage: "render", completed: 1, total: 2 }, digests: { receipt: "rec" } });
  });

  test("Given invalid real export options When attempt creation runs Then typed rejection leaves zero attempts", () => {
    // Given
    sqlite.exec("UPDATE exports SET options_json='{\"scale\":\"not-a-number\"}' WHERE id='job'");

    // When / Then
    try { createExportAttempt(db, { id: "a1", jobId: "job", parentAttemptId: null, projectRevision: 3, projectDigest: "project-digest", status: "failed", progress: {}, digests: { options: "wrong", input_closure: "i", renderer: "r", capture: "c", output: "out", receipt: "rec" }, findings: [], retention: {}, createdAt: 2 }); } catch (error) { expect(repositoryError(error).code).toBe("invalid_options"); }
    expect(sqlite.query("SELECT COUNT(*) AS count FROM export_attempts").get()).toEqual({ count: 0 });
  });

  test("Given every persisted event variant When decoded Then strict readers preserve its discriminant", () => {
    // Given
    const base = { id: "e", ts: 1, turnId: "t" };
    const normalized = [
      { ...base, type: "chat.user_message", text: "x", attachmentCount: 0 }, { ...base, type: "chat.delta", text: "x" },
      { ...base, type: "chat.thinking", text: "x" }, { ...base, type: "chat.message_end" },
      { ...base, type: "tool.started", toolCallId: "c", tool: "x", input: {} }, { ...base, type: "tool.finished", toolCallId: "c", tool: "x", ok: true, output: {} },
      { ...base, type: "tool.permission_required", toolCallId: "c", tool: "x", input: {} }, { ...base, type: "file.changed", action: "edited", path: "x" },
      { id: "e", ts: 1, type: "status.running" }, { id: "e", ts: 1, type: "status.idle", stopReason: "end_turn" },
      { id: "e", ts: 1, type: "status.error", message: "x", recoverable: true }, { id: "e", ts: 1, type: "usage.delta", input: 1, output: 2, cached: 3 },
    ];
    const users = [{ type: "user.message", text: "x", attachments: ["a"] }, { type: "user.interrupt" }, { type: "user.tool_decision", toolCallId: "c", decision: "allow", reason: "ok" }];

    // When
    const normalizedTypes = normalized.map((item, index) => parsePersistedNormalizedEvent(JSON.stringify(item), `n${index}`).type);
    const userTypes = users.map((item, index) => parsePersistedUserEvent(JSON.stringify(item), `u${index}`).type);

    // Then
    expect(normalizedTypes).toEqual(normalized.map((item) => item.type));
    expect(userTypes).toEqual(users.map((item) => item.type));
    try { parsePersistedNormalizedEvent("{}", "bad"); } catch (error) { expect(repositoryError(error).code).toBe("corrupt_json"); }
  });

  test("Given a persisted sanitized logo failure When replayed Then its stage code and terminal idle survive without diagnostics", () => {
    // Given
    const cause = new LogoDeliverableError("rounds_changed");
    const safe = sanitizeTurnEvent({ id: "logo-error", ts: 10, type: "status.error", message: "private-stage-diagnostic", recoverable: true }, cause);
    const error = persistNormalizedEvent(sqlite, "s", safe);
    const idle = persistNormalizedEvent(sqlite, "s", { id: "logo-idle", ts: 10, type: "status.idle", stopReason: "error" });

    // When
    const replay = listSequencedSessionEvents(sqlite, "s", 0);

    // Then
    expect(replay).toEqual([error, idle]);
    expect(replay[0]?.event).toMatchObject({ type: "status.error", code: "logo_deliverables_missing", recoverable: true });
    expect(JSON.stringify(replay)).not.toContain("private-stage-diagnostic");
    expect(JSON.stringify(replay)).not.toContain(cause.detail);
  });

  test("Given every shared turn error code When persisted and replayed Then strict readers preserve all codes", () => {
    // Given: Record makes additions to the shared DTO require replay coverage.
    const codes = {
      graphic_requires_authenticated_codex: "graphic_requires_authenticated_codex", graphic_starter_unchanged: "graphic_starter_unchanged",
      logo_requires_authenticated_codex: "logo_requires_authenticated_codex", logo_deliverables_missing: "logo_deliverables_missing",
      logo_image_provenance_missing: "logo_image_provenance_missing", design_review_failed: "design_review_failed",
      commandcode_unavailable: "commandcode_unavailable", unsupported_generation_model_effort: "unsupported_generation_model_effort",
      backend_unavailable: "backend_unavailable", agent_control_files_present: "agent_control_files_present", path_unavailable: "path_unavailable",
      immutable_reference_mutated: "immutable_reference_mutated", immutable_reference_path_unavailable: "immutable_reference_path_unavailable",
      immutable_reference_escaped: "immutable_reference_escaped", private_input_unavailable: "private_input_unavailable",
      publication_failed: "publication_failed", operation_conflict: "operation_conflict", operation_cancelled: "operation_cancelled", turn_failed: "turn_failed",
      deck_source_page_limit: "deck_source_page_limit",
    } satisfies Record<TurnErrorCode, TurnErrorCode>;
    const expected = Object.values(codes).map((code) => {
      const event = { id: code, ts: 10, type: "status.error" as const, code, message: "sanitized", recoverable: true };
      const stored = insertSequencedEvent(sqlite, { id: event.id, sessionId: "s", direction: "down", type: event.type, payload: event, turnId: null, processedAt: event.ts, createdAt: event.ts });
      return { sequence: stored.sequence, event };
    });

    // When / Then
    expect(listSequencedSessionEvents(sqlite, "s", 0)).toEqual(expected);
  });

  test("Given every shared rejection reason and a not-applied notice When replayed Then strict readers preserve them", () => {
    // Given: Record makes additions to the shared DTO require replay coverage.
    const reasons = {
      logo_manifest_missing: "logo_manifest_missing", logo_manifest_invalid: "logo_manifest_invalid",
      logo_history_changed: "logo_history_changed", logo_selection_invalid: "logo_selection_invalid",
      logo_candidate_invalid: "logo_candidate_invalid", logo_candidate_provenance: "logo_candidate_provenance",
      logo_svg_missing: "logo_svg_missing", logo_svg_invalid: "logo_svg_invalid",
      logo_svg_source_mismatch: "logo_svg_source_mismatch", logo_guidelines_invalid: "logo_guidelines_invalid",
    } satisfies Record<TurnRejectionReason, TurnRejectionReason>;
    const expected = Object.values(reasons).map((reason, index) => {
      const event = {
        id: reason, ts: 10, type: "status.error" as const, code: "logo_deliverables_missing" as const,
        message: "sanitized", recoverable: true, reason,
        notApplied: { turnId: `turn-${index}`, operationId: `op-${index}`, repairs: index % 2 },
      };
      const stored = insertSequencedEvent(sqlite, { id: event.id, sessionId: "s", direction: "down", type: event.type, payload: event, turnId: null, processedAt: event.ts, createdAt: event.ts });
      return { sequence: stored.sequence, event };
    });

    // When / Then: a reloaded conversation still knows the turn produced nothing.
    expect(listSequencedSessionEvents(sqlite, "s", 0)).toEqual(expected);
  });

  test.each([
    ["an unknown reason", { reason: "logo_vibes_wrong" }],
    ["an empty reason", { reason: "" }],
    ["a non-string reason", { reason: 7 }],
    ["a not-applied notice that is not an object", { notApplied: "yes" }],
    ["a not-applied array", { notApplied: [] }],
    ["a not-applied notice without an operation", { notApplied: { turnId: "t", repairs: 0 } }],
    ["a negative repair count", { notApplied: { turnId: "t", operationId: "o", repairs: -1 } }],
    ["a fractional repair count", { notApplied: { turnId: "t", operationId: "o", repairs: 0.5 } }],
  ])("Given %s persisted on a turn error When replayed Then corruption is rejected", (_label, claim) => {
    // Given
    const event = { id: "invalid-metadata", ts: 10, type: "status.error", message: "sanitized", recoverable: true, ...claim };
    insertSequencedEvent(sqlite, { id: event.id, sessionId: "s", direction: "down", type: event.type, payload: event, turnId: null, processedAt: event.ts, createdAt: event.ts });

    // When / Then
    expect(() => listSequencedSessionEvents(sqlite, "s", 0)).toThrow(new PipelineRepositoryError("corrupt_json", event.id));
  });

  test.each(["unknown_error", "", "toString", "__proto__", null, 7, {}])("Given invalid persisted error code %j When replayed Then corruption is rejected", (code) => {
    // Given
    const event = { id: "invalid-error", ts: 10, type: "status.error", code, message: "sanitized", recoverable: true };
    insertSequencedEvent(sqlite, { id: event.id, sessionId: "s", direction: "down", type: event.type, payload: event, turnId: null, processedAt: event.ts, createdAt: event.ts });

    // When / Then
    expect(() => listSequencedSessionEvents(sqlite, "s", 0)).toThrow(new PipelineRepositoryError("corrupt_json", event.id));
  });

  test("Given events share a millisecond When inserted Then sequence is monotonic and corrupted JSON is rejected with a machine code", () => {
    // Given / When
    const first = insertSequencedEvent(sqlite, { id: "e1", sessionId: "s", direction: "down", type: "x", payload: {}, turnId: null, processedAt: 10, createdAt: 10 });
    const second = insertSequencedEvent(sqlite, { id: "e2", sessionId: "s", direction: "down", type: "x", payload: {}, turnId: null, processedAt: 10, createdAt: 10 });
    sqlite.exec("INSERT INTO learning_checkpoints (id,item_id,project_id,artifact_revision,artifact_digest,feedback,next_context_json,created_at) VALUES ('cp','lesson','p',3,'project-digest','done','{',3)");

    // Then
    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    try { getLearningCheckpoint(db, "cp"); } catch (error) { expect(repositoryError(error).code).toBe("corrupt_json"); }
  });
});
