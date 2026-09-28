import { Hono, type Context } from "hono";
import {
  FigmaImportContractError,
  type CreateFigmaImportResponse,
} from "@bg/shared/figma-import";
import type { ApiErrorBody, ApiSuccess } from "@bg/shared";
import { getLatestProjectSession, getProjectDetail } from "../db/project-read-repository";
import { isUserTurnRunning } from "../services/turns";
import { getSqlite } from "../db/sqlite-client";
import {
  AcquisitionLimitError,
  createAcquisitionBudget,
  ExtractionAcquisitionError,
  throwIfAcquisitionAborted,
} from "../services/extraction-acquisition";
import {
  DesignSystemPinError,
  ensureProjectDesignSystemPin,
} from "../services/project-design-system-pin";
import {
  stageFigmaExport,
  type FigmaImportResult,
} from "../services/figma-import";
import { FigmaImportError } from "../services/figma-import-errors";
import {
  ArtifactCoordinator,
  ArtifactOperationError,
} from "../services/artifact-coordinator";
import { PathBoundaryError } from "../security/path-boundary";
import { projectsDir, resolveManagedPath } from "../lib/paths";
import { parseFigmaExportForm } from "./figma-import-form";

const IMPORT_TIMEOUT_MS = 30_000;

function ok<T>(data: T): ApiSuccess<T> {
  return { data };
}

function fail(code: string, message: string, details?: unknown): ApiErrorBody {
  return { error: { code, message, details } };
}

export const figmaImportRoutes = new Hono();

figmaImportRoutes.post("/api/projects/:id/figma/import", async (c) => {
  const project = await getProjectDetail(c.req.param("id"));
  if (project === null) {
    return c.json(fail("project_not_found", "Project not found"), 404);
  }
  let projectRoot: string;
  try {
    projectRoot = resolveManagedPath(projectsDir, project.dir_path);
  } catch (error) {
    if (error instanceof PathBoundaryError) {
      return c.json(
        fail("project_path_unavailable", "Project path is unavailable"),
        409,
      );
    }
    throw error;
  }
  const session = await getLatestProjectSession(project.id);
  if (session && (session.status === "running" || isUserTurnRunning(session.id))) {
    return c.json(fail("session_busy", "Cannot import while a turn is running"), 409);
  }
  if (!(c.req.header("content-type") ?? "").startsWith("multipart/form-data")) {
    return c.json(
      fail("invalid_figma_request", "Invalid Figma import request"),
      415,
    );
  }
  const budget = createAcquisitionBudget(
    c.req.raw.signal,
    IMPORT_TIMEOUT_MS,
  );
  try {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch (error) {
      if (budget.signal.aborted) throw error;
      throw new FigmaImportContractError("invalid_figma_request");
    }
    const prepared = await parseFigmaExportForm(form, budget.signal);
    const pin = await ensureProjectDesignSystemPin(project.id);
    throwIfAcquisitionAborted(budget.signal);
    const coordinator = new ArtifactCoordinator(getSqlite());
    await coordinator.initialize(project.id, projectRoot);
    const current = await getProjectDetail(project.id);
    if (current === null || current.current_digest === null) {
      throw new ArtifactOperationError(
        "artifact_identity_mismatch",
        "Artifact identity is unavailable",
      );
    }
    if (
      prepared.expectedRevision !== current.current_revision ||
      prepared.expectedDigest !== current.current_digest
    ) {
      throw new ArtifactOperationError(
        "stale_artifact_identity",
        "Expected artifact identity is stale",
      );
    }
    const stagedResults: FigmaImportResult[] = [];
    const operation = await coordinator.run({
      projectId: project.id,
      projectDir: projectRoot,
      kind: "figma_import",
      expectedRevision: prepared.expectedRevision,
      expectedArtifactDigest: prepared.expectedDigest,
      signal: budget.signal,
      mutate: async (stageDir) => {
        stagedResults.push(await stageFigmaExport({
          stage_dir: stageDir,
          source_file_name: prepared.sourceFileName,
          document: prepared.document,
          node_ids: prepared.nodeIds,
          assets: prepared.assets,
          pinned_tokens_css: pin?.tokens ?? "",
          imported_at: new Date().toISOString(),
          signal: budget.signal,
        }));
      },
    });
    const result = stagedResults[0];
    if (result === undefined || operation.status !== "committed") {
      throw new ArtifactOperationError(
        "operation_failed",
        "Figma import did not commit",
      );
    }
    return c.json(ok({
      manifest_path: result.manifest_path,
      imported_node_count: result.imported_node_count,
      imported_asset_count: result.imported_asset_count,
      token_mapping: {
        matched: result.matched_token_count,
        unmatched: result.unmatched_token_count,
      },
    } satisfies CreateFigmaImportResponse), 201);
  } catch (error) {
    return figmaFailure(c, error);
  } finally {
    budget.dispose();
  }
});

function figmaFailure(c: Context, error: unknown): Response {
  if (error instanceof FigmaImportContractError) {
    return c.json(fail(error.code, "Invalid Figma import request"), 400);
  }
  if (error instanceof FigmaImportError) {
    return c.json(
      fail(error.code, "Figma import could not be completed"),
      400,
    );
  }
  if (error instanceof AcquisitionLimitError) {
    return c.json(
      fail("figma_import_limit", "Figma import exceeded an acquisition limit", {
        limit: error.limit,
        maximum: error.maximum,
      }),
      413,
    );
  }
  if (error instanceof ExtractionAcquisitionError) {
    return c.json(
      fail(error.code, "Figma import did not finish in time"),
      error.code === "acquisition_timeout" ? 408 : 409,
    );
  }
  if (error instanceof ArtifactOperationError) {
    return c.json(
      fail(error.code, "Figma import conflicted with project changes"),
      409,
    );
  }
  if (error instanceof DesignSystemPinError) {
    return c.json(fail(error.code, "Pinned design system is unavailable"), 409);
  }
  throw error;
}
