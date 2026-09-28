import { Hono } from "hono";
import {
  parseCreateVisualAlternativesRequest,
  UpgradeContractError,
  type ApiErrorBody,
  type ApiSuccess,
  type CreateVisualAlternativesRequest,
} from "@bg/shared";
import { loadConfig } from "../config";
import { getSqlite } from "../db/sqlite-client";
import { projectsDir, resolveManagedPath } from "../lib/paths";
import { PathBoundaryError } from "../security/path-boundary";
import {
  getLatestProjectSession,
  getProjectDetail,
} from "../db/project-read-repository";
import { ArtifactOperationError } from "../services/artifact-coordinator";
import {
  VisualAlternativeService,
  VisualAlternativeServiceError,
} from "../services/visual-alternatives";
import { VisualAlternativeStorageError } from "../services/visual-alternative-storage";
import { isUserTurnRunning } from "../services/turns";

type AlternativeService = Pick<
  VisualAlternativeService,
  "cancel" | "delete" | "generate" | "list" | "promote"
>;

let service: AlternativeService = new VisualAlternativeService(getSqlite());

export function replaceVisualAlternativeServiceForTest(
  replacement: AlternativeService,
): () => void {
  const previous = service;
  service = replacement;
  return () => {
    if (service === replacement) service = previous;
  };
}

function ok<T>(data: T): ApiSuccess<T> {
  return { data };
}
function fail(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}
function managedProjectDir(dirPath: string): string | null {
  try {
    return resolveManagedPath(projectsDir, dirPath);
  } catch (error) {
    if (error instanceof PathBoundaryError) return null;
    throw error;
  }
}
function pathUnavailable(): ApiErrorBody {
  return fail("project_path_unavailable", "Project directory is outside managed storage");
}
function isIdentity(
  value: unknown,
): value is {
  readonly expected_revision: number;
  readonly expected_artifact_digest: string;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return (
    Object.keys(record).every((key) =>
      key === "expected_revision" || key === "expected_artifact_digest"
    ) &&
    typeof record["expected_revision"] === "number" &&
    Number.isSafeInteger(record["expected_revision"]) &&
    record["expected_revision"] >= 0 &&
    typeof record["expected_artifact_digest"] === "string" &&
    /^[a-f0-9]{64}$/.test(record["expected_artifact_digest"])
  );
}

export const visualAlternativeRoutes = new Hono();

visualAlternativeRoutes.get("/api/projects/:id/alternatives", async (c) => {
  const projectId = c.req.param("id");
  if (await getProjectDetail(projectId) === null) {
    return c.json(fail("project_not_found", "Project not found"), 404);
  }
  return c.json(ok(service.list(projectId)));
});

visualAlternativeRoutes.post(
  "/api/projects/:id/alternatives/generate",
  async (c) => {
    const projectId = c.req.param("id");
    const [project, session] = await Promise.all([
      getProjectDetail(projectId),
      getLatestProjectSession(projectId),
    ]);
    if (project === null || session === null) {
      return c.json(fail("project_session_not_found", "Project or session not found"), 404);
    }
    if (session.status === "running" || isUserTurnRunning(session.id)) {
      return c.json(fail("session_busy", "A turn is already running"), 409);
    }
    let request: CreateVisualAlternativesRequest;
    try {
      request = parseCreateVisualAlternativesRequest(
        await c.req.json<unknown>().catch(() => null),
      );
    } catch (error) {
      if (error instanceof UpgradeContractError) {
        return c.json(fail("invalid_alternatives", "Expected two to four named alternatives"), 400);
      }
      throw error;
    }
    const projectDir = managedProjectDir(project.dir_path);
    if (projectDir === null) return c.json(pathUnavailable(), 503);
    const config = await loadConfig();
    try {
      const started = await service.generate({
        projectId,
        sessionId: session.id,
        projectDir,
        entrypoint: project.entrypoint,
        maxConcurrentTurns: config.harness.maxConcurrentSessions,
        request,
      });
      return c.json(ok(await started.completion), 201);
    } catch (error) {
      if (error instanceof VisualAlternativeServiceError) {
        return c.json(
          fail(error.code, "Alternative generation could not start"),
          error.code === "capacity_exhausted" ? 429 : 409,
        );
      }
      throw error;
    }
  },
);

visualAlternativeRoutes.post(
  "/api/projects/:id/alternatives/cancel",
  async (c) => {
    const projectId = c.req.param("id");
    if (await getProjectDetail(projectId) === null) {
      return c.json(fail("project_not_found", "Project not found"), 404);
    }
    const outcome = await service.cancel(projectId);
    if (outcome === "not_active") {
      return c.json(fail("operation_not_active", "No alternative generation is active"), 409);
    }
    if (outcome === "recovery_pending") {
      return c.json(fail("alternatives_recovery_pending", "The original design could not be restored yet"), 409);
    }
    return c.json(ok({ cancelled: true }), 202);
  },
);

visualAlternativeRoutes.post(
  "/api/projects/:id/alternatives/:alternativeId/promote",
  async (c) => {
    const projectId = c.req.param("id");
    const project = await getProjectDetail(projectId);
    if (project === null) {
      return c.json(fail("project_not_found", "Project not found"), 404);
    }
    const projectDir = managedProjectDir(project.dir_path);
    if (projectDir === null) return c.json(pathUnavailable(), 503);
    const body: unknown = await c.req.json().catch(() => null);
    if (!isIdentity(body)) {
      return c.json(fail("invalid_artifact_identity", "Expected artifact identity is required"), 400);
    }
    try {
      const promoted = await service.promote({
        projectId,
        projectDir,
        alternativeId: c.req.param("alternativeId"),
        expectedRevision: body.expected_revision,
        expectedDigest: body.expected_artifact_digest,
      });
      return c.json(ok({
        operation_id: promoted.operationId,
        result_revision: promoted.resultRevision,
        result_digest: promoted.resultDigest,
      }));
    } catch (error) {
      if (error instanceof VisualAlternativeServiceError) {
        return c.json(
          fail(error.code, "Alternative could not be promoted"),
          error.code === "alternative_not_found" ? 404 : 409,
        );
      }
      if (error instanceof VisualAlternativeStorageError) {
        return c.json(fail(error.code, "Alternative bytes are unavailable"), 409);
      }
      if (error instanceof ArtifactOperationError) {
        return c.json(fail(error.code, "Artifact changed; reload and retry"), 409);
      }
      throw error;
    }
  },
);

visualAlternativeRoutes.delete(
  "/api/projects/:id/alternatives/:alternativeId",
  async (c) => {
    try {
      service.delete(c.req.param("id"), c.req.param("alternativeId"));
      return c.body(null, 204);
    } catch (error) {
      if (error instanceof VisualAlternativeServiceError) {
        return c.json(
          fail(error.code, "Alternative could not be deleted"),
          error.code === "alternative_not_found" ? 404 : 409,
        );
      }
      throw error;
    }
  },
);
