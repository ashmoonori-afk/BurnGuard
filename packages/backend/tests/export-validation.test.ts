import { describe, expect, test } from "bun:test";
import "./export-pdf-deadline-cases";
import "./export-pdf-producer-closure-cases";
import "./export-pdf-raster-cases";
import "./export-receipt-boundary-cases";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import JSZip from "jszip";
import { parseExportOptions } from "../../shared/src/export";
import { parseExportAttempt } from "../../shared/src/export-attempt";
import { inspectCanonicalTree, parseCanonicalTreeManifest, validateCanonicalTree } from "../src/services/canonical-tree-manifest";
import { ExportClosureError, resolveStaticClosure } from "../src/services/export-closure";
import { buildHtmlArchiveManifest, HTML_EXPORT_MANIFEST, validateHtmlArchive } from "../src/services/export-html-validation";
import { buildContentDisposition, buildDownloadFilename, formatExtension, formatFilenameTag, formatMime, slugifyProjectName } from "../src/services/export-naming";
import { analyzePixels, parsePng, validateDecodedPng } from "../src/services/export-png-validation";
import { canonicalJson, type ExportReceipt, parseExportReceipt, receiptDigest, requireReceiptIdentity, sha256 } from "../src/services/export-receipt";
import { zipDirectory } from "../src/services/zip";
import { canCreateSymlink, SYMLINK_SKIP_REASON } from "./helpers/platform";

const digest = "a".repeat(64);

function attempt(status: string, overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: "attempt-1",
    job_id: "job-1",
    parent_attempt_id: null,
    status,
    project_revision: 7,
    project_digest: digest,
    design_system_digest: null,
    digests: {
      options: digest,
      input_closure: status === "pending" ? null : digest,
      renderer: digest,
      capture: digest,
      output: status === "validated" ? digest : null,
      receipt: status === "validated" ? digest : null,
    },
    progress: {
      stage: status === "validated" ? "complete" : "queued",
      completed: status === "validated" ? 6 : 0,
      total: 6,
    },
    stop_reason: null,
    findings: [],
    retention: { retained_until: 10_000, output_available: status === "validated" },
    cancel_requested_at: null,
    created_at: 1,
    updated_at: 2,
    ...overrides,
  };
}

