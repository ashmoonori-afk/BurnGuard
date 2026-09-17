import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AdapterRunInput } from "../src/adapters/types";
import type { NormalizedEvent } from "@bg/shared";
import { runWithContinuation } from "../src/services/turn-continuation";
import { parseCodexLine } from "../src/adapters/codex/parser";

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

test("Given a stalled attempt, then owned cleanup finishes before restart and explicit cancellation never restarts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-stall-"));
  const abort = new AbortController();
  const input: AdapterRunInput = { sessionId: "s", turnId: "t", projectDir: dir, binaryPath: "fixture", prompt: "task", signal: abort.signal, userEvent: { type: "user.message", text: "task" }, onEvent: async () => {} };
  let calls = 0;
  let cleaned = false;
  try {
    const result = await runWithContinuation(input, async attempt => {
      calls++;
      if (calls === 1) {
        await new Promise<void>(resolve => attempt.signal!.addEventListener("abort", () => resolve(), { once: true }));
        cleaned = true;
        return { exitCode: 1 };
      }
      expect(cleaned).toBe(true);
      return { exitCode: 0 };
    }, async () => true, { idleMs: 10, toolMs: 100, attemptMs: 1000, attempts: 3 });
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

test("Given an adapter throwing on an owned timeout, then it resumes but unexpected exceptions remain failures", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-abort-throw-"));
  let calls = 0;
  const input: AdapterRunInput = { sessionId: "s", turnId: "t", projectDir: dir, binaryPath: "fixture", prompt: "task", userEvent: { type: "user.message", text: "task" }, onEvent: async () => {} };
  try {
    const result = await runWithContinuation(input, async attempt => {
      if (++calls === 1) await new Promise<never>((_resolve, reject) => attempt.signal!.addEventListener("abort", () => reject(attempt.signal!.reason), { once: true }));
      return { exitCode: 0 };
    }, async () => true, { idleMs: 10, toolMs: 100, attemptMs: 1000, attempts: 3 });
    expect(result.exitCode).toBe(0);
    expect(calls).toBe(2);
    await expect(runWithContinuation(input, async () => { throw new Error("permission denied"); }, async () => true)).rejects.toThrow("permission denied");
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
