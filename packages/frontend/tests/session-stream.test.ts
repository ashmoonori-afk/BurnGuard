import { afterEach, expect, mock, test } from "bun:test";
import type { SequencedEventEnvelope, SessionInfo, SessionSnapshot } from "@bg/shared";
import { bootstrapApiAuthority } from "../src/api/client";
import { openSessionStream, retrySessionStream, type SessionStreamHandlers } from "../src/hooks/useSessionEvents";

const SESSION: SessionInfo = {
  id: "s1",
  project_id: "p1",
  backend_id: "codex",
  status: "idle",
  usage: { input: 0, output: 0, cached: 0, cache_write: 0 },
  updated_at: 1,
  last_active_at: 1,
};
const snapshot = (sequence: number): SessionSnapshot => ({ session: SESSION, sequence, pending_permissions: [] });

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.EventSource = originalEventSource;
});

test("Given an open stream whose resync snapshot fails When the stream opens Then the workspace is stale rather than disconnected, and the next envelope clears it", async () => {
  let snapshots = 0;
  let open: () => void = () => {};
  let deliver: (item: SequencedEventEnvelope) => void = () => {};
  const subscribed = deferred();
  const staleSet = deferred();
  const flags: string[] = [];
  const handlers: SessionStreamHandlers = {
    setState: () => {},
    setError: (value) => { flags.push(`error:${value}`); },
    setStale: (value) => { flags.push(`stale:${value}`); if (value) staleSet.resolve(); },
    onLive: () => {},
  };
  const stop = openSessionStream("s1", { current: null }, handlers, {
    getSessionSnapshot: async () => { snapshots += 1; if (snapshots === 2) throw new Error("resync_failed"); return snapshot(0); },
    listSessionEvents: async () => [],
    subscribeSessionStream: (_id, onEvent, _onError, options) => { open = () => options?.onOpen?.(); deliver = onEvent; subscribed.resolve(); return () => {}; },
  });
  try {
    await subscribed.promise;
    open();
    await staleSet.promise;

    expect(flags).not.toContain("error:true");
    expect(flags.at(-1)).toBe("stale:true");

    deliver({ sequence: 1, event: { id: "e1", ts: 2, type: "status.running" } });
    expect(flags.at(-1)).toBe("stale:false");
    expect(flags).not.toContain("error:true");
  } finally {
    stop();
  }
});

test("Given a launch capability the backend no longer accepts When the stream is retried Then the snapshot is requested again with a fresh capability and the error clears without a reload", async () => {
  let bootstraps = 0;
  const snapshotCapabilities: (string | null)[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/bootstrap") {
      bootstraps += 1;
      return Response.json({ data: { capability: bootstraps === 1 ? "capability-a" : "capability-b" } });
    }
    const capability = new Headers(init?.headers).get("x-burnguard-capability");
    if (url.endsWith("/snapshot")) {
      snapshotCapabilities.push(capability);
      return capability === "capability-b"
        ? Response.json({ data: snapshot(0) })
        : Response.json({ error: { code: "forbidden", message: "denied" } }, { status: 403 });
    }
    if (url.endsWith("/events")) return Response.json({ data: [] });
    return Response.json({ error: { code: "not_found", message: "missing" } }, { status: 404 });
  }) as typeof fetch;
  class Source {
    static CLOSED = 2;
    readyState = 1;
    addEventListener() {}
    removeEventListener() {}
    close() {}
  }
  globalThis.EventSource = Source as unknown as typeof EventSource;

  await bootstrapApiAuthority();
  const errorSet = deferred();
  const stateSet = deferred();
  const flags: string[] = [];
  const handlers: SessionStreamHandlers = {
    setState: (state) => { if (state !== null) stateSet.resolve(); },
    setError: (value) => { flags.push(`error:${value}`); if (value) errorSet.resolve(); },
    setStale: () => {},
    onLive: () => {},
  };
  const stateRef = { current: null };
  let stop = openSessionStream("s1", stateRef, handlers);
  try {
    await errorSet.promise;
    expect(snapshotCapabilities).toEqual(["capability-a"]);

    await retrySessionStream(() => { stop(); stop = openSessionStream("s1", stateRef, handlers); });
    await stateSet.promise;

    expect(bootstraps).toBe(2);
    expect(snapshotCapabilities).toEqual(["capability-a", "capability-b"]);
    expect(flags.filter((flag) => flag === "error:true")).toHaveLength(1);
    expect(flags.at(-1)).toBe("error:false");
  } finally {
    stop();
  }
});
