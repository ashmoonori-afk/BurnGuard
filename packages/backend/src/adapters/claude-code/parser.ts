import path from "node:path";
import { ulid } from "ulid";
import type { NormalizedEvent } from "@bg/shared";

export interface ParserContext {
  turnId: string;
  projectDir: string;
  toolNames: Map<string, string>;
  toolInputs: Map<string, unknown>;
}

/**
 * Parses a single Claude Code stream-json line and returns zero or more
 * NormalizedEvents. Pure function — state lives in `ctx` for correlation of
 * tool_use ↔ tool_result across lines.
 */
export function parseStreamLine(
  rawLine: string,
  ctx: ParserContext,
): NormalizedEvent[] {
  const trimmed = rawLine.trim();
  if (!trimmed) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!raw || typeof raw !== "object") return [];

  const out: NormalizedEvent[] = [];
  const ts = Date.now();
  const obj = raw as Record<string, unknown>;

  switch (obj.type) {
    case "system": {
      // system init — status.running is emitted by the orchestrator already.
      break;
    }

    case "assistant": {
      const content = extractContent(obj.message);
      for (const block of content) {
        switch (block.type) {
          case "text": {
            const text = typeof block.text === "string" ? block.text : "";
            if (text.length > 0) {
              out.push({
                id: ulid(),
                ts,
                type: "chat.delta",
                turnId: ctx.turnId,
                text,
              });
            }
            break;
          }
          case "thinking": {
            const text =
              typeof block.thinking === "string" ? block.thinking : "";
            if (text.length > 0) {
              out.push({
                id: ulid(),
                ts,
                type: "chat.thinking",
                turnId: ctx.turnId,
                text,
              });
            }
            break;
          }
          case "tool_use": {
            const toolId = typeof block.id === "string" ? block.id : undefined;
            const toolName =
              typeof block.name === "string" ? block.name : undefined;
            if (toolId && toolName) {
              ctx.toolNames.set(toolId, toolName);
              ctx.toolInputs.set(toolId, block.input);
              out.push({
                id: ulid(),
                ts,
                type: "tool.started",
                turnId: ctx.turnId,
                toolCallId: toolId,
                tool: toolName,
                input: block.input,
              });
            }
            break;
          }
        }
      }
      break;
    }

    case "user": {
      // tool_result blocks only — Claude Code echoes tool outputs this way.
      const content = extractContent(obj.message);
      for (const block of content) {
        if (
          block.type === "tool_result" &&
          typeof block.tool_use_id === "string"
        ) {
          const toolName = ctx.toolNames.get(block.tool_use_id) ?? "tool";
          const ok = !block.is_error;
          out.push({
            id: ulid(),
            ts,
            type: "tool.finished",
            turnId: ctx.turnId,
            toolCallId: block.tool_use_id,
            tool: toolName,
            ok,
            output: block.content,
          });

          if (ok && isFileWriteTool(toolName)) {
            const input = ctx.toolInputs.get(block.tool_use_id);
            const filePath = extractFilePath(input);
            if (filePath) {
              const normalized = normalizePath(filePath, ctx.projectDir);
              // Skip file.changed with empty/out-of-tree paths. If Claude
              // writes outside projectDir or reports a bogus empty path,
              // emitting it would trigger the `/fs/` + relPath:"" 404 loop
              // on the frontend canvas.
              if (normalized) {
                out.push({
                  id: ulid(),
                  ts,
                  type: "file.changed",
                  turnId: ctx.turnId,
                  action: toolName === "Write" ? "created" : "edited",
                  path: normalized,
                });
              }
            }
          }
        }
      }
      break;
    }

    case "result": {
      const usage = obj.usage as Record<string, unknown> | undefined;
      if (usage && typeof usage === "object") {
        out.push({
          id: ulid(),
          ts,
          type: "usage.delta",
          input: numberOr(usage.input_tokens, 0),
          output: numberOr(usage.output_tokens, 0),
          cached: numberOr(usage.cache_read_input_tokens, 0),
        });
      }
      const isError =
        obj.is_error === true ||
        obj.subtype === "error_max_turns" ||
        obj.subtype === "error";
      out.push({
        id: ulid(),
        ts,
        type: "chat.message_end",
        turnId: ctx.turnId,
      });
      if (isError) {
        out.push({
          id: ulid(),
          ts,
          type: "status.error",
          code: "turn_failed",
          message: "turn_failed",
          recoverable: true,
        });
      }
      out.push({
        id: ulid(),
        ts,
        type: "status.idle",
        stopReason: isError ? "error" : "end_turn",
      });
      break;
    }
  }

  return out;
}

function extractContent(message: unknown): Array<Record<string, unknown>> {
  if (!message || typeof message !== "object") return [];
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];
  return content.filter(
    (b): b is Record<string, unknown> =>
      b !== null && typeof b === "object",
  );
}

function isFileWriteTool(tool: string | undefined): boolean {
  return (
    tool === "Write" ||
    tool === "Edit" ||
    tool === "Update" ||
    tool === "MultiEdit" ||
    tool === "NotebookEdit"
  );
}

function extractFilePath(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const candidates = ["file_path", "path", "filepath", "file"];
  for (const key of candidates) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function normalizePath(filePath: string, projectDir: string): string | null {
  const absolute = path.isAbsolute(filePath)
    ? filePath
    : path.join(projectDir, filePath);
  const relative = path.relative(projectDir, absolute).replaceAll("\\", "/");
  // Reject empty (file == projectDir), out-of-tree (starts with `../`),
  // and absolute (relative couldn't be computed — different drive on Windows).
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) {
    return null;
  }
  return relative;
}

function numberOr(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}
