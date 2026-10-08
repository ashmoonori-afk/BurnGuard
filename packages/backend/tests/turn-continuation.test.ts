import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AdapterRunInput } from "../src/adapters/types";
import type { NormalizedEvent } from "@bg/shared";
import { type ContinuationTimer, resolveContinuationLimits, runWithContinuation } from "../src/services/turn-continuation";
import { type CodexParserContext, parseCodexLine } from "../src/adapters/codex/parser";
import { CODEX_PROGRESS_HEADER, codexProgressHandler } from "../src/adapters/codex/progress-metrics";

const STALL_LIMITS = { idleMs: 1_000, toolMs: 5_000, attemptMs: 60_000, attempts: 3 };

/** Virtual clock: nothing expires until the test advances it, so deadlines are driven by signal rather than elapsed time. */
function manualTimers(): { schedule: ContinuationTimer; advance: (ms: number) => void } {
  const pending = new Map<number, { at: number; handler: () => void }>();
  let now = 0;
  let next = 0;
  return {
    schedule: (handler, ms) => {
      const id = next++;
      pending.set(id, { at: now + ms, handler });
      return () => { pending.delete(id); };
    },
    advance: (ms: number) => {
      const target = now + ms;
      for (;;) {
        let due: { id: number; at: number; handler: () => void } | undefined;
        for (const [id, timer] of pending) if (timer.at <= target && (due === undefined || timer.at < due.at)) due = { id, ...timer };
        if (due === undefined) break;
        pending.delete(due.id);
        now = due.at;
        due.handler();
      }
      now = target;
    },
  };
}

const whenAborted = (signal: AbortSignal): Promise<void> =>
  signal.aborted ? Promise.resolve() : new Promise(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));

