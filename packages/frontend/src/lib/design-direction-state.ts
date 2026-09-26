import type { DesignDirectionState, NormalizedEvent } from "@bg/shared";

/**
 * Ordering and action availability for the design-direction workflow.
 *
 * The backend is the single writer: every snapshot is published as a
 * `design.direction_state` event AND returned from the mutation that caused
 * it, so the frontend sees the same state through two channels that can
 * arrive in any order. These helpers decide which snapshot is newer without
 * timers, polling, or arrival-order guesses.
 */

export type DirectionActions = {
  readonly canGenerate: boolean;
  readonly canCancel: boolean;
  readonly canRetry: boolean;
  readonly canSelect: boolean;
  readonly canUndo: boolean;
};

export type DirectionProgress = { readonly resolved: number; readonly total: number };

/**
 * `updated_at` comes from the backend clock and never moves backwards;
 * `selection_revision` breaks ties for select/undo pairs that land inside the
 * same millisecond (both keep the same `updated_at` granularity).
 */
function isNewer(candidate: DesignDirectionState, incumbent: DesignDirectionState): boolean {
  if (candidate.updated_at !== incumbent.updated_at) {
    return candidate.updated_at > incumbent.updated_at;
  }
  return candidate.selection_revision > incumbent.selection_revision;
}

/** Newest direction snapshot carried by an unordered event batch (replay or live). */
export function latestDirectionState(
  events: readonly NormalizedEvent[],
): DesignDirectionState | null {
  let latest: DesignDirectionState | null = null;
  for (const event of events) {
    if (event.type !== "design.direction_state") continue;
    if (latest === null || isNewer(event.state, latest)) latest = event.state;
  }
  return latest;
}

/** Cache merge for the GET/mutation channel against whatever SSE already wrote. */
export function preferDirectionState(
  current: DesignDirectionState | null,
  incoming: DesignDirectionState | null,
): DesignDirectionState | null {
  if (incoming === null) return current;
  if (current === null) return incoming;
  return isNewer(incoming, current) ? incoming : current;
}

/** Real slot progress — never a synthetic percentage. */
export function directionProgress(state: DesignDirectionState): DirectionProgress {
  return {
    resolved: state.directions.filter((slot) => slot.status !== "pending").length,
    total: state.directions.length,
  };
}

/** Regeneration replaces the previews a selection was made against, so a selected state asks once before generating. */
export function regenerateActivation(selectedId: string | null, confirming: boolean): "confirm" | "generate" {
  return selectedId !== null && !confirming ? "confirm" : "generate";
}

export function directionActions(state: DesignDirectionState | null): DirectionActions {
  if (state === null) {
    return { canGenerate: true, canCancel: false, canRetry: false, canSelect: false, canUndo: false };
  }
  switch (state.status) {
    case "loading":
      // Selection and undo stay closed while the renderer owns the snapshot:
      // its next publish is built from the pre-selection state it captured.
      return { canGenerate: false, canCancel: true, canRetry: false, canSelect: false, canUndo: false };
    case "ready":
    case "partial":
    case "failed":
    case "cancelled":
      return {
        canGenerate: true,
        canCancel: false,
        canRetry: state.directions.some((slot) => slot.status === "failed" || slot.status === "cancelled"),
        canSelect: state.directions.some((slot) => slot.status === "ready"),
        canUndo: state.selection_history.length > 0,
      };
    default: {
      const unreachable: never = state.status;
      return unreachable;
    }
  }
}
