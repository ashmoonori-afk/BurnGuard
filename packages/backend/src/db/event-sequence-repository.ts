import type { Database } from "bun:sqlite";
import { VisualSourceContractError, parseDesignDirectionState, parseUploadedVisualSourceSelections, parseVisualSourceManifest, type ExportAttemptStatus, type ExportProgress, type ExportStopReason, type NormalizedEvent, type SequencedEventEnvelope, type TurnErrorCode, type UserEvent } from "@bg/shared";
import { PipelineRepositoryError, parseJsonRecord } from "./pipeline-errors";

export { insertSequencedEvent } from "./sequenced-event-writer";

export function parsePersistedNormalizedEvent(value: string, id: string): NormalizedEvent {
  const item = parseJsonRecord(value, id);
  const type = text(item, "type", id);
  const base = { id: text(item, "id", id), ts: integer(item, "ts", id) };
  switch (type) {
    case "chat.user_message": {
      const common = { ...base, type, turnId: text(item, "turnId", id), text: text(item, "text", id), attachmentCount: integer(item, "attachmentCount", id) };
      if (item["visualSources"] === undefined) return common;
      try {
        const visualSources = parseVisualSourceManifest(item["visualSources"]);
        if (visualSources.sources.some((source) => source.provenance.turn_id !== common.turnId)) throw new PipelineRepositoryError("corrupt_json", id);
        return { ...common, visualSources };
      }
      catch (error) { if (error instanceof VisualSourceContractError) throw new PipelineRepositoryError("corrupt_json", id); throw error; }
    }
    case "chat.delta":
    case "chat.thinking":
      return { ...base, type, turnId: text(item, "turnId", id), text: text(item, "text", id) };
    case "chat.message_end":
      return { ...base, type, turnId: text(item, "turnId", id) };
    case "tool.started":
    case "tool.permission_required":
      return { ...base, type, turnId: text(item, "turnId", id), toolCallId: text(item, "toolCallId", id), tool: text(item, "tool", id), input: item["input"] };
    case "tool.finished": {
      const output = item["output"];
      const common = { ...base, type, turnId: text(item, "turnId", id), toolCallId: text(item, "toolCallId", id), tool: text(item, "tool", id), ok: truth(item, "ok", id) };
      return output === undefined ? common : { ...common, output };
    }
    case "tool.permission_decided":
      return { ...base, type, turnId: text(item, "turnId", id), toolCallId: text(item, "toolCallId", id), decision: decision(item, id) };
    case "artifact.preview":
      return { ...base, type, projectId: text(item, "projectId", id), previewId: text(item, "previewId", id), path: text(item, "path", id), version: integer(item, "version", id), active: truth(item, "active", id) };
    case "artifact.operation":
      return { ...base, type, operationId: text(item, "operationId", id), revision: integer(item, "revision", id), digest: text(item, "digest", id), changedPaths: texts(item, "changedPaths", id), outcome: operationOutcome(item, id) };
    case "export.attempt":
      return { ...base, type, jobId: text(item, "jobId", id), attemptId: text(item, "attemptId", id), status: exportStatus(item, id), progress: exportProgress(item, id), projectRevision: integer(item, "projectRevision", id), projectDigest: text(item, "projectDigest", id), stopReason: exportStopReason(item, id) };
    case "design.direction_state":
      return { ...base, type, state: parseDesignDirectionState(item["state"]) };
    case "file.changed":
      return { ...base, type, turnId: text(item, "turnId", id), action: fileAction(item, id), path: text(item, "path", id) };
    case "status.running":
      return { ...base, type };
    case "status.idle":
      return { ...base, type, stopReason: stopReason(item, id) };
    case "status.error": {
      const common = { ...base, type, message: text(item, "message", id), recoverable: truth(item, "recoverable", id) };
      return item["code"] === undefined ? common : { ...common, code: turnErrorCode(item, id) };
    }
    case "usage.delta": {
      const cached = item["cached"];
      const common = { ...base, type, input: integer(item, "input", id), output: integer(item, "output", id) };
      return cached === undefined ? common : { ...common, cached: integer(item, "cached", id) };
    }
    default:
      throw new PipelineRepositoryError("corrupt_json", id);
  }
}

export function parsePersistedUserEvent(value: string, id: string): UserEvent {
  const item = parseJsonRecord(value, id);
  const type = text(item, "type", id);
  switch (type) {
    case "user.message": {
      const attachments = item["attachments"];
      const activeRelPath = item["active_rel_path"];
      const common = { type, text: text(item, "text", id) };
      if (attachments !== undefined && (!Array.isArray(attachments) || !attachments.every((entry) => typeof entry === "string"))) throw new PipelineRepositoryError("corrupt_json", id);
      let visualSources;
      try { visualSources = parseUploadedVisualSourceSelections(item["visualSources"]); }
      catch (error) { if (error instanceof VisualSourceContractError) throw new PipelineRepositoryError("corrupt_json", id); throw error; }
      if (activeRelPath !== undefined && typeof activeRelPath !== "string") throw new PipelineRepositoryError("corrupt_json", id);
      return {
        ...common,
        ...(activeRelPath === undefined ? {} : { active_rel_path: activeRelPath }),
        ...(attachments === undefined ? {} : { attachments }),
        ...(visualSources === undefined ? {} : { visualSources }),
      };
    }
    case "user.interrupt":
      return { type };
    case "user.tool_decision": {
      const reason = item["reason"];
      const common = { type, toolCallId: text(item, "toolCallId", id), decision: decision(item, id) };
      if (reason === undefined) return common;
      if (typeof reason !== "string") throw new PipelineRepositoryError("corrupt_json", id);
      return { ...common, reason };
    }
    default:
      throw new PipelineRepositoryError("corrupt_json", id);
  }
}

