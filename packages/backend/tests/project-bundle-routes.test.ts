import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createProjectRecord } from "../src/db/seed";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { getProjectDetail } from "../src/db/project-read-repository";
import { createApp } from "../src/server";
import { closeProjectWatcher } from "../src/services/watcher-registry";

const capability = "bundle-route-capability";
const authority = "127.0.0.1:14070";
const created: string[] = [];

beforeAll(runMigrations);

afterAll(async () => {
  for (const projectId of created) {
    closeProjectWatcher(projectId);
    const project = await getProjectDetail(projectId);
    getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
    if (project) await rm(project.dir_path, { recursive: true, force: true });
  }
});

test("Given launch authority When a project bundle is downloaded and uploaded Then the API creates a different project with intact files", async () => {
  // Given
  const source = await createProjectRecord({
    name: "한글 이동 프로젝트",
    type: "prototype",
    designSystemId: null,
    backendId: "codex",
    optionsJson: null,
    entrypoint: "index.html",
    thumbnailPath: null,
    initializeArtifact: async (stage) => {
      await writeFile(`${stage}/index.html`, "<h1>route portable</h1>");
    },
  });
  created.push(source.id);
  const app = createApp({ capability, appAuthority: authority });

  // When
  const exported = await app.request(new Request(`http://${authority}/api/projects/${source.id}/bundle`, {
    headers: { host: authority, "x-burnguard-capability": capability },
  }));
  const form = new FormData();
  form.set("name", "Route restored");
  form.set("source", "bundle");
  form.set("files", new File([await exported.arrayBuffer()], "route.burnguard-project"));
  const imported = await app.request(new Request(`http://${authority}/api/projects/import`, {
    method: "POST",
    headers: { host: authority, origin: `http://${authority}`, "x-burnguard-capability": capability },
    body: form,
  }));
  const body = await imported.json() as { data?: { id: string; warnings: unknown[] }; error?: { code: string } };
  if (body.data) created.push(body.data.id);

  // Then
  expect(exported.status).toBe(200);
  expect(exported.headers.get("content-type")).toContain("application/vnd.burnguard.project+zip");
  expect(exported.headers.get("content-disposition")).toContain(".burnguard-project");
  expect(exported.headers.get("content-disposition")).toContain("%ED%95%9C%EA%B8%80");
  expect(imported.status).toBe(201);
  expect(body.error).toBeUndefined();
  expect(body.data?.id).not.toBe(source.id);
  expect(body.data?.warnings).toEqual([]);
  const restored = body.data ? await getProjectDetail(body.data.id) : null;
  expect(restored ? await readFile(restored.dir_path + "/index.html", "utf8") : null).toContain("route portable");
});

test("Given no launch authority When bundle routes are requested Then the shared gate denies export and import", async () => {
  // Given
  const app = createApp({ capability, appAuthority: authority });
  const form = new FormData();
  form.set("source", "bundle");
  form.set("files", new File(["invalid"], "invalid.burnguard-project"));

  // When
  const exported = await app.request(new Request(`http://${authority}/api/projects/missing/bundle`, {
    headers: { host: authority },
  }));
  const imported = await app.request(new Request(`http://${authority}/api/projects/import`, {
    method: "POST",
    headers: { host: authority, origin: `http://${authority}` },
    body: form,
  }));

  // Then
  expect(exported.status).toBe(403);
  expect(imported.status).toBe(403);
});

test("Given launch authority When a project is deleted and restored through the API Then the listing carries no paths and the files come back", async () => {
  // Given
  const source = await createProjectRecord({
    name: "Route trash",
    type: "prototype",
    designSystemId: null,
    backendId: "codex",
    optionsJson: null,
    entrypoint: "index.html",
    thumbnailPath: null,
    initializeArtifact: async (stage) => {
      await writeFile(`${stage}/index.html`, "<h1>route trash</h1>");
    },
  });
  created.push(source.id);
  const app = createApp({ capability, appAuthority: authority });
  const headers = { host: authority, origin: `http://${authority}`, "x-burnguard-capability": capability };

  // When
  const deleted = await app.request(new Request(`http://${authority}/api/projects/${source.id}`, { method: "DELETE", headers }));
  const listed = await app.request(new Request(`http://${authority}/api/home/recently-deleted`, { headers }));
  const listedBody = await listed.json() as { data: Array<Record<string, unknown>> };
  const restored = await app.request(new Request(`http://${authority}/api/home/recently-deleted/${source.id}/restore`, { method: "POST", headers }));
  const again = await app.request(new Request(`http://${authority}/api/home/recently-deleted/${source.id}/restore`, { method: "POST", headers }));

  // Then
  expect(deleted.status).toBe(204);
  const entry = listedBody.data.find((item) => item.id === source.id);
  expect(entry === undefined ? null : Object.keys(entry).sort()).toEqual(["deleted_at", "id", "name"]);
  expect(entry?.name).toBe("Route trash");
  expect(restored.status).toBe(200);
  const project = await getProjectDetail(source.id);
  expect(project ? await readFile(project.dir_path + "/index.html", "utf8") : null).toBe("<h1>route trash</h1>");
  expect(again.status).toBe(404);
  expect((await again.json() as { error: { code: string } }).error.code).toBe("project_restore_unavailable");
});
