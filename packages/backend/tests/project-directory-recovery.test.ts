import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runMigrationsFrom } from "../src/db/migrate";
import { getSqlite } from "../src/db/sqlite-client";
import { projectsDir } from "../src/lib/paths";
import { artifactRoutes } from "../src/routes/artifacts";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { reconcileArtifactState } from "../src/services/artifact-recovery";

let db: Database;
let root: string;
let healthy: string;
beforeEach(async () => {
  db = new Database(":memory:");
  await runMigrationsFrom(db, path.join(import.meta.dir, "../src/db/migrations"));
  root = await mkdtemp(path.join(os.tmpdir(), "burnguard-project-directory-"));
  healthy = path.join(root, "healthy");
  await mkdir(healthy);
  await writeFile(path.join(healthy, "index.html"), "healthy bytes");
  addProject(db, "healthy", healthy);
});
afterEach(async () => { db.close(); await rm(root, { recursive: true, force: true }); });

function addProject(target: Database, id: string, directory: string): void {
  target.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(id, "Fixture", directory);
  target.prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(`${id}-session`, id);
}

test("Given absent project roots with and without a digest When startup reconciles Then healthy projects and sessions recover while missing rows stay intact", async () => {
  for (const id of ["missing-new", "missing-committed"]) addProject(db, id, path.join(root, id));
  db.prepare("UPDATE projects SET current_digest=? WHERE id='missing-committed'").run("a".repeat(64));
  db.exec("UPDATE sessions SET status='running',pid=123 WHERE id='healthy-session'");
  const missingBefore = db.query("SELECT * FROM projects WHERE id LIKE 'missing-%' ORDER BY id").all();
  expect(await reconcileArtifactState(db)).toEqual({ operations: 0, projects: 1, sessions: 1, unavailableProjects: [
    { projectId: "missing-committed", code: "project_directory_missing" }, { projectId: "missing-new", code: "project_directory_missing" },
  ] });
  expect(db.query("SELECT * FROM projects WHERE id LIKE 'missing-%' ORDER BY id").all()).toEqual(missingBefore);
  expect(db.query("SELECT status,pid FROM sessions WHERE id='healthy-session'").get()).toEqual({ status: "idle", pid: null });
  expect(db.query("SELECT current_digest FROM projects WHERE id='healthy'").get()).toMatchObject({ current_digest: expect.any(String) });
  expect(db.query("SELECT id FROM artifact_operations WHERE project_id LIKE 'missing-%'").all()).toEqual([]);
  expect(existsSync(path.join(root, "missing-new"))).toBe(false);
  expect(existsSync(path.join(root, "missing-committed"))).toBe(false);
  expect(await readFile(path.join(healthy, "index.html"), "utf8")).toBe("healthy bytes");
});

test("Given a moved project with a working receipt When startup runs and its folder is restored Then the exact receipt survives and recovery can finish", async () => {
  const missing = path.join(root, "missing");
  const moved = path.join(root, "moved");
  await mkdir(missing);
  await writeFile(path.join(missing, "index.html"), "preserved bytes");
  addProject(db, "missing", missing);
  await new ArtifactCoordinator(db).initialize("missing", missing);
  db.exec("UPDATE artifact_operations SET status='working',result_revision=NULL,result_digest=NULL WHERE project_id='missing'");
  const before = db.query("SELECT * FROM artifact_operations WHERE project_id='missing'").get();
  await rename(missing, moved);
  expect((await reconcileArtifactState(db)).unavailableProjects).toEqual([{ projectId: "missing", code: "project_directory_missing" }]);
  expect(db.query("SELECT * FROM artifact_operations WHERE project_id='missing'").get()).toEqual(before);
  expect(existsSync(missing)).toBe(false);
  expect(await readFile(path.join(moved, "index.html"), "utf8")).toBe("preserved bytes");
  await rename(moved, missing);
  expect(await reconcileArtifactState(db)).toMatchObject({ operations: 1, projects: 2, unavailableProjects: [] });
  expect(db.query("SELECT status FROM artifact_operations WHERE project_id='missing'").get()).toEqual({ status: "recovered" });
  expect(await readFile(path.join(missing, "index.html"), "utf8")).toBe("preserved bytes");
});

test("Given an existing root with missing recovery bytes When startup reconciles Then receipt errors remain fatal instead of being classified as an absent project", async () => {
  await new ArtifactCoordinator(db).initialize("healthy", healthy);
  const operation = db.query<{ id: string; snapshot_json: string }, []>("SELECT id,snapshot_json FROM artifact_operations WHERE project_id='healthy'").get()!;
  db.prepare("UPDATE artifact_operations SET status='working',result_revision=NULL,result_digest=NULL WHERE id=?").run(operation.id);
  const snapshot = JSON.parse(operation.snapshot_json) as { snapshot_path: string };
  await rename(snapshot.snapshot_path, path.join(root, "retained-snapshot"));
  await expect(reconcileArtifactState(db)).rejects.toMatchObject({ code: "tree_missing" });
  expect(await readFile(path.join(healthy, "index.html"), "utf8")).toBe("healthy bytes");
  expect(db.query("SELECT status FROM artifact_operations WHERE id=?").get(operation.id)).toEqual({ status: "recovering" });
});

test("Given an absent folder with a cached file index When files artifacts or refresh is requested Then a private-path-free error remains until the folder returns", async () => {
  const id = `missing-route-${crypto.randomUUID()}`;
  const directory = path.join(projectsDir, id);
  const moved = path.join(root, "route-moved");
  const target = getSqlite();
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "index.html"), "route bytes");
  addProject(target, id, directory);
  try {
    await new ArtifactCoordinator(target).initialize(id, directory);
    await rename(directory, moved);
    const before = target.query("SELECT * FROM projects WHERE id=?").get(id);
    for (const resource of ["files", "artifacts", "refresh"]) {
      const response = await artifactRoutes.request(`http://local/api/projects/${id}/${resource}`, { method: resource === "refresh" ? "POST" : "GET" });
      expect(response.status).toBe(409);
      const body = await response.text();
      expect(JSON.parse(body)).toMatchObject({ error: { code: "project_directory_missing" } });
      expect(body).not.toContain(directory);
    }
    expect(target.query("SELECT * FROM projects WHERE id=?").get(id)).toEqual(before);
    await rename(moved, directory);
    expect((await artifactRoutes.request(`http://local/api/projects/${id}/artifacts`)).status).toBe(200);
    expect((await artifactRoutes.request(`http://local/api/projects/${id}/files`)).status).toBe(200);
  } finally {
    target.prepare("DELETE FROM projects WHERE id=?").run(id);
    await rm(directory, { recursive: true, force: true });
  }
});
