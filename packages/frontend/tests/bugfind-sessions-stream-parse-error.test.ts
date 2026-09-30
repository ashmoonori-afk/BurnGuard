import { expect, test } from "bun:test";
import type { SessionInfo, SessionSnapshot } from "@bg/shared";
import { openSessionStream, type SessionStreamHandlers } from "../src/hooks/useSessionEvents";

const SESSION: SessionInfo = {
  id: "s1",
  project_id: "p1",
  backend_id: "codex",
  status: "idle",
  usage: { input: 0, output: 0, cached: 0, cache_write: 0 },
  updated_at: 1,
  last_active_at: 1,
};
const snapshot: SessionSnapshot = { session: SESSION, sequence: 0, pending_permissions: [] };

test("Given an open, healthy session stream When one payload fails envelope validation Then the workspace is not marked disconnected", async () => {
  // Given
  let reportError: (err: { kind: "parse" | "connection"; message: string }) => void = () => {};
  let subscribed: () => void = () => {};
  const ready = new Promise<void>((resolve) => { subscribed = resolve; });
  const flags: string[] = [];
  const handlers: SessionStreamHandlers = {
    setState: () => {},
    setError: (value) => { flags.push(`error:${value}`); },
    setStale: (value) => { flags.push(`stale:${value}`); },
    onLive: () => {},
  };
  const stop = openSessionStream("s1", { current: null }, handlers, {
    getSessionSnapshot: async () => snapshot,
    listSessionEvents: async () => [],
    subscribeSessionStream: (_id, _onEvent, onError) => { reportError = (err) => onError?.(err); subscribed(); return () => {}; },
  });
  try {
    await ready;

    // When
    reportError({ kind: "parse", message: "invalid_event_envelope" });

    // Then
    expect(flags).not.toContain("error:true");
  } finally {
    stop();
  }
});
