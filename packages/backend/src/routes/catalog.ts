import { stat } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ApiErrorBody, ApiSuccess, DesignSystemPreview } from "@bg/shared";
import { getSqlite } from "../db/sqlite-client";
import { CatalogRepositoryError, getCatalogRow, getCatalogTags, getCatalogUsage, updateCatalogMetadata } from "../db/catalog-repository";
import { systemsDir } from "../lib/paths";
import { CatalogFileError, catalogPaths, inspectCatalogTree } from "../services/catalog-files";
import { assertSafeName, resolveWithin } from "../security/path-boundary";
import {
  CatalogLifecycleError, copyCatalogSystem, purgeCatalogSystem, restoreCatalogSystem, trashCatalogSystem,
} from "../services/catalog-lifecycle";
import { CatalogQueryError, parseCatalogQuery } from "../services/catalog-query";
import { getCatalogSystem, listCatalogSystems } from "../services/catalog-service";
import { CatalogInputError, parseChildRequest, parseEmptyBody, parseMetadataPatch } from "./catalog-input";

function ok<T>(data: T, meta?: { readonly total: number; readonly limit: number; readonly offset: number }): ApiSuccess<T> {
  return meta === undefined ? { data } : { data, meta };
}
function fail(code: string, message: string, details?: unknown): ApiErrorBody {
  return { error: { code, message, details } };
}

export const catalogRoutes = new Hono();

catalogRoutes.get("/api/design-systems/:id/previews", async (c) => {
  try {
    const id = c.req.param("id");
    const row = getCatalogRow(getSqlite(), id);
    if (row === null || row.lifecycle === "trashed") return c.json(fail("design_system_not_found", "Design system not found"), 404);
    const paths = await catalogPaths(systemsDir, id, row.dirPath);
    const tree = await inspectCatalogTree(paths.live);
    const previews: DesignSystemPreview[] = tree.files.filter((file) => /^preview\/[^/]+\.html?$/i.test(file)).map((file) => ({ path: file }));
    return c.json(ok(previews));
  } catch (error) { return catalogError(c, error); }
});

catalogRoutes.get("/api/design-systems", async (c) => {
  try {
    const query = parseCatalogQuery(c.req.url);
    const result = await listCatalogSystems(getSqlite(), systemsDir, query);
    return c.json(ok(result.items, { total: result.total, limit: query.limit, offset: query.offset }));
  } catch (error) {
    return catalogError(c, error);
  }
});

catalogRoutes.get("/api/design-systems/:id/files/*", async (c) => {
  const id = c.req.param("id");
  const prefix = `/api/design-systems/${id}/files/`;
  let relPath = "";
  try {
    const row = getCatalogRow(getSqlite(), id);
    if (row === null || row.lifecycle === "trashed") return c.json(fail("design_system_file_not_found", "Design system file not found"), 404);
    const rawPath = new URL(c.req.url).pathname;
    relPath = rawPath.startsWith(prefix) ? decodeURIComponent(rawPath.slice(prefix.length)) : "";
    const paths = await catalogPaths(systemsDir, id, row.dirPath);
    const candidate = resolveWithin(paths.live, ...relPath.replaceAll("\\", "/").split("/").map(assertSafeName));
    if (!(await stat(candidate)).isFile()) return c.json(fail("design_system_file_not_found", "Design system file not found"), 404);
    return new Response(Bun.file(candidate), { headers: { "Content-Type": catalogContentType(relPath), "Cache-Control": "no-cache" } });
  } catch (error) {
    if (error instanceof Error) return c.json(fail("design_system_file_not_found", "Design system file not found", { id, path: relPath }), 404);
    throw error;
  }
});

catalogRoutes.get("/api/design-systems/:id", async (c) => {
  try {
    const result = await getCatalogSystem(getSqlite(), systemsDir, c.req.param("id"));
    return result === null
      ? c.json(fail("design_system_not_found", "Design system not found"), 404)
      : c.json(ok(result));
  } catch (error) {
    return catalogError(c, error);
  }
});

catalogRoutes.patch("/api/design-systems/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const row = getCatalogRow(getSqlite(), id);
    if (row === null) return c.json(fail("design_system_not_found", "Design system not found"), 404);
    if (row.lifecycle === "trashed") return c.json(fail("invalid_lifecycle", "Restore the system before editing metadata"), 409);
    const patch = parseMetadataPatch(await jsonBody(c.req.raw));
    updateCatalogMetadata(getSqlite(), {
      id,
      expectedRevision: patch.expectedRevision,
      name: patch.name ?? row.name,
      description: patch.description === undefined ? row.description : patch.description,
      status: patch.status ?? row.status,
      tags: patch.tags ?? getCatalogTags(getSqlite(), id),
      kind: patch.kind ?? row.kind,
      provenance: patch.provenance ?? row.provenance,
      license: patch.license ?? row.license,
      lifecycle: patch.lifecycle ?? (row.lifecycle === "archived" ? "archived" : "active"),
      updatedAt: Date.now(),
    });
    const result = await getCatalogSystem(getSqlite(), systemsDir, id);
    if (result === null) return c.json(fail("design_system_not_found", "Design system not found"), 404);
    return c.json(ok(result));
  } catch (error) {
    return catalogError(c, error);
  }
});

