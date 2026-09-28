import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getSqlite } from "../src/db/sqlite-client";
import { runMigrations } from "../src/db/migrate-local";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { VisualAlternativeService } from "../src/services/visual-alternatives";
import {
  replaceVisualAlternativeServiceForTest,
  visualAlternativeRoutes,
} from "../src/routes/visual-alternatives";
import { managedFileRoutes } from "../src/routes/managed-files";
import { classifyApiRoute } from "../src/server";

const roots: string[] = [];
let root: string;
let restoreService: (() => void) | null = null;
const projectId = `visual-alternative-routes-${process.pid}`;
const sessionId = `${projectId}-session`;

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "burnguard-alternative-routes-"));
  roots.push(root);
  await writeFile(path.join(root, "index.html"), "<main>Original</main>");
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, projectId, root);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?, 'codex','idle',1,1,1)").run(sessionId, projectId);
  const coordinator = new ArtifactCoordinator(getSqlite());
  await coordinator.initialize(projectId, root);
  const service = new VisualAlternativeService(getSqlite(), {
    runTurn: async ({ operationId, ordinal }) => {
      const identity = getSqlite().query<{ readonly current_revision: number; readonly current_digest: string }, [string]>(
        "SELECT current_revision,current_digest FROM projects WHERE id=?",
      ).get(projectId);
      if (identity === null) throw new Error("project_fixture_missing");
      await coordinator.run({
        projectId,
        projectDir: root,
        kind: "turn",
        operationId,
        expectedRevision: identity.current_revision,
        expectedArtifactDigest: identity.current_digest,
        mutate: async (stage) => {
          await writeFile(path.join(stage, "index.html"), `<main>Alternative ${ordinal + 1}</main>`);
        },
      });
    },
  });
  const started = await service.generate({
    projectId,
    sessionId,
    projectDir: root,
    entrypoint: "index.html",
    request: {
      count: 2,
      prompt: "Explore alternatives.",
      names: ["Quiet", "Editorial"],
    },
  });
  await started.completion;
  restoreService = replaceVisualAlternativeServiceForTest(service);
});

afterEach(async () => {
  restoreService?.();
  restoreService = null;
  getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("visual alternative routes", () => {
  test("Given ready alternatives When listed promoted and deleted Then retained revisions remain independently addressable", async () => {
    // Given
    const listResponse = await visualAlternativeRoutes.request(`http://local/api/projects/${projectId}/alternatives`);
    const listed = await listResponse.json();
    const [first, second] = listed.data.alternatives;
    const identity = getSqlite().query<{ readonly current_revision: number; readonly current_digest: string }, [string]>(
      "SELECT current_revision,current_digest FROM projects WHERE id=?",
    ).get(projectId);
    if (identity === null || first === undefined || second === undefined) throw new Error("alternatives_fixture_missing");

    // When
    const preview = await managedFileRoutes.request(`http://local${first.entrypoint_url}`);
    const promoted = await visualAlternativeRoutes.request(
      `http://local/api/projects/${projectId}/alternatives/${first.id}/promote`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_revision: identity.current_revision,
          expected_artifact_digest: identity.current_digest,
        }),
      },
    );
    const secondReceipt = getSqlite().query<{ readonly snapshot_json: string }, [string]>(
      "SELECT snapshot_json FROM artifact_operations WHERE id=?",
    ).get(second.operation_id);
    if (secondReceipt === null) throw new Error("alternative_receipt_missing");
    await rm(JSON.parse(secondReceipt.snapshot_json).stage_path, { recursive: true, force: true });
    const unavailablePreview = await managedFileRoutes.request(`http://local${second.entrypoint_url}`);
    const deleted = await visualAlternativeRoutes.request(
      `http://local/api/projects/${projectId}/alternatives/${second.id}`,
      { method: "DELETE" },
    );

    // Then
    expect(classifyApiRoute(`/api/projects/${projectId}/alternatives`, "GET")).toBe("artifact-operations");
    expect(classifyApiRoute(first.entrypoint_url, "GET")).toBe("managed-files");
    expect(listResponse.status).toBe(200);
    expect(await preview.text()).toContain("Alternative 1");
    expect(promoted.status).toBe(200);
    expect(await readFile(path.join(root, "index.html"), "utf8")).toContain("Alternative 1");
    expect(unavailablePreview.status).toBe(409);
    expect(await unavailablePreview.json()).toMatchObject({ error: { code: "corrupt_visual_alternative" } });
    expect(deleted.status).toBe(204);
    const afterDelete = await visualAlternativeRoutes.request(`http://local/api/projects/${projectId}/alternatives`);
    expect((await afterDelete.json()).data.alternatives.map((item: { readonly id: string }) => item.id)).toEqual([first.id]);
  });

  test("Given an out-of-range request When generation is requested Then it rejects before any row is created", async () => {
    // Given
    const before = getSqlite().query<{ readonly count: number }, [string]>(
      "SELECT COUNT(*) AS count FROM visual_alternatives WHERE project_id=?",
    ).get(projectId)?.count;

    // When
    const response = await visualAlternativeRoutes.request(
      `http://local/api/projects/${projectId}/alternatives/generate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count: 5, prompt: "Too many", names: ["A", "B", "C", "D", "E"] }),
      },
    );

    // Then
    expect(response.status).toBe(400);
    expect(getSqlite().query<{ readonly count: number }, [string]>(
      "SELECT COUNT(*) AS count FROM visual_alternatives WHERE project_id=?",
    ).get(projectId)?.count).toBe(before);
  });
});
