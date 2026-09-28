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
  latestProjectSession,
  listRecentRuntimeFailures,
  runtimeFailureForSession,
} from "./runtime-failure-diagnostics";
import { holdSessionsForRecovery } from "./turns";
import { projectsDir, resolveManagedPath } from "../lib/paths";
import { PathBoundaryError } from "../security/path-boundary";

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

/**
 * Adopts the saved on-disk tree for the exact session diagnostics advertised. Every session of the
 * project holds a turn reservation for the whole recovery, so no turn can start meanwhile, and the
 * eligibility checks are repeated under the artifact project lock right before adoption. The
 * adopt-only coordinator path refuses active operations instead of restoring the baseline.
 */
export async function resumeProjectFromSavedFiles(
  db: Database,
  projectId: string,
  sessionId: string,
): Promise<RuntimeResumeResult> {
  const project = db.query<{
    readonly id: string;
    readonly dir_path: string;
  }, [string]>("SELECT id,dir_path FROM projects WHERE id=?").get(projectId);
  if (project === null) throw new RuntimeRecoveryError("project_not_found");
  let projectRoot: string;
  try { projectRoot = resolveManagedPath(projectsDir, project.dir_path); }
  catch (error) {
    if (error instanceof PathBoundaryError) throw new RuntimeRecoveryError("recovery_unavailable");
    throw error;
  }
  assertResumable(db, projectId, sessionId);

  const releaseHold = holdProjectSessions(db, projectId);
  try {
    if (await isCanonicalTreeRootMissing(projectRoot)) {
      throw new RuntimeRecoveryError("project_directory_missing");
    }
    await new ArtifactCoordinator(db).adoptExternal(projectId, projectRoot, () => {
      assertResumable(db, projectId, sessionId);
      const active = db.query<{ readonly id: string }, [string]>(`SELECT id FROM artifact_operations
        WHERE project_id=? AND status IN ('pending','working','recovering') LIMIT 1`).get(projectId);
      if (active !== null) throw new RuntimeRecoveryError("runtime_resume_busy");
    });
    await indexProjectFiles(projectId);
  } catch (error) {
    if (error instanceof ArtifactOperationError) {
      if (error.code === "operation_conflict" || error.code === "external_changes_pending") {
        throw new RuntimeRecoveryError("runtime_resume_busy");
      }
      throw new RuntimeRecoveryError("recovery_unavailable");
    }
    throw error;
  } finally {
    releaseHold();
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
    session_id: sessionId,
    status: "ready",
    artifact: {
      revision: artifact.current_revision,
      digest: artifact.current_digest,
    },
  };
}

function assertResumable(db: Database, projectId: string, sessionId: string): void {
  const session = latestProjectSession(db, projectId);
  if (session === null || session.id !== sessionId) throw new RuntimeRecoveryError("runtime_resume_not_available");
  if (runtimeFailureForSession(db, session)?.can_resume !== true) {
    throw new RuntimeRecoveryError("runtime_resume_not_available");
  }
}

function holdProjectSessions(db: Database, projectId: string): () => void {
  const sessionIds = db.query<{ readonly id: string }, [string]>("SELECT id FROM sessions WHERE project_id=? ORDER BY id")
    .all(projectId)
    .map((row) => row.id);
  const release = holdSessionsForRecovery(sessionIds);
  if (release === null) throw new RuntimeRecoveryError("runtime_resume_busy");
  return release;
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
