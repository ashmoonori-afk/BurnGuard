import { ulid } from "ulid";
import { parseDesignDirectionState, type DesignDirectionState, type NormalizedEvent } from "@bg/shared";
import { listSessionEvents } from "../db/events";
import { getSqlite } from "../db/sqlite-client";
import { insertSequencedEvent } from "../db/sequenced-event-writer";
import { parsePersistedNormalizedEvent } from "../db/event-sequence-repository";
import { broker, sequencedBroker } from "./broker";

export async function getLatestDirectionState(sessionId: string): Promise<DesignDirectionState | null> {
  const events = await listSessionEvents(sessionId);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]?.event;
    if (event?.type === "design.direction_state") return parseDesignDirectionState(event.state);
  }
  return null;
}

export class DirectionStateConflictError extends Error {}

export async function publishDirectionState(sessionId: string, state: DesignDirectionState, expected?: DesignDirectionState): Promise<void> {
  const parsed = parseDesignDirectionState(state);
  const event: NormalizedEvent = { id: ulid(), ts: parsed.updated_at, type: "design.direction_state", state: parsed };
  const db = getSqlite();
  const persisted = db.transaction(() => {
    if (expected !== undefined) {
      const row = db.query<{ readonly id: string; readonly payload_json: string }, [string]>("SELECT id,payload_json FROM events WHERE session_id=? AND direction='down' AND type='design.direction_state' ORDER BY sequence DESC LIMIT 1").get(sessionId);
      const latest = row === null ? null : parsePersistedNormalizedEvent(row.payload_json, row.id);
      if (latest?.type !== "design.direction_state" || latest.state.generation_id !== expected.generation_id || latest.state.selection_revision !== expected.selection_revision || latest.state.updated_at !== expected.updated_at) throw new DirectionStateConflictError("Direction state changed");
    }
    const inserted = insertSequencedEvent(db, { id: event.id, sessionId, direction: "down", type: event.type, payload: event, turnId: null, processedAt: event.ts, createdAt: Date.now() });
    return { sequence: inserted.sequence, event };
  })();
  broker.publish(sessionId, event);
  sequencedBroker.publish(sessionId, persisted);
}
