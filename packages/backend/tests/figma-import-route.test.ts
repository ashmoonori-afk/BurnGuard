import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSqlite } from "../src/db/sqlite-client";
import { runMigrations } from "../src/db/migrate-local";
import { createApp } from "../src/server";
import { projectsDir } from "../src/lib/paths";
import {
  ArtifactCoordinator,
} from "../src/services/artifact-coordinator";
import { getProjectDetail } from "../src/db/project-read-repository";

const projectIds: string[] = [];
const roots: string[] = [];

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  const db = getSqlite();
  for (const projectId of projectIds) {
    db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  }
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
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
        children: [{
          id: "1:1",
          name: "Section",
          type: "GROUP",
          children: [{
            id: "1:2",
            name: "Checkout",
            type: "FRAME",
            children: [],
          }],
        }],
      }],
    },
  });
}

async function createProject(): Promise<{
  readonly id: string;
  readonly dir: string;
  readonly revision: number;
  readonly digest: string;
}> {
  const id = `project-${randomUUID()}`;
  const sessionId = `session-${randomUUID()}`;
  await mkdir(projectsDir, { recursive: true });
  const dir = await mkdtemp(path.join(projectsDir, "figma-route-"));
  const now = Date.now();
  const db = getSqlite();
  db.prepare(
    "INSERT INTO projects (id,name,type,design_system_id,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',NULL,?,'index.html','claude-code',?,?)",
  ).run(id, id, dir, now, now);
  db.prepare(
    "INSERT INTO sessions (id,project_id,backend_id,status,usage_input_tokens,usage_output_tokens,usage_cache_read,usage_cache_write,created_at,updated_at,last_active_at) VALUES (?,?,'claude-code','idle',0,0,0,0,?,?,?)",
  ).run(sessionId, id, now, now, now);
  projectIds.push(id);
  roots.push(dir);
  const initialized = await new ArtifactCoordinator(db).initializeProject(
    id,
    dir,
    async (stage) => {
      await writeFile(path.join(stage, "index.html"), "<h1>Checkout</h1>");
    },
  );
  return {
    id,
    dir,
    revision: initialized.resultRevision,
    digest: initialized.resultDigest,
  };
}

function importForm(
  project: { readonly revision: number; readonly digest: string },
  document = fixtureDocument(),
): FormData {
  const form = new FormData();
  form.set("expected_revision", String(project.revision));
  form.set("expected_artifact_digest", project.digest);
  form.set("node_ids", JSON.stringify(["1:2"]));
  form.set(
    "document",
    new File([document], "figma-file.json", { type: "application/json" }),
  );
  form.append(
    "assets",
    new File(
      [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
      "Checkout.png",
      { type: "image/png" },
    ),
  );
  form.append("asset_paths", "exports/Checkout.png");
  return form;
}

describe("project Figma file import route", () => {
  test("Given an initialized project and nested export When imported Then revision digest operation event and file index advance together", async () => {
    const project = await createProject();

    const response = await createApp().request(
      `/api/projects/${project.id}/figma/import`,
      { method: "POST", body: importForm(project) },
    );
    const body = await response.json();
    const current = await getProjectDetail(project.id);
    const manifest = JSON.parse(
      await readFile(path.join(project.dir, body.data.manifest_path), "utf8"),
    );

    expect(response.status).toBe(201);
    expect(body.data).toEqual(expect.objectContaining({
      imported_node_count: 1,
      imported_asset_count: 1,
    }));
    expect(current?.current_revision).toBe(project.revision + 1);
    expect(current?.current_digest).not.toBe(project.digest);
    expect(manifest.provenance.source_file_name).toBe("figma-file.json");
    expect(getSqlite().query(
      "SELECT status FROM artifact_operations WHERE project_id=? AND json_extract(replay_json,'$.kind')='figma_import'",
    ).get(project.id)).toEqual({ status: "committed" });
    expect(getSqlite().query(
      "SELECT COUNT(*) count FROM events WHERE session_id=(SELECT id FROM sessions WHERE project_id=?) AND type='artifact.operation'",
    ).get(project.id)).toEqual({ count: 2 });
    expect(getSqlite().query(
      "SELECT hash FROM files WHERE project_id=? AND rel_path=?",
    ).get(project.id, body.data.manifest_path)).toEqual({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  test("Given a stale expected artifact identity When importing Then the route refuses it with a sanitized conflict", async () => {
    const project = await createProject();
    const first = await createApp().request(
      `/api/projects/${project.id}/figma/import`,
      { method: "POST", body: importForm(project) },
    );
    expect(first.status).toBe(201);

    const stale = await createApp().request(
      `/api/projects/${project.id}/figma/import`,
      { method: "POST", body: importForm(project) },
    );
    const body = await stale.json();

    expect(stale.status).toBe(409);
    expect(body).toEqual({
      error: {
        code: "stale_artifact_identity",
        message: "Figma import conflicted with project changes",
      },
    });
  });

  test("Given an imported immutable reference When a later operation edits or deletes it Then publication is rejected", async () => {
    const project = await createProject();
    const response = await createApp().request(
      `/api/projects/${project.id}/figma/import`,
      { method: "POST", body: importForm(project) },
    );
    const body = await response.json();
    const manifest = JSON.parse(
      await readFile(path.join(project.dir, body.data.manifest_path), "utf8"),
    );
    const current = await getProjectDetail(project.id);
    if (current?.current_digest === null || current === null) {
      throw new Error("artifact_identity_unavailable");
    }
    const coordinator = new ArtifactCoordinator(getSqlite());
    const attempts: readonly ((stage: string) => Promise<void>)[] = [
      async (stage) => {
        await writeFile(path.join(stage, manifest.nodes[0].node_path), "{}");
      },
      async (stage) => {
        await unlink(path.join(stage, body.data.manifest_path));
      },
      async (stage) => {
        await copyFile(
          path.join(stage, manifest.nodes[0].node_path),
          path.join(stage, "copied-reference.json"),
        );
      },
    ];
    for (const mutate of attempts) {
      await expect(coordinator.run({
        projectId: project.id,
        projectDir: project.dir,
        kind: "turn",
        expectedRevision: current.current_revision,
        expectedArtifactDigest: current.current_digest,
        mutate,
      })).rejects.toMatchObject({
        code: "immutable_reference_escaped",
      });
    }
    const nodePath = path.join(project.dir, manifest.nodes[0].node_path);
    const originalNode = await readFile(nodePath);
    await writeFile(nodePath, "{}");
    await expect(
      coordinator.observeExternal(project.id, project.dir),
    ).rejects.toMatchObject({ code: "immutable_reference_escaped" });
    expect(await readFile(nodePath)).toEqual(originalNode);
    expect((await getProjectDetail(project.id))?.current_revision).toBe(
      current.current_revision,
    );
  });

  test("Given too many exported assets and malformed JSON When imported Then asset count is rejected before document parsing", async () => {
    const project = await createProject();
    const form = importForm(project, "{");
    form.delete("assets");
    form.delete("asset_paths");
    for (let index = 0; index < 65; index += 1) {
      form.append(
        "assets",
        new File(["x"], `asset-${index}.png`, { type: "image/png" }),
      );
      form.append("asset_paths", `asset-${index}.png`);
    }

    const response = await createApp().request(
      `/api/projects/${project.id}/figma/import`,
      { method: "POST", body: form },
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_figma_request");
  });

});
