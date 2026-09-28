import type { Database } from "bun:sqlite";
import type { BackendId, NormalizedEvent } from "@bg/shared";
import type {
  RuntimeFailureCode,
  RuntimeFailureDiagnostic,
  RuntimeFailureStage,
} from "@bg/shared/runtime-diagnostics";
import { parsePersistedNormalizedEvent } from "../db/event-sequence-repository";

export type RuntimeSessionRow = {
  readonly id: string;
  readonly project_id: string;
  readonly project_name: string;
  readonly backend_id: BackendId;
  readonly status: "idle" | "running" | "awaiting_tool" | "error" | "terminated";
};

const RECENT_EVENT_LIMIT = 200;

/** One canonical ordering decides which session represents a project for diagnostics and resume. */
// Matches the project view's latest-session choice (updated_at), so "Open project" lands on the resumed session.
const LATEST_SESSION_ORDER = "updated_at DESC,id DESC";

export function latestProjectSession(db: Database, projectId: string): RuntimeSessionRow | null {
  return db.query<RuntimeSessionRow, [string]>(`SELECT s.id,p.id project_id,p.name project_name,s.backend_id,s.status
    FROM projects p JOIN sessions s ON s.id=(SELECT id FROM sessions WHERE project_id=p.id ORDER BY ${LATEST_SESSION_ORDER} LIMIT 1)
    WHERE p.id=?`).get(projectId);
}

export function listRecentRuntimeFailures(
  db: Database,
  limit: number,
): readonly RuntimeFailureDiagnostic[] {
  // SQL orders every project's latest session by its newest failure event and applies the limit,
  // so only bounded candidates are parsed; ties break deterministically on the session id.
  const sessions = db.query<RuntimeSessionRow, [number]>(`SELECT id,project_id,project_name,backend_id,status FROM (
      SELECT s.id,p.id project_id,p.name project_name,s.backend_id,s.status,
        (SELECT MAX(json_extract(e.payload_json,'$.ts')) FROM events e
          WHERE e.session_id=s.id AND e.direction='down'
            AND (e.type='status.error' OR (e.type='status.idle' AND json_extract(e.payload_json,'$.stopReason')='interrupted'))) failed_at
      FROM projects p JOIN sessions s ON s.id=(SELECT id FROM sessions WHERE project_id=p.id ORDER BY ${LATEST_SESSION_ORDER} LIMIT 1)
    ) WHERE failed_at IS NOT NULL ORDER BY failed_at DESC,id ASC LIMIT ?`).all(limit);
  return sessions
    .flatMap((session) => {
      const failure = runtimeFailureForSession(db, session);
      return failure === null ? [] : [failure];
    })
    .sort((left, right) => right.failed_at - left.failed_at || left.session_id.localeCompare(right.session_id));
}

export function runtimeFailureForSession(
  db: Database,
  session: RuntimeSessionRow,
): RuntimeFailureDiagnostic | null {
  const events = recentSessionEvents(db, session.id);
  let latestTerminalIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === "status.idle") {
      latestTerminalIndex = index;
      break;
    }
  }
  const latestTerminal = latestTerminalIndex < 0 ? undefined : events[latestTerminalIndex];
  const canResume = latestTerminal?.type === "status.idle"
    && (latestTerminal.stopReason === "error" || latestTerminal.stopReason === "interrupted")
    && session.status !== "running"
    && session.status !== "awaiting_tool";

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "status.idle" && event.stopReason === "interrupted") {
      return failureDiagnostic(session, events, index, event.ts, "interrupted", canResume);
    }
    if (event?.type === "status.error") {
      return failureDiagnostic(session, events, index, event.ts, event.code ?? "turn_failed", canResume);
    }
  }
  return null;
}

function recentSessionEvents(db: Database, sessionId: string): readonly NormalizedEvent[] {
  const rows = db.query<{
    readonly id: string;
    readonly payload_json: string;
  }, [string, number]>(`SELECT id,payload_json FROM events
    WHERE session_id=? AND direction='down'
    ORDER BY sequence DESC LIMIT ?`).all(sessionId, RECENT_EVENT_LIMIT);
  return rows.reverse().map((row) => parsePersistedNormalizedEvent(row.payload_json, row.id));
}

function failureDiagnostic(
  session: RuntimeSessionRow,
  events: readonly NormalizedEvent[],
  eventIndex: number,
  failedAt: number,
  code: RuntimeFailureCode,
  canResume: boolean,
): RuntimeFailureDiagnostic {
  return {
    project_id: session.project_id,
    project_name: session.project_name,
    session_id: session.id,
    backend_id: session.backend_id,
    turn_id: nearestTurnId(events, eventIndex),
    failed_at: failedAt,
    stage: failureStage(code),
    code,
    can_resume: canResume,
  };
}

function nearestTurnId(events: readonly NormalizedEvent[], before: number): string | null {
  for (let index = before; index >= 0; index -= 1) {
    const event = events[index];
    if (event !== undefined && "turnId" in event) return event.turnId;
  }
  return null;
}

function failureStage(code: RuntimeFailureCode): RuntimeFailureStage {
  if (code === "interrupted") return "generation";
  switch (code) {
    case "graphic_requires_authenticated_codex":
    case "logo_requires_authenticated_codex":
    case "commandcode_unavailable":
    case "unsupported_generation_model_effort":
    case "backend_unavailable":
      return "preflight";
    case "agent_control_files_present":
    case "path_unavailable":
    case "immutable_reference_path_unavailable":
    case "private_input_unavailable":
    case "deck_source_page_limit":
      return "input";
    case "logo_deliverables_missing":
    case "logo_image_provenance_missing":
    case "design_review_failed":
    case "immutable_reference_mutated":
    case "immutable_reference_escaped":
      return "review";
    case "publication_failed":
    case "operation_conflict":
    case "operation_cancelled":
      return "publication";
    case "graphic_starter_unchanged":
    case "turn_failed":
      return "generation";
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}
