import type { NormalizedEvent } from "@bg/shared";
import { ulid } from "ulid";
import { normalizeStreamLine, textDelta, type StreamParserContext } from "../stream-normalizer";

export type CopilotParserContext = StreamParserContext;

/**
 * Copilot 1.0.83 JSONL uses the SDK session-event shape. Only finalized assistant messages are
 * displayable; user echoes, tool output, diagnostics and incremental duplicates stay private.
 */
export function parseCopilotLine(line: string, ctx: CopilotParserContext): NormalizedEvent[] {
  return normalizeStreamLine(line, ctx, (record) => {
    const data = record.data;
    if (record.type === "session.error") return [{ id: ulid(), ts: Date.now(), type: "status.idle", stopReason: "error" }];
    if (record.type !== "assistant.message" || !data || typeof data !== "object" || Array.isArray(data)) return [];
    const content = (data as Record<string, unknown>).content;
    return typeof content === "string" ? [textDelta(content, ctx)] : [];
  });
}
