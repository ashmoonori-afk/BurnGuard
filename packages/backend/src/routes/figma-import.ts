import { Hono, type Context } from "hono";
import { PathBoundaryError } from "../security/path-boundary";
import type { ApiErrorBody, ApiSuccess, CreateFigmaImportResponse, FigmaImportInspection } from "@bg/shared";
import {
  FigmaImportContractError,
  parseCreateFigmaApiImportRequest,
  parseFigmaNodeIds,
  parseInspectFigmaImportRequest,
} from "@bg/shared/figma-import";
import { getProjectDetail } from "../db/project-read-repository";
import { createAcquisitionBudget, AcquisitionLimitError, DEFAULT_ACQUISITION_LIMITS, ExtractionAcquisitionError } from "../services/extraction-acquisition";
import { ensureProjectDesignSystemPin, DesignSystemPinError } from "../services/project-design-system-pin";
import { FigmaApiError } from "../services/figma";
import { importFigmaApi, inspectFigmaApiImport } from "../services/figma-import-api";
import { importFigmaExport, parseFigmaImportDocument, type FigmaExportAsset } from "../services/figma-import";
import { FigmaImportError } from "../services/figma-import-errors";
import { indexProjectFiles } from "../services/managed-project-files";
import { projectsDir, resolveManagedPath } from "../lib/paths";

const IMPORT_TIMEOUT_MS = 30_000;

function ok<T>(data: T): ApiSuccess<T> {
  return { data };
}

function fail(code: string, message: string, details?: unknown): ApiErrorBody {
  return { error: { code, message, details } };
}

export const figmaImportRoutes = new Hono();

figmaImportRoutes.post("/api/projects/:id/figma/inspect", async (c) => {
  const project = await getProjectDetail(c.req.param("id"));
  if (project === null) return c.json(fail("project_not_found", "Project not found"), 404);
  try { resolveManagedPath(projectsDir, project.dir_path); }
  catch (error) {
    if (error instanceof PathBoundaryError) return c.json(fail("project_path_unavailable", "Project path is unavailable"), 409);
    throw error;
  }
  const body: unknown = await c.req.json().catch(() => null);
  try {
    const request = parseInspectFigmaImportRequest(body);
    const budget = createAcquisitionBudget(undefined, IMPORT_TIMEOUT_MS);
    try {
      return c.json(ok(await inspectFigmaApiImport({ source_url: request.source_url, signal: budget.signal }) satisfies FigmaImportInspection));
    } finally {
      budget.dispose();
    }
  } catch (error) {
    return figmaFailure(c, error);
  }
});

figmaImportRoutes.post("/api/projects/:id/figma/import", async (c) => {
  const project = await getProjectDetail(c.req.param("id"));
  if (project === null) return c.json(fail("project_not_found", "Project not found"), 404);
  try { resolveManagedPath(projectsDir, project.dir_path); }
  catch (error) {
    if (error instanceof PathBoundaryError) return c.json(fail("project_path_unavailable", "Project path is unavailable"), 409);
    throw error;
  }
  const budget = createAcquisitionBudget(undefined, IMPORT_TIMEOUT_MS);
  try {
    const pin = await ensureProjectDesignSystemPin(project.id);
    const contentType = c.req.header("content-type") ?? "";
    const result = contentType.startsWith("multipart/form-data")
      ? await importExportForm(await c.req.formData(), project.dir_path, pin?.tokens ?? "")
      : await importApiBody(await c.req.json<unknown>().catch(() => null), project.dir_path, pin?.tokens ?? "", budget.signal);
    await indexProjectFiles(project.id);
    return c.json(ok({
      manifest_path: result.manifest_path,
      imported_node_count: result.imported_node_count,
      imported_asset_count: result.imported_asset_count,
      token_mapping: { matched: result.matched_token_count, unmatched: result.unmatched_token_count },
    } satisfies CreateFigmaImportResponse), 201);
  } catch (error) {
    return figmaFailure(c, error);
  } finally {
    budget.dispose();
  }
});

