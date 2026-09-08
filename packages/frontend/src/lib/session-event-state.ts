import type { NormalizedEvent, SequencedEventEnvelope, SessionInfo, SessionSnapshot } from "@bg/shared";

export interface SessionEventState {
  readonly snapshot: SessionSnapshot;
  readonly envelopes: readonly SequencedEventEnvelope[];
  readonly session: SessionInfo;
  readonly pending: SessionSnapshot["pending_permissions"];
  readonly sequence: number;
}

/** A durable snapshot already includes every status/usage event through its cursor. */
export function mergeSessionEvents(
  current: SessionEventState | null,
  incoming: readonly SequencedEventEnvelope[],
  snapshot: SessionSnapshot = current!.snapshot,
): SessionEventState {
  if (current && current.snapshot.session.id !== snapshot.session.id) current = null;
  if (current && snapshot.sequence < current.snapshot.sequence) snapshot = current.snapshot;
  const bySequence = new Map((current?.envelopes ?? []).map((item) => [item.sequence, item]));
  for (const item of incoming) {
    const previous = bySequence.get(item.sequence);
    if (previous && previous.event.id !== item.event.id) throw new Error("event_sequence_conflict");
    bySequence.set(item.sequence, item);
  }
  const envelopes = [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
  let session = snapshot.session;
  const pending = new Map(snapshot.pending_permissions.map((event) => [event.toolCallId, event]));
  for (const { sequence, event } of envelopes) {
    if (sequence <= snapshot.sequence) continue;
    session = applySessionEvent(session, event);
    switch (event.type) {
      case "tool.permission_required": pending.set(event.toolCallId, event); break;
      case "tool.permission_decided":
      case "tool.finished": pending.delete(event.toolCallId); break;
      case "status.running":
      case "status.error": pending.clear(); break;
      case "status.idle": if (event.stopReason !== "requires_action") pending.clear(); break;
    }
  }
  return { snapshot, envelopes, session, pending: [...pending.values()], sequence: Math.max(snapshot.sequence, envelopes.at(-1)?.sequence ?? 0) };
}

function applySessionEvent(current: SessionInfo, event: NormalizedEvent): SessionInfo {
  const timestamps = { updated_at: Math.max(current.updated_at, event.ts), last_active_at: Math.max(current.last_active_at, event.ts) };
  switch (event.type) {
    case "usage.delta": return { ...current, ...timestamps, usage: { ...current.usage, input: current.usage.input + event.input, output: current.usage.output + event.output, cached: current.usage.cached + (event.cached ?? 0) } };
    case "status.running": return { ...current, ...timestamps, status: "running" };
    case "status.idle": return { ...current, ...timestamps, status: "idle" };
    case "status.error": return { ...current, ...timestamps, status: "error" };
    default: return current;
  }
}
