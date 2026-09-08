import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSqlite } from "../src/db/sqlite-client";
import { projectsDir } from "../src/lib/paths";
import { managedFileRoutes } from "../src/routes/managed-files";
import { artifactOperationRoutes } from "../src/routes/artifact-operations";
import { projectRoutes } from "../src/routes/project";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";

let id: string;
let root: string;
const html = '<html><body><h1 data-bg-node-id="hero">Seed</h1></body></html>';
beforeEach(async () => {
  id = `review-concurrency-${crypto.randomUUID()}`;
  root = path.join(projectsDir, id);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "index.html"), html);
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(id, "Seed", root);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(`${id}-session`, id);
});
afterEach(async () => { getSqlite().prepare("DELETE FROM projects WHERE id=?").run(id); await rm(root, { recursive: true, force: true }); });
function getFile() { return managedFileRoutes.request(`http://local/api/projects/${id}/fs/index.html?node_bg_id=hero`); }
function activeCount() { return getSqlite().query<{ count: number }, [string]>("SELECT COUNT(*) count FROM artifact_operations WHERE project_id=? AND status IN ('working','pending','recovering')").get(id)?.count; }

test("Given a seeded project with no digest When first-open file requests overlap Then adoption happens once and editing and deletion work", async () => {
  const responses = await Promise.all(Array.from({ length: 4 }, getFile));
  expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
  expect(new Set(responses.map((response) => response.headers.get("X-Burnguard-Artifact-Digest"))).size).toBe(1);
  expect(activeCount()).toBe(0);
  expect(getSqlite().query<{ count: number }, [string]>("SELECT COUNT(*) count FROM artifact_operations WHERE project_id=?").get(id)?.count).toBe(1);
  const file = responses[0]!;
  const edit = await artifactOperationRoutes.request(`http://local/api/projects/${id}/fs/index.html`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected_revision: Number(file.headers.get("X-Burnguard-Revision")), expected_artifact_digest: file.headers.get("X-Burnguard-Artifact-Digest"), expected_file_hash: file.headers.get("X-Burnguard-File-Hash"), node_fingerprint: file.headers.get("X-Burnguard-Node-Fingerprint"), node_bg_id: "hero", text: "Edited", styles: { color: "red" } }),
  });
  expect(edit.status).toBe(200);
  expect(await readFile(path.join(root, "index.html"), "utf8")).toContain("Edited");
  expect(activeCount()).toBe(0);
  expect((await projectRoutes.request(`http://local/api/projects/${id}`, { method: "DELETE" })).status).toBe(204);
}, 30_000);

test("Given an external save When watcher observation and multiple file requests overlap Then one revision commits and no stale working row survives", async () => {
  await getFile();
  await writeFile(path.join(root, "index.html"), html.replace("Seed", "External"));
  const [observation, ...responses] = await Promise.all([new ArtifactCoordinator(getSqlite()).observeExternal(id, root), ...Array.from({ length: 5 }, getFile)]);
  expect(observation).toMatchObject({ status: "committed", resultRevision: 1 });
  expect(responses.map((response) => (response as Response).status)).toEqual([200, 200, 200, 200, 200]);
  expect(activeCount()).toBe(0);
  expect(getSqlite().query("SELECT current_revision FROM projects WHERE id=?").get(id)).toEqual({ current_revision: 1 });
}, 30_000);

test("Given a publication paused before its file read When a file GET arrives Then it waits for committed bytes without rejecting the active operation", async () => {
  const base = await new ArtifactCoordinator(getSqlite()).initialize(id, root);
  let reached: () => void = () => {};
  const publishing = new Promise<void>((resolve) => { reached = resolve; });
  let resume: () => void = () => {};
  const gate = new Promise<void>((resolve) => { resume = resolve; });
  const operation = new ArtifactCoordinator(getSqlite(), { beforePublishRead: async () => { reached(); await gate; } }).run({ projectId: id, projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, mutate: async (stage) => { await writeFile(path.join(stage, "index.html"), html.replace("Seed", "Published")); } });
  await publishing;
  const reading = getFile();
  resume();
  expect(await operation).toMatchObject({ status: "committed", resultRevision: 1 });
  const response = await reading;
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("Published");
  expect(activeCount()).toBe(0);
}, 30_000);
