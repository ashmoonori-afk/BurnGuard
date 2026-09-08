import { useCallback, useEffect, useRef, useState } from "react";
import type { NormalizedEvent } from "@bg/shared";
import { getSessionSnapshot, listSessionEvents, subscribeSessionStream } from "@/api/session";
import { mergeSessionEvents, type SessionEventState } from "@/lib/session-event-state";

export function useSessionEvents(sessionId: string | undefined, onLiveEvent: (event: NormalizedEvent) => void) {
  const [state, setState] = useState<SessionEventState | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const stateRef = useRef<SessionEventState | null>(null);
  const onLiveRef = useRef(onLiveEvent);
  onLiveRef.current = onLiveEvent;
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const refreshSnapshot = useCallback(async () => {
    if (!sessionId) return;
    const snapshot = await getSessionSnapshot(sessionId);
    if (stateRef.current?.snapshot.session.id !== sessionId) return;
    stateRef.current = mergeSessionEvents(stateRef.current, [], snapshot);
    setState(stateRef.current);
  }, [sessionId]);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    stateRef.current = null;
    setState(null);
    setError(false);
    if (!sessionId) return;
    void (async () => {
      try {
        const snapshot = await getSessionSnapshot(sessionId);
        const history = await listSessionEvents(sessionId);
        if (!active) return;
        stateRef.current = mergeSessionEvents(null, history, snapshot);
        setState(stateRef.current);
        for (const item of history) if (item.sequence > snapshot.sequence) onLiveRef.current(item.event);
        unsubscribe = subscribeSessionStream(sessionId, (item) => {
          if (!active || !stateRef.current) return;
          const seen = stateRef.current.envelopes.some((event) => event.sequence === item.sequence);
          stateRef.current = mergeSessionEvents(stateRef.current, [item]);
          setState(stateRef.current);
          setError(false);
          if (!seen && item.sequence > snapshot.sequence) onLiveRef.current(item.event);
        }, () => { if (active) setError(true); }, {
          afterSequence: stateRef.current.sequence,
          onOpen: () => {
            if (!active) return;
            setError(false);
            void refreshSnapshot().catch(() => { if (active) setError(true); });
          },
        });
      } catch { if (active) setError(true); }
    })();
    return () => { active = false; unsubscribe(); };
  }, [sessionId, attempt, refreshSnapshot]);
  return { state: state?.snapshot.session.id === sessionId ? state : null, error, retry, refreshSnapshot };
}
