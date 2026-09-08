import type { Database } from "bun:sqlite";

export type ConversationMessage = { readonly role: "user" | "assistant"; readonly turnId: string; readonly text: string };
export const MAX_HISTORY_CHARS = 16_000;

/** Bound both database reads and prompt bytes; keep the most recent dialogue. */
export function readConversationHistory(db: Database, sessionId: string): readonly ConversationMessage[] {
  const rows = db.query<{ type: string; turn_id: string | null; text: string | null }, [string]>(`SELECT type,turn_id,substr(json_extract(payload_json,'$.text'),1,4000) text
    FROM events WHERE session_id=? AND direction='down' AND type IN ('chat.user_message','chat.delta') ORDER BY sequence DESC LIMIT 200`).all(sessionId);
  const messages: { role: "user" | "assistant"; turnId: string; text: string }[] = [];
  let remaining = MAX_HISTORY_CHARS;
  for (const row of rows) {
    if (remaining === 0 || messages.length >= 20) break;
    if (typeof row.text !== "string" || row.turn_id === null) continue;
    const role = row.type === "chat.user_message" ? "user" : "assistant";
    const text = row.text.slice(-remaining);
    const current = messages[messages.length - 1];
    if (current?.role === role && current.turnId === row.turn_id) current.text = text + current.text;
    else messages.push({ role, turnId: row.turn_id, text });
    remaining -= text.length;
  }
  return messages.reverse();
}
