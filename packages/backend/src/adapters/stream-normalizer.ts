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
 * Normalizes one stdout line from a CLI that streams JSON, text, or a mixture of both.
 *
 * The contract mirrors the Codex adapter: a recognised structured line becomes its mapped events, a
 * structured line with an unknown `type` is dropped as chrome, and everything else falls through to
 * `chat.delta` so nothing a provider prints is silently lost. A provider that changes its schema
 * therefore degrades to raw text instead of breaking the turn.
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
      // Malformed JSON — fall through to a raw delta rather than wedging the stream.
    }
  }

  return [textDelta(line, ctx)];
}

export function textDelta(text: string, ctx: StreamParserContext): NormalizedEvent {
  return { id: ulid(), ts: Date.now(), type: "chat.delta", turnId: ctx.turnId, text };
}
