import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import path from "node:path";
import type { NormalizedEvent, SequencedEventEnvelope } from "@bg/shared";
import { runMigrationsFrom } from "../src/db/migrate";
import { persistNormalizedEvent } from "../src/db/events";
import { readSessionSnapshot } from "../src/db/session-snapshot";
import { readConversationHistory, MAX_HISTORY_CHARS } from "../src/db/conversation-history";
import { insertSequencedEvent } from "../src/db/sequenced-event-writer";
import { subscribeBeforeBackfill } from "../src/services/sequenced-event-replay";
import { createApp } from "../src/server";
import { DECK_STAGE_JS } from "../src/runtime/deck-stage";

let db: Database;
beforeEach(async () => {
  db = new Database(":memory:");
  await runMigrationsFrom(db, path.join(import.meta.dir, "../src/db/migrations"));
  db.exec("INSERT INTO projects(id,name,type,dir_path,backend_id,created_at,updated_at) VALUES ('p','P','prototype','unused','codex',1,1)");
  db.exec("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES ('s','p','codex','idle',1,1,1),('other','p','codex','idle',1,1,1)");
});
afterEach(() => db.close());
const delta = (id: string, text = id): NormalizedEvent => ({ id, ts: 1, type: "chat.delta", turnId: "t", text });

test("Given publish while replay emit awaits When replay becomes live Then every sequence arrives once", async () => {
  const observed: number[] = [];
  let listener: (item: SequencedEventEnvelope) => Promise<void> = async () => {};
  const stop = await subscribeBeforeBackfill({ afterSequence: 0,
    subscribe: (value) => { listener = value; return () => {}; },
    backfill: async () => [{ sequence: 1, event: delta("a") }],
    emit: async (item) => { observed.push(item.sequence); if (item.sequence === 1) { await listener({ sequence: 2, event: delta("b") }); await listener({ sequence: 2, event: delta("b") }); } },
  });
  await listener({ sequence: 3, event: delta("c") });
  stop();
  expect(observed).toEqual([1, 2, 3]);
});

test("Given two overlapping live emits When the first waits Then cursor and delivery remain ordered", async () => {
  const observed: number[] = [];
  let listener: (item: SequencedEventEnvelope) => Promise<void> = async () => {};
  let release: () => void = () => {};
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const stop = await subscribeBeforeBackfill({ afterSequence: 0, subscribe: (value) => { listener = value; return () => {}; }, backfill: async () => [],
    emit: async (item) => { if (item.sequence === 1) await barrier; observed.push(item.sequence); },
  });
  const first = listener({ sequence: 1, event: delta("a") });
  const second = listener({ sequence: 2, event: delta("b") });
  release();
  await Promise.all([first, second]);
  await listener({ sequence: 1, event: delta("a") });
  stop();
  expect(observed).toEqual([1, 2]);
});

test("Given production routing When the deck fetches its runtime Then exact JavaScript is returned", async () => {
  const response = await createApp({ capability: "test", appAuthority: "127.0.0.1:14070" }).request("/runtime/deck-stage.js");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/javascript");
  expect(await response.text()).toBe(DECK_STAGE_JS);
});

test("Given usage events When snapshot is read Then totals and cursor include the same committed events", () => {
  const event = persistNormalizedEvent(db, "s", { id: "usage", ts: 1, type: "usage.delta", input: 5, output: 9, cached: 3 });
  const snapshot = readSessionSnapshot(db, "s");
  expect(snapshot?.sequence).toBe(event.sequence);
  expect(snapshot?.session.usage).toEqual({ input: 5, output: 9, cached: 3, cache_write: 0 });
  expect(() => persistNormalizedEvent(db, "s", { id: "usage", ts: 1, type: "usage.delta", input: 5, output: 9 })).toThrow();
  expect(readSessionSnapshot(db, "s")?.session.usage.input).toBe(5);
});

test("Given settled and terminal permissions When reconnecting Then only current pending requests survive", () => {
  const permission = (id: string): NormalizedEvent => ({ id, ts: 1, type: "tool.permission_required", turnId: "t", toolCallId: id, tool: "Bash", input: {} });
  persistNormalizedEvent(db, "s", permission("first"));
  persistNormalizedEvent(db, "s", { id: "decided", ts: 2, type: "tool.permission_decided", turnId: "t", toolCallId: "first", decision: "allow" });
  persistNormalizedEvent(db, "s", permission("second"));
  expect(readSessionSnapshot(db, "s")?.pending_permissions.map((item) => item.toolCallId)).toEqual(["second"]);
  persistNormalizedEvent(db, "s", { id: "idle", ts: 3, type: "status.idle", stopReason: "end_turn" });
  expect(readSessionSnapshot(db, "s")?.pending_permissions).toEqual([]);
  expect(readSessionSnapshot(db, "s")?.session.status).toBe("idle");
  persistNormalizedEvent(db, "s", permission("legacy"));
  insertSequencedEvent(db, { id: "legacy-decision", sessionId: "s", direction: "up", type: "user.tool_decision", payload: { type: "user.tool_decision", toolCallId: "legacy", decision: "deny" }, turnId: "t", processedAt: 4, createdAt: 4 });
  expect(readSessionSnapshot(db, "s")?.pending_permissions).toEqual([]);
});

test("Given dialogue from separate sessions When assembling history Then recent roles and choices stay bounded and isolated", () => {
  persistNormalizedEvent(db, "s", { id: "question", ts: 1, type: "chat.user_message", turnId: "t", text: "Suggest two options", attachmentCount: 0 });
  persistNormalizedEvent(db, "s", delta("part-a", "1. Red. "));
  persistNormalizedEvent(db, "s", delta("part-b", "2. Blue."));
  persistNormalizedEvent(db, "other", delta("secret", "OTHER SESSION"));
  expect(readConversationHistory(db, "s")).toEqual([
    { role: "user", turnId: "t", text: "Suggest two options" },
    { role: "assistant", turnId: "t", text: "1. Red. 2. Blue." },
  ]);
  for (let index = 0; index < 10; index += 1) persistNormalizedEvent(db, "s", delta(`large-${index}`, "x".repeat(5000)));
  expect(readConversationHistory(db, "s").reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
  expect(JSON.stringify(readConversationHistory(db, "s"))).not.toContain("OTHER SESSION");
});
