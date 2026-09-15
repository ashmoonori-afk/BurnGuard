import { ulid } from "ulid";
import type { NormalizedEvent } from "@bg/shared";

export interface StreamParserContext {
  readonly turnId: string;
  readonly projectDir?: string;
}

/** Maps a provider's structured line to events, or null when the shape is not recognised. */
export type KnownLineMapper = (
  record: Record<string, unknown>,
  ctx: StreamParserContext,
) => NormalizedEvent[] | null;

/**
 * Accept only recognized structured events. Unknown schemas and malformed or plain diagnostic
 * lines are not assistant content and must never be persisted as chat.
 */
export function normalizeStreamLine(
  line: string,
  ctx: StreamParserContext,
  mapKnown?: KnownLineMapper,
): NormalizedEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        const mapped = mapKnown?.(record, ctx);
        if (mapped) return mapped;
        // A tagged line we do not understand is provider chrome, not content: emitting it raw would
        // paste JSON into the user's chat.
        if (typeof record.type === "string") return [];
      }
    } catch {
      // A malformed line is discarded without interrupting stream drainage.
    }
  }

  // Structured providers must never turn diagnostics, malformed envelopes, or prompt echoes into chat.
  return [];
}

export function textDelta(text: string, ctx: StreamParserContext): NormalizedEvent {
  return { id: ulid(), ts: Date.now(), type: "chat.delta", turnId: ctx.turnId, text };
}