async function importApiBody(body: unknown, projectDir: string, tokens: string, signal: AbortSignal) {
  const request = parseCreateFigmaApiImportRequest(body);
  return importFigmaApi({
    project_dir: projectDir,
    source_url: request.source_url,
    node_ids: request.node_ids,
    pinned_tokens_css: tokens,
    imported_at: new Date().toISOString(),
    signal,
  });
}

async function importExportForm(form: FormData, projectDir: string, tokens: string) {
  const allowed = new Set(["file_key", "node_ids", "document", "assets", "asset_paths"]);
  if ([...form.keys()].some((key) => !allowed.has(key))) throw new FigmaImportContractError("invalid_figma_request");
  const fileKey = form.get("file_key");
  const rawNodeIds = form.get("node_ids");
  const documentFile = form.get("document");
  const files = form.getAll("assets");
  const paths = form.getAll("asset_paths");
  if (
    typeof fileKey !== "string" ||
    !/^[A-Za-z0-9]{8,}$/u.test(fileKey) ||
    typeof rawNodeIds !== "string" ||
    !(documentFile instanceof File) ||
    documentFile.size > DEFAULT_ACQUISITION_LIMITS.figmaBodyBytes ||
    files.length !== paths.length
  ) throw new FigmaImportContractError("invalid_figma_request");
  let nodeIds: readonly string[];
  let documentJson: unknown;
  try {
    nodeIds = parseFigmaNodeIds(JSON.parse(rawNodeIds));
    documentJson = JSON.parse(await documentFile.text());
  } catch (error) {
    if (error instanceof FigmaImportContractError) throw error;
    throw new FigmaImportError("invalid_figma_export");
  }
  const assets: FigmaExportAsset[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const relativePath = paths[index];
    if (!(file instanceof File) || typeof relativePath !== "string") throw new FigmaImportContractError("invalid_figma_request");
    const mediaType = file.type === "image/png" || file.name.toLowerCase().endsWith(".png")
      ? "image/png" as const
      : file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")
        ? "image/svg+xml" as const
        : null;
    if (mediaType === null) throw new FigmaImportError("unsafe_figma_asset");
    assets.push({ relative_path: relativePath, bytes: new Uint8Array(await file.arrayBuffer()), media_type: mediaType });
  }
  return importFigmaExport({
    project_dir: projectDir,
    file_key: fileKey,
    document: parseFigmaImportDocument(documentJson),
    node_ids: nodeIds,
    assets,
    pinned_tokens_css: tokens,
    imported_at: new Date().toISOString(),
  });
}

function figmaFailure(c: Context, error: unknown): Response {
  if (error instanceof FigmaImportContractError) return c.json(fail(error.code, "Invalid Figma import request"), 400);
  if (error instanceof FigmaImportError) {
    const status = error.code === "figma_import_failed" ? 502 : 400;
    return c.json(fail(error.code, "Figma import could not be completed"), status);
  }
  if (error instanceof FigmaApiError) {
    switch (error.code) {
      case "missing_token": return c.json(fail("figma_token_missing", "Figma access is not configured"), 409);
      case "invalid_url": return c.json(fail("invalid_figma_url", "Figma URL is invalid"), 400);
      case "auth_failed": return c.json(fail("figma_auth_failed", "Figma access was rejected"), 409);
      case "not_found": return c.json(fail("figma_file_not_found", "Figma file was not found"), 404);
      case "rate_limited": return c.json(fail("figma_rate_limited", "Figma request limit was reached"), 429);
      case "fetch_failed": return c.json(fail("figma_fetch_failed", "Figma could not be reached"), 502);
    }
  }
  if (error instanceof AcquisitionLimitError) {
    return c.json(fail("figma_import_limit", "Figma import exceeded an acquisition limit", { limit: error.limit, maximum: error.maximum }), 413);
  }
  if (error instanceof ExtractionAcquisitionError) {
    return c.json(fail(error.code, "Figma import did not finish in time"), error.code === "acquisition_timeout" ? 408 : 409);
  }
  if (error instanceof DesignSystemPinError) return c.json(fail(error.code, "Pinned design system is unavailable"), 409);
  throw error;
}
