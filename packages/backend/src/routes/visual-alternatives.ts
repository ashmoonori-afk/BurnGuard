import { Hono } from "hono";
import {
  parseCreateVisualAlternativesRequest,
  UpgradeContractError,
  type ApiErrorBody,
  type ApiSuccess,
  type CreateVisualAlternativesRequest,
} from "@bg/shared";
import { getSqlite } from "../db/sqlite-client";
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
  "delete" | "generate" | "list" | "promote"
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
    try {
      const started = await service.generate({
        projectId,
        sessionId: session.id,
        projectDir: project.dir_path,
        entrypoint: project.entrypoint,
        request,
      });
      return c.json(ok(await started.completion), 201);
    } catch (error) {
      if (error instanceof VisualAlternativeServiceError) {
        return c.json(fail(error.code, "Alternative generation could not start"), 409);
      }
      throw error;
    }
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
    const body: unknown = await c.req.json().catch(() => null);
    if (!isIdentity(body)) {
      return c.json(fail("invalid_artifact_identity", "Expected artifact identity is required"), 400);
    }
    try {
      const promoted = await service.promote({
        projectId,
        projectDir: project.dir_path,
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
