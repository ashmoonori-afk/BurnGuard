import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mapGeneratedImages } from "../src/adapters/codex/event-mapping";
import {
  parseCodexLine,
  type CodexParserContext,
} from "../src/adapters/codex/parser";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PNG_SHA = createHash("sha256").update(PNG).digest("hex");
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function tempCodexHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), "bg-codex-home-"));
  homes.push(home);
  return home;
}

function ctx(): CodexParserContext {
  return { turnId: "turn-1", toolNames: new Map() };
}

describe("parseCodexLine — structured path", () => {
  test("Given provider diagnostics When parsing errors Then only authored text can become chat content", () => {
    const warning = 'Under-development features enabled: skip_host_skill_discovery. Under-development features are incomplete and may behave unpredictably. To suppress this warning, set `suppress_unstable_features_warning = true` in C:\\Users\\fixture\\.codex\\config.toml.';
    const errorItem = (message: string) => JSON.stringify({ type: "item.completed", item: { type: "error", message } });
    expect(parseCodexLine(errorItem(warning), ctx())).toEqual([]);
    expect(parseCodexLine(warning, ctx())).toEqual([]);
    expect(parseCodexLine("Authentication failed", ctx())).toEqual([]);
    expect(parseCodexLine(`${warning}\nAuthentication failed`, ctx())).toEqual([]);
    const privateDiagnostic =
      "Authentication failed: sk-private at /Users/local/.codex/config.toml";
    const events = parseCodexLine(errorItem(privateDiagnostic), ctx());
    expect(events).toContainEqual(expect.objectContaining({ type: "tool.finished", ok: false }));
    expect(JSON.stringify(events)).not.toContain("sk-private");
    expect(JSON.stringify(events)).not.toContain("/Users/local");
    expect(parseCodexLine(errorItem(`${warning}\nAuthentication failed`), ctx())).toContainEqual(expect.objectContaining({ type: "tool.finished", ok: false }));
    expect(parseCodexLine(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: warning } }), ctx())[0]).toMatchObject({ type: "chat.delta", text: warning });
  });

  test("tool_start becomes tool.started and registers the tool name", () => {
    const c = ctx();
    const events = parseCodexLine(
      JSON.stringify({
        type: "tool_start",
        id: "call-1",
        tool: "Bash",
        input: { command: "ls" },
      }),
      c,
    );
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.type).toBe("tool.started");
    if (e.type === "tool.started") {
      expect(e.toolCallId).toBe("call-1");
      expect(e.tool).toBe("Bash");
      expect(e.input).toEqual({ command: "ls" });
    }
    expect(c.toolNames.get("call-1")).toBe("Bash");
  });

  test("tool_result looks up the registered tool name when the line omits it", () => {
    const c = ctx();
    parseCodexLine(
      JSON.stringify({ type: "tool_start", id: "call-2", tool: "Read" }),
      c,
    );
    const [finished] = parseCodexLine(
      JSON.stringify({ type: "tool_result", id: "call-2", output: "hi" }),
      c,
    );
    expect(finished.type).toBe("tool.finished");
    if (finished.type === "tool.finished") {
      expect(finished.tool).toBe("Read");
      expect(finished.toolCallId).toBe("call-2");
      expect(finished.ok).toBe(true);
      expect(finished.output).toBe("hi");
    }
  });

  test("tool_result respects is_error / ok:false as failure signals", () => {
    const c = ctx();
    const [a] = parseCodexLine(
      JSON.stringify({ type: "tool_result", id: "c", tool: "Bash", is_error: true }),
      c,
    );
    const [b] = parseCodexLine(
      JSON.stringify({ type: "tool_result", id: "c", tool: "Bash", ok: false }),
      c,
    );
    if (a.type === "tool.finished") expect(a.ok).toBe(false);
    if (b.type === "tool.finished") expect(b.ok).toBe(false);
  });

  test("file_change maps to file.changed with a normalized action", () => {
    const c = ctx();
    const [edited] = parseCodexLine(
      JSON.stringify({ type: "file_change", path: "deck.html" }),
      c,
    );
    const [created] = parseCodexLine(
      JSON.stringify({ type: "file_change", path: "notes.md", action: "created" }),
      c,
    );
    const [unknown] = parseCodexLine(
      JSON.stringify({ type: "file_change", path: "x.css", action: "weird" }),
      c,
    );
    if (edited.type === "file.changed") expect(edited.action).toBe("edited");
    if (created.type === "file.changed") expect(created.action).toBe("created");
    if (unknown.type === "file.changed") expect(unknown.action).toBe("edited");
  });

  test("usage maps through and preserves cached when present", () => {
    const c = ctx();
    const [a] = parseCodexLine(
      JSON.stringify({ type: "usage", input_tokens: 123, output_tokens: 45 }),
      c,
    );
    const [b] = parseCodexLine(
      JSON.stringify({ type: "usage", input: 10, output: 20, cached: 5 }),
      c,
    );
    if (a.type === "usage.delta") {
      expect(a.input).toBe(123);
      expect(a.output).toBe(45);
      expect(a.cached).toBeUndefined();
    }
    if (b.type === "usage.delta") {
      expect(b.cached).toBe(5);
    }
  });

  test("done normalizes stopReason and falls back to end_turn", () => {
    const c = ctx();
    const [a] = parseCodexLine(JSON.stringify({ type: "done", reason: "interrupted" }), c);
    const [b] = parseCodexLine(JSON.stringify({ type: "done", reason: "unknown" }), c);
    if (a.type === "status.idle") expect(a.stopReason).toBe("interrupted");
    if (b.type === "status.idle") expect(b.stopReason).toBe("end_turn");
  });

  test("text / message map to chat.delta", () => {
    const c = ctx();
    const [a] = parseCodexLine(JSON.stringify({ type: "text", content: "hi" }), c);
    const [b] = parseCodexLine(JSON.stringify({ type: "message", text: "hi" }), c);
    if (a.type === "chat.delta") expect(a.text).toBe("hi");
    if (b.type === "chat.delta") expect(b.text).toBe("hi");
  });

  test("thinking maps to chat.thinking", () => {
    const c = ctx();
    const [e] = parseCodexLine(
      JSON.stringify({ type: "thinking", content: "pondering" }),
      c,
    );
    expect(e.type).toBe("chat.thinking");
  });

  test("error maps to status.error with recoverable default true", () => {
    const c = ctx();
    const [e] = parseCodexLine(
      JSON.stringify({ type: "error", message: "boom" }),
      c,
    );
    if (e.type === "status.error") {
      expect(e.message).toBe("boom");
      expect(e.recoverable).toBe(true);
    }
  });

  test("Codex item.completed agent messages become readable chat deltas", () => {
    const c = ctx();
    const [event] = parseCodexLine(
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "Changed only the headline." },
      }),
      c,
    );
    expect(event.type).toBe("chat.delta");
    if (event.type === "chat.delta") {
      expect(event.text).toBe("Changed only the headline.");
    }
  });

  test("Codex recoverable item diagnostics do not poison a successful turn", () => {
    const c = ctx();
    const events = parseCodexLine(
      JSON.stringify({
        type: "item.completed",
        item: { type: "error", message: "Skills were trimmed for this turn." },
      }),
      c,
    );
    expect(events).toEqual([]);
  });

  test("Codex skills-budget notice does not become a failed tool", () => {
    const events = parseCodexLine(
      JSON.stringify({
        type: "item.completed",
        item: { type: "error", message: "Exceeded skills context budget. All skill descriptions were removed and 26 additional skills were not included in the model-visible skills list." },
      }),
      ctx(),
    );
    expect(events).toEqual([]);
  });

  test("Given images the built-in image tool saved for this thread When the turn completes Then each is surfaced as one image_generation call carrying only its sha256", () => {
    const codexHome = tempCodexHome();
    const threadId = "01a0bd75-12bd-75a3-8193-127dd61ddb33";
    mkdirSync(path.join(codexHome, "generated_images", threadId), { recursive: true });
    writeFileSync(path.join(codexHome, "generated_images", threadId, "exec-1.png"), PNG);
    writeFileSync(path.join(codexHome, "generated_images", threadId, "notes.txt"), PNG);
    writeFileSync(path.join(codexHome, "generated_images", threadId, "fake.png"), Buffer.from("not a png"));
    const c: CodexParserContext = { ...ctx(), codexHome };
    expect(parseCodexLine(JSON.stringify({ type: "thread.started", thread_id: threadId }), c)).toEqual([]);
    const events = parseCodexLine(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }), c);
    expect(events.map((event) => event.type)).toEqual(["tool.started", "tool.finished", "usage.delta", "chat.message_end", "status.idle"]);
    expect(events[0]).toMatchObject({ type: "tool.started", tool: "image_generation" });
    expect(events[1]).toMatchObject({ type: "tool.finished", tool: "image_generation", ok: true, output: { image_sha256: [PNG_SHA] } });
    expect(JSON.stringify(events)).not.toContain(codexHome);
  });

  test("Given an image already surfaced while the tool ran When the turn completes Then it is not reported a second time", () => {
    const codexHome = tempCodexHome();
    const threadId = "01a0bd75-12bd-75a3-8193-127dd61ddb33";
    mkdirSync(path.join(codexHome, "generated_images", threadId), { recursive: true });
    writeFileSync(path.join(codexHome, "generated_images", threadId, "exec-1.png"), PNG);
    const c: CodexParserContext = { ...ctx(), codexHome };
    parseCodexLine(JSON.stringify({ type: "thread.started", thread_id: threadId }), c);
    expect(mapGeneratedImages(c).map((event) => event.type)).toEqual(["tool.started", "tool.finished"]);
    expect(mapGeneratedImages(c)).toEqual([]);
    const events = parseCodexLine(JSON.stringify({ type: "turn.completed", usage: {} }), c);
    expect(events.map((event) => event.type)).toEqual(["usage.delta", "chat.message_end", "status.idle"]);
  });

  test("Given no thread, an unsafe thread id or no codexHome When the turn completes Then no image call is invented", () => {
    const codexHome = tempCodexHome();
    mkdirSync(path.join(codexHome, "generated_images", "other"), { recursive: true });
    writeFileSync(path.join(codexHome, "generated_images", "other", "exec-1.png"), PNG);
    const completed = JSON.stringify({ type: "turn.completed", usage: {} });
    const types = (c: CodexParserContext) => parseCodexLine(completed, c).map((event) => event.type);
    expect(types({ ...ctx(), codexHome })).toEqual(["usage.delta", "chat.message_end", "status.idle"]);
    const traversal: CodexParserContext = { ...ctx(), codexHome };
    parseCodexLine(JSON.stringify({ type: "thread.started", thread_id: "../generated_images/other" }), traversal);
    expect(types(traversal)).toEqual(["usage.delta", "chat.message_end", "status.idle"]);
    const noHome: CodexParserContext = ctx();
    parseCodexLine(JSON.stringify({ type: "thread.started", thread_id: "01a0bd75-12bd-75a3-8193-127dd61ddb33" }), noHome);
    expect(types(noHome)).toEqual(["usage.delta", "chat.message_end", "status.idle"]);
  });

  test("Codex turn.failed becomes one bounded terminal error sequence", () => {
    const events = parseCodexLine(
      JSON.stringify({
        type: "turn.failed",
        error: {
          message:
            "Authentication failed: sk-private at /Users/local/.codex/config.toml",
        },
      }),
      ctx(),
    );

    expect(events.map((event) => event.type)).toEqual([
      "chat.message_end",
      "status.error",
      "status.idle",
    ]);
    expect(JSON.stringify(events)).not.toContain("sk-private");
    expect(JSON.stringify(events)).not.toContain("/Users/local");
  });

  test("Codex turn.completed emits usage and one terminal status sequence", () => {
    const c = ctx();
    const events = parseCodexLine(
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 12, cached_input_tokens: 5, output_tokens: 7 },
      }),
      c,
    );
    expect(events.map((event) => event.type)).toEqual([
      "usage.delta",
      "chat.message_end",
      "status.idle",
    ]);
    const usage = events[0];
    if (usage.type === "usage.delta") {
      expect(usage.input).toBe(12);
      expect(usage.output).toBe(7);
      expect(usage.cached).toBe(5);
    }
  });

  test("Codex file changes stay project-relative and reject outside paths", () => {
    const c = { ...ctx(), projectDir: process.cwd() };
    const [inside] = parseCodexLine(
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "file_change",
          changes: [{ path: path.join(process.cwd(), "index.html"), kind: "update" }],
          status: "completed",
        },
      }),
      c,
    );
    expect(inside.type).toBe("file.changed");
    if (inside.type === "file.changed") expect(inside.path).toBe("index.html");

    expect(
      parseCodexLine(
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "file_change",
            changes: [{ path: "/tmp/outside.html", kind: "update" }],
            status: "completed",
          },
        }),
        c,
      ),
    ).toHaveLength(0);
  });
});

