import type { Database } from "bun:sqlite";
import { ulid } from "ulid";
import type { ExportAttemptStatus, ExportProgress, ExportStopReason, NormalizedEvent, SequencedEventEnvelope } from "@bg/shared";
import { insertSequencedEvent } from "../db/sequenced-event-writer";
import { broker, sequencedBroker } from "./broker";
import { completeExportAttempt } from "../db/export-lifecycle-repository";

type ExportAttemptEventInput = {
  readonly projectId: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly status: ExportAttemptStatus;
  readonly progress: ExportProgress;
  readonly projectRevision: number;
  readonly projectDigest: string;
  readonly stopReason: ExportStopReason | null;
};
export type PersistedExportAttemptEvent = { readonly sessionId: string; readonly envelope: SequencedEventEnvelope };

export function completeExportAttemptWithEvent(db: Database, input: Parameters<typeof completeExportAttempt>[1] & {
  readonly projectId: string; readonly projectRevision: number; readonly projectDigest: string;
}): PersistedExportAttemptEvent | null {
  return db.transaction(() => {
    completeExportAttempt(db, input);
    return persistExportAttemptEvent(db, { ...input, status: "validated", progress: { stage: "complete", completed: 6, total: 6 }, stopReason: null });
  })();
}

export function persistExportAttemptEvent(db: Database, input: ExportAttemptEventInput): PersistedExportAttemptEvent | null {
  const session = db.query<{ readonly id: string }, [string]>("SELECT id FROM sessions WHERE project_id=? ORDER BY updated_at DESC LIMIT 1").get(input.projectId);
  if (session === null) return null;
  const event: NormalizedEvent = { id: ulid(), ts: Date.now(), type: "export.attempt", jobId: input.jobId, attemptId: input.attemptId, status: input.status, progress: input.progress, projectRevision: input.projectRevision, projectDigest: input.projectDigest, stopReason: input.stopReason };
  const stored = insertSequencedEvent(db, { id: event.id, sessionId: session.id, direction: "down", type: event.type, payload: event, turnId: null, processedAt: event.ts, createdAt: event.ts });
  return { sessionId: session.id, envelope: { sequence: stored.sequence, event } };
}

export function publishPersistedExportAttemptEvent(stored: PersistedExportAttemptEvent | null): void {
  if (stored === null) return;
  broker.publish(stored.sessionId, stored.envelope.event);
  sequencedBroker.publish(stored.sessionId, stored.envelope);
}

export function publishExportAttemptEvent(db: Database, input: ExportAttemptEventInput): void {
  publishPersistedExportAttemptEvent(persistExportAttemptEvent(db, input));
}
