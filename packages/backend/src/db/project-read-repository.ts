import type { BackendId } from "@bg/shared";
import type { ProjectDetail, SessionInfo } from "@bg/shared";
import { getSqlite } from "./sqlite-client";

type ProjectRow = ProjectDetail;
type SessionRow = {
  readonly id: string; readonly project_id: string; readonly backend_id: BackendId;
  readonly status: "idle" | "running" | "awaiting_tool" | "error" | "terminated";
  readonly updated_at: number; readonly last_active_at: number; readonly input: number;
  readonly output: number; readonly cached: number; readonly cache_write: number;
};

export async function getProjectDetail(projectId: string): Promise<ProjectDetail | null> {
  return getSqlite().query<ProjectRow, [string]>(`SELECT p.id,p.name,p.type,p.design_system_id,d.name design_system_name,
    p.thumbnail_path,p.updated_at,p.archived_at,p.dir_path,p.entrypoint,p.backend_id,p.options_json,p.current_revision,p.current_digest
    FROM projects p LEFT JOIN design_systems d ON d.id=p.design_system_id WHERE p.id=?`).get(projectId);
}

export async function listProjectIds(): Promise<readonly string[]> {
  return getSqlite().query<{ readonly id: string }, []>("SELECT id FROM projects ORDER BY id").all().map((row) => row.id);
}

export async function getLatestProjectSession(projectId: string): Promise<SessionInfo | null> {
  const row = getSqlite().query<SessionRow, [string]>(`${SESSION_SELECT} WHERE project_id=? ORDER BY updated_at DESC LIMIT 1`).get(projectId);
  return row === null ? null : sessionInfo(row);
}

function sessionInfo(row: SessionRow): SessionInfo {
  return {
    id: row.id, project_id: row.project_id, backend_id: row.backend_id, status: row.status,
    usage: { input: row.input, output: row.output, cached: row.cached, cache_write: row.cache_write },
    updated_at: row.updated_at, last_active_at: row.last_active_at,
  };
}

const SESSION_SELECT = `SELECT id,project_id,backend_id,status,updated_at,last_active_at,
  usage_input_tokens input,usage_output_tokens output,usage_cache_read cached,usage_cache_write cache_write FROM sessions`;