describe("parseCodexLine — structured stdout boundary", () => {
  test("Given non-JSON stdout When parsed Then it is dropped rather than promoted to authored chat", () => {
    expect(parseCodexLine("  hello world from codex  ", ctx())).toEqual([]);
  });

  test("JSON with an unknown structured type is ignored instead of becoming chat", () => {
    const c = ctx();
    const events = parseCodexLine(
      JSON.stringify({
        type: "new_and_exciting",
        diagnostic: "sk-private at /Users/local/.codex/config.toml",
      }),
      c,
    );
    expect(events).toEqual([]);
  });

  test("Given JSON without a type When parsed Then it is dropped rather than promoted to authored chat", () => {
    expect(parseCodexLine(JSON.stringify({ hello: "world" }), ctx())).toEqual([]);
  });

  test("Given malformed JSON When parsed Then it is dropped without throwing", () => {
    expect(parseCodexLine(`{ "type": "text",`, ctx())).toEqual([]);
  });

  test("Given diagnostic stdout interleaved with supported assistant messages When parsed Then only authored messages reach chat", () => {
    const secret = "FAKE_NOT_A_SECRET";
    const privatePath = "/private/fixture-only/config.toml";
    const diagnostic = `PROBE_ONLY diagnostic token=${secret} path=${privatePath}`;
    const diagnostics = [
      diagnostic,
      `${diagnostic}\n${diagnostic}`,
      `{ "type": "text", "text": ${JSON.stringify(diagnostic)}, }`,
      `{ "type": "text", "text": ${JSON.stringify(diagnostic)}`,
      JSON.stringify({ text: diagnostic }),
      ...[null, 7, "", "unknown_diagnostic"].map((type) => JSON.stringify({ type, text: diagnostic })),
      JSON.stringify(diagnostic),
      JSON.stringify([{ type: "text", text: diagnostic }]),
      "null",
      "true",
    ];
    const authored = "AUTHORED_MESSAGE_CONTROL";
    const messages = [
      { type: "item.completed", item: { type: "agent_message", text: authored } },
      { type: "text", content: authored },
      { type: "message", text: authored },
      { type: "chat.delta", text: authored },
    ];
    for (const message of messages) {
      const context = ctx();
      const events = [...diagnostics, JSON.stringify(message), ...diagnostics].flatMap((line) => parseCodexLine(line, context));
      expect(events).toMatchObject([{ type: "chat.delta", turnId: "turn-1", text: authored }]);
      expect(JSON.stringify(events)).not.toContain(secret);
      expect(JSON.stringify(events)).not.toContain(privatePath);
    }
  });

  test("empty / whitespace-only lines are dropped", () => {
    const c = ctx();
    expect(parseCodexLine("", c)).toHaveLength(0);
    expect(parseCodexLine("   ", c)).toHaveLength(0);
    expect(parseCodexLine("\t\n", c)).toHaveLength(0);
  });
});