describe("export validation contracts", () => {
  test("Given PNG options When parsed Then defaults and bounds are canonical", () => {
    expect(parseExportOptions("png", { png_width: 1440, png_height: 900, png_dpr: 2 })).toEqual({
      png_width: 1440,
      png_height: 900,
      png_dpr: 2,
    });
    expect(parseExportOptions("png", {})).toEqual({ png_width: 1280, png_height: 720, png_dpr: 1 });
    expect(() => parseExportOptions("png", { png_width: 319 })).toThrow();
    expect(() => parseExportOptions("png", { pdf_paper: "a4" })).toThrow();
  });

  test("Given each existing format When options parsed Then defaults are persisted without cross-format keys", () => {
    expect(parseExportOptions("pdf", {})).toEqual({ pdf_paper: "a4" });
    expect(parseExportOptions("pptx", {})).toEqual({ pptx_size: "16x9" });
    expect(parseExportOptions("html_zip", {})).toEqual({});
    expect(parseExportOptions("handoff", {})).toEqual({});
    expect(() => parseExportOptions("pdf", { pptx_size: "4x3" })).toThrow();
  });

  test("Given platform and frame formats When options parsed Then only their canonical options are accepted", () => {
    // Given / When / Then
    expect(parseExportOptions("cafe24_package", { asset_base_url: "/web/upload/burnguard/project/" })).toEqual({ asset_base_url: "/web/upload/burnguard/project/" });
    expect(parseExportOptions("imweb_package", { asset_base_url: "https://cdn.example.com/assets/" })).toEqual({ asset_base_url: "https://cdn.example.com/assets/" });
    expect(parseExportOptions("png_zip", {})).toEqual({ slice_height: 5000, slice_format: "png" });
    expect(parseExportOptions("png_zip", { slice_height: 3000, slice_format: "jpeg", jpeg_quality: 60 })).toEqual({ slice_height: 3000, slice_format: "jpeg", jpeg_quality: 60 });
    expect(parseExportOptions("pdf", { pdf_paper: "artboard" })).toEqual({ pdf_paper: "artboard" });
    expect(() => parseExportOptions("png_zip", { jpeg_quality: 85 })).toThrow("invalid_field at jpeg_quality");
    expect(() => parseExportOptions("cafe24_package", { slice_height: 3000 })).toThrow("invalid_field at slice_height");
  });

  test.each([
    "http://example.com/assets",
    "//example.com/assets",
    "https://user:pass@example.com/assets",
    "https://example.com/a/../b",
    "https://example.com/a%2Fb",
    "https://example.com/a%5Cb",
    "https://example.com/a?query=1",
    "https://example.com/a#fragment",
    "javascript:alert(1)",
    "/assets/../../secret",
    "/assets/control\u0000",
    `https://example.com/${"a".repeat(2049)}`,
  ])("Given unsafe asset base URL %s When parsed Then it is rejected", (assetBaseUrl) => {
    // When / Then
    expect(() => parseExportOptions("cafe24_package", { asset_base_url: assetBaseUrl })).toThrow("invalid_field at asset_base_url");
  });

  test("Given pending and validated attempts When parsed Then result digests are state-dependent", () => {
    expect(parseExportAttempt(attempt("pending")).status).toBe("pending");
    expect(parseExportAttempt(attempt("validated")).status).toBe("validated");
    expect(() => parseExportAttempt(attempt("validated", {
      digests: { options: digest, input_closure: digest, renderer: digest, capture: digest, output: null, receipt: null },
    }))).toThrow();
  });

  test("Given terminal failures When parsed Then machine stop reason and unavailable retention are required", () => {
    expect(() => parseExportAttempt(attempt("failed"))).toThrow();
    expect(parseExportAttempt(attempt("failed", {
      stop_reason: "render_failed",
      retention: { retained_until: 10_000, output_available: false },
    })).status).toBe("failed");
  });

  test("Given unknown nested fields or invalid progress When parsed Then the boundary rejects recursively", () => {
    expect(() => parseExportAttempt(attempt("pending", { extra: true }))).toThrow();
    expect(() => parseExportAttempt(attempt("pending", {
      progress: { stage: "invented", completed: 0, total: 6 },
    }))).toThrow();
    expect(() => parseExportAttempt(attempt("pending", {
      retention: { retained_until: 10_000, output_available: false, extra: true },
    }))).toThrow();
  });

  test("Given a PNG validated job When named Then MIME and semantic revision name are stable", () => {
    expect((["html_zip", "pdf", "png", "pptx", "handoff"] as const).map((format) => ({ extension: formatExtension(format), mime: formatMime(format), tag: formatFilenameTag(format) }))).toEqual([
      { extension: "zip", mime: "application/zip", tag: "html" }, { extension: "pdf", mime: "application/pdf", tag: "deck" }, { extension: "png", mime: "image/png", tag: "png" }, { extension: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", tag: "deck" }, { extension: "zip", mime: "application/zip", tag: "handoff" },
    ]);
    expect(buildDownloadFilename({ projectName: "Launch Deck", revision: 7, format: "png" })).toBe("Launch-Deck-png-r7.png");
    expect(buildDownloadFilename({ projectName: null, job: { format: "pdf", created_at: 0, completed_at: null } })).toBe("export-deck-1970-01-01.pdf");
    expect(slugifyProjectName("한글 / launch")).toBe("한글-launch"); expect(buildContentDisposition("한글.png")).toContain("filename*=UTF-8''");
  });

  test("Given linked HTML CSS font JS and image When closure resolves Then every local input is included", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-export-closure-"));
    try {
      await mkdir(path.join(root, "styles"), { recursive: true }); await mkdir(path.join(root, "fonts")); await mkdir(path.join(root, "scripts")); await mkdir(path.join(root, "images"));
      await writeFile(path.join(root, "index.html"), '<html><body><img src="images/a.png"><link rel="stylesheet" href="styles/main.css"><script type="module" src="scripts/main.js"></script><a href="https://example.com">ordinary link</a></body></html>');
      await writeFile(path.join(root, "styles/main.css"), '@import "nested.css";@font-face{src:url(../fonts/a.woff2)}');
      await writeFile(path.join(root, "styles/nested.css"), "body{color:#123}"); await writeFile(path.join(root, "scripts/main.js"), 'import "./child.js"');
      await writeFile(path.join(root, "scripts/child.js"), "export const value=1"); await writeFile(path.join(root, "fonts/a.woff2"), "font"); await writeFile(path.join(root, "images/a.png"), "image");
      const manifest = await inspectCanonicalTree(root); const closure = await resolveStaticClosure(root, "index.html", manifest);
      expect(parseCanonicalTreeManifest(JSON.parse(JSON.stringify(manifest)))).toEqual(manifest); await expect(validateCanonicalTree(root, manifest)).resolves.toEqual(manifest);
      expect(closure.referenced_paths).toEqual(["fonts/a.woff2", "images/a.png", "scripts/child.js", "scripts/main.js", "styles/main.css", "styles/nested.css"]);
      const archiveManifest = buildHtmlArchiveManifest({ schema_version: 1, entrypoint: "index.html", project_revision: 7, project_digest: manifest.tree_digest, input_closure_digest: digest }, manifest.files.map((file) => ({ path: file.path, size: file.size, sha256: file.sha256 })));
      await writeFile(path.join(root, HTML_EXPORT_MANIFEST), canonicalJson(archiveManifest));
      const archivePath = `${root}.zip`;
      try {
        await zipDirectory(root, archivePath);
        const bytes = new Uint8Array(await readFile(archivePath));
        expect((await validateHtmlArchive(bytes, archiveManifest)).entries).toEqual(archiveManifest.entries);
        const reopened = await JSZip.loadAsync(bytes);
        expect(await reopened.file("index.html")?.async("string")).toContain('href="styles/main.css"');
        expect(await reopened.file("fonts/a.woff2")?.async("string")).toBe("font");
        expect(await reopened.file("scripts/child.js")?.async("string")).toBe("export const value=1");
      } finally { await rm(archivePath, { force: true }); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("Given missing remote escaping and symlink assets When closure resolves Then each fails closed", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-export-closure-bad-"));
    try {
      for (const [source, code] of [
        ['<html><body><img src="missing.png"></body></html>', "missing_asset"],
        ['<html><body><script src="https://example.com/a.js"></script></body></html>', "remote_asset"],
        ['<html><body><img src="../outside.png"></body></html>', "unsafe_asset"],
      ] as const) {
        await writeFile(path.join(root, "index.html"), source);
        try { await resolveStaticClosure(root, "index.html", await inspectCanonicalTree(root)); throw new TypeError("expected closure failure"); }
        catch (error) { if (!(error instanceof ExportClosureError)) throw error; expect(error.code).toBe(code); }
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("Given data URIs the artifact CSP admits and a srcset data candidate When closure resolves Then only local files are referenced and non-image data fails closed", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-export-closure-data-"));
    const closureCode = async (): Promise<string> => {
      try { await resolveStaticClosure(root, "index.html", await inspectCanonicalTree(root)); return "resolved"; }
      catch (error) { if (!(error instanceof ExportClosureError)) throw error; return `${error.code}:${error.asset}`; }
    };
    try {
      // Given
      const admitted = `<html><body><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Ccircle cx='110' cy='110' r='100' fill='%23f06'/%3E%3C/svg%3E"><img src="data:image/avif;base64,AAAAIGZ0eXBhdmlm"><img srcset="data:image/png;base64,iVBORw0KGgo= 1x, b.png 2x"><style>@font-face{font-family:x;src:url(data:font/woff2;base64,d09GMgABAAAAAA==)}.a{background:url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22/>")}</style></body></html>`;
      await writeFile(path.join(root, "index.html"), admitted); await writeFile(path.join(root, "b.png"), "image");
      // When / Then
      expect((await resolveStaticClosure(root, "index.html", await inspectCanonicalTree(root))).referenced_paths).toEqual(["b.png"]);
      await rm(path.join(root, "b.png"));
      expect(await closureCode()).toBe("missing_asset:b.png");
      for (const rejected of ['<img src="data:text/html,%3Cscript%3Ealert(1)%3C/script%3E">', '<script src="data:application/javascript,alert(1)"></script>', '<img src="data:image/svg+xml">']) {
        await writeFile(path.join(root, "index.html"), `<html><body>${rejected}</body></html>`);
        expect(await closureCode()).toStartWith("unsafe_asset:");
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("Given PNG chunks and deterministic pixels When validated Then dimensions and statistics are exact", () => {
    const bytes = png(2, 2, [255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
    expect(parsePng(bytes)).toEqual({ width: 2, height: 2 });
    expect(validateDecodedPng(bytes, Uint8Array.from([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]), { width: 2, height: 2 }).statistics.differing_pixels).toBe(1);
    expect(() => validateDecodedPng(bytes, new Uint8Array(16), { width: 3, height: 2 })).toThrow("dimension_mismatch");
    expect(() => analyzePixels(new Uint8Array(16), 2, 2)).toThrow("transparent");
    expect(() => analyzePixels(Uint8Array.from({ length: 16 }, (_, index) => index % 4 === 3 ? 255 : 20), 2, 2)).toThrow("one_color");
  });

  test("Given a semantic HTML archive When reopened Then paths hashes manifest and closure validate", async () => {
    const html = new TextEncoder().encode("<html><body><img src=asset.png></body></html>"); const asset = Uint8Array.from([1, 2, 3]);
    const expected = { schema_version: 1 as const, entrypoint: "index.html", project_revision: 7, project_digest: digest, input_closure_digest: "b".repeat(64) };
    const manifest = buildHtmlArchiveManifest(expected, [{ path: "index.html", size: html.length, sha256: sha256(html) }, { path: "asset.png", size: asset.length, sha256: sha256(asset) }]);
    const zip = new JSZip(); zip.file("index.html", html); zip.file("asset.png", asset); zip.file(HTML_EXPORT_MANIFEST, canonicalJson(manifest));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    expect((await validateHtmlArchive(bytes, expected)).entries).toHaveLength(2);
    const missing = new JSZip(); missing.file("index.html", html); missing.file(HTML_EXPORT_MANIFEST, canonicalJson(manifest));
    await expect(validateHtmlArchive(await missing.generateAsync({ type: "uint8array" }), expected)).rejects.toThrow("manifest_mismatch");
  });

  test.skipIf(!canCreateSymlink())(`Given the temp directory reached through a link When an HTML archive is validated Then the entrypoint closure resolves (${SYMLINK_SKIP_REASON})`, async () => {
    // Given
    const real = await mkdtemp(path.join(tmpdir(), "bg-html-validate-real-")); const link = `${real}-link`; await symlink(real, link, "dir");
    const saved = { TMPDIR: process.env["TMPDIR"], TEMP: process.env["TEMP"], TMP: process.env["TMP"] };
    const html = new TextEncoder().encode("<html><body><img src=asset.png></body></html>"); const asset = Uint8Array.from([1, 2, 3]);
    const expected = { schema_version: 1 as const, entrypoint: "index.html", project_revision: 7, project_digest: digest, input_closure_digest: "b".repeat(64) };
    const manifest = buildHtmlArchiveManifest(expected, [{ path: "index.html", size: html.length, sha256: sha256(html) }, { path: "asset.png", size: asset.length, sha256: sha256(asset) }]);
    const zip = new JSZip(); zip.file("index.html", html); zip.file("asset.png", asset); zip.file(HTML_EXPORT_MANIFEST, canonicalJson(manifest));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    try {
      process.env["TMPDIR"] = link; process.env["TEMP"] = link; process.env["TMP"] = link;
      // When / Then
      expect((await validateHtmlArchive(bytes, expected)).entries).toEqual(manifest.entries);
    } finally {
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      await rm(link, { force: true }); await rm(real, { recursive: true, force: true });
    }
  });

  test("Given a receipt When identity or digest changes Then strict verification blocks it", () => {
    const receipt: ExportReceipt = { schema_version: 1, job_id: "job", attempt_id: "attempt", parent_attempt_id: null, format: "png", project: { id: "p", revision: 7, digest }, options: { png_width: 320, png_height: 240, png_dpr: 1 }, output_file: "artifact.png", output_size: 3, digests: { input_closure: digest, design_system: null, options: sha256(canonicalJson({ png_width: 320, png_height: 240, png_dpr: 1 })), renderer: digest, capture: digest, output: digest }, validation: { width: 320, height: 240, statistics: { pixels: 76_800, visible_pixels: 76_800, differing_pixels: 100, dominant_ratio: 0.9, luminance_variance: 10, entropy: 0.2 } } };
    const parsed = parseExportReceipt(JSON.parse(canonicalJson(receipt)));
    expect(receiptDigest(parsed)).toBe(sha256(canonicalJson(receipt)));
    const authority = { jobId: "job", attemptId: "attempt", parentAttemptId: null, projectId: "p", projectRevision: 7, projectDigest: digest, format: "png" as const, options: { png_width: 320, png_height: 240, png_dpr: 1 } as const, optionsDigest: sha256(canonicalJson({ png_width: 320, png_height: 240, png_dpr: 1 })), inputClosureDigest: digest, designSystemDigest: null, rendererDigest: digest, captureDigest: digest, outputFile: "artifact.png", outputDigest: digest, outputSize: 3 };
    for (const patch of [{ jobId: "wrong" }, { attemptId: "wrong" }, { parentAttemptId: "parent" }, { projectId: "wrong" }, { projectRevision: 8 }, { projectDigest: "b".repeat(64) }, { options: { png_width: 321, png_height: 240, png_dpr: 1 } }, { optionsDigest: "b".repeat(64) }, { inputClosureDigest: "b".repeat(64) }, { designSystemDigest: "b".repeat(64) }, { rendererDigest: "b".repeat(64) }, { captureDigest: "b".repeat(64) }, { outputFile: "wrong.png" }, { outputDigest: "b".repeat(64) }, { outputSize: 4 }] as const) expect(() => requireReceiptIdentity(parsed, { ...authority, ...patch })).toThrow();
  });
});

function png(width: number, height: number, rgba: readonly number[]): Uint8Array {
  const rows = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) rows.set(rgba.slice(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const ihdr = new Uint8Array(13); new DataView(ihdr.buffer).setUint32(0, width); new DataView(ihdr.buffer).setUint32(4, height); ihdr[8] = 8; ihdr[9] = 6;
  return Uint8Array.from([...Uint8Array.from([137,80,78,71,13,10,26,10]), ...chunk("IHDR", ihdr), ...chunk("IDAT", deflateSync(rows)), ...chunk("IEND", new Uint8Array())]);
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const name = new TextEncoder().encode(type); const body = Uint8Array.from([...name, ...data]);
  const output = new Uint8Array(data.length + 12); new DataView(output.buffer).setUint32(0, data.length); output.set(body, 4); new DataView(output.buffer).setUint32(data.length + 8, crc(body)); return output;
}
function crc(bytes: Uint8Array): number { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) === 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
