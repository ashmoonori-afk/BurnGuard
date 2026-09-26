import { useCallback, useEffect, useRef, useState } from "react";
import type { NormalizedEvent } from "@bg/shared";
import { bootstrapApiAuthority } from "@/api/client";
import { getSessionSnapshot, listSessionEvents, subscribeSessionStream } from "@/api/session";
import { mergeSessionEvents, type SessionEventState } from "@/lib/session-event-state";

type SessionStreamApi = {
  readonly getSessionSnapshot: typeof getSessionSnapshot;
  readonly listSessionEvents: typeof listSessionEvents;
  readonly subscribeSessionStream: typeof subscribeSessionStream;
};
const sessionApi: SessionStreamApi = { getSessionSnapshot, listSessionEvents, subscribeSessionStream };

type StateRef = { current: SessionEventState | null };

export type SessionStreamHandlers = {
  readonly setState: (state: SessionEventState | null) => void;
  /** The live connection itself is down; the workspace fails closed until it is back. */
  readonly setError: (error: boolean) => void;
  /** The connection is open but the resync after (re)opening failed; pending permissions and usage may lag until the next event. */
  readonly setStale: (stale: boolean) => void;
  readonly onLive: (event: NormalizedEvent) => void;
};

/**
 * A restarted backend mints a new launch capability, so every request with the old one answers 403
 * and the stream can never come back on its own: a retry re-bootstraps the capability first.
 */
export async function retrySessionStream(resubscribe: () => void): Promise<void> {
  await bootstrapApiAuthority().catch(() => {});
  resubscribe();
}

async function refreshSessionSnapshot(sessionId: string, stateRef: StateRef, setState: (state: SessionEventState) => void, api: SessionStreamApi): Promise<void> {
  const snapshot = await api.getSessionSnapshot(sessionId);
  if (stateRef.current?.snapshot.session.id !== sessionId) return;
  stateRef.current = mergeSessionEvents(stateRef.current, [], snapshot);
  setState(stateRef.current);
}

/** Loads the durable history, then follows the live stream. Exported so the connection states can be driven without React. */
export function openSessionStream(sessionId: string, stateRef: StateRef, handlers: SessionStreamHandlers, api: SessionStreamApi = sessionApi): () => void {
  let active = true;
  let unsubscribe = () => {};
  stateRef.current = null;
  handlers.setState(null);
  handlers.setError(false);
  handlers.setStale(false);
  void (async () => {
    try {
      const snapshot = await api.getSessionSnapshot(sessionId);
      const history = await api.listSessionEvents(sessionId);
      if (!active) return;
      stateRef.current = mergeSessionEvents(null, history, snapshot);
      handlers.setState(stateRef.current);
      for (const item of history) if (item.sequence > snapshot.sequence) handlers.onLive(item.event);
      unsubscribe = api.subscribeSessionStream(sessionId, (item) => {
        if (!active || !stateRef.current) return;
        const seen = stateRef.current.envelopes.some((event) => event.sequence === item.sequence);
        stateRef.current = mergeSessionEvents(stateRef.current, [item]);
        handlers.setState(stateRef.current);
        handlers.setError(false);
        handlers.setStale(false);
        if (!seen && item.sequence > snapshot.sequence) handlers.onLive(item.event);
      }, () => { if (active) handlers.setError(true); }, {
        afterSequence: stateRef.current.sequence,
        onOpen: () => {
          if (!active) return;
          handlers.setError(false);
          refreshSessionSnapshot(sessionId, stateRef, handlers.setState, api)
            .then(() => { if (active) handlers.setStale(false); })
            .catch(() => { if (active) handlers.setStale(true); });
        },
      });
    } catch { if (active) handlers.setError(true); }
  })();
  return () => { active = false; unsubscribe(); };
}

export function useSessionEvents(sessionId: string | undefined, onLiveEvent: (event: NormalizedEvent) => void) {
  const [state, setState] = useState<SessionEventState | null>(null);
  const [error, setError] = useState(false);
  const [stale, setStale] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const stateRef = useRef<SessionEventState | null>(null);
  const onLiveRef = useRef(onLiveEvent);
  onLiveRef.current = onLiveEvent;
  const retry = useCallback(() => retrySessionStream(() => setAttempt((value) => value + 1)), []);
  const refreshSnapshot = useCallback(async () => {
    if (!sessionId) return;
    await refreshSessionSnapshot(sessionId, stateRef, setState, sessionApi);
    setStale(false);
  }, [sessionId]);

  useEffect(() => {
    if (sessionId) return openSessionStream(sessionId, stateRef, { setState, setError, setStale, onLive: (event) => onLiveRef.current(event) });
    stateRef.current = null;
    setState(null);
    setError(false);
    setStale(false);
  }, [sessionId, attempt]);
  return { state: state?.snapshot.session.id === sessionId ? state : null, error, stale, retry, refreshSnapshot };
}
