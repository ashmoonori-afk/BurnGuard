import type { Database } from "bun:sqlite";
import type {
  BackendDetectionResult,
  BackendId,
  RuntimeDiagnostics,
  RuntimeResumeResult,
} from "@bg/shared";
import type { RuntimeBackendDiagnostic } from "@bg/shared/runtime-diagnostics";
import { runtimeBackendProfiles } from "../adapters/registry";
import { ArtifactCoordinator, ArtifactOperationError } from "./artifact-coordinator";
import { readCodexModelCatalog, detectBackends } from "./backends";
import { isCanonicalTreeRootMissing } from "./canonical-tree-manifest";
import { indexProjectFiles } from "./managed-project-files";
import {
  listRecentRuntimeFailures,
  runtimeFailureForSession,
  type RuntimeSessionRow,
} from "./runtime-failure-diagnostics";

export { listRecentRuntimeFailures } from "./runtime-failure-diagnostics";

export class RuntimeRecoveryError extends Error {
  constructor(
    readonly code:
      | "project_not_found"
      | "project_directory_missing"
      | "runtime_resume_not_available"
      | "runtime_resume_busy"
      | "recovery_unavailable",
  ) {
    super(code);
    this.name = "RuntimeRecoveryError";
  }
}

export async function getRuntimeDiagnostics(db: Database): Promise<RuntimeDiagnostics> {
  const [detection, codexCatalog] = await Promise.all([
    detectBackends({ force: true, skipCodexAuthentication: true }),
    readCodexModelCatalog(),
  ]);
  return {
    checked_at: Date.now(),
    backends: buildRuntimeBackendDiagnostics(detection, codexCatalog.fetchedAt),
    recent_failures: listRecentRuntimeFailures(db, 8),
  };
}

export function buildRuntimeBackendDiagnostics(
  detection: BackendDetectionResult,
  codexFetchedAt: number | null,
): readonly RuntimeBackendDiagnostic[] {
  const byId = new Map(detection.backends.map((backend) => [backend.id, backend]));
  return runtimeBackendProfiles().map((profile) => {
    const detected = byId.get(profile.id);
    return {
      id: profile.id,
      cli: {
        status: detected?.found === true ? "detected" : "missing",
        version: detected?.version ?? null,
      },
      capabilities: profile.capabilities,
      prompt_transport: profile.promptTransport,
      model_catalog: modelCatalog(profile.id, codexFetchedAt),
    };
  });
}

export async function resumeProjectFromSavedFiles(
  db: Database,
  projectId: string,
): Promise<RuntimeResumeResult> {
  const project = db.query<{
    readonly id: string;
    readonly dir_path: string;
  }, [string]>("SELECT id,dir_path FROM projects WHERE id=?").get(projectId);
  if (project === null) throw new RuntimeRecoveryError("project_not_found");

  const session = db.query<RuntimeSessionRow, [string]>(`SELECT s.id,p.id project_id,p.name project_name,s.backend_id,s.status
    FROM sessions s JOIN projects p ON p.id=s.project_id
    WHERE s.project_id=? ORDER BY s.updated_at DESC,s.id DESC LIMIT 1`).get(projectId);
  if (session === null) throw new RuntimeRecoveryError("runtime_resume_not_available");
  const failure = runtimeFailureForSession(db, session);
  if (failure?.can_resume !== true) throw new RuntimeRecoveryError("runtime_resume_not_available");
  if (await isCanonicalTreeRootMissing(project.dir_path)) {
    throw new RuntimeRecoveryError("project_directory_missing");
  }
  const active = db.query<{ readonly id: string }, [string]>(`SELECT id FROM artifact_operations
    WHERE project_id=? AND status IN ('pending','working','recovering') LIMIT 1`).get(projectId);
  if (active !== null) throw new RuntimeRecoveryError("runtime_resume_busy");

  try {
    await new ArtifactCoordinator(db).observeExternal(projectId, project.dir_path);
    await indexProjectFiles(projectId);
  } catch (error) {
    if (error instanceof ArtifactOperationError) {
      if (error.code === "operation_conflict" || error.code === "external_changes_pending") {
        throw new RuntimeRecoveryError("runtime_resume_busy");
      }
      throw new RuntimeRecoveryError("recovery_unavailable");
    }
    throw error;
  }

  const artifact = db.query<{
    readonly current_revision: number;
    readonly current_digest: string | null;
  }, [string]>("SELECT current_revision,current_digest FROM projects WHERE id=?").get(projectId);
  if (artifact?.current_digest === null || artifact === null) {
    throw new RuntimeRecoveryError("recovery_unavailable");
  }
  return {
    project_id: projectId,
    session_id: session.id,
    status: "ready",
    artifact: {
      revision: artifact.current_revision,
      digest: artifact.current_digest,
    },
  };
}

function modelCatalog(
  backendId: BackendId,
  codexFetchedAt: number | null,
): RuntimeBackendDiagnostic["model_catalog"] {
  switch (backendId) {
    case "claude-code":
    case "gemini":
      return { source: "bundled", fetched_at: null };
    case "codex":
      return { source: "codex_cache", fetched_at: codexFetchedAt };
    case "copilot":
      return { source: "not_tracked", fetched_at: null };
    default: {
      const exhaustive: never = backendId;
      return exhaustive;
    }
  }
}
