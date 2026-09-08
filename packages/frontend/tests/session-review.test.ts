import { afterEach, expect, mock, test } from "bun:test";
import type { NormalizedEvent, SessionSnapshot } from "@bg/shared";
import { mergeSessionEvents } from "../src/lib/session-event-state";
import { bootstrapApiAuthority } from "../src/api/client";
import { getSessionSnapshot, listSessionEvents, submitToolDecision, subscribeSessionStream } from "../src/api/session";
import { parseComposerDraft } from "../src/components/chat/useComposerDraft";
import { resolveTheme } from "../src/hooks/useTheme";

const snapshot: SessionSnapshot = { sequence: 5, session: { id: "session-42", project_id: "project-7", backend_id: "codex", status: "idle", usage: { input: 100, output: 50, cached: 20, cache_write: 0 }, updated_at: 50, last_active_at: 50 }, pending_permissions: [] };
const event = (sequence: number, value: NormalizedEvent) => ({ sequence, event: value });
const permission: Extract<NormalizedEvent, { type: "tool.permission_required" }> = { id: "permission", ts: 60, type: "tool.permission_required", turnId: "turn", toolCallId: "tool", tool: "Write", input: { path: "index.html" } };

test("Given persisted usage When history and duplicate reconnect events merge Then tokens are applied once after the snapshot cursor", () => {
  const old = event(4, { id: "old", ts: 40, type: "usage.delta", input: 100, output: 50, cached: 20 });
  const fresh = event(6, { id: "new", ts: 60, type: "usage.delta", input: 10, output: 5, cached: 2 });
  let state = mergeSessionEvents(null, [old], snapshot);
  expect(state.session.usage).toEqual(snapshot.session.usage);
  state = mergeSessionEvents(state, [fresh, old, fresh]);
  expect(state.session.usage).toEqual({ input: 110, output: 55, cached: 22, cache_write: 0 });
  state = mergeSessionEvents(state, [fresh], { ...snapshot, sequence: 6, session: state.session });
  expect(state.session.usage.input).toBe(110);
  expect(state.envelopes).toHaveLength(2);
});

test("Given same-millisecond chunks with reverse IDs When replay races live Then durable sequence preserves text order", () => {
  const second = event(7, { id: "a", ts: 60, type: "chat.delta", text: "나", turnId: "turn" });
  const first = event(6, { id: "z", ts: 60, type: "chat.delta", text: "가", turnId: "turn" });
  const state = mergeSessionEvents(mergeSessionEvents(null, [second], snapshot), [first, second]);
  expect(state.envelopes.map((item) => item.event.type === "chat.delta" ? item.event.text : "").join("")).toBe("가나");
});

test("Given completed historical permission When loading or reconnecting Then only current unresolved requests remain", () => {
  let state = mergeSessionEvents(null, [event(3, permission)], snapshot);
  expect(state.pending).toHaveLength(0);
  state = mergeSessionEvents(state, [event(6, permission)]);
  expect(state.pending.map((item) => item.toolCallId)).toEqual(["tool"]);
  state = mergeSessionEvents(state, [event(7, { id: "decided", ts: 70, type: "tool.permission_decided", turnId: "turn", toolCallId: "tool", decision: "allow" })]);
  expect(state.pending).toHaveLength(0);
  state = mergeSessionEvents(state, [event(8, { ...permission, id: "second" })]);
  state = mergeSessionEvents(state, [event(9, { id: "end", ts: 90, type: "status.idle", stopReason: "interrupted" })]);
  expect(state.pending).toHaveLength(0);
});

test("Given newer snapshot When an older response resolves late Then usage and pending never roll back", () => {
  const newer = { ...snapshot, sequence: 10, session: { ...snapshot.session, usage: { ...snapshot.session.usage, input: 120 } } };
  const state = mergeSessionEvents(mergeSessionEvents(null, [], newer), [], snapshot);
  expect(state.sequence).toBe(10);
  expect(state.session.usage.input).toBe(120);
});

test("Given a pending permission When a new turn starts Then live state uses the same permission boundary as snapshots", () => {
  const state = mergeSessionEvents(null, [event(6, { id: "started", ts: 60, type: "status.running" })], { ...snapshot, pending_permissions: [permission] });
  expect(state.pending).toHaveLength(0);
  expect(state.session.status).toBe("running");
});

const originalFetch = globalThis.fetch;
const OriginalEventSource = globalThis.EventSource;
afterEach(() => { globalThis.fetch = originalFetch; globalThis.EventSource = OriginalEventSource; });

test("Given distinct project and session IDs When calling session APIs Then permission and snapshot target the session and history retains sequence", async () => {
  const paths: string[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    paths.push(String(input));
    if (String(input) === "/api/bootstrap") return Response.json({ data: { capability: "test" } });
    if (String(input).endsWith("/snapshot")) return Response.json({ data: snapshot });
    if (String(input).endsWith("/events")) return Response.json({ data: [event(6, permission)] });
    return Response.json({ data: { accepted: true } });
  }) as typeof fetch;
  await bootstrapApiAuthority();
  const loaded = await getSessionSnapshot("session-42");
  await submitToolDecision(loaded.session.id, { toolCallId: "tool", decision: "deny" });
  expect(paths).toContain("/api/sessions/session-42/tool-decision");
  expect((await listSessionEvents("session-42"))[0]?.sequence).toBe(6);
  expect(paths.every((path) => !path.includes("project-7"))).toBe(true);
});

test("Given a replay cursor When subscribing Then reconnect starts after it and malformed envelopes cannot reach state", () => {
  let opened = "";
  const listeners = new Map<string, (event: MessageEvent<string>) => void>();
  class Source {
    static CLOSED = 2;
    readyState = 1;
    constructor(url: string) { opened = url; }
    addEventListener(name: string, listener: (event: MessageEvent<string>) => void) { listeners.set(name, listener); }
    removeEventListener(name: string) { listeners.delete(name); }
    close() {}
  }
  globalThis.EventSource = Source as unknown as typeof EventSource;
  const incoming = mock(() => {});
  const errors = mock(() => {});
  const close = subscribeSessionStream("session-42", incoming, errors, { afterSequence: 9 });
  expect(opened).toEndWith("?after_sequence=9");
  listeners.get("message")?.({ data: JSON.stringify({ sequence: -1, event: permission }) } as MessageEvent<string>);
  expect(incoming).not.toHaveBeenCalled();
  expect(errors).toHaveBeenCalledTimes(1);
  close();
  expect(listeners.size).toBe(0);
});

test("Given a local draft When restored Then attachments and roles survive and unsupported files do not reenter the queue", () => {
  const file = new File(["%PDF"], "자료.pdf", { type: "application/pdf" });
  const parsed = parseComposerDraft({ text: "요청", items: [{ status: "ready", file, role: "immutable_reference" }, { status: "ready", file: new File(["x"], "bad.exe"), role: "ordinary_content" }] });
  expect(parsed?.text).toBe("요청");
  expect(parsed?.items).toHaveLength(1);
  expect(parsed?.items[0]).toMatchObject({ status: "ready", role: "immutable_reference", file });
  expect(parseComposerDraft({ text: 5, items: [] })).toBeNull();
});

test("Given a saved theme When system preference changes Then explicit choices stay fixed and auto follows the system", () => {
  expect(resolveTheme("light", true)).toBe("light");
  expect(resolveTheme("dark", false)).toBe("dark");
  expect(resolveTheme("auto", true)).toBe("dark");
  expect(resolveTheme("auto", false)).toBe("light");
});
