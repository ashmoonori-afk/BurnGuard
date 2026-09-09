import { ulid } from "ulid";
import type { NormalizedEvent } from "@bg/shared";
import { isCodexStartupNotice, mapCodexEnvelope } from "./event-mapping";

export interface CodexParserContext {
  turnId: string;
  projectDir?: string;
  /** Correlates a tool_result line to the tool name set at tool_start. */
  toolNames: Map<string, string>;
}

/**
 * Parses a single stdout line from the Codex CLI into zero or more
 * `NormalizedEvent`s. The parser is intentionally forward-compatible:
 *
 *   1. JSON lines with a `type` tag matching a known event kind are
 *      mapped to the corresponding normalized event. Both snake_case
 *      and dot.case variants are accepted because Codex's eventual
 *      structured output format isn't nailed down yet.
 *   2. Anything else — non-JSON text, JSON without a `type`, JSON with
 *      an unknown `type` — falls through to `chat.delta` so nothing
 *      gets silently dropped. This preserves the Phase 1 raw-mode
 *      guarantee while letting the adapter upgrade incrementally as
 *      Codex starts to emit structured events.
 *
 * Callers must supply a fresh context per turn (with a unique turnId
 * and an empty `toolNames` map); the parser mutates `toolNames` to
 * correlate tool_start/tool_end pairs by their call id.
 */
export function parseCodexLine(
  line: string,
  ctx: CodexParserContext,
): NormalizedEvent[] {
  const trimmed = line.trim();
  if (!trimmed || isCodexStartupNotice(trimmed)) return [];

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        const mapped =
          mapCodexEnvelope(record, ctx) ?? mapStructured(record, ctx);
        if (mapped) return mapped;
      }
    } catch {
      // Malformed JSON — fall through to raw delta.
    }
  }

  return [
    {
      id: ulid(),
      ts: Date.now(),
      type: "chat.delta",
      turnId: ctx.turnId,
      text: line,
    },
  ];
}

function mapStructured(
  obj: Record<string, unknown>,
  ctx: CodexParserContext,
): NormalizedEvent[] | null {
  const type = asString(obj.type);
  if (!type) return null;
  const now = Date.now();

  switch (type) {
    case "tool_start":
    case "tool.started":
    case "tool_use": {
      const toolCallId = resolveCallId(obj) ?? ulid();
      const tool = asString(obj.tool) ?? asString(obj.name) ?? "unknown";
      const input = obj.input ?? obj.arguments ?? null;
      ctx.toolNames.set(toolCallId, tool);
      return [
        {
          id: ulid(),
          ts: now,
          type: "tool.started",
          turnId: ctx.turnId,
          toolCallId,
          tool,
          input,
        },
      ];
    }

    case "tool_end":
    case "tool.finished":
    case "tool_result": {
      const toolCallId = resolveCallId(obj) ?? ulid();
      const tool =
        asString(obj.tool) ??
        asString(obj.name) ??
        ctx.toolNames.get(toolCallId) ??
        "unknown";
      // Codex may emit either `ok: false` or `is_error: true`. Treat
      // either signal as failure; default is success.
      const ok = obj.ok !== false && obj.is_error !== true;
      const output = obj.output ?? obj.content ?? null;
      return [
        {
          id: ulid(),
          ts: now,
          type: "tool.finished",
          turnId: ctx.turnId,
          toolCallId,
          tool,
          ok,
          output,
        },
      ];
    }

    case "file_change":
    case "file.changed": {
      const filePath = asString(obj.path);
      if (!filePath) return null;
      const rawAction = asString(obj.action);
      const action: "created" | "edited" | "deleted" =
        rawAction === "created" || rawAction === "deleted"
          ? rawAction
          : "edited";
      return [
        {
          id: ulid(),
          ts: now,
          type: "file.changed",
          turnId: ctx.turnId,
          action,
          path: filePath,
        },
      ];
    }

    case "usage":
    case "usage.delta": {
      const input = asNumber(obj.input_tokens ?? obj.input) ?? 0;
      const output = asNumber(obj.output_tokens ?? obj.output) ?? 0;
      const cached = asNumber(obj.cached_tokens ?? obj.cached);
      return [
        {
          id: ulid(),
          ts: now,
          type: "usage.delta",
          input,
          output,
          ...(cached != null ? { cached } : {}),
        },
      ];
    }

    case "done":
    case "complete":
    case "result":
    case "status.idle": {
      const stopReason = normalizeStopReason(
        asString(obj.reason) ?? asString(obj.stop_reason),
      );
      return [
        {
          id: ulid(),
          ts: now,
          type: "status.idle",
          stopReason,
        },
      ];
    }

    case "text":
    case "chat.delta":
    case "message": {
      const content = asString(obj.content) ?? asString(obj.text);
      if (!content) return null;
      return [
        {
          id: ulid(),
          ts: now,
          type: "chat.delta",
          turnId: ctx.turnId,
          text: content,
        },
      ];
    }

    case "thinking":
    case "chat.thinking": {
      const content = asString(obj.content) ?? asString(obj.text);
      if (!content) return null;
      return [
        {
          id: ulid(),
          ts: now,
          type: "chat.thinking",
          turnId: ctx.turnId,
          text: content,
        },
      ];
    }

    case "error":
    case "status.error": {
      const message = asString(obj.message) ?? "Codex reported an error";
      const recoverable =
        typeof obj.recoverable === "boolean" ? obj.recoverable : true;
      return [
        {
          id: ulid(),
          ts: now,
          type: "status.error",
          message,
          recoverable,
        },
      ];
    }

    default:
      return null;
  }
}

function resolveCallId(obj: Record<string, unknown>): string | null {
  return (
    asString(obj.toolCallId) ??
    asString(obj.tool_call_id) ??
    asString(obj.call_id) ??
    asString(obj.id)
  );
}

function normalizeStopReason(
  raw: string | null,
): "end_turn" | "requires_action" | "interrupted" | "error" {
  if (
    raw === "end_turn" ||
    raw === "requires_action" ||
    raw === "interrupted" ||
    raw === "error"
  ) {
    return raw;
  }
  return "end_turn";
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
