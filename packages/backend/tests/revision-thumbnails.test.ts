import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getSqlite } from "../src/db/sqlite-client";
import { projectsDir } from "../src/lib/paths";
import { homeRoutes } from "../src/routes/home";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { resetChromiumCapability, setChromiumCapabilityForTesting } from "../src/services/chromium-capability";
import { loadProjectThumbnail, THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH, type ThumbnailRenderer } from "../src/services/project-thumbnails";

const projects: { id: string; dirPath: string }[] = [];
const png = createCanvas(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT).toBuffer("image/png");
beforeAll(() => { setChromiumCapabilityForTesting(true); });
afterAll(async () => {
  resetChromiumCapability();
  for (const project of projects) {
    getSqlite().prepare("DELETE FROM projects WHERE id=?").run(project.id);
    await rm(project.dirPath, { recursive: true, force: true });
  }
});
async function createProject() {
  const id = `revision-thumb-${crypto.randomUUID()}`;
  const dirPath = path.join(projectsDir, id);
  await mkdir(dirPath, { recursive: true });
  await writeFile(path.join(dirPath, "index.html"), "before");
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(id, id, dirPath);
  const project = { id, dirPath };
  projects.push(project);
  return project;
}
const request = (url: string, etag?: string) => homeRoutes.request(`http://local${url}`, etag ? { headers: { "if-none-match": etag } } : undefined);

test("Given a retained revision When both thumbnail sides are requested Then the shared renderer reads its snapshot and result instead of the live tree", async () => {
  const project = await createProject();
  const coordinator = new ArtifactCoordinator(getSqlite());
  const initial = await coordinator.initialize(project.id, project.dirPath);
  const operation = await coordinator.run({
    projectId: project.id, projectDir: project.dirPath, kind: "turn", expectedRevision: 0, expectedArtifactDigest: initial.tree_digest,
    mutate: stage => writeFile(path.join(stage, "index.html"), "after"),
  });
  const sources: string[] = [];
  const renderer: ThumbnailRenderer = async input => {
    sources.push(await readFile(path.join(input.stagedDir, "index.html"), "utf8"));
    await writeFile(input.outputPath, png);
  };

  const before = await loadProjectThumbnail(project.id, renderer, () => "before", { operationId: operation.id, side: "before" });
  const after = await loadProjectThumbnail(project.id, renderer, () => "after", { operationId: operation.id, side: "after" });

  expect(sources).toEqual(["before", "after"]);
  if (before.kind !== "ready" || after.kind !== "ready") throw new Error("Expected retained thumbnails");
  expect(before.etag).not.toBe(after.etag);
  const url = `/api/projects/${project.id}/thumbnail?operation=${operation.id}&side=before`;
  expect((await request(url, before.etag)).status).toBe(304);
  const foreign = await createProject();
  expect(await loadProjectThumbnail(foreign.id, renderer, () => "foreign", { operationId: operation.id, side: "before" })).toEqual({ kind: "unavailable", code: "thumbnail_unavailable" });

  // A cached image cannot hide damaged retained bytes or outlive its authority.
  await writeFile(path.join(project.dirPath, ".meta", "artifact-operations", operation.id, "stage", "index.html"), "tampered");
  expect(await loadProjectThumbnail(project.id, renderer, () => "damaged", { operationId: operation.id, side: "after" })).toEqual({ kind: "unavailable", code: "thumbnail_unavailable" });
  getSqlite().prepare("UPDATE artifact_operations SET retention_json=json_set(retention_json,'$.retained_until',1) WHERE id=?").run(operation.id);
  expect((await request(url)).status).toBe(503);
  expect(sources).toHaveLength(2);
}, 60_000);

test("Given invalid or missing revision thumbnail identities When requested Then they never fall back to the live project", async () => {
  const project = await createProject();
  let renders = 0;
  const renderer: ThumbnailRenderer = async input => { renders += 1; await writeFile(input.outputPath, png); };

  const missing = await loadProjectThumbnail(project.id, renderer, () => "missing", { operationId: "missing", side: "before" });
  const malformed = await request(`/api/projects/${project.id}/thumbnail?operation=..&side=before`);
  const noSide = await request(`/api/projects/${project.id}/thumbnail?operation=missing`);

  expect(missing).toEqual({ kind: "unavailable", code: "thumbnail_unavailable" });
  expect([malformed.status, noSide.status]).toEqual([400, 400]);
  expect(renders).toBe(0);
});
