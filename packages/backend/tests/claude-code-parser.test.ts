import { describe, expect, test } from "bun:test";
import {
  parseStreamLine,
  type ParserContext,
} from "../src/adapters/claude-code/parser";

function freshCtx(overrides: Partial<ParserContext> = {}): ParserContext {
  return {
    turnId: "turn-1",
    projectDir: "/tmp/proj-1",
    toolNames: new Map(),
    toolInputs: new Map(),
    ...overrides,
  };
}

describe("parseStreamLine — input shape tolerance", () => {
  test("blank, non-JSON, and non-object lines yield zero events", () => {
    const ctx = freshCtx();
    expect(parseStreamLine("", ctx)).toEqual([]);
    expect(parseStreamLine("   ", ctx)).toEqual([]);
    expect(parseStreamLine("garbage[not json", ctx)).toEqual([]);
    expect(parseStreamLine("42", ctx)).toEqual([]);
    expect(parseStreamLine("null", ctx)).toEqual([]);
  });

  test("unknown top-level type is silently skipped (forward-compat)", () => {
    const ctx = freshCtx();
    const events = parseStreamLine(
      JSON.stringify({ type: "future_event_type", body: "..." }),
      ctx,
    );
    expect(events).toEqual([]);
  });
});

describe("parseStreamLine — assistant content blocks", () => {
  test("text block becomes a single chat.delta with the text payload", () => {
    const ctx = freshCtx();
    const events = parseStreamLine(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "hello" }] },
      }),
      ctx,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "chat.delta",
      turnId: "turn-1",
      text: "hello",
    });
  });

  test("empty text content is dropped (no zero-length deltas)", () => {
    const ctx = freshCtx();
    const events = parseStreamLine(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "" }] },
      }),
      ctx,
    );
    expect(events).toEqual([]);
  });

  test("thinking block becomes chat.thinking", () => {
    const ctx = freshCtx();
    const events = parseStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "thinking", thinking: "let me reason about it" }],
        },
      }),
      ctx,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "chat.thinking",
      text: "let me reason about it",
    });
  });

  test("tool_use registers the tool name and emits tool.started", () => {
    const ctx = freshCtx();
    const events = parseStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "call-1",
              name: "Read",
              input: { file_path: "deck.html" },
            },
          ],
        },
      }),
      ctx,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tool.started",
      toolCallId: "call-1",
      tool: "Read",
      input: { file_path: "deck.html" },
    });
    expect(ctx.toolNames.get("call-1")).toBe("Read");
  });

  test("multiple content blocks emit in order", () => {
    const ctx = freshCtx();
    const events = parseStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "Plan." },
            { type: "text", text: "Here is the answer." },
          ],
        },
      }),
      ctx,
    );
    expect(events.map((e) => e.type)).toEqual([
      "chat.thinking",
      "chat.delta",
    ]);
  });
});

describe("parseStreamLine — tool_result correlation", () => {
  test("looks up the tool name from a prior tool_use", () => {
    const ctx = freshCtx();
    parseStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "call-2", name: "Edit", input: {} },
          ],
        },
      }),
      ctx,
    );
    const events = parseStreamLine(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "call-2", content: "ok" },
          ],
        },
      }),
      ctx,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tool.finished",
      toolCallId: "call-2",
      tool: "Edit",
      ok: true,
      output: "ok",
    });
  });

  test("falls back to 'tool' when no prior tool_use was seen", () => {
    const ctx = freshCtx();
    const events = parseStreamLine(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "orphan", content: null },
          ],
        },
      }),
      ctx,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "tool.finished", tool: "tool" });
  });

  test("is_error: true flips ok=false but still emits tool.finished", () => {
    const ctx = freshCtx();
    parseStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "call-3", name: "Bash", input: {} },
          ],
        },
      }),
      ctx,
    );
    const events = parseStreamLine(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "call-3",
              content: "permission denied",
              is_error: true,
            },
          ],
        },
      }),
      ctx,
    );
    expect(events[0]).toMatchObject({
      type: "tool.finished",
      ok: false,
    });
  });
});

