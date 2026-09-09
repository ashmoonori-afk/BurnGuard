import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import type { ApiErrorBody, ApiSuccess } from "@bg/shared";
import { getSqlite } from "../db/sqlite-client";
import { getProjectDetail } from "../db/project-read-repository";

import { ArtifactCoordinator } from "../services/artifact-coordinator";
import { ArtifactIdentityError, requireArtifactIdentity } from "../services/artifact-identity";
import { inspectCanonicalTree } from "../services/canonical-tree-manifest";
import { resolveDrawFile, resolveProjectFile } from "../services/managed-project-files";
import { FilePatchError, fingerprintHtmlNode, htmlWithEditableIds } from "../services/file-patch";

function ok<T>(data: T): ApiSuccess<T> { return { data }; }
function fail(code: string, message: string, details?: unknown): ApiErrorBody { return { error: { code, message, details } }; }

export const managedFileRoutes = new Hono();

managedFileRoutes.get("/api/projects/:id/fs/*", async (c) => {
  const projectId = c.req.param("id");
  const prefix = `/api/projects/${projectId}/fs/`;
  const relPath = c.req.path.startsWith(prefix) ? decodeURIComponent(c.req.path.slice(prefix.length)) : "";
  const resolved = await resolveProjectFile(projectId, relPath);
  if (resolved === null) return c.json(fail("file_not_found", "Project file not found", { projectId, relPath }), 404);
  try {
    if (!(await stat(resolved.absolutePath)).isFile()) return c.json(fail("not_a_file", "Requested path is not a file", { relPath }), 400);
  } catch (error) {
    if (error instanceof Error) return c.json(fail("file_not_found", "Project file not found", { projectId, relPath }), 404);
    throw error;
  }
  const coordinator = new ArtifactCoordinator(getSqlite());
  await coordinator.observeExternal(projectId, resolved.project.dir_path);
  const project = await getProjectDetail(projectId);
  const manifest = await inspectCanonicalTree(resolved.project.dir_path);
  const file = manifest.files.find((entry) => entry.path === resolved.relPath);
  if (project === null || project.current_digest === null || file === undefined) return c.json(fail("artifact_identity_unavailable", "Artifact identity is unavailable"), 409);
  const headers: Record<string, string> = { "Cache-Control": "no-cache", "Content-Type": contentType(resolved.absolutePath), ETag: `"${file.sha256}"`, "X-Burnguard-File-Hash": file.sha256, "X-Burnguard-Revision": String(project.current_revision), "X-Burnguard-Artifact-Digest": project.current_digest };
  const nodeBgId = c.req.query("node_bg_id");
  if (nodeBgId !== undefined) {
    try { headers["X-Burnguard-Node-Fingerprint"] = fingerprintHtmlNode(await readFile(resolved.absolutePath, "utf8"), nodeBgId).fingerprint; }
    catch (error) {
      if (error instanceof FilePatchError) return c.json(fail(error.code, error.message), 422);
      throw error;
    }
  }
  const body = /\.html?$/i.test(resolved.absolutePath)
    ? htmlWithEditableIds(await readFile(resolved.absolutePath, "utf8"))
    : Bun.file(resolved.absolutePath);
  return new Response(body, { headers });
});

managedFileRoutes.get("/api/projects/:id/draws/*", async (c) => {
  const projectId = c.req.param("id");
  const prefix = `/api/projects/${projectId}/draws/`;
  const relPath = c.req.path.startsWith(prefix) ? decodeURIComponent(c.req.path.slice(prefix.length)) : "";
  if (relPath.length === 0) return c.json(fail("invalid_path", "File path is required"), 400);
  const resolved = await resolveDrawFile(projectId, relPath);
  if (resolved === null) return c.json(fail("project_not_found", "Project or path invalid", { projectId, relPath }), 404);
  try {
    if (!(await stat(resolved.absolutePath)).isFile()) return c.json(fail("not_a_file", "Draws sidecar is not a file", { relPath }), 400);
    return c.body(await readFile(resolved.absolutePath, "utf8"), 200, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-cache" });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return c.body('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 200, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-cache" });
  }
});

