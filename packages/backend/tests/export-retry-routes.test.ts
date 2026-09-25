import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createExportAuthority, failExportAttempt } from "../src/db/export-lifecycle-repository";
import { runMigrations } from "../src/db/migrate-local";
import { getProjectDetail } from "../src/db/project-read-repository";
import { getSqlite } from "../src/db/sqlite-client";
import { projectsDir } from "../src/lib/paths";
import { artifactRoutes } from "../src/routes/artifacts";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";

const projectId = `export-retry-routes-${process.pid}`;
const projectDir = path.join(projectsDir, projectId);
const deck = (slides: number) => `<!doctype html><html><head><title>Deck</title></head><body>${"<section data-slide><h1>Slide</h1></section>".repeat(slides)}</body></html>`;

beforeAll(async () => {
  await runMigrations();
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, "index.html"), deck(30));
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,options_json,created_at,updated_at) VALUES (?,?,'slide_deck',?,'index.html','codex',NULL,1,1)").run(projectId, "Deck", projectDir);
  await new ArtifactCoordinator(getSqlite()).initialize(projectId, projectDir);
});

afterAll(async () => {
  getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
  await rm(projectDir, { recursive: true, force: true });
});

function attemptCount(jobId: string): number {
  return getSqlite().query<{ readonly count: number }, [string]>("SELECT COUNT(*) count FROM export_attempts WHERE job_id=?").get(jobId)?.count ?? -1;
}

describe("export retry route", () => {
  test("Given a failed deck PDF job whose deck then grew past the raster budget When retry is requested Then it is refused as 400 pdf_resource_limit without a new attempt", async () => {
    // Given
    const project = await getProjectDetail(projectId);
    if (project === null || project.current_digest === null) throw new TypeError("deck identity missing");
    const ids = createExportAuthority(getSqlite(), { projectId, revision: project.current_revision, digest: project.current_digest, designSystemDigest: null, format: "pdf", options: { pdf_paper: "a4" }, rendererDigest: "r", captureDigest: "c" });
    failExportAttempt(getSqlite(), { jobId: ids.jobId, attemptId: ids.attemptId, status: "failed", reason: "render_failed", message: "Export render failed" });
    await writeFile(path.join(projectDir, "index.html"), deck(40));
    const identity = { project_revision: project.current_revision, project_digest: project.current_digest };

    // When
    const retry = await artifactRoutes.request(`http://local/api/exports/${ids.jobId}/retry`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(identity) });
    const create = await artifactRoutes.request(`http://local/api/projects/${projectId}/exports`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "pdf", options: { pdf_paper: "a4" } }) });

    // Then
    expect(retry.status).toBe(400);
    expect(await retry.json()).toMatchObject({ error: { code: "pdf_resource_limit" } });
    expect(attemptCount(ids.jobId)).toBe(1);
    expect(create.status).toBe(400);
    expect(await create.json()).toMatchObject({ error: { code: "pdf_resource_limit" } });
  });
});
