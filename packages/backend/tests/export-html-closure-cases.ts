import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { CanonicalTreeManifestError, canonicalTreePath, inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { ExportClosureError, localAssetReferences, resolveStaticClosure } from "../src/services/export-closure";
import { buildHtmlArchiveManifest, HTML_EXPORT_MANIFEST, validateHtmlArchive } from "../src/services/export-html-validation";
import { canonicalJson, sha256 } from "../src/services/export-receipt";

const digest = "a".repeat(64);

/**
 * Removes a directory link itself, never what it points at and never through a recursive walk: a Windows junction is a
 * directory entry (rmdir), a POSIX symlink is a file entry (unlink). Bun's `rm` fails with EFAULT on a Windows directory link.
 */
const removeDirectoryLink = (link: string): Promise<void> => (process.platform === "win32" ? rmdir(link) : unlink(link));

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
    // An import whose binding is never used, and a side-effect import, must not be trimmed away by the parser.
    expect(await closureOutcome({ "index.html": html, "app.js": 'import x from "https://cdn.example/x.js";\n' })).toBe("remote_asset:https://cdn.example/x.js");
    expect(await closureOutcome({ "index.html": html, "app.js": 'import "https://cdn.example/x.js";\n' })).toBe("remote_asset:https://cdn.example/x.js");
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

  // References are URL text, resolved with POSIX rules on every OS; an image, a fetched link and a module import share one resolver.
  const referenceOutcomes = async (reference: string): Promise<readonly string[]> => [
    await closureOutcome({ "index.html": page("", `<img src="${reference}">`), "a.png": "image" }),
    await closureOutcome({ "index.html": page(`<link rel="stylesheet" href="${reference}">`, ""), "a.png": "image" }),
    await closureOutcome({ "index.html": page("", '<script type="module" src="app.js"></script>'), "app.js": `import ${JSON.stringify(reference)};\n`, "a.png": "image" }),
  ];

  test("Given references written as Windows paths with a drive letter, backslashes or a UNC share When the export closure resolves Then each is refused and no host path is read", async () => {
    // Given: a browser reads a drive letter as a URL scheme and a backslash as a slash, so none of these names a project file.
    const refused: readonly (readonly [string, string])[] = [
      [String.raw`C:\Users\qa\project\a.png`, "remote_asset"],
      ["C:/Users/qa/project/a.png", "remote_asset"],
      ["file:///C:/Users/qa/project/a.png", "remote_asset"],
      [String.raw`\\server\share\a.png`, "unsafe_asset"],
      [String.raw`images\a.png`, "unsafe_asset"],
      [String.raw`..\a.png`, "unsafe_asset"],
      ["images%5Ca.png", "unsafe_asset"],
    ];
    for (const [reference, code] of refused) {
      // When / Then
      expect(await referenceOutcomes(reference)).toEqual([`${code}:${reference}`, `${code}:${reference}`, `${code}:${reference}`]);
    }
  });

  test("Given references written as POSIX absolute paths When the export closure resolves Then they resolve against the project root and never against the host file system", async () => {
    // Given: a leading slash is root-relative to the project, and a file: URL is remote.
    const outcomes: readonly (readonly [string, string])[] = [
      ["/home/qa/project/a.png", "missing_asset:home/qa/project/a.png"],
      ["/Users/qa/project/a.png", "missing_asset:Users/qa/project/a.png"],
      ["file:///home/qa/project/a.png", "remote_asset:file:///home/qa/project/a.png"],
      ["file:///Users/qa/project/a.png", "remote_asset:file:///Users/qa/project/a.png"],
      ["../../etc/passwd", "unsafe_asset:../../etc/passwd"],
    ];
    for (const [reference, outcome] of outcomes) {
      // When / Then
      expect(await referenceOutcomes(reference)).toEqual([outcome, outcome, outcome]);
    }
    // When / Then: the same spelling that does name a project file resolves to it.
    expect(await referenceOutcomes("/a.png")).toEqual(["resolved:a.png", "resolved:a.png", "resolved:a.png,app.js"]);
  });

  test("Given the temp directory reached through a link (a junction on Windows, a symlink elsewhere), and on Windows through its 8.3 short name When an HTML archive is validated Then the entrypoint closure resolves", async () => {
    // Given
    const base = await mkdtemp(path.join(tmpdir(), "bg-html-validate-link-")); const real = path.join(base, "bg long temp directory"); const link = path.join(base, "link");
    // "junction" needs no privilege on Windows and is an ordinary symlink on every other OS, so this case never skips.
    await mkdir(real); await symlink(real, link, "junction");
    const temps = [link];
    if (process.platform === "win32") {
      // NTFS gives the only long name in a fresh directory the short name BGLONG~1. CI must prove it; a volume with 8.3 names turned off has no such alias.
      const short = path.join(base, "BGLONG~1");
      if (process.env["CI"] !== undefined || existsSync(short)) temps.push(short);
    }
    const saved = { TMPDIR: process.env["TMPDIR"], TEMP: process.env["TEMP"], TMP: process.env["TMP"] };
    const html = new TextEncoder().encode("<html><body><img src=asset.png></body></html>"); const asset = Uint8Array.from([1, 2, 3]);
    const expected = { schema_version: 1 as const, entrypoint: "index.html", project_revision: 7, project_digest: digest, input_closure_digest: "b".repeat(64) };
    const manifest = buildHtmlArchiveManifest(expected, [{ path: "index.html", size: html.length, sha256: sha256(html) }, { path: "asset.png", size: asset.length, sha256: sha256(asset) }]);
    const zip = new JSZip(); zip.file("index.html", html); zip.file("asset.png", asset); zip.file(HTML_EXPORT_MANIFEST, canonicalJson(manifest));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    try {
      for (const temp of temps) {
        process.env["TMPDIR"] = temp; process.env["TEMP"] = temp; process.env["TMP"] = temp;
        // When / Then
        expect((await validateHtmlArchive(bytes, expected)).entries).toEqual(manifest.entries);
      }
    } finally {
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      await removeDirectoryLink(link); await rm(base, { recursive: true, force: true });
    }
  });
});

