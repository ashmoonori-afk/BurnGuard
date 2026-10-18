import { useCallback, useEffect, useRef, useState } from "react";
import type { NormalizedEvent } from "@bg/shared";
import { bootstrapApiAuthority, isAuthorityDenied, onAuthorityRejected, rejectLaunchAuthority } from "@/api/client";
import { getSessionSnapshot, listSessionEvents, subscribeSessionStream } from "@/api/session";
import { mergeSessionEvents, type SessionEventState } from "@/lib/session-event-state";
import { useLaunchAuthority } from "./useLaunchAuthority";

type SessionStreamApi = {
  readonly getSessionSnapshot: typeof getSessionSnapshot;
  readonly listSessionEvents: typeof listSessionEvents;
  readonly subscribeSessionStream: typeof subscribeSessionStream;
};
const sessionApi: SessionStreamApi = { getSessionSnapshot, listSessionEvents, subscribeSessionStream };

type StateRef = { current: SessionEventState | null };

export type SessionStreamHandlers = {
  readonly setState: (state: SessionEventState | null) => void;
  /** The live connection is closed for good; the workspace fails closed until a retry reopens it. */
  readonly setError: (error: boolean) => void;
  /** The browser is retrying the connection on its own; the workspace stays usable. */
  readonly setReconnecting: (reconnecting: boolean) => void;
  /** The connection is open but the resync after (re)opening failed; pending permissions and usage may lag until the next event. */
  readonly setStale: (stale: boolean) => void;
  readonly onLive: (event: NormalizedEvent) => void;
};

/**
 * A connectivity retry must establish authority before opening another stream.
 * A denied bootstrap propagates; it must never silently reopen a stale stream.
 */
export async function retrySessionStream(resubscribe: () => void): Promise<void> {
  await bootstrapApiAuthority();
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
  let checkedDisconnect = false;
  let disconnectCheck: AbortController | null = null;
  const closeDenied = () => {
    if (!active) return;
    active = false;
    disconnectCheck?.abort();
    unsubscribe();
    handlers.setReconnecting(false);
    handlers.setError(true);
  };
  const stopAuthorityListener = onAuthorityRejected(closeDenied);
  const handleFailure = (error: unknown) => {
    if (active && isAuthorityDenied(error)) {
      rejectLaunchAuthority();
      closeDenied();
    }
  };
  const checkDisconnect = () => {
    if (checkedDisconnect) return;
    checkedDisconnect = true;
    const controller = new AbortController();
    disconnectCheck = controller;
    const timer = setTimeout(() => controller.abort(), 15_000);
    void api.getSessionSnapshot(sessionId, controller.signal)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) handleFailure(error);
      })
      .finally(() => clearTimeout(timer));
  };
  stateRef.current = null;
  handlers.setState(null);
  handlers.setError(false);
  handlers.setReconnecting(false);
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
        handlers.setReconnecting(false);
        handlers.setStale(false);
        if (!seen && item.sequence > snapshot.sequence) handlers.onLive(item.event);
      }, (report) => {
        if (!active) return;
        if (report.kind === "connection") {
          if (report.state === "closed") {
            // A temporary outage must not consume the one authority check before a restarted server can answer.
            checkDisconnect();
            handlers.setReconnecting(false);
            handlers.setError(true);
          } else handlers.setReconnecting(true);
          return;
        }
        // A bad payload leaves the EventSource healthy: flag the view stale and resync instead of failing closed.
        handlers.setStale(true);
        refreshSessionSnapshot(sessionId, stateRef, handlers.setState, api)
          .then(() => { if (active) handlers.setStale(false); })
          .catch((error: unknown) => { handleFailure(error); if (active) handlers.setStale(true); });
      }, {
        afterSequence: stateRef.current.sequence,
        onOpen: () => {
          if (!active) return;
          disconnectCheck?.abort();
          checkedDisconnect = false;
          handlers.setError(false);
          handlers.setReconnecting(false);
          refreshSessionSnapshot(sessionId, stateRef, handlers.setState, api)
            .then(() => { if (active) handlers.setStale(false); })
            .catch((error: unknown) => { handleFailure(error); if (active) handlers.setStale(true); });
        },
      });
    } catch (error) { handleFailure(error); if (active) handlers.setError(true); }
  })();
  return () => { active = false; disconnectCheck?.abort(); stopAuthorityListener(); unsubscribe(); };
}

export function useSessionEvents(sessionId: string | undefined, onLiveEvent: (event: NormalizedEvent) => void) {
  const [state, setState] = useState<SessionEventState | null>(null);
  const [error, setError] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [stale, setStale] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const authorityExpired = useLaunchAuthority();
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
    if (sessionId) return openSessionStream(sessionId, stateRef, { setState, setError, setReconnecting, setStale, onLive: (event) => onLiveRef.current(event) });
    stateRef.current = null;
    setState(null);
    setError(false);
    setReconnecting(false);
    setStale(false);
  }, [sessionId, attempt]);
  return { state: state?.snapshot.session.id === sessionId ? state : null, error, reconnecting, stale, retry, refreshSnapshot, authorityExpired };
}
