import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExportFormat, ExportOptions, ProjectDetail, SequencedEventEnvelope } from "@bg/shared";
import { LOGO_FILES, LOGO_PAGE, LOGO_SOURCE_ATTRIBUTE } from "@bg/shared";
import { getExportAttemptDetail, getExportJob } from "../src/db/exports";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { copyBundledFonts } from "../src/data/bundled-fonts";
import { projectsDir } from "../src/lib/paths";
import { artifactRoutes } from "../src/routes/artifacts";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { sequencedBroker } from "../src/services/broker";
import { activeExportBrowserCount } from "../src/services/export-browser-registry";
import { parseExportReceipt } from "../src/services/export-receipt";
import { parseExportValidation } from "../src/services/export-receipt-validation";
import { LogoSvgExportError, renderLogoSvg } from "../src/services/export-svg";
import { assertExportAllowed, enqueueProjectExport, ExportServiceError } from "../src/services/exports";

const suite = `logo-export-${process.pid}`;
const webProjectId = `${suite}-web`;
const webDir = path.join(projectsDir, webProjectId);
const logoProjectId = `${suite}-logo`;
const logoDir = path.join(projectsDir, logoProjectId);
const logoSessionId = `${logoProjectId}-session`;
const oversizedDir = path.join(projectsDir, `${suite}-logo-oversized`);
const logoProject = projectFixture("logo", logoDir);
const oversizedLogoProject = projectFixture("logo", oversizedDir);