describe("parseStreamLine — file.changed emission", () => {
  test("Write tool result emits file.changed with action=created and a project-relative path", () => {
    const ctx = freshCtx({ projectDir: "/tmp/proj-1" });
    parseStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "w1",
              name: "Write",
              input: { file_path: "/tmp/proj-1/index.html" },
            },
          ],
        },
      }),
      ctx,
    );
    const events = parseStreamLine(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "w1", content: "wrote" },
          ],
        },
      }),
      ctx,
    );
    const fileEvent = events.find((e) => e.type === "file.changed");
    expect(fileEvent).toMatchObject({
      type: "file.changed",
      action: "created",
      path: "index.html",
    });
  });

  test("Edit tool result uses action=edited", () => {
    const ctx = freshCtx({ projectDir: "/tmp/proj-1" });
    parseStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "e1",
              name: "Edit",
              input: { file_path: "deck.html" },
            },
          ],
        },
      }),
      ctx,
    );
    const events = parseStreamLine(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "e1", content: "ok" },
          ],
        },
      }),
      ctx,
    );
    const fileEvent = events.find((e) => e.type === "file.changed");
    expect(fileEvent).toMatchObject({ action: "edited", path: "deck.html" });
  });

  test("file.changed is suppressed when the path resolves outside the project tree", () => {
    const ctx = freshCtx({ projectDir: "/tmp/proj-1" });
    parseStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "x1",
              name: "Write",
              input: { file_path: "/etc/passwd" },
            },
          ],
        },
      }),
      ctx,
    );
    const events = parseStreamLine(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "x1", content: "ok" },
          ],
        },
      }),
      ctx,
    );
    expect(events.find((e) => e.type === "file.changed")).toBeUndefined();
  });

  test("file.changed is suppressed when tool_result is_error", () => {
    const ctx = freshCtx({ projectDir: "/tmp/proj-1" });
    parseStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "f1",
              name: "Write",
              input: { file_path: "deck.html" },
            },
          ],
        },
      }),
      ctx,
    );
    const events = parseStreamLine(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "f1",
              content: "fail",
              is_error: true,
            },
          ],
        },
      }),
      ctx,
    );
    expect(events.find((e) => e.type === "file.changed")).toBeUndefined();
  });
});

describe("parseStreamLine — result line", () => {
  test("emits usage.delta + chat.message_end + status.idle on success", () => {
    const ctx = freshCtx();
    const events = parseStreamLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        usage: {
          input_tokens: 200,
          output_tokens: 80,
          cache_read_input_tokens: 1500,
        },
      }),
      ctx,
    );
    expect(events.map((e) => e.type)).toEqual([
      "usage.delta",
      "chat.message_end",
      "status.idle",
    ]);
    expect(events[0]).toMatchObject({ input: 200, output: 80, cached: 1500 });
    expect(events[2]).toMatchObject({ stopReason: "end_turn" });
  });

  test("flips status.idle to stopReason=error when subtype is an error", () => {
    const ctx = freshCtx();
    const events = parseStreamLine(
      JSON.stringify({ type: "result", subtype: "error_max_turns" }),
      ctx,
    );
    const idle = events.find((e) => e.type === "status.idle");
    expect(idle).toMatchObject({ stopReason: "error" });
  });

  test("an is_error result keeps provider diagnostics out of chat and history", () => {
    const ctx = freshCtx();
    const events = parseStreamLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: true,
        result:
          "Invalid API key sk-private at /Users/local/.claude/config.json",
      }),
      ctx,
    );
    expect(events.map((e) => e.type)).toEqual([
      "chat.message_end",
      "status.error",
      "status.idle",
    ]);
    expect(JSON.stringify(events)).not.toContain("sk-private");
    expect(JSON.stringify(events)).not.toContain("/Users/local");
    expect(events[1]).toMatchObject({
      code: "turn_failed",
      message: "turn_failed",
      recoverable: true,
    });
    expect(events[2]).toMatchObject({ stopReason: "error" });
  });

  test("an error result without a result field remains a bounded status error", () => {
    const ctx = freshCtx();
    const withError = parseStreamLine(
      JSON.stringify({ type: "result", subtype: "error", error: "rate_limit_exceeded" }),
      ctx,
    );
    expect(withError.map((event) => event.type)).toEqual([
      "chat.message_end",
      "status.error",
      "status.idle",
    ]);
    expect(JSON.stringify(withError)).not.toContain("rate_limit_exceeded");

    const subtypeOnly = parseStreamLine(
      JSON.stringify({ type: "result", subtype: "error_max_turns" }),
      ctx,
    );
    expect(subtypeOnly.map((event) => event.type)).toEqual([
      "chat.message_end",
      "status.error",
      "status.idle",
    ]);
  });

  test("a successful result emits neither chat.delta nor status.error", () => {
    const ctx = freshCtx();
    const events = parseStreamLine(
      JSON.stringify({ type: "result", subtype: "success", result: "done" }),
      ctx,
    );
    expect(events.map((e) => e.type)).toEqual(["chat.message_end", "status.idle"]);
  });

  test("non-numeric usage values fall back to 0", () => {
    const ctx = freshCtx();
    const events = parseStreamLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        usage: { input_tokens: "n/a", output_tokens: null },
      }),
      ctx,
    );
    expect(events[0]).toMatchObject({ input: 0, output: 0, cached: 0 });
  });
});
