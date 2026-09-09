import path from "node:path";
import { ulid } from "ulid";
import type { NormalizedEvent } from "@bg/shared";
import { resolveWithin } from "../../security/path-boundary";
import type { CodexParserContext } from "./parser";

export function isCodexStartupNotice(message: string): boolean {
  return /^Under-development features enabled: [a-z0-9_, ]+\. Under-development features are incomplete and may behave unpredictably\. To suppress this warning, set `?suppress_unstable_features_warning = true`? in [^\r\n]+config\.toml`?\.?$/.test(message.trim());
}

export function mapCodexEnvelope(
  obj: Record<string, unknown>,
  ctx: CodexParserContext,
): NormalizedEvent[] | null {
  const type = asString(obj.type);
  if (!type) return null;

  switch (type) {
    case "thread.started":
      return [];
    case "turn.started":
      return [{ id: ulid(), ts: Date.now(), type: "status.running" }];
    case "item.started":
      return mapItem(obj.item, ctx, false);
    case "item.completed":
      return mapItem(obj.item, ctx, true);
    case "turn.completed":
      return mapTurnCompleted(obj.usage, ctx);
    default:
      return null;
  }
}

function mapItem(
  value: unknown,
  ctx: CodexParserContext,
  completed: boolean,
): NormalizedEvent[] {
  if (!isRecord(value)) return [];
  const itemType = asString(value.type);
  const itemId = asString(value.id) ?? ulid();
  if (itemType === "agent_message" && completed) {
    const text = asString(value.text);
    return text
      ? [{ id: ulid(), ts: Date.now(), type: "chat.delta", turnId: ctx.turnId, text }]
      : [];
  }
  if (itemType === "error" && completed) {
    const message = asString(value.message) ?? "Codex reported an error";
    // Codex sends this startup notice as an error item in some CLI versions.
    if (isCodexStartupNotice(message)) return [];
    return [{
      id: ulid(),
      ts: Date.now(),
      type: "chat.delta",
      turnId: ctx.turnId,
      text: message,
    }];
  }
  if (itemType === "command_execution") {
    if (!completed) {
      return [{
        id: ulid(),
        ts: Date.now(),
        type: "tool.started",
        turnId: ctx.turnId,
        toolCallId: itemId,
        tool: itemType,
        input: { command: asString(value.command) ?? "" },
      }];
    }
    return [{
      id: ulid(),
      ts: Date.now(),
      type: "tool.finished",
      turnId: ctx.turnId,
      toolCallId: itemId,
      tool: itemType,
      ok: asString(value.status) === "completed",
      output: {
        aggregated_output: value.aggregated_output ?? "",
        exit_code: value.exit_code ?? null,
      },
    }];
  }
  if (itemType === "file_change" && completed) {
    return mapFileChanges(value.changes, ctx);
  }
  return [];
}

function mapTurnCompleted(
  value: unknown,
  ctx: CodexParserContext,
): NormalizedEvent[] {
  const usage = isRecord(value) ? value : {};
  const input = asNumber(usage.input_tokens) ?? 0;
  const output = asNumber(usage.output_tokens) ?? 0;
  const cached = asNumber(usage.cached_input_tokens);
  return [
    {
      id: ulid(),
      ts: Date.now(),
      type: "usage.delta",
      input,
      output,
      ...(cached != null ? { cached } : {}),
    },
    { id: ulid(), ts: Date.now(), type: "chat.message_end", turnId: ctx.turnId },
    { id: ulid(), ts: Date.now(), type: "status.idle", stopReason: "end_turn" },
  ];
}

function mapFileChanges(
  value: unknown,
  ctx: CodexParserContext,
): NormalizedEvent[] {
  if (!Array.isArray(value)) return [];
  const events: NormalizedEvent[] = [];
  for (const change of value) {
    if (!isRecord(change)) continue;
    const rawPath = asString(change.path);
    if (!rawPath || !ctx.projectDir) continue;
    const filePath = normalizeProjectPath(rawPath, ctx.projectDir);
    if (!filePath) continue;
    const kind = asString(change.kind);
    events.push({
      id: ulid(),
      ts: Date.now(),
      type: "file.changed",
      turnId: ctx.turnId,
      action: kind === "add" ? "created" : kind === "delete" ? "deleted" : "edited",
      path: filePath,
    });
  }
  return events;
}

function normalizeProjectPath(rawPath: string, projectDir: string): string | null {
  const candidate = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(projectDir, rawPath);
  const relative = path.relative(projectDir, candidate);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  try {
    resolveWithin(projectDir, ...relative.split(path.sep));
    return relative.split(path.sep).join("/");
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