const VALID_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" ${LOGO_SOURCE_ATTRIBUTE}="explorations/round-1/candidate-2.png"><path d="M64 64H448V448H64Z" fill="#101828"/></svg>\n`;
const RASTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><image href="candidate-2.png" width="512" height="512"/></svg>\n`;

beforeAll(async () => {
  await runMigrations();
  for (const dir of [webDir, logoDir, oversizedDir]) await mkdir(dir, { recursive: true });
  await writeFile(path.join(webDir, "index.html"), "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Landing</title></head><body><main>Landing</main></body></html>");
  await writeFile(path.join(logoDir, "index.html"), guidelines(8));
  await writeFile(path.join(logoDir, LOGO_FILES.logo), VALID_SVG);
  await copyBundledFonts(logoDir);
  await writeFile(path.join(oversizedDir, "index.html"), guidelines(20));
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,options_json,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',NULL,1,1)").run(webProjectId, "Acme Landing", webDir);
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,options_json,created_at,updated_at) VALUES (?,?,'logo',?,'index.html','codex',NULL,1,1)").run(logoProjectId, "Acme", logoDir);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(logoSessionId, logoProjectId);
  await new ArtifactCoordinator(getSqlite()).initialize(logoProjectId, logoDir);
});

afterAll(async () => {
  getSqlite().prepare("DELETE FROM projects WHERE id IN (?,?)").run(webProjectId, logoProjectId);
  for (const dir of [webDir, logoDir, oversizedDir]) await rm(dir, { recursive: true, force: true });
});

describe("SVG export requires a logo project", () => {
  test("Given a prototype project When SVG is enqueued Then the service rejects before an export authority exists", async () => {
    // Given
    const before = exportCount(webProjectId);

    // When / Then
    await expect(enqueueProjectExport(webProjectId, "svg", {})).rejects.toBeInstanceOf(ExportServiceError);
    await expect(enqueueProjectExport(webProjectId, "svg", {})).rejects.toMatchObject({ code: "format_requires_logo" });
    expect(exportCount(webProjectId)).toBe(before);
    expect(activeExportBrowserCount()).toBe(0);
  });

  test("Given a prototype project When SVG is requested over HTTP Then the route answers 400 without creating an authority", async () => {
    // Given
    const before = exportCount(webProjectId);

    // When
    const response = await postExport(webProjectId, { format: "svg", options: {} });

    // Then
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "format_requires_logo" } });
    expect(exportCount(webProjectId)).toBe(before);
    expect(activeExportBrowserCount()).toBe(0);
  });

  test("Given a logo project When SVG is requested Then the guard admits it", async () => {
    // Given / When / Then
    await expect(assertExportAllowed(logoProject, "svg", {})).resolves.toBeUndefined();
  });
});

describe("logo project export format guards", () => {
  test.each([
    ["png", { png_width: 1280, png_height: 720, png_dpr: 1 }, "format_requires_web"],
    ["handoff", {}, "format_requires_web"],
    ["cafe24_package", {}, "format_requires_web"],
    ["imweb_package", {}, "format_requires_web"],
    ["png_zip", { slice_height: 5000, slice_format: "png" }, "format_requires_frames"],
    ["pptx", { pptx_size: "16x9" }, "format_requires_deck"],
  ] as readonly (readonly [ExportFormat, ExportOptions, string])[])(
    "Given a logo project When %s is requested Then the guard rejects it",
    async (format, options, code) => {
      // Given / When / Then
      await expect(assertExportAllowed(logoProject, format, options)).rejects.toBeInstanceOf(ExportServiceError);
      await expect(assertExportAllowed(logoProject, format, options)).rejects.toMatchObject({ code });
    },
  );

  test("Given a logo project When PNG is requested over HTTP Then the route rejects it without an authority", async () => {
    // Given
    const before = exportCount(logoProjectId);

    // When
    const response = await postExport(logoProjectId, { format: "png", options: { png_width: 1280, png_height: 720, png_dpr: 1 } });

    // Then
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "format_requires_web" } });
    expect(exportCount(logoProjectId)).toBe(before);
    expect(activeExportBrowserCount()).toBe(0);
  });

  test("Given a logo project When the guidelines artboard PDF or HTML archive is requested Then the guard admits it", async () => {
    // Given / When / Then
    await expect(assertExportAllowed(logoProject, "pdf", { pdf_paper: "artboard" })).resolves.toBeUndefined();
    await expect(assertExportAllowed(logoProject, "html_zip", {})).resolves.toBeUndefined();
  });

  test("Given guidelines with more pages than the raster budget When artboard PDF is requested Then the page budget rejects it", async () => {
    // Given / When / Then
    await expect(assertExportAllowed(oversizedLogoProject, "pdf", { pdf_paper: "artboard" })).rejects.toMatchObject({ code: "pdf_resource_limit" });
  });
});

describe("renderLogoSvg", () => {
  test("Given a valid master SVG When rendered Then the bytes are copied unchanged and the source is recorded", async () => {
    // Given
    const staged = await stage(VALID_SVG);
    try {
      const outputPath = path.join(staged, "artifact.svg");

      // When
      const validation = await renderLogoSvg({ stagedDir: path.join(staged, "render"), entrypointDir: ".", outputPath });

      // Then
      expect(validation).toEqual({ root: "svg", bytes: Buffer.byteLength(VALID_SVG), source: "explorations/round-1/candidate-2.png" });
      expect(await readFile(outputPath, "utf8")).toBe(VALID_SVG);
    } finally {
      await rm(staged, { recursive: true, force: true });
    }
  });

  test("Given a master SVG embedding a raster image When rendered Then the export fails with the validation reason", async () => {
    // Given
    const staged = await stage(RASTER_SVG);
    try {
      // When / Then
      await expect(renderLogoSvg({ stagedDir: path.join(staged, "render"), entrypointDir: ".", outputPath: path.join(staged, "artifact.svg") })).rejects.toBeInstanceOf(LogoSvgExportError);
      await expect(renderLogoSvg({ stagedDir: path.join(staged, "render"), entrypointDir: ".", outputPath: path.join(staged, "artifact.svg") })).rejects.toMatchObject({ code: "logo_svg_invalid", reason: "svg_forbidden_element:image" });
    } finally {
      await rm(staged, { recursive: true, force: true });
    }
  });

  test("Given a staged tree without logo.svg When rendered Then the export fails as missing", async () => {
    // Given
    const staged = await stage(null);
    try {
      // When / Then
      await expect(renderLogoSvg({ stagedDir: path.join(staged, "render"), entrypointDir: ".", outputPath: path.join(staged, "artifact.svg") })).rejects.toMatchObject({ code: "logo_svg_missing" });
    } finally {
      await rm(staged, { recursive: true, force: true });
    }
  });
});

describe("logo SVG export pipeline", () => {
  test("Given a logo project When SVG is exported Then the published artifact is the master vector and its receipt", async () => {
    // Given
    const terminal = nextTerminalExport();

    // When
    const started = await enqueueProjectExport(logoProjectId, "svg", {});
    if (started === null || started.latest_attempt === null) throw new TypeError("logo SVG export did not start");
    await terminal;

    // Then
    const job = await getExportJob(started.id);
    if (job?.status !== "succeeded") {
      const attempt = await getExportAttemptDetail(started.latest_attempt.id);
      throw new TypeError(`${job?.error_message ?? `unexpected logo export status: ${job?.status ?? "missing"}`} ${JSON.stringify(attempt?.findings ?? [])}`);
    }
    if (job.output_path === null) throw new TypeError("logo SVG output unavailable");
    expect(path.basename(job.output_path)).toBe("artifact.svg");
    expect(await readFile(job.output_path, "utf8")).toBe(VALID_SVG);
    const receipt = parseExportReceipt(JSON.parse(await readFile(path.join(path.dirname(job.output_path), "receipt.json"), "utf8")));
    expect(receipt.format).toBe("svg");
    expect(receipt.validation).toEqual({ root: "svg", bytes: Buffer.byteLength(VALID_SVG), source: "explorations/round-1/candidate-2.png" });
    expect(activeExportBrowserCount()).toBe(0);
  }, 70_000);
});

describe("SVG export receipt validation", () => {
  test("Given an observed SVG output When the receipt is parsed Then the root marker and size survive", () => {
    // Given / When / Then
    expect(parseExportValidation("svg", {}, { root: "svg", bytes: 312, source: "round-2/candidate-1" })).toEqual({ root: "svg", bytes: 312, source: "round-2/candidate-1" });
    expect(parseExportValidation("svg", {}, { root: "xml", bytes: 4096, source: null })).toEqual({ root: "xml", bytes: 4096, source: null });
  });

  test.each([
    [{ root: "html", bytes: 312, source: null }],
    [{ root: "svg", bytes: 0, source: null }],
    [{ root: "svg", bytes: 312 }],
    [{ root: "svg", bytes: 312, source: "" }],
    [{ root: "svg", bytes: 312, source: null, extra: 1 }],
  ])("Given a malformed SVG validation %o When parsed Then it is rejected", (input) => {
    // Given / When / Then
    expect(() => parseExportValidation("svg", {}, input)).toThrow(TypeError);
  });
});

function projectFixture(type: ProjectDetail["type"], dir: string): ProjectDetail {
  return {
    id: path.basename(dir),
    name: "Acme",
    type,
    design_system_id: null,
    design_system_name: null,
    thumbnail_path: null,
    updated_at: 1,
    archived_at: null,
    dir_path: dir,
    entrypoint: "index.html",
    backend_id: "codex",
    options_json: null,
    current_revision: 1,
    current_digest: null,
  };
}

function guidelines(pages: number): string {
  const artboards = Array.from(
    { length: pages },
    (_, index) => `<section data-graphic-artboard id="page-${index + 1}" style="width:${LOGO_PAGE.width}px;height:${LOGO_PAGE.height}px"></section>`,
  ).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Logo guidelines</title></head><body>${artboards}</body></html>`;
}

async function stage(svg: string | null): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "bg-logo-svg-"));
  await mkdir(path.join(root, "render"), { recursive: true });
  if (svg !== null) await writeFile(path.join(root, "render", LOGO_FILES.logo), svg);
  return root;
}

function postExport(projectId: string, body: { readonly format: ExportFormat; readonly options: ExportOptions }): Promise<Response> {
  return artifactRoutes.request(`http://local/api/projects/${projectId}/exports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function exportCount(projectId: string): number {
  return getSqlite().query<{ readonly count: number }, [string]>("SELECT COUNT(*) count FROM exports WHERE project_id=?").get(projectId)?.count ?? 0;
}

function nextTerminalExport(): Promise<SequencedEventEnvelope> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new TypeError("logo export terminal event timed out"));
    }, 60_000);
    const unsubscribe = sequencedBroker.subscribe(logoSessionId, (item) => {
      if (item.event.type !== "export.attempt" || (item.event.status !== "failed" && item.event.status !== "validated")) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(item);
    });
  });
}