for (const operation of ["duplicate", "derive"] as const) {
  catalogRoutes.post(`/api/design-systems/:id/${operation}`, async (c) => {
    try {
      const body = parseChildRequest(await jsonBody(c.req.raw), operation);
      await copyCatalogSystem(getSqlite(), systemsDir, c.req.param("id"), {
        id: body.id,
        name: body.name,
        operation,
        reason: body.reason,
        metadata: body.metadata,
        ...(body.parentReceiptId === undefined ? {} : { parentReceiptId: body.parentReceiptId }),
        ...(body.parentDigest === undefined ? {} : { parentDigest: body.parentDigest }),
      });
      const result = await getCatalogSystem(getSqlite(), systemsDir, body.id);
      if (result === null) return c.json(fail("catalog_operation_failed", "Catalog child disappeared"), 500);
      return c.json(ok(result), 201);
    } catch (error) {
      return catalogError(c, error);
    }
  });
}

catalogRoutes.post("/api/design-systems/:id/trash", async (c) => {
  try {
    parseEmptyBody(await jsonBody(c.req.raw));
    await trashCatalogSystem(getSqlite(), systemsDir, c.req.param("id"));
    const result = await getCatalogSystem(getSqlite(), systemsDir, c.req.param("id"));
    return result === null ? c.json(fail("catalog_operation_failed", "Catalog system disappeared"), 500) : c.json(ok(result));
  } catch (error) { return catalogError(c, error); }
});

catalogRoutes.post("/api/design-systems/:id/restore", async (c) => {
  try {
    parseEmptyBody(await jsonBody(c.req.raw));
    await restoreCatalogSystem(getSqlite(), systemsDir, c.req.param("id"));
    const result = await getCatalogSystem(getSqlite(), systemsDir, c.req.param("id"));
    return result === null ? c.json(fail("catalog_operation_failed", "Catalog system disappeared"), 500) : c.json(ok(result));
  } catch (error) { return catalogError(c, error); }
});

catalogRoutes.delete("/api/design-systems/:id/purge", async (c) => {
  try {
    await purgeCatalogSystem(getSqlite(), systemsDir, c.req.param("id"));
    return c.body(null, 204);
  } catch (error) { return catalogError(c, error); }
});

catalogRoutes.delete("/api/design-systems/:id", async (c) => {
  try {
    await trashCatalogSystem(getSqlite(), systemsDir, c.req.param("id"));
    return c.json(ok({ id: c.req.param("id"), deleted: true as const }));
  } catch (error) {
    if (error instanceof CatalogFileError && error.code === "unsafe_catalog_path") {
      return c.json(ok({ id: c.req.param("id"), deleted: false as const, warning: "unsafe_catalog_path" as const }));
    }
    return catalogError(c, error);
  }
});

async function jsonBody(request: Request): Promise<unknown> {
  try { return await request.json(); }
  catch (error) {
    if (error instanceof SyntaxError) throw new CatalogInputError("body");
    throw error;
  }
}

function catalogContentType(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case ".css": return "text/css; charset=utf-8";
    case ".html": return "text/html; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".md": return "text/markdown; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg": case ".jpeg": return "image/jpeg";
    case ".woff": return "font/woff";
    case ".woff2": return "font/woff2";
    default: return "application/octet-stream";
  }
}

function catalogError(c: Context, error: unknown): Response {
  if (error instanceof CatalogQueryError) return c.json(fail(error.code, error.message, { field: error.field }), 400);
  if (error instanceof CatalogInputError) return c.json(fail(error.code, error.message, { field: error.field }), 400);
  if (error instanceof CatalogRepositoryError) {
    if (error.code === "expected_revision_conflict") return c.json(fail(error.code, error.message), 412);
    if (error.code === "not_found") return c.json(fail("design_system_not_found", error.message), 404);
    return c.json(fail(error.code, error.message), 409);
  }
  if (error instanceof CatalogLifecycleError) {
    if (error.code === "design_system_not_found") return c.json(fail(error.code, error.message), 404);
    if (error.code === "catalog_operation_failed") return c.json(fail(error.code, error.message), 500);
    if (error.code === "has_active_projects") {
      const id = c.req.param("id");
      const projectRefs = id === undefined ? [] : getCatalogUsage(getSqlite(), id);
      return c.json(fail(error.code, error.message, { project_refs: projectRefs }), 409);
    }
    return c.json(fail(error.code, error.message), 409);
  }
  if (error instanceof CatalogFileError) {
    return c.json(fail(error.code, error.message), error.code === "unsafe_catalog_path" || error.code === "catalog_digest_mismatch" || error.code === "catalog_manifest_unverifiable" ? 409 : 500);
  }
  return c.json(fail("catalog_operation_failed", error instanceof Error ? error.message : "Unknown catalog failure"), 500);
}
