import { ulid } from "ulid";
import type { NormalizedEvent } from "@bg/shared";
import { normalizeStreamLine, textDelta, type StreamParserContext } from "../stream-normalizer";

export type GeminiParserContext = StreamParserContext;

/**
 * Gemini CLI `--output-format stream-json` lines.
 *
 * Only the shapes this adapter actually consumes are mapped; every other tagged line is dropped and
 * untagged diagnostics are discarded. The role and completion fields follow the published
 * google-gemini/gemini-cli packages/core/src/output/types.ts contract.
 */
export function parseGeminiLine(line: string, ctx: GeminiParserContext): NormalizedEvent[] {
  return normalizeStreamLine(line, ctx, mapGeminiRecord);
}

function mapGeminiRecord(record: Record<string, unknown>, ctx: StreamParserContext): NormalizedEvent[] | null {
  const type = typeof record.type === "string" ? record.type : null;
  if (type === null) return null;

  if (type === "assistant" || type === "content" || type === "message") {
    if (type === "message" && record.role !== "assistant") return [];
    const text = extractText(record);
    return text ? [textDelta(text, ctx)] : [];
  }

  if (type === "result" || type === "done" || type === "turn_complete") {
    const failed = record.status === "error" || record.is_error === true || record.error !== undefined
      || (typeof record.subtype === "string" && record.subtype !== "success");
    return [{
      id: ulid(),
      ts: Date.now(),
      type: "status.idle",
      stopReason: failed ? "error" : "end_turn",
    }];
  }

  if (type === "error" && record.severity === "error") {
    return [{ id: ulid(), ts: Date.now(), type: "status.idle", stopReason: "error" }];
  }

  return null;
}

/** Pulls displayable text out of the several shapes the CLI uses for a message body. */
function extractText(record: Record<string, unknown>): string {
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  const body = record.message ?? record.content;
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    const inner = (body as Record<string, unknown>).content;
    if (typeof inner === "string") return inner;
    if (Array.isArray(inner)) return joinParts(inner);
  }
  if (Array.isArray(record.content)) return joinParts(record.content);
  return "";
}

function joinParts(parts: readonly unknown[]): string {
  return parts
    .map((part) => {
      if (typeof part === "string") return part;
      if (part !== null && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
        return (part as Record<string, unknown>).text as string;
      }
      return "";
    })
    .filter((text) => text.length > 0)
    .join("");
}
