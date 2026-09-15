import { describe, expect, test } from "bun:test";
import { buildCopilotCommand } from "../src/adapters/copilot";
import { parseCopilotLine } from "../src/adapters/copilot/parser";
import { buildGeminiCommand } from "../src/adapters/gemini";
import { parseGeminiLine } from "../src/adapters/gemini/parser";

const ctx = { turnId: "turn-1", projectDir: "/missing/project" };

/** Every field a normalized event may carry, so a provider-shaped key cannot slip through. */
const EVENT_KEYS = new Set([
  "id", "ts", "type", "turnId", "text", "stopReason", "toolCallId", "toolName",
  "input", "output", "isError", "relPath", "changeKind", "usage", "attachmentCount", "visualSources",
]);

describe("Provider adapter argv", () => {
  test("Given a Gemini turn, then argv selects headless stream-json and keeps the prompt off the command line", () => {
    const argv = buildGeminiCommand("/bin/gemini", { model: "gemini-2.5-flash-image", effort: "low", vanilla: false, provider: "native" });
    expect(argv[0]).toBe("/bin/gemini");
    // stream-json is what the parser consumes; text or json output would silently produce no events.
    expect(argv).toContain("--output-format");
    expect(argv[argv.indexOf("--output-format") + 1]).toBe("stream-json");
    // Without an approval mode the CLI blocks on interactive confirmation and the turn hangs.
    expect(argv[argv.indexOf("--approval-mode") + 1]).toBe("auto_edit");
    expect(argv[argv.indexOf("--model") + 1]).toBe("gemini-2.5-flash-image");
    // The prompt is piped on stdin: a BurnGuard prompt is tens of kilobytes and Windows caps argv.
    expect(argv[argv.indexOf("--prompt") + 1]).toBe("");
    expect(argv.some((part) => part.length > 500)).toBe(false);
  });

  test("Given no model selection, then Gemini argv omits --model entirely", () => {
    const argv = buildGeminiCommand("/bin/gemini", { model: "", effort: "low", vanilla: false, provider: "native" });
    expect(argv).not.toContain("--model");
    expect(argv).toContain("--output-format");
  });

  test("Given a Copilot turn, then argv carries the prompt and runs without interactive approval", () => {
    const argv = buildCopilotCommand("/bin/copilot", "BUILD THE THING");
    expect(argv[0]).toBe("/bin/copilot");
    expect(argv[argv.indexOf("--prompt") + 1]).toBe("BUILD THE THING");
    expect(argv).not.toContain("--allow-all-tools");
    expect(argv).toContain("--allow-tool=write");
    expect(argv).toContain("--output-format");
  });

});

describe("Provider stream normalization", () => {
  test("Given Gemini stream-json, then message shapes become deltas and completion becomes idle", () => {
    expect(parseGeminiLine(JSON.stringify({ type: "assistant", text: "hello" }), ctx))
      .toMatchObject([{ type: "chat.delta", turnId: "turn-1", text: "hello" }]);
    expect(parseGeminiLine(JSON.stringify({ type: "message", role: "assistant", message: { content: [{ text: "a" }, { text: "b" }] } }), ctx))
      .toMatchObject([{ type: "chat.delta", text: "ab" }]);
    expect(parseGeminiLine(JSON.stringify({ type: "result", subtype: "success" }), ctx))
      .toMatchObject([{ type: "status.idle", stopReason: "end_turn" }]);
    expect(parseGeminiLine(JSON.stringify({ type: "result", is_error: true }), ctx))
      .toMatchObject([{ type: "status.idle", stopReason: "error" }]);
  });

  test("Given a tagged line the adapter does not model, then it is dropped instead of pasted as chat", () => {
    // Emitting an unknown envelope raw would put provider JSON into the user's conversation.
    expect(parseGeminiLine(JSON.stringify({ type: "system", subtype: "init", cwd: "/x" }), ctx)).toEqual([]);
    expect(parseGeminiLine(JSON.stringify({ type: "tool_call_request", name: "read" }), ctx)).toEqual([]);
  });

  test("Given malformed or hostile output, then no parser throws and nothing is silently lost", () => {
    const hostile = [
      // These three look like JSON envelopes and reach JSON.parse, so the parser's guard is what
      // keeps them from throwing. Without them the assertion would pass even with no guard at all.
      '{"type":"assistant","text":}',
      "{bad json}",
      '{"type":"assistant" "text":"missing comma"}',
      "{",
      '{"type":',
      '{"type":"assistant","text":',
      "}{",
      "\u0000\u0001 binary-ish",
      "가나다 한국어 줄",
      `{"type":"assistant","text":"${"x".repeat(4000)}"}`,
      "[]",
      "null",
      "plain terminal chatter",
    ];
    for (const parse of [parseGeminiLine, parseCopilotLine]) {
      for (const line of hostile) {
        const events = parse(line, ctx);
        expect(Array.isArray(events), line.slice(0, 20)).toBe(true);
        for (const event of events) {
          // A provider key reaching the event stream would leak its schema past the adapter boundary.
          for (const key of Object.keys(event)) expect(EVENT_KEYS.has(key), `${key} in ${event.type}`).toBe(true);
        }
      }
    }
  });

  test("Given plain-text providers, then every printed line reaches the user as a delta", () => {
    for (const parse of [parseCopilotLine]) {
      expect(parse("Working on it", ctx)).toEqual([]);
      expect(parse(JSON.stringify({ type: "assistant.message", data: { content: "Working on it" } }), ctx)).toMatchObject([{ type: "chat.delta", text: "Working on it" }]);
      // Blank chrome lines are not content and must not flood the transcript.
      expect(parse("   ", ctx)).toEqual([]);
    }
  });
});