test("Given an incomplete attempt, then recovery preserves stage assets and publishes only the successful terminal event", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-continue-"));
  const events: NormalizedEvent[] = [];
  const input: AdapterRunInput = { sessionId: "s", turnId: "t", projectDir: dir, binaryPath: "fixture", prompt: "Create the deck", userEvent: { type: "user.message", text: "Create the deck" }, onEvent: async e => { events.push(e); } };
  let calls = 0;
  try {
    const result = await runWithContinuation(input, async attempt => {
      calls++;
      if (calls === 1) await writeFile(path.join(dir, "image.png"), "existing image");
      else {
        expect(attempt.prompt).toContain("<resume_incomplete_work>");
        expect(attempt.prompt).toContain('data-bg-complete="true"');
        expect(await readFile(path.join(dir, "image.png"), "utf8")).toBe("existing image");
        await writeFile(path.join(dir, "deck.html"), "finished");
      }
      await attempt.onEvent({ id: String(calls), ts: 1, type: "status.idle", stopReason: calls === 1 ? "interrupted" : "end_turn" });
      return { exitCode: calls === 1 ? 1 : 0 };
    }, async () => calls === 2);
    expect(result.exitCode).toBe(0);
    expect(calls).toBe(2);
    expect(events.filter(e => e.type === "status.idle")).toEqual([expect.objectContaining({ stopReason: "end_turn" })]);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool.finished", tool: "generation_resume_incomplete", ok: true }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Given a partial continuation timeout override, then tool and absolute deadlines retain safe defaults", () => {
  expect(resolveContinuationLimits({ idleMs: 120_000, attempts: 3 })).toEqual({ idleMs: 120_000, toolMs: 600_000, attemptMs: 900_000, attempts: 3 });
});

test("Given an explicitly undefined timeout override When resolving limits Then the default deadline remains active", () => {
  expect(resolveContinuationLimits({ idleMs: undefined, toolMs: 250, attempts: 2 }))
    .toEqual({ idleMs: 120_000, toolMs: 250, attemptMs: 900_000, attempts: 2 });
});

test("Given a stalled attempt, then owned cleanup finishes before restart and explicit cancellation never restarts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-stall-"));
  const abort = new AbortController();
  const input: AdapterRunInput = { sessionId: "s", turnId: "t", projectDir: dir, binaryPath: "fixture", prompt: "task", signal: abort.signal, userEvent: { type: "user.message", text: "task" }, onEvent: async () => {} };
  const { schedule, advance } = manualTimers();
  let calls = 0;
  let cleaned = false;
  try {
    const result = await runWithContinuation(input, async attempt => {
      calls++;
      if (calls === 1) {
        advance(STALL_LIMITS.idleMs);
        await whenAborted(attempt.signal!);
        cleaned = true;
        return { exitCode: 1 };
      }
      expect(cleaned).toBe(true);
      return { exitCode: 0 };
    }, async () => true, STALL_LIMITS, schedule);
    expect(result.exitCode).toBe(0);
    expect(calls).toBe(2);
    calls = 0;
    await expect(runWithContinuation(input, async () => { calls++; abort.abort(); return { exitCode: 1 }; }, async () => false)).rejects.toBeDefined();
    expect(calls).toBe(1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Given repeated incomplete results, then retries are bounded and end in a visible failure", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-retry-limit-"));
  const events: NormalizedEvent[] = [];
  let calls = 0;
  try {
    const result = await runWithContinuation({ sessionId: "s", turnId: "t", projectDir: dir, binaryPath: "fixture", prompt: "task", userEvent: { type: "user.message", text: "task" }, onEvent: async e => { events.push(e); } }, async () => { calls++; return { exitCode: 0 }; }, async () => false);
    expect(calls).toBe(3);
    expect(result.exitCode).toBe(1);
    expect(events.at(-1)).toMatchObject({ type: "status.error", code: "turn_failed" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test.each([
  "provider_auth_required", "provider_usage_limited", "provider_quota_exhausted", "provider_model_unavailable",
] as const)("Given a provider failure classified as %s, then the turn is not relaunched", async (code) => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-provider-failure-"));
  const events: NormalizedEvent[] = [];
  let calls = 0;
  try {
    const result = await runWithContinuation({ sessionId: "s", turnId: "t", projectDir: dir, binaryPath: "fixture", prompt: "task", userEvent: { type: "user.message", text: "task" }, onEvent: async e => { events.push(e); } }, async (attempt) => {
      calls++;
      await attempt.onEvent({ id: "e1", ts: 1, type: "status.error", code, message: code, recoverable: false });
      await attempt.onEvent({ id: "e2", ts: 1, type: "status.idle", stopReason: "error" });
      return { exitCode: 1 };
    }, async () => false);
    expect(calls).toBe(1);
    expect(result.exitCode).toBe(1);
    expect(events.find((event) => event.type === "status.error")).toMatchObject({ code, recoverable: false });
    expect(events.some((event) => event.type === "tool.started")).toBe(false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Given an adapter throwing on an owned timeout, then it resumes but unexpected exceptions remain failures", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-abort-throw-"));
  let calls = 0;
  const input: AdapterRunInput = { sessionId: "s", turnId: "t", projectDir: dir, binaryPath: "fixture", prompt: "task", userEvent: { type: "user.message", text: "task" }, onEvent: async () => {} };
  try {
    const { schedule, advance } = manualTimers();
    const result = await runWithContinuation(input, async attempt => {
      if (++calls === 1) {
        advance(STALL_LIMITS.idleMs);
        await whenAborted(attempt.signal!);
        throw attempt.signal!.reason;
      }
      return { exitCode: 0 };
    }, async () => true, STALL_LIMITS, schedule);
    expect(result.exitCode).toBe(0);
    expect(calls).toBe(2);
    await expect(runWithContinuation(input, async () => { throw new Error("permission denied"); }, async () => true)).rejects.toThrow("permission denied");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Given reasoning that keeps advancing, then a working attempt is never stopped as inactive", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-progress-"));
  const { schedule, advance } = manualTimers();
  const events: NormalizedEvent[] = [];
  let calls = 0;
  try {
    const result = await runWithContinuation({ sessionId: "s", turnId: "t", projectDir: dir, binaryPath: "fixture", prompt: "task", userEvent: { type: "user.message", text: "task" }, onEvent: async e => { events.push(e); } }, async attempt => {
      calls++;
      for (const [index, text] of ["reading the brief", "reading the brief and the bundled assets", "drafting the layout"].entries()) {
        await attempt.onEvent({ id: `think-${index}`, ts: 1, type: "chat.thinking", turnId: "t", text });
        advance(STALL_LIMITS.idleMs - 1);
      }
      expect(attempt.signal!.aborted).toBe(false);
      await attempt.onEvent({ id: "end", ts: 1, type: "status.idle", stopReason: "end_turn" });
      return { exitCode: 0 };
    }, async () => true, STALL_LIMITS, schedule);
    expect(result.exitCode).toBe(0);
    expect(calls).toBe(1);
    expect(events.some(e => e.type === "tool.started" && e.tool.startsWith("generation_resume"))).toBe(false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Given only a repeated status heartbeat after the last output, then the attempt stops for inactivity and records that reason", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-heartbeat-"));
  const { schedule, advance } = manualTimers();
  const events: NormalizedEvent[] = [];
  let calls = 0;
  try {
    const result = await runWithContinuation({ sessionId: "s", turnId: "t", projectDir: dir, binaryPath: "fixture", prompt: "task", userEvent: { type: "user.message", text: "task" }, onEvent: async e => { events.push(e); } }, async attempt => {
      calls++;
      if (calls > 1) {
        await attempt.onEvent({ id: "end", ts: 1, type: "status.idle", stopReason: "end_turn" });
        return { exitCode: 0 };
      }
      for (let beat = 0; beat < 3; beat++) {
        await attempt.onEvent({ id: `run-${beat}`, ts: 1, type: "status.running" });
        await attempt.onEvent({ id: `beat-${beat}`, ts: 1, type: "chat.thinking", turnId: "t", text: "still working on it" });
        advance(STALL_LIMITS.idleMs - 1);
      }
      await whenAborted(attempt.signal!);
      return { exitCode: 1 };
    }, async () => calls === 2, STALL_LIMITS, schedule);
    expect(result.exitCode).toBe(0);
    expect(calls).toBe(2);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool.started", tool: "generation_resume_stalled", input: { attempt: 2, maximum: STALL_LIMITS.attempts, reason: "inactivity" } }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Given progress that outlives the attempt deadline, then the attempt still stops and records the deadline instead of inactivity", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-deadline-"));
  const { schedule, advance } = manualTimers();
  const limits = { idleMs: 1_000, toolMs: 5_000, attemptMs: 2_500, attempts: 3 };
  const events: NormalizedEvent[] = [];
  let calls = 0;
  let steps = 0;
  try {
    const result = await runWithContinuation({ sessionId: "s", turnId: "t", projectDir: dir, binaryPath: "fixture", prompt: "task", userEvent: { type: "user.message", text: "task" }, onEvent: async e => { events.push(e); } }, async attempt => {
      calls++;
      if (calls > 1) {
        await attempt.onEvent({ id: "end", ts: 1, type: "status.idle", stopReason: "end_turn" });
        return { exitCode: 0 };
      }
      while (!attempt.signal!.aborted && steps < 10) {
        await attempt.onEvent({ id: `step-${steps}`, ts: 1, type: "chat.thinking", turnId: "t", text: `drafting section ${steps}` });
        steps++;
        advance(limits.idleMs - 1);
      }
      return { exitCode: 1 };
    }, async () => calls === 2, limits, schedule);
    expect(result.exitCode).toBe(0);
    expect(steps).toBe(3);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool.started", tool: "generation_resume_stalled", input: { attempt: 2, maximum: limits.attempts, reason: "attempt_deadline" } }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Given Codex reasoning on the real stream, then parsed progress keeps the attempt alive and hidden reasoning is never published", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-codex-progress-"));
  const { schedule, advance } = manualTimers();
  const events: NormalizedEvent[] = [];
  // Item shapes as recorded by the installed Codex CLI: an exposed summary beside encrypted content.
  const lines = [
    JSON.stringify({ type: "item.started", item: { id: "item_0", type: "reasoning", text: "" } }),
    JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "reasoning", text: "Reviewing the brief and the existing assets" } }),
    JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "reasoning", summary: [{ type: "summary_text", text: "Drafting the first section" }], encrypted_content: "ENCRYPTED-REASONING-PAYLOAD", content: [{ type: "reasoning_text", text: "raw private chain of thought" }] } }),
  ];
  let calls = 0;
  try {
    const result = await runWithContinuation({ sessionId: "s", turnId: "t", projectDir: dir, binaryPath: "fixture", prompt: "task", userEvent: { type: "user.message", text: "task" }, onEvent: async e => { events.push(e); } }, async attempt => {
      calls++;
      const ctx: CodexParserContext = { turnId: attempt.turnId, projectDir: dir, toolNames: new Map() };
      for (const line of lines) {
        for (const event of parseCodexLine(line, ctx)) await attempt.onEvent(event);
        advance(STALL_LIMITS.idleMs - 1);
      }
      expect(attempt.signal!.aborted).toBe(false);
      await attempt.onEvent({ id: "end", ts: 1, type: "status.idle", stopReason: "end_turn" });
      return { exitCode: 0 };
    }, async () => true, STALL_LIMITS, schedule);
    expect(result.exitCode).toBe(0);
    expect(calls).toBe(1);
    expect(events.filter(e => e.type === "chat.thinking").map(e => e.text)).toEqual(["Reviewing the brief and the existing assets", "Drafting the first section"]);
    expect(JSON.stringify(events)).not.toContain("ENCRYPTED-REASONING-PAYLOAD");
    expect(JSON.stringify(events)).not.toContain("raw private chain of thought");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Given a Codex save error, then it is visible without leaking diagnostics or declaring a file changed", () => {
  const ctx = { turnId: "t", projectDir: process.cwd(), toolNames: new Map<string, string>() };
  for (const item of [{ type: "error", message: "apply_patch failed in C:/private/token" }, { type: "file_change", status: "failed", changes: [{ path: "deck.html", kind: "delete" }] }]) {
    const events = parseCodexLine(JSON.stringify({ type: "item.completed", item }), ctx);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool.finished", ok: false }));
    expect(events.some(e => e.type === "file.changed")).toBe(false);
    expect(JSON.stringify(events)).not.toContain("private");
  }
});

