import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { artifactRoutes } from "../src/routes/artifacts";
import { activeExportBrowserCount } from "../src/services/export-browser-registry";
import { enqueueProjectExport, ExportServiceError } from "../src/services/exports";

const mixedId = `mixed-artboards-${process.pid}`;
const uniformId = `uniform-artboards-${process.pid}`;
const canvas = { schema_version: 1, width: 1080, height: 1080 } as const;

function insertProject(id: string, frames: readonly { readonly width: number; readonly height: number; readonly label: string }[]): void {
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,options_json,created_at,updated_at) VALUES (?,?,'graphic',?,'index.html','codex',?,1,1)").run(
    id,
    "Banner Set",
    `/tmp/${id}`,
    JSON.stringify({ graphic_canvas: canvas, graphic_set: { schema_version: 1, kind: "banner_set", frame_count: frames.length, frames } }),
  );
}

function exportCount(projectId: string): number {
  return getSqlite().query<{ readonly count: number }, [string]>("SELECT COUNT(*) count FROM exports WHERE project_id=?").get(projectId)?.count ?? 0;
}

beforeAll(async () => {
  await runMigrations();
  insertProject(mixedId, [{ width: 1080, height: 1080, label: "square" }, { width: 1200, height: 628, label: "wide" }]);
  insertProject(uniformId, [{ width: 1080, height: 1080, label: "square-a" }, { width: 1080, height: 1080, label: "square-b" }]);
});

afterAll(() => {
  getSqlite().prepare("DELETE FROM projects WHERE id IN (?,?)").run(mixedId, uniformId);
});

describe("artboard PDF page geometry guard", () => {
  test("Given a banner set with two artboard sizes When an artboard PDF is enqueued Then it is rejected before an export authority exists", async () => {
    // Given
    const before = exportCount(mixedId);

    // When / Then
    await expect(enqueueProjectExport(mixedId, "pdf", { pdf_paper: "artboard" })).rejects.toMatchObject({ code: "invalid_graphic_export_options" });
    expect(exportCount(mixedId)).toBe(before);
    expect(activeExportBrowserCount()).toBe(0);
  });

  test("Given the same mixed banner set When requested over HTTP Then a typed client error is returned", async () => {
    // Given / When
    const response = await artifactRoutes.request(`http://local/api/projects/${mixedId}/exports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: "pdf", options: { pdf_paper: "artboard" } }),
    });

    // Then
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_graphic_export_options" } });
    expect(exportCount(mixedId)).toBe(0);
  });

  test("Given a banner set whose artboards share one size When an artboard PDF is enqueued Then the geometry guard does not reject it", async () => {
    // Given / When
    const rejection = await enqueueProjectExport(uniformId, "pdf", { pdf_paper: "artboard" }).then(() => null, (error: unknown) => error);

    // Then
    expect(rejection instanceof ExportServiceError && rejection.code === "invalid_graphic_export_options").toBe(false);
  });
});
