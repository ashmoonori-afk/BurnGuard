import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { ExportClosureError, localAssetReferences, resolveStaticClosure } from "../src/services/export-closure";
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

  test("Given a srcset descriptor that hides a comma in parentheses or a very long srcset When closure resolves Then every browser candidate is checked in linear time", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-export-closure-srcset-"));
    try {
      // Given: a browser drops the invalid `1x(,#)` candidate and fetches the next one.
      await writeFile(path.join(root, "a.png"), "image");
      for (const remote of ["https://tracker.example/p.gif", "//evil.example/p.png"]) {
        await writeFile(path.join(root, "index.html"), `<html><body><img srcset="#a 1x(,#),${remote}"></body></html>`);
        // When / Then
        await expect(resolveStaticClosure(root, "index.html", await inspectCanonicalTree(root))).rejects.toMatchObject({ code: "remote_asset" });
      }
      // Given: 1.5 MB of candidates, which a quadratic parser cannot even finish before the reference cap is checked.
      await writeFile(path.join(root, "index.html"), `<html><body><img srcset="${"a.png 1x, ".repeat(150_000)}"></body></html>`);
      // When / Then
      await expect(resolveStaticClosure(root, "index.html", await inspectCanonicalTree(root))).rejects.toMatchObject({ code: "closure_limit" });
      // Given: millions of candidates, which must reach the cap rather than overflow a spread.
      await writeFile(path.join(root, "index.html"), `<html><body><img srcset="${"a.png ,".repeat(3_000_000)}"></body></html>`);
      // When / Then
      await expect(resolveStaticClosure(root, "index.html", await inspectCanonicalTree(root))).rejects.toMatchObject({ code: "closure_limit" });
      // Given: one URL with a long inner comma run and a trailing comma, which an end-anchored comma pattern backtracks over.
      await writeFile(path.join(root, "index.html"), `<html><body><img srcset="a.png${",".repeat(400_000)}b,"></body></html>`);
      // When / Then
      await expect(resolveStaticClosure(root, "index.html", await inspectCanonicalTree(root))).rejects.toMatchObject({ code: "missing_asset" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("Given a million CSS url() values in a style attribute or a style element When references are collected Then they reach the reference cap instead of overflowing a spread", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-export-closure-css-"));
    const urls = "url(a.png)".repeat(1_000_000);
    try {
      await writeFile(path.join(root, "a.png"), "image");
      for (const body of [`<div style="background:${urls}"></div>`, `<style>.a{background:${urls}}</style>`]) {
        // Given
        await writeFile(path.join(root, "index.html"), `<html><body>${body}</body></html>`);
        // When / Then
        await expect(resolveStaticClosure(root, "index.html", await inspectCanonicalTree(root))).rejects.toMatchObject({ code: "closure_limit" });
        expect(localAssetReferences(body, "index.html")).toHaveLength(1_000_000);
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  const closureOutcome = async (files: Readonly<Record<string, string>>): Promise<string> => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-export-closure-scan-"));
    try {
      for (const [name, content] of Object.entries(files)) await writeFile(path.join(root, name), content);
      return `resolved:${(await resolveStaticClosure(root, "index.html", await inspectCanonicalTree(root))).referenced_paths.join(",")}`;
    } catch (error) {
      if (!(error instanceof ExportClosureError)) throw error;
      return `${error.code}:${error.asset}`;
    } finally { await rm(root, { recursive: true, force: true }); }
  };
  const page = (head: string, body: string): string => `<!doctype html><html><head><title>t</title>${head}</head><body>${body}</body></html>`;

  test("Given a script whose commented-out line mentions an import When the export closure resolves Then the export is not refused", async () => {
    // Given: the same script saved with LF and with CRLF line endings, as a Windows editor writes it.
    for (const eol of ["\n", "\r\n"]) {
      const files = {
        "index.html": page("", '<script type="module" src="app.js"></script>'),
        "app.js": ['// import { legacy } from "./legacy-helpers.js";', '/* export * from "./gone.js"; */', 'import { a } from "./a.js";', "document.body.dataset.ready = String(a);", ""].join(eol),
        "a.js": ["export const a = 1;", ""].join(eol),
      };
      // When / Then
      expect(await closureOutcome(files)).toBe("resolved:a.js,app.js");
    }
  });

  test("Given a script whose UI string reads like an import statement When the export closure resolves Then the export is not refused", async () => {
    // Given
    const files = {
      "index.html": page("", '<script src="app.js"></script>'),
      "app.js": "const hint = \"Tap to import contacts from 'Google'\";\ndocument.title = hint;\n",
    };
    // When / Then
    expect(await closureOutcome(files)).toBe("resolved:app.js");
  });

  test("Given real imports beside a commented one, or a script that does not parse When the export closure resolves Then local imports are followed and remote imports still fail closed", async () => {
    // Given
    const html = page("", '<script type="module" src="app.js"></script>');
    const imports = '// import "./gone.js";\nimport { a } from "./a.js";\nexport * from "./b.js";\nconst c = await import("./c.js");\nconsole.log(a, c);\n';
    // When / Then
    expect(await closureOutcome({ "index.html": html, "app.js": imports, "a.js": "export const a = 1;\n", "b.js": "export const b = 2;\n", "c.js": "export default 3;\n" })).toBe("resolved:a.js,app.js,b.js,c.js");
    expect(await closureOutcome({ "index.html": html, "app.js": imports, "a.js": "export const a = 1;\n", "b.js": "export const b = 2;\n" })).toBe("missing_asset:c.js");
    expect(await closureOutcome({ "index.html": html, "app.js": 'import x from "https://cdn.example/x.js";\nx();\n' })).toBe("remote_asset:https://cdn.example/x.js");
    expect(await closureOutcome({ "index.html": html, "app.js": 'const = ;\nimport("https://cdn.example/x.js");\n' })).toBe("remote_asset:https://cdn.example/x.js");
  });

  test("Given a page with a canonical link to its public URL When the export closure resolves Then the non-fetched metadata link is not treated as a remote asset", async () => {
    // Given
    const metadata = '<link rel="canonical" href="https://example.com/landing"><link rel="Alternate" hreflang="en" href="https://example.com/en">';
    // When / Then
    expect(await closureOutcome({ "index.html": page(metadata, "<main>Landing</main>") })).toBe("resolved:");
    // Given: relations a browser does fetch, and a link that names none.
    for (const fetched of ['<link rel="stylesheet" href="https://example.com/a.css">', '<link rel="alternate stylesheet" href="https://example.com/a.css">', '<link href="https://example.com/a.css">']) {
      // When / Then
      expect(await closureOutcome({ "index.html": page(fetched, "<main>Landing</main>") })).toBe("remote_asset:https://example.com/a.css");
    }
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
