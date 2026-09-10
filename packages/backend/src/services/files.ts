import { readFile } from "node:fs/promises";
import type { ArtifactSummary } from "@bg/shared/artifact";
import type { FileInfo } from "@bg/shared/harness";
import { getSqlite } from "../db/sqlite-client";
import { ArtifactCoordinator } from "./artifact-coordinator";
import { listProjectFiles as listProjectFilesFromDb } from "../db/files";
import { getProjectDetail } from "../db/project-read-repository";
import { resolveWithin } from "../security/path-boundary";
import { indexProjectFiles } from "./managed-project-files";
import { buildSiteMap } from "./site-map";

export { indexProjectFiles, isTransientFilePath, resolveDrawFile, resolveProjectFile } from "./managed-project-files";

export async function listIndexedProjectFiles(projectId: string) {
  const project = await getProjectDetail(projectId);
  if (project === null) return [];
  const files = await listProjectFilesFromDb(projectId);
  if (files.length > 0) return files;
  return (await indexProjectFiles(projectId)) ?? [];
}

export async function buildArtifactSummary(projectId: string): Promise<ArtifactSummary | null> {
  const project = await getProjectDetail(projectId);
  if (project === null) return null;
  let digest = project.current_digest;
  if (digest === null) digest = (await new ArtifactCoordinator(getSqlite()).initialize(projectId, project.dir_path)).tree_digest;
  const files = await listIndexedProjectFiles(projectId);
  const latestUpdated = files.reduce((maximum, file) => Math.max(maximum, file.updated_at ?? 0), project.updated_at);
  const entrypoint = pickEntrypoint(project.entrypoint, files);
  const siteMap = entrypoint === null
    ? { pages: [], overflow: false }
    : await buildSiteMap(files, entrypoint, (relPath) => readFile(resolveWithin(project.dir_path, relPath), "utf8"));
  return {
    project_id: project.id,
    entrypoint: entrypoint ?? project.entrypoint,
    entrypoint_url: entrypoint === null ? null : `/api/projects/${project.id}/fs/${entrypoint}`,
    design_system_id: project.design_system_id,
    design_system_url: project.design_system_id === null ? null : `/api/design-systems/${project.design_system_id}`,
    file_count: files.length,
    current_revision: project.current_revision,
    current_digest: digest,
    updated_at: latestUpdated,
    pages: siteMap.pages,
    site_overflow: siteMap.overflow,
  };
}

function pickEntrypoint(preferred: string | undefined | null, files: readonly FileInfo[]): string | null {
  const candidate = preferred?.trim() ?? "";
  if (candidate.length > 0 && files.some((file) => file.rel_path === candidate && file.category !== "folder")) return candidate;
  return files.find((file) => file.category === "html")?.rel_path ?? null;
}