managedFileRoutes.put("/api/projects/:id/draws/*", async (c) => {
  const projectId = c.req.param("id");
  if (await getProjectDetail(projectId) === null) return c.json(fail("project_not_found", "Project not found", { projectId }), 404);
  const prefix = `/api/projects/${projectId}/draws/`;
  const relPath = c.req.path.startsWith(prefix) ? decodeURIComponent(c.req.path.slice(prefix.length)) : "";
  if (relPath.length === 0) return c.json(fail("invalid_path", "File path is required"), 400);
  const resolved = await resolveDrawFile(projectId, relPath);
  if (resolved === null) return c.json(fail("path_escape", "Resolved path escapes the draws root", { relPath }), 400);
  const body = await c.req.text();
  if (body.length > 2_000_000) return c.json(fail("invalid_body", "svg body required (string, <= 2MB)"), 400);
  const project = await getProjectDetail(projectId);
  const expectedRevision = Number(c.req.header("x-burnguard-revision"));
  const expectedDigest = (c.req.header("if-match") ?? "").replace(/^"|"$/g, "");
  if (project === null) return c.json(fail("project_not_found", "Project not found", { projectId }), 404);
  try { requireArtifactIdentity({ revision: expectedRevision, digest: expectedDigest }, { revision: project.current_revision, digest: project.current_digest }); }
  catch (error) {
    if (error instanceof ArtifactIdentityError) return c.json(fail(error.code, error.message, { current_revision: project.current_revision, current_digest: project.current_digest }), error.code === "invalid_artifact_identity" ? 400 : 409);
    throw error;
  }
  await mkdir(resolved.parentDir, { recursive: true });
  await writeFile(resolved.absolutePath, body, "utf8");
  const anchor = { schema_version: 1, artifact_revision: expectedRevision, artifact_digest: expectedDigest, file_hash: c.req.header("x-burnguard-file-hash") ?? null, viewport: c.req.header("x-burnguard-viewport") ?? null, coordinate_system: c.req.header("x-burnguard-coordinate-system") ?? "svg", node_anchor: c.req.header("x-burnguard-node-anchor") ?? null };
  await writeFile(`${resolved.absolutePath}.anchor.json`, JSON.stringify(anchor), "utf8");
  return c.json(ok({ rel_path: resolved.relPath, bytes: Buffer.byteLength(body), anchor }));
});

managedFileRoutes.get("/api/exports/:id/download", async (c) => {
  const id = c.req.param("id");
  const { ExportDownloadError, verifyExportDownload } = await import("../services/export-download");
  try {
    const download = await verifyExportDownload(id);
    const project = await getProjectDetail(download.projectId);
    const { buildContentDisposition, buildDownloadFilename, formatMime } = await import("../services/export-naming");
    const filename = buildDownloadFilename({ projectName: project?.name ?? null, revision: download.revision, format: download.format });
    return new Response(Bun.file(download.path), { headers: { "Content-Disposition": buildContentDisposition(filename), "Content-Type": formatMime(download.format) } });
  } catch (error) {
    if (!(error instanceof ExportDownloadError)) throw error;
    if (error.code === "not_found") return c.json(fail("export_not_found", "Export job not found", { id }), 404);
    if (error.code === "corrupt") return c.json(fail("export_corrupt", "Export receipt or output is corrupt", { id }), 410);
    return c.json(fail("export_not_ready", "Export is not ready for download", { id }), 409);
  }
});

function contentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html": case ".htm": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": case ".mjs": case ".cjs": return "application/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg": case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".woff": return "font/woff";
    case ".woff2": return "font/woff2";
    case ".ttf": return "font/ttf";
    case ".otf": return "font/otf";
    case ".md": case ".txt": return "text/plain; charset=utf-8";
    default: return "application/octet-stream";
  }
}
