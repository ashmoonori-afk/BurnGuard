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
import { listArtifactOperations } from "../src/db/artifact-operation-query";
import { artifactHistory } from "../src/services/artifact-history";
import { writePreTurnSnapshot } from "../src/services/checkpoints";
import { parseFigmaImportDocument, stageFigmaExport } from "../src/services/figma-import";

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
    const copiedPath = path.join(project.dir, "copied-reference.json");
    await writeFile(copiedPath, originalNode);
    await expect(
      coordinator.observeExternal(project.id, project.dir),
    ).rejects.toMatchObject({ code: "immutable_reference_escaped" });
    await expect(readFile(copiedPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await getProjectDetail(project.id))?.current_revision).toBe(
      current.current_revision,
    );
  });

  test("Given an immutable attachment matches imported asset bytes When another file changes Then the registered Figma asset path remains publishable", async () => {
    const project = await createProject();
    const response = await createApp().request(
      `/api/projects/${project.id}/figma/import`,
      { method: "POST", body: importForm(project) },
    );
    const body = await response.json();
    const manifest = JSON.parse(
      await readFile(path.join(project.dir, body.data.manifest_path), "utf8"),
    );
    const assetSha256 = manifest.nodes[0]?.asset_sha256;
    const assetPath = manifest.nodes[0]?.asset_path;
    const current = await getProjectDetail(project.id);
    if (
      typeof assetSha256 !== "string" ||
      typeof assetPath !== "string" ||
      current === null ||
      current.current_digest === null
    ) throw new Error("fixture_identity_unavailable");

    const operation = await new ArtifactCoordinator(getSqlite()).run({
      projectId: project.id,
      projectDir: project.dir,
      kind: "turn",
      expectedRevision: current.current_revision,
      expectedArtifactDigest: current.current_digest,
      publicationPolicy: { forbiddenSha256: new Set([assetSha256]) },
      mutate: async (stage) => {
        await writeFile(path.join(stage, "index.html"), "<h1>Updated</h1>");
      },
    });

    expect(operation).toMatchObject({
      status: "committed",
      resultRevision: current.current_revision + 1,
    });
    expect(
      await readFile(path.join(project.dir, assetPath)),
    ).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
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

describe("project Figma file import route failures and history", () => {
  test("Given an unsafe asset path found while staging When imported Then the sanitized 400 code survives rollback", async () => {
    // Given
    const project = await createProject();
    const form = importForm(project);
    form.set("asset_paths", "../outside.png");

    // When
    const response = await createApp().request(`/api/projects/${project.id}/figma/import`, { method: "POST", body: form });

    // Then
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("unsafe_figma_asset");
    expect((await getProjectDetail(project.id))?.current_revision).toBe(project.revision);
  });

  test("Given a malformed multipart body When imported Then the route answers invalid_figma_request", async () => {
    // Given
    const project = await createProject();

    // When
    const response = await createApp().request(`/api/projects/${project.id}/figma/import`, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=broken" },
      body: "--not-the-boundary\r\nnonsense",
    });

    // Then
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_figma_request");
  });

  test("Given a committed import When history is read and the import is undone Then receipts parse and undo is refused", async () => {
    // Given
    const project = await createProject();
    const response = await createApp().request(`/api/projects/${project.id}/figma/import`, { method: "POST", body: importForm(project) });
    expect(response.status).toBe(201);
    const current = await getProjectDetail(project.id);
    if (current === null || current.current_digest === null) throw new Error("artifact_identity_unavailable");
    const operation = getSqlite().query<{ readonly id: string }, [string]>(
      "SELECT id FROM artifact_operations WHERE project_id=? AND json_extract(replay_json,'$.kind')='figma_import'",
    ).get(project.id);
    if (operation === null) throw new Error("import_operation_missing");

    // When
    const operations = listArtifactOperations(getSqlite(), project.id);
    const history = artifactHistory(getSqlite(), project.id, current.current_revision, current.current_digest);
    const undo = await new ArtifactCoordinator(getSqlite()).undo({
      projectId: project.id,
      projectDir: project.dir,
      operationId: operation.id,
      expectedRevision: current.current_revision,
      expectedArtifactDigest: current.current_digest,
    }).then(() => "undone", (error: unknown) => (error as { code?: string }).code);

    // Then
    expect(operations.some((item) => item.replay.kind === "figma_import")).toBe(true);
    expect(history.undo_operation_id).toBeNull();
    expect(undo).toBe("undo_unavailable");
  });
});

describe("project Figma references in initialization", () => {
  test("Given validated Figma references staged by an initialization When the project is created Then the references are accepted", async () => {
    // Given
    const id = `project-${randomUUID()}`;
    await mkdir(projectsDir, { recursive: true });
    const dir = await mkdtemp(path.join(projectsDir, "figma-init-"));
    const now = Date.now();
    getSqlite().prepare(
      "INSERT INTO projects (id,name,type,design_system_id,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',NULL,?,'index.html','claude-code',?,?)",
    ).run(id, id, dir, now, now);
    projectIds.push(id);
    roots.push(dir);

    // When
    const initialized = await new ArtifactCoordinator(getSqlite()).initializeProject(id, dir, async (stage) => {
      await writeFile(path.join(stage, "index.html"), "<h1>Restored</h1>");
      await stageFigmaExport({
        stage_dir: stage,
        source_file_name: "figma-file.json",
        document: parseFigmaImportDocument(JSON.parse(fixtureDocument())),
        node_ids: ["1:2"],
        assets: [],
        pinned_tokens_css: "",
        imported_at: "2026-09-27T12:00:00.000Z",
        signal: new AbortController().signal,
      });
    });

    // Then
    expect(initialized.status).toBe("committed");
  });
});

describe("project history around Figma imports", () => {
  test("Given edits before and after an import When history is read Then only revisions since the import are restorable", async () => {
    // Given
    const project = await createProject();
    const coordinator = new ArtifactCoordinator(getSqlite());
    const edit = async (html: string) => {
      const current = await getProjectDetail(project.id);
      if (current === null || current.current_digest === null) throw new Error("artifact_identity_unavailable");
      return coordinator.run({
        projectId: project.id,
        projectDir: project.dir,
        kind: "palette",
        expectedRevision: current.current_revision,
        expectedArtifactDigest: current.current_digest,
        mutate: async (stage) => { await writeFile(path.join(stage, "index.html"), html); },
      });
    };
    const before = await edit("<h1>Before import</h1>");
    const afterBefore = await getProjectDetail(project.id);
    if (afterBefore === null || afterBefore.current_digest === null) throw new Error("artifact_identity_unavailable");
    const imported = await createApp().request(`/api/projects/${project.id}/figma/import`, {
      method: "POST",
      body: importForm({ revision: afterBefore.current_revision, digest: afterBefore.current_digest }),
    });
    expect(imported.status).toBe(201);
    const after = await edit("<h1>After import</h1>");
    const current = await getProjectDetail(project.id);
    if (current === null || current.current_digest === null) throw new Error("artifact_identity_unavailable");

    // When
    const history = artifactHistory(getSqlite(), project.id, current.current_revision, current.current_digest);
    const availability = new Map(history.entries.map((entry) => [entry.operation_id, entry.available]));

    // Then
    expect(availability.get(before.id)).toBe(false);
    expect(availability.get(after.id)).toBe(true);
    expect(history.undo_operation_id).toBe(after.id);
  });
});

describe("chat checkpoint revert around Figma imports", () => {
  test("Given turns before and after an import When each is reverted Then only the pre-import turn is refused with a clear code", async () => {
    // Given
    const project = await createProject();
    await writePreTurnSnapshot(project.id, "turn-before-import");
    const imported = await createApp().request(`/api/projects/${project.id}/figma/import`, { method: "POST", body: importForm(project) });
    expect(imported.status).toBe(201);
    await writePreTurnSnapshot(project.id, "turn-after-import");
    const current = await getProjectDetail(project.id);
    if (current === null || current.current_digest === null) throw new Error("artifact_identity_unavailable");
    const revert = (turnId: string) => createApp().request(`/api/projects/${project.id}/checkpoints/${turnId}/restore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expected_revision: current.current_revision, expected_artifact_digest: current.current_digest }),
    });

    // When
    const before = await revert("turn-before-import");
    const after = await revert("turn-after-import");

    // Then
    expect(before.status).toBe(409);
    expect((await before.json()).error.code).toBe("revert_before_figma_import");
    expect(after.status).toBe(200);
  });
});
