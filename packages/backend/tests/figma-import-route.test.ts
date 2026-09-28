import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getSqlite } from "../src/db/sqlite-client";
import { runMigrations } from "../src/db/migrate-local";
import { createApp } from "../src/server";
import { projectsDir } from "../src/lib/paths";
import { mkdir } from "node:fs/promises";

const projectIds: string[] = [];
const roots: string[] = [];

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  const db = getSqlite();
  for (const projectId of projectIds) db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

function fixtureDocument(): string {
  return JSON.stringify({
    name: "Checkout",
    version: "7",
    lastModified: "2026-09-27T10:15:00Z",
    document: {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Page",
        type: "CANVAS",
        children: [{ id: "1:2", name: "Checkout", type: "FRAME", children: [] }],
      }],
    },
  });
}

async function createProject(): Promise<{ readonly id: string; readonly dir: string }> {
  const id = `project-${randomUUID()}`;
  await mkdir(projectsDir, { recursive: true });
  const dir = await mkdtemp(path.join(projectsDir, "figma-route-"));
  const now = Date.now();
  getSqlite().prepare(
    "INSERT INTO projects (id,name,type,design_system_id,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',NULL,?,'index.html','claude-code',?,?)",
  ).run(id, id, dir, now, now);
  projectIds.push(id);
  roots.push(dir);
  return { id, dir };
}

describe("project Figma import routes", () => {
  test("Given an export folder payload When imported Then the response and persisted manifest expose parsed provenance", async () => {
    const project = await createProject();
    const form = new FormData();
    form.set("file_key", "abc123XYZ");
    form.set("node_ids", JSON.stringify(["1:2"]));
    form.set("document", new File([fixtureDocument()], "figma-file.json", { type: "application/json" }));
    form.append("assets", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "Checkout.png", { type: "image/png" }));
    form.append("asset_paths", "exports/Checkout.png");

    const response = await createApp().request(`/api/projects/${project.id}/figma/import`, { method: "POST", body: form });
    const body = await response.json();
    const manifest = JSON.parse(await readFile(path.join(project.dir, body.data.manifest_path), "utf8"));

    expect(response.status).toBe(201);
    expect(body.data).toEqual(expect.objectContaining({
      imported_node_count: 1,
      imported_asset_count: 1,
      token_mapping: { matched: 0, unmatched: 0 },
    }));
    expect(manifest.provenance).toEqual(expect.objectContaining({
      source: "export",
      file_key: "abc123XYZ",
      file_version: "7",
      last_modified: "2026-09-27T10:15:00Z",
    }));
  });

  test("Given a Figma API URL without a configured token When inspected Then only a stable error code is returned", async () => {
    const project = await createProject();

    const response = await createApp().request(`/api/projects/${project.id}/figma/inspect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_url: "https://www.figma.com/design/abc123XYZ/Checkout?node-id=1-2" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: { code: "figma_token_missing", message: "Figma access is not configured" } });
  });
});
