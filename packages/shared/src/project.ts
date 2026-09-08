import type { BackendId } from "./app";
import type { ProjectSummary } from "./home";
import type { SessionStatus } from "./harness";
import type { NormalizedEvent } from "./events";

export interface ProjectDetail extends ProjectSummary {
  dir_path: string;
  entrypoint: string;
  backend_id: BackendId;
  options_json: string | null;
  current_revision: number;
  current_digest: string | null;
}

export interface SessionInfo {
  id: string;
  project_id: string;
  backend_id: BackendId;
  status: SessionStatus;
  usage: {
    input: number;
    output: number;
    cached: number;
    cache_write: number;
  };
  updated_at: number;
  last_active_at: number;
}

/** Session state and its durable event cursor are read in one transaction. */
export interface SessionSnapshot {
  readonly session: SessionInfo;
  readonly sequence: number;
  readonly pending_permissions: readonly Extract<NormalizedEvent, { type: "tool.permission_required" }>[];
}
