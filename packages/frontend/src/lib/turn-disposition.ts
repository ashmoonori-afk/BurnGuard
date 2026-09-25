import type { NormalizedEvent, TurnNotApplied, TurnRejectionReason } from "@bg/shared";

/**
 * Where a turn's work stands with respect to the project.
 *
 * The backend buffers a turn's terminal events until its operation has committed, so
 * `chat.message_end` is the only evidence on the stream that what was streamed actually reached
 * the project. Everything before it is generated text under validation, and the UI says so rather
 * than letting the last streamed bubble look saved.
 *
 * - `pending`     generated, still being checked; nothing is in the project yet
 * - `committed`   the turn published; what was streamed is what the project now holds
 * - `not_applied` the turn was refused and the server states nothing it produced was published
 * - `rejected`    the turn failed without that statement; the UI claims nothing about the tree
 * - `stopped`     the user interrupted; the partial work the turn had reached was kept
 */
export const TURN_DISPOSITIONS = ["pending", "committed", "not_applied", "rejected", "stopped"] as const;

export type TurnDisposition = (typeof TURN_DISPOSITIONS)[number];

export interface TurnState {
  readonly turnId: string;
  readonly disposition: TurnDisposition;
  /** Which contract the finished work broke, when the server named one. */
  readonly reason?: TurnRejectionReason;
  /** Present only when the server itself stated the turn published nothing. */
  readonly notApplied?: TurnNotApplied;
}

type MutableTurnState = {
  turnId: string;
  disposition: TurnDisposition;
  reason?: TurnRejectionReason;
  notApplied?: TurnNotApplied;
};

/**
 * Projects the session's events onto one standing per turn.
 *
 * The projection is a fold over the durable event list, so a reloaded conversation and a live
 * stream of the same events produce the same standings. A refusal that carries `notApplied` is
 * attached to the turn id the server named - never to whichever turn happens to be last - and a
 * terminal that carries no turn id belongs to the turn that was open when it arrived.
 */
export function projectTurnStates(events: readonly NormalizedEvent[]): ReadonlyMap<string, TurnState> {
  const states = new Map<string, MutableTurnState>();
  const userTurns = new Set(events.flatMap((event) => event.type === "chat.user_message" ? [event.turnId] : []));
  const childParents = new Map<string, string>();
  let open: string | null = null;

  const parents = new Map<string, string>();
  const parentOf = (turnId: string): string => {
    // A user-message id is authoritative even if it happens to resemble a generated repair or
    // deck review id.
    if (userTurns.has(turnId)) return turnId;
    // A child id is its parent plus exactly one generated suffix, so one strip and one lookup decide it; the
    // projection re-runs on every streamed event, so the answer is cached per id.
    let parent = parents.get(turnId);
    if (parent === undefined) {
      const prefix = turnId.replace(/-(?:review|logo-repair|design-repair-[1-9]\d*)$/u, "");
      parent = prefix !== turnId && userTurns.has(prefix) ? prefix : turnId;
      parents.set(turnId, parent);
    }
    if (parent !== turnId) childParents.set(turnId, parent);
    return parent;
  };

  const track = (turnId: string): MutableTurnState => {
    const existing = states.get(turnId);
    if (existing) return existing;
    const created: MutableTurnState = { turnId, disposition: "pending" };
    states.set(turnId, created);
    return created;
  };

  for (const event of events) {
    switch (event.type) {
      case "chat.user_message":
      case "chat.delta":
      case "chat.thinking":
      case "tool.started":
      case "tool.finished":
      case "tool.permission_required":
      case "file.changed":
        track(event.turnId);
        open = parentOf(event.turnId);
        break;
      case "chat.message_end": {
        const parent = parentOf(event.turnId);
        const state = track(event.turnId);
        // Only the enclosing user turn's terminal proves publication. Repair and deck review
        // terminals are suppressed or buffered by the backend and cannot commit their own bubble.
        if (parent === event.turnId && state.disposition === "pending") state.disposition = "committed";
        open = parent;
        break;
      }
      case "status.error": {
        if (event.notApplied) {
          const state = track(event.notApplied.turnId);
          state.disposition = "not_applied";
          state.notApplied = event.notApplied;
          if (event.reason !== undefined) state.reason = event.reason;
          break;
        }
        if (open === null) break;
        const state = track(open);
        if (state.disposition === "pending") state.disposition = "rejected";
        if (event.reason !== undefined) state.reason = event.reason;
        break;
      }
      case "status.idle": {
        if (open !== null && event.stopReason === "interrupted") {
          const state = track(open);
          if (state.disposition === "pending") state.disposition = "stopped";
        }
        // A turn awaiting a permission decision is still the open turn.
        if (event.stopReason !== "requires_action") open = null;
        break;
      }
      default:
        break;
    }
  }

  // Repair and deck review output is part of its enclosing user turn. It remains pending while the
  // parent is pending, then receives that parent's authoritative publication result (including
  // notApplied).
  for (const [childId, parentId] of childParents) {
    const child = states.get(childId);
    const parent = states.get(parentId);
    if (child === undefined || parent === undefined || parent.disposition === "pending") continue;
    child.disposition = parent.disposition;
    child.reason = parent.reason;
    child.notApplied = parent.notApplied;
  }

  return new Map([...states].map(([turnId, state]) => [turnId, { ...state }]));
}