export function listSequencedSessionEvents(db: Database, sessionId: string, afterSequence: number): readonly SequencedEventEnvelope[] {
  const rows = db.query<{ readonly sequence: number | null; readonly payload_json: string; readonly id: string }, [string, number]>("SELECT sequence,payload_json,id FROM events WHERE session_id=? AND direction='down' AND sequence>? ORDER BY sequence").all(sessionId, afterSequence);
  return rows.map((row) => {
    if (row.sequence === null) throw new PipelineRepositoryError("corrupt_json", row.id);
    const event = parsePersistedNormalizedEvent(row.payload_json, row.id);
    if (event.type === "chat.user_message" && event.visualSources?.sources.some((source) => source.provenance.session_id !== sessionId)) throw new PipelineRepositoryError("corrupt_json", row.id);
    return { sequence: row.sequence, event };
  });
}

function text(item: Readonly<Record<string, unknown>>, key: string, id: string): string {
  const value = item[key];
  if (typeof value !== "string" || value.length === 0) throw new PipelineRepositoryError("corrupt_json", id);
  return value;
}

function integer(item: Readonly<Record<string, unknown>>, key: string, id: string): number {
  const value = item[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new PipelineRepositoryError("corrupt_json", id);
  return value;
}

function truth(item: Readonly<Record<string, unknown>>, key: string, id: string): boolean {
  const value = item[key];
  if (typeof value !== "boolean") throw new PipelineRepositoryError("corrupt_json", id);
  return value;
}

function texts(item: Readonly<Record<string, unknown>>, key: string, id: string): readonly string[] {
  const value = item[key];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) throw new PipelineRepositoryError("corrupt_json", id);
  return value;
}

function exportStatus(item: Readonly<Record<string, unknown>>, id: string): ExportAttemptStatus {
  const value = text(item, "status", id);
  switch (value) { case "pending": case "running": case "validating": case "retrying": case "recovering": case "validated": case "failed": case "cancelled": case "corrupt": case "expired": return value; default: throw new PipelineRepositoryError("corrupt_json", id); }
}
function exportProgress(item: Readonly<Record<string, unknown>>, id: string): ExportProgress {
  const progress = item["progress"];
  if (!record(progress)) throw new PipelineRepositoryError("corrupt_json", id);
  const stage = text(progress, "stage", id); const completed = integer(progress, "completed", id); const total = integer(progress, "total", id);
  if (total !== 6) throw new PipelineRepositoryError("corrupt_json", id);
  switch (stage) { case "queued": case "snapshotting": case "rendering": case "validating": case "publishing": case "complete": return { stage, completed, total: 6 }; default: throw new PipelineRepositoryError("corrupt_json", id); }
}
function exportStopReason(item: Readonly<Record<string, unknown>>, id: string): ExportStopReason | null {
  const value = item["stopReason"];
  if (value === null) return null;
  if (typeof value !== "string") throw new PipelineRepositoryError("corrupt_json", id);
  switch (value) { case "user_cancelled": case "source_changed": case "snapshot_failed": case "render_failed": case "validation_failed": case "publication_failed": case "recovery_failed": case "receipt_corrupt": case "output_missing": case "retention_expired": return value; default: throw new PipelineRepositoryError("corrupt_json", id); }
}

function record(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null && !Array.isArray(value); }

function operationOutcome(item: Readonly<Record<string, unknown>>, id: string): "committed" | "cancelled" | "failed" | "conflicted" | "recovered" {
  const value = text(item, "outcome", id);
  switch (value) {
    case "committed": case "cancelled": case "failed": case "conflicted": case "recovered": return value;
    default: throw new PipelineRepositoryError("corrupt_json", id);
  }
}

function fileAction(item: Readonly<Record<string, unknown>>, id: string): "created" | "edited" | "deleted" {
  const value = text(item, "action", id);
  switch (value) {
    case "created": case "edited": case "deleted": return value;
    default: throw new PipelineRepositoryError("corrupt_json", id);
  }
}

function turnErrorCode(item: Readonly<Record<string, unknown>>, id: string): TurnErrorCode {
  const value = text(item, "code", id);
  switch (value) {
    case "backend_unavailable": case "path_unavailable": case "immutable_reference_mutated": case "immutable_reference_path_unavailable": case "immutable_reference_escaped": case "private_input_unavailable": case "publication_failed": case "operation_conflict": case "operation_cancelled": case "turn_failed": return value;
    default: throw new PipelineRepositoryError("corrupt_json", id);
  }
}

function stopReason(item: Readonly<Record<string, unknown>>, id: string): "end_turn" | "requires_action" | "interrupted" | "error" {
  const value = text(item, "stopReason", id);
  switch (value) {
    case "end_turn": case "requires_action": case "interrupted": case "error": return value;
    default: throw new PipelineRepositoryError("corrupt_json", id);
  }
}

function decision(item: Readonly<Record<string, unknown>>, id: string): "allow" | "deny" {
  const value = text(item, "decision", id);
  switch (value) {
    case "allow": case "deny": return value;
    default: throw new PipelineRepositoryError("corrupt_json", id);
  }
}
