import { and, asc, eq, gt } from "drizzle-orm";
import { ulid } from "ulid";
import type { NormalizedEvent, SequencedEventEnvelope, UserEvent } from "@bg/shared/events";
import { getDb, getSqlite } from "./client";
import { insertSequencedEvent, listSequencedSessionEvents, parsePersistedNormalizedEvent, parsePersistedUserEvent } from "./event-sequence-repository";
import { eventsTable, projectsTable, sessionsTable } from "./schema";

export interface PersistedUserEvent {
  id: string;
  session_id: string;
  payload: UserEvent;
  processed_at: number;
}

export async function insertUserEvent(sessionId: string, payload: UserEvent) {
  const id = ulid();
  const now = Date.now();
  insertSequencedEvent(getSqlite(), { id, sessionId, direction: "up", type: payload.type, payload, turnId: null, processedAt: now, createdAt: now });
  return { id, session_id: sessionId, payload, processed_at: now } satisfies PersistedUserEvent;
}

export async function insertNormalizedEvent(sessionId: string, event: NormalizedEvent) {
  return persistNormalizedEvent(getSqlite(), sessionId, event);
}

export function persistNormalizedEvent(db: ReturnType<typeof getSqlite>, sessionId: string, event: NormalizedEvent): SequencedEventEnvelope {
  return db.transaction(() => {
    const persisted = insertSequencedEvent(db, {
      id: event.id,
      sessionId,
      direction: "down",
      type: event.type,
      payload: event,
      turnId: "turnId" in event ? event.turnId : null,
      processedAt: event.ts,
      createdAt: Date.now(),
    });
    if (event.type === "usage.delta") {
      db.prepare("UPDATE sessions SET usage_input_tokens=usage_input_tokens+?,usage_output_tokens=usage_output_tokens+?,usage_cache_read=usage_cache_read+?,updated_at=?,last_active_at=? WHERE id=?")
        .run(event.input, event.output, event.cached ?? 0, event.ts, event.ts, sessionId);
    }
    const status = event.type === "status.running" ? "running"
      : event.type === "tool.permission_required" ? "awaiting_tool"
      : event.type === "status.error" ? "error"
      : event.type === "status.idle" ? (event.stopReason === "requires_action" ? "awaiting_tool" : "idle") : null;
    if (status !== null) db.prepare("UPDATE sessions SET status=?,updated_at=?,last_active_at=? WHERE id=?").run(status, event.ts, event.ts, sessionId);
    return { sequence: persisted.sequence, event } satisfies SequencedEventEnvelope;
  })();
}

export async function listSessionEvents(sessionId: string, afterSequence?: number): Promise<readonly SequencedEventEnvelope[]> {
  return listSequencedSessionEvents(getSqlite(), sessionId, afterSequence ?? 0);
}

export async function listLegacySessionEvents(sessionId: string, since?: number) {
  const db = getDb();
  const rows = await db
    .select({
      payload: eventsTable.payloadJson,
      direction: eventsTable.direction,
      type: eventsTable.type,
      turnId: eventsTable.turnId,
      processed_at: eventsTable.processedAt,
      id: eventsTable.id,
    })
    .from(eventsTable)
    .where(
      since
        ? and(eq(eventsTable.sessionId, sessionId), gt(eventsTable.processedAt, since))
        : eq(eventsTable.sessionId, sessionId),
    )
    .orderBy(asc(eventsTable.processedAt), asc(eventsTable.id));

  const out: NormalizedEvent[] = [];
  for (const row of rows) {
    if (row.direction === "down") {
      out.push(parsePersistedNormalizedEvent(row.payload, row.id));
      continue;
    }
    // direction === "up" — synthesize a chat.user_message for legacy sessions
    // that predate the server-side persistence of user messages as normalized
    // events. Newer turns already emit chat.user_message via the broker, so
    // we skip duplicates.
    if (row.type !== "user.message") continue;
    const payload = parsePersistedUserEvent(row.payload, row.id);
    if (payload.type !== "user.message") continue;
    const hasSynth = rows.some(
      (candidate) =>
        candidate.direction === "down" &&
        candidate.type === "chat.user_message" &&
        Math.abs(candidate.processed_at - row.processed_at) < 500,
    );
    if (hasSynth) continue;
    out.push({
      id: row.id,
      ts: row.processed_at,
      type: "chat.user_message",
      turnId: row.turnId ?? row.id,
      text: payload.text,
      attachmentCount: payload.attachments?.length ?? 0,
    });
  }
  return out.sort((a, b) => (a.ts === b.ts ? a.id.localeCompare(b.id) : a.ts - b.ts));
}

export async function setSessionStatus(
  sessionId: string,
  status: "idle" | "running" | "awaiting_tool" | "error" | "terminated",
) {
  const db = getDb();
  const now = Date.now();
  await db
    .update(sessionsTable)
    .set({
      status,
      updatedAt: now,
      lastActiveAt: now,
    })
    .where(eq(sessionsTable.id, sessionId));
}

export async function setSessionBackend(
  sessionId: string,
  backendId: "claude-code" | "codex",
) {
  const db = getDb();
  await db
    .update(sessionsTable)
    .set({ backendId, updatedAt: Date.now() })
    .where(eq(sessionsTable.id, sessionId));
}

export async function bumpSessionUsage(
  sessionId: string,
  usage: { input: number; output: number; cached?: number },
) {
  const db = getDb();
  const rows = await db
    .select({
      input: sessionsTable.usageInputTokens,
      output: sessionsTable.usageOutputTokens,
      cached: sessionsTable.usageCacheRead,
    })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .limit(1);

  const current = rows[0];
  if (!current) return;

  await db
    .update(sessionsTable)
    .set({
      usageInputTokens: current.input + usage.input,
      usageOutputTokens: current.output + usage.output,
      usageCacheRead: current.cached + (usage.cached ?? 0),
      updatedAt: Date.now(),
      lastActiveAt: Date.now(),
    })
    .where(eq(sessionsTable.id, sessionId));
}

export async function getSessionProject(sessionId: string) {
  const db = getDb();
  const rows = await db
    .select({
      session_id: sessionsTable.id,
      project_id: projectsTable.id,
      project_name: projectsTable.name,
      project_type: projectsTable.type,
      project_dir: projectsTable.dirPath,
      entrypoint: projectsTable.entrypoint,
      options_json: projectsTable.optionsJson,
      design_system_id: projectsTable.designSystemId,
      backend_id: sessionsTable.backendId,
    })
    .from(sessionsTable)
    .innerJoin(projectsTable, eq(sessionsTable.projectId, projectsTable.id))
    .where(eq(sessionsTable.id, sessionId))
    .limit(1);

  return rows[0] ?? null;
}
