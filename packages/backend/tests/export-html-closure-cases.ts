import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { ExportClosureError, resolveStaticClosure } from "../src/services/export-closure";
import { buildHtmlArchiveManifest, HTML_EXPORT_MANIFEST, validateHtmlArchive } from "../src/services/export-html-validation";
import { canonicalJson, sha256 } from "../src/services/export-receipt";
import { canCreateSymlink, SYMLINK_SKIP_REASON } from "./helpers/platform";

const digest = "a".repeat(64);

describe("export HTML closure boundaries", () => {
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
});
