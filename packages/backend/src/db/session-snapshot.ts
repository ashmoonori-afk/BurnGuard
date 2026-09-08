import type { Database } from "bun:sqlite";
import type { SessionInfo, SessionSnapshot } from "@bg/shared";
import { parsePersistedNormalizedEvent, parsePersistedUserEvent } from "./event-sequence-repository";

export function readSessionSnapshot(db: Database, sessionId: string): SessionSnapshot | null {
  return db.transaction(() => {
    const row = db.query<{
      id: string; project_id: string; backend_id: SessionInfo["backend_id"]; status: SessionInfo["status"];
      usage_input_tokens: number; usage_output_tokens: number; usage_cache_read: number; usage_cache_write: number;
      updated_at: number; last_active_at: number;
    }, [string]>("SELECT * FROM sessions WHERE id=?").get(sessionId);
    if (row === null) return null;
    const sequence = db.query<{ value: number }, [string]>("SELECT COALESCE(MAX(sequence),0) value FROM events WHERE session_id=?").get(sessionId)?.value ?? 0;
    const boundary = db.query<{ value: number }, [string]>(`SELECT COALESCE(MAX(sequence),0) value FROM events WHERE session_id=? AND direction='down'
      AND (type IN ('status.running','status.error') OR (type='status.idle' AND json_extract(payload_json,'$.stopReason')!='requires_action'))`).get(sessionId)?.value ?? 0;
    const pending = new Map<string, SessionSnapshot["pending_permissions"][number]>();
    const rows = db.query<{ id: string; direction: string; payload_json: string }, [string, number]>(`SELECT id,direction,payload_json FROM events WHERE session_id=? AND sequence>?
      AND type IN ('tool.permission_required','tool.permission_decided','tool.finished','user.tool_decision') ORDER BY sequence`).all(sessionId, boundary);
    for (const item of rows) {
      if (item.direction === "up") {
        const event = parsePersistedUserEvent(item.payload_json, item.id);
        if (event.type === "user.tool_decision") pending.delete(event.toolCallId);
        continue;
      }
      const event = parsePersistedNormalizedEvent(item.payload_json, item.id);
      if (event.type === "tool.permission_required") pending.set(event.toolCallId, event);
      else if (event.type === "tool.permission_decided" || event.type === "tool.finished") pending.delete(event.toolCallId);
    }
    return {
      session: { id: row.id, project_id: row.project_id, backend_id: row.backend_id, status: row.status,
        usage: { input: row.usage_input_tokens, output: row.usage_output_tokens, cached: row.usage_cache_read, cache_write: row.usage_cache_write },
        updated_at: row.updated_at, last_active_at: row.last_active_at },
      sequence, pending_permissions: [...pending.values()],
    };
  })();
}