describe("export closure root aliases", () => {
  test("Given a project root reached through a linked parent, and on Windows through its 8.3 short name When the tree is inspected and the closure resolves Then entries, digest and references match the direct spelling", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "bg-export-alias-")); const link = path.join(base, "link");
    try {
      // Given
      const real = path.join(base, "real"); const project = path.join(real, "bg long project directory");
      await mkdir(path.join(project, "assets"), { recursive: true });
      await writeFile(path.join(project, "index.html"), '<html><body><img src="assets/a.png"><script type="module" src="app.js"></script></body></html>');
      await writeFile(path.join(project, "app.js"), 'import "./assets/lib.js";\n'); await writeFile(path.join(project, "assets", "a.png"), "image"); await writeFile(path.join(project, "assets", "lib.js"), "export {};\n");
      // A junction on Windows (no privilege needed), a symlink on every other OS.
      await symlink(real, link, "junction");
      const aliases = [path.join(link, "bg long project directory")];
      if (process.platform === "win32") {
        // NTFS gives the only long name in a fresh directory the short name BGLONG~1. CI must prove it; a volume with 8.3 names turned off has no such alias.
        const short = path.join(real, "BGLONG~1");
        if (process.env["CI"] !== undefined || existsSync(short)) aliases.push(short);
      }
      const direct = await inspectCanonicalTree(project);
      expect(direct.files.map((file) => file.path)).toEqual(["app.js", "assets/a.png", "assets/lib.js", "index.html"]);
      for (const alias of aliases) {
        // When
        const manifest = await inspectCanonicalTree(alias);
        // Then
        expect(manifest).toEqual(direct);
        expect((await resolveStaticClosure(alias, "index.html", manifest)).referenced_paths).toEqual(["app.js", "assets/a.png", "assets/lib.js"]);
      }
      // Then: a root that is itself the link stays refused on every OS.
      await expect(inspectCanonicalTree(link)).rejects.toMatchObject({ code: "unsafe_tree_entry" });
    } finally { await removeDirectoryLink(link); await rm(base, { recursive: true, force: true }); }
  });

  const refusedAlias = (base: string, target: string, flavor: path.PlatformPath): string => {
    try { return canonicalTreePath(base, target, flavor); }
    catch (error) { if (!(error instanceof CanonicalTreeManifestError)) throw error; return error.code; }
  };

  test("Given Windows spellings of a root and its entry (drive letter, case, UNC share) When the manifest path is named Then it is root-relative with forward slashes, and a junction, 8.3 short-name or other-drive alias of the root is refused", () => {
    // Given
    const entry = String.raw`C:\Users\qa\project\assets\a.png`;
    // When / Then: the spelling realpath returns, whatever the case of the drive or a directory.
    expect(canonicalTreePath(String.raw`C:\Users\qa\project`, entry, path.win32)).toBe("assets/a.png");
    expect(canonicalTreePath(String.raw`c:\users\QA\project`, entry, path.win32)).toBe("assets/a.png");
    expect(canonicalTreePath(String.raw`\\server\share\project`, String.raw`\\server\share\project\assets\a.png`, path.win32)).toBe("assets/a.png");
    // When / Then: another spelling of the same directory is not a prefix of the entry.
    expect(refusedAlias(String.raw`C:\Users\QAUSER~1\project`, String.raw`C:\Users\qa-user-long\project\assets\a.png`, path.win32)).toBe("unsafe_tree_entry");
    expect(refusedAlias(String.raw`C:\junction\project`, entry, path.win32)).toBe("unsafe_tree_entry");
    expect(refusedAlias(String.raw`D:\Users\qa\project`, entry, path.win32)).toBe("unsafe_tree_entry");
    expect(refusedAlias(String.raw`C:\Users\qa\project`, String.raw`C:\Users\qa\project`, path.win32)).toBe("unsafe_tree_entry");
  });

  test("Given POSIX spellings of a root and its entry When the manifest path is named Then it is root-relative, and a symlinked, /private or differently cased alias of the root is refused", () => {
    // When / Then: Linux and macOS home directories.
    expect(canonicalTreePath("/home/qa/project", "/home/qa/project/assets/a.png", path.posix)).toBe("assets/a.png");
    expect(canonicalTreePath("/Users/qa/project", "/Users/qa/project/assets/a.png", path.posix)).toBe("assets/a.png");
    // When / Then: another spelling of the same directory is not a prefix of the entry.
    expect(refusedAlias("/home/qa/link/project", "/home/qa/real/project/assets/a.png", path.posix)).toBe("unsafe_tree_entry");
    expect(refusedAlias("/var/folders/qa/project", "/private/var/folders/qa/project/assets/a.png", path.posix)).toBe("unsafe_tree_entry");
    expect(refusedAlias("/Users/QA/project", "/Users/qa/project/assets/a.png", path.posix)).toBe("unsafe_tree_entry");
  });
});