test("Given a progress-only signal arriving inside every idle window, then a silent large tool input stays alive past idleMs", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-partial-progress-"));
  const { schedule, advance } = manualTimers();
  const events: NormalizedEvent[] = [];
  let calls = 0;
  try {
    const result = await runWithContinuation({ sessionId: "s", turnId: "t", projectDir: dir, binaryPath: "fixture", prompt: "task", userEvent: { type: "user.message", text: "task" }, onEvent: async e => { events.push(e); } }, async attempt => {
      calls++;
      for (let beat = 0; beat < 5; beat++) {
        attempt.onProgress!();
        advance(STALL_LIMITS.idleMs - 1);
      }
      expect(attempt.signal!.aborted).toBe(false);
      await attempt.onEvent({ id: "end", ts: 1, type: "status.idle", stopReason: "end_turn" });
      return { exitCode: 0 };
    }, async () => true, STALL_LIMITS, schedule);
    expect(result.exitCode).toBe(0);
    expect(calls).toBe(1);
    expect(events.map(e => e.type)).toEqual(["status.idle"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Given a progress-only signal that never stops, then attemptMs still ends the attempt", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-partial-deadline-"));
  const { schedule, advance } = manualTimers();
  const limits = { idleMs: 1_000, toolMs: 5_000, attemptMs: 2_500, attempts: 3 };
  const events: NormalizedEvent[] = [];
  let calls = 0;
  let beats = 0;
  try {
    await runWithContinuation({ sessionId: "s", turnId: "t", projectDir: dir, binaryPath: "fixture", prompt: "task", userEvent: { type: "user.message", text: "task" }, onEvent: async e => { events.push(e); } }, async attempt => {
      calls++;
      if (calls > 1) { await attempt.onEvent({ id: "end", ts: 1, type: "status.idle", stopReason: "end_turn" }); return { exitCode: 0 }; }
      while (!attempt.signal!.aborted && beats < 10) { attempt.onProgress!(); beats++; advance(limits.idleMs - 1); }
      return { exitCode: 1 };
    }, async () => calls === 2, limits, schedule);
    expect(beats).toBe(3);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool.started", tool: "generation_resume_stalled", input: { attempt: 2, maximum: limits.attempts, reason: "attempt_deadline" } }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Given Codex metric exports, then streaming keeps a silent patch alive and a stalled stream still stops at idleMs", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-codex-metrics-"));
  const { schedule, advance } = manualTimers();
  const events: NormalizedEvent[] = [];
  const exportOf = (value: string) => new Request("http://127.0.0.1/v1/metrics", { method: "POST", headers: { [CODEX_PROGRESS_HEADER]: "token" }, body: JSON.stringify({ resourceMetrics: [{ scopeMetrics: [{ metrics: [{ name: "codex.websocket.event", sum: { dataPoints: [{ attributes: [{ key: "success", value: { stringValue: "true" } }], asInt: value }] } }] }] }] }) });
  let calls = 0;
  try {
    await runWithContinuation({ sessionId: "s", turnId: "t", projectDir: dir, binaryPath: "fixture", prompt: "task", userEvent: { type: "user.message", text: "task" }, onEvent: async e => { events.push(e); } }, async attempt => {
      calls++;
      if (calls > 1) { await attempt.onEvent({ id: "end", ts: 1, type: "status.idle", stopReason: "end_turn" }); return { exitCode: 0 }; }
      const handle = codexProgressHandler("token", attempt.onProgress!);
      for (let beat = 0; beat < 3; beat++) { await handle(exportOf("4")); advance(STALL_LIMITS.idleMs - 1); }
      expect(attempt.signal!.aborted).toBe(false);
      // A periodic export with no new stream events proves nothing: the stalled stream ends at idleMs.
      await handle(exportOf("0"));
      advance(1);
      expect(attempt.signal!.aborted).toBe(true);
      return { exitCode: 1 };
    }, async () => calls === 2, STALL_LIMITS, schedule);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool.started", tool: "generation_resume_stalled", input: { attempt: 2, maximum: STALL_LIMITS.attempts, reason: "inactivity" } }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
