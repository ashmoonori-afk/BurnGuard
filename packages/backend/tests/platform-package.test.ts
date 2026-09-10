import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import type { ExportOptions } from "@bg/shared";
import { runMigrations } from "../src/db/migrate-local";
import { advanceExportAttempt, completeExportAttempt, createExportAuthority } from "../src/db/export-lifecycle-repository";
import { getSqlite } from "../src/db/sqlite-client";
import { exportsDir } from "../src/lib/paths";
import { verifyExportDownload, ExportDownloadError } from "../src/services/export-download";
import { buildPlatformPackage, PLATFORM_TRANSFORMATION_VERSION } from "../src/services/export-platform-package";
import { ExportPackageError, type PlatformPackageManifest } from "../src/services/export-package-validation";
import { canonicalJson, parseExportReceipt, sha256, type ExportReceipt } from "../src/services/export-receipt";
import { FIXTURE_ENTRYPOINT, stagePlatformFixture } from "./helpers/platform-package-fixture";

const CAFE24_BASE = "/web/upload/burnguard/shop-site/";
const projectName = "Shop Site";
const roots: string[] = [];

afterAll(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function stage(main?: string): Promise<string> {
  const root = await stagePlatformFixture(main);
  roots.push(root);
  return root;
}

async function build(format: "cafe24_package" | "imweb_package", options: ExportOptions = {}, main?: string) {
  const stagedDir = await stage(main);
  const outputPath = path.join(path.dirname(stagedDir), `${path.basename(stagedDir)}-artifact.zip`);
  const validation = await buildPlatformPackage({
    paths: { staged: stagedDir, scratch: path.join(path.dirname(stagedDir), `${path.basename(stagedDir)}-package`), output: outputPath },
    format,
    options,
    project: { name: projectName, entrypoint: FIXTURE_ENTRYPOINT, revision: 4, digest: "a".repeat(64) },
  });
  const bytes = new Uint8Array(await readFile(outputPath));
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.values(zip.files).filter((entry) => !entry.dir).map((entry) => entry.name).sort();
  const text = async (name: string): Promise<string> => {
    const file = zip.file(name);
    if (file === null) throw new TypeError(`missing package entry: ${name}`);
    return file.async("string");
  };
  return { validation, outputPath, bytes, names, text, lint: async () => JSON.parse(await text("lint.json")) as { readonly findings: readonly { readonly code: string; readonly severity: string }[] } };
}

describe("cafe24 smart design package", () => {
  test("Given a staged two-page site When the cafe24 package is built Then layout, fragments and rewritten assets ship together", async () => {
    // Given / When
    const built = await build("cafe24_package");

    // Then
    expect(built.names).toContain("layout/burnguard-layout.html");
    expect(built.names).toContain("pages/home.html");
    expect(built.names).toContain("pages/about.html");
    expect(built.names).toContain("GUIDE.html");
    expect(built.names).toContain("lint.json");
    expect(built.names).toContain("burnguard-export.json");
    expect(built.names.filter((name) => name.startsWith("web/shop-site/"))).not.toHaveLength(0);
    expect(built.validation).toEqual({ entries: built.names.length - 1 });
  });

  test("Given the built package When each fragment is read Then it opens with the layout directive and the layout holds one contents marker", async () => {
    // Given
    const built = await build("cafe24_package");

    // When
    const fragments = await Promise.all(built.names.filter((name) => name.startsWith("pages/")).map(built.text));
    const layout = await built.text("layout/burnguard-layout.html");

    // Then
    for (const fragment of fragments) expect(fragment.startsWith("<!--@layout(/layout/burnguard-layout.html)-->\n")).toBe(true);
    expect(layout.match(/<!--@contents-->/gu)).toHaveLength(1);
    expect(layout).toContain("<!doctype html>");
    expect(fragments.some((fragment) => fragment.includes("<style>"))).toBe(true);
  });

  test("Given closure assets When the package is built Then every reference points at the asset base url", async () => {
    // Given
    const built = await build("cafe24_package");

    // When
    const documents = await Promise.all([...built.names.filter((name) => name.startsWith("pages/")), "layout/burnguard-layout.html"].map(built.text));
    const css = await built.text("web/shop-site/css/site.css");

    // Then
    for (const document of documents) {
      expect(document).not.toMatch(/(?:src|href)="(?:img|css|js|fonts)\//u);
      expect(document).not.toMatch(/srcset="[^"]*(?:^|\s)img\//u);
    }
    expect(documents.join("")).toContain(`${CAFE24_BASE}img/hero.png`);
    expect(documents.join("")).toContain(`${CAFE24_BASE}css/site.css`);
    expect(css).toContain(`${CAFE24_BASE}img/bg.png`);
    expect(css).toContain(`${CAFE24_BASE}css/base.css`);
  });

  test("Given a configured asset base url When the package is built Then that host is used instead of the default", async () => {
    const built = await build("cafe24_package", { asset_base_url: "https://cdn.example.com/burnguard" });
    expect(await built.text("pages/home.html")).toContain("https://cdn.example.com/burnguard/img/hero.png");
  });

  test("Given woff2 fonts and a jQuery include When the package is linted Then both warnings are recorded and the export still succeeds", async () => {
    // Given / When
    const built = await build("cafe24_package");
    const lint = await built.lint();

    // Then
    expect(lint.findings.map((finding) => finding.code)).toContain("cafe24_disallowed_extension");
    expect(lint.findings.map((finding) => finding.code)).toContain("cafe24_jquery_duplicate");
    expect(lint.findings.every((finding) => finding.severity !== "error")).toBe(true);
    expect(built.names).toContain("web/shop-site/fonts/OFL.txt");
  });

  test("Given inter-page navigation When the package is built Then the relative href survives with an informational finding", async () => {
    const built = await build("cafe24_package");
    expect(await built.text("layout/burnguard-layout.html")).toContain("./about.html");
    const links = (await built.lint()).findings.filter((finding) => finding.code === "cafe24_unresolved_link");
    expect(links).not.toHaveLength(0);
    expect(links.every((finding) => finding.severity === "info")).toBe(true);
  });
});

describe("imweb code widget package", () => {
  test("Given a staged site When the imweb package is built Then fragments carry no document chrome and comments are stripped", async () => {
    // Given / When
    const built = await build("imweb_package");
    const fragment = await built.text("pages/home.imweb.html");

    // Then
    expect(built.names).toContain("common/header-code.html");
    expect(built.names).toContain("common/footer-code.html");
    expect(fragment).not.toMatch(/<html|<head|<body|data-bg-shared/iu);
    expect(fragment).not.toContain("editorial note");
    expect(fragment).toContain('<div class="bg-site bg-page-home">');
    expect(fragment).toContain("대문 이미지");
  });

  test("Given shared and page CSS When the package is built Then every selector is scoped and root selectors are remapped", async () => {
    // Given / When
    const built = await build("imweb_package");
    const header = await built.text("common/header-code.html");
    const fragment = await built.text("pages/home.imweb.html");

    // Then
    expect(header).not.toMatch(/(?:^|[};])\s*(?::root|html|body)\s*[,{]/mu);
    expect(header).toContain(".bg-site{--brand:#123456}");
    expect(fragment).toContain(".bg-site .hero");
    expect(fragment).toContain("@media (min-width:600px)");
  });

  test("Given a small image When the fragment is built Then it is inlined as a data uri", async () => {
    expect(await (await build("imweb_package")).text("pages/home.imweb.html")).toContain("data:image/png;base64,");
  });

  test("Given an image over the inline budget and no asset base url When linted Then hosting is requested and the reference is kept", async () => {
    // Given / When
    const built = await build("imweb_package");
    const lint = await built.lint();

    // Then
    const hosting = lint.findings.filter((finding) => finding.code === "imweb_image_needs_hosting");
    expect(hosting).not.toHaveLength(0);
    expect(hosting.every((finding) => finding.severity === "warning")).toBe(true);
  });

  test("Given an asset base url When an oversized image is rewritten Then no hosting finding remains", async () => {
    const lint = await (await build("imweb_package", { asset_base_url: "https://cdn.example.com/burnguard" })).lint();
    expect(lint.findings.map((finding) => finding.code)).not.toContain("imweb_image_needs_hosting");
  });

  test("Given a fragment over one million characters When the package is built Then the export fails as a platform lint failure", async () => {
    // Given
    const oversized = `<section class="hero" id="hero"><p>${"가".repeat(1_000_001)}</p></section>`;

    // When / Then
    await expect(build("imweb_package", {}, oversized)).rejects.toMatchObject({ name: "ExportError", code: "platform_lint_failed" });
  });
});

describe("platform package boundaries", () => {
  test.each(["cafe24_package", "imweb_package"] as const)("Given private project documents When %s is built Then they never enter the archive", async (format) => {
    const built = await build(format);
    expect(built.names.some((name) => name.includes("docs/attachments") || name.includes("private-brief"))).toBe(false);
  });

  test.each(["cafe24_package", "imweb_package"] as const)("Given a built %s When one entry is edited Then package validation rejects the archive", async (format) => {
    // Given
    const built = await build(format);
    const zip = await JSZip.loadAsync(built.bytes);
    const victim = built.names.find((name) => name.startsWith("pages/"));
    if (victim === undefined) throw new TypeError("no page fragment to tamper with");
    zip.file(victim, `${await built.text(victim)}<!-- injected -->`);
    const tampered = await zip.generateAsync({ type: "uint8array" });

    // When / Then
    const { validatePlatformPackage } = await import("../src/services/export-package-validation");
    const manifest: PlatformPackageManifest = JSON.parse(await built.text("burnguard-export.json"));
    await expect(validatePlatformPackage(tampered, manifest)).rejects.toBeInstanceOf(ExportPackageError);
  });

  test.each(["cafe24_package", "imweb_package"] as const)("Given a published %s receipt When the download is verified Then identity holds and tampering is rejected", async (format) => {
    // Given
    await runMigrations();
    const built = await build(format);
    const db = getSqlite();
    const projectId = `platform-${format}-${process.pid}`;
    db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at,current_revision,current_digest) VALUES (?,?,'prototype',?,?,'codex',1,1,4,?)").run(projectId, projectName, `/tmp/${projectId}`, FIXTURE_ENTRYPOINT, "a".repeat(64));
    const options: ExportOptions = {};
    const ids = createExportAuthority(db, { projectId, revision: 4, digest: "a".repeat(64), designSystemDigest: null, format, options, rendererDigest: "b".repeat(64), captureDigest: "c".repeat(64) });
    advanceExportAttempt(db, { attemptId: ids.attemptId, status: "running", stage: "rendering", inputClosureDigest: "d".repeat(64), designSystemDigest: null });
    advanceExportAttempt(db, { attemptId: ids.attemptId, status: "validating", stage: "publishing" });
    const published = path.join(exportsDir, "attempts", ids.attemptId);
    await mkdir(published, { recursive: true });
    const outputPath = path.join(published, "artifact.zip");
    await writeFile(outputPath, built.bytes);
    const receipt: ExportReceipt = {
      schema_version: 1, job_id: ids.jobId, attempt_id: ids.attemptId, parent_attempt_id: null, format,
      project: { id: projectId, revision: 4, digest: "a".repeat(64) }, options, output_file: "artifact.zip", output_size: built.bytes.byteLength,
      digests: { input_closure: "d".repeat(64), design_system: null, options: sha256(canonicalJson(options)), renderer: "b".repeat(64), capture: "c".repeat(64), output: sha256(built.bytes) },
      validation: built.validation,
    };
    const receiptJson = canonicalJson(receipt);
    await writeFile(path.join(published, "receipt.json"), receiptJson);
    completeExportAttempt(db, { ...ids, outputPath, size: built.bytes.byteLength, outputDigest: sha256(built.bytes), receiptDigest: sha256(receiptJson) });

    // When
    const verified = await verifyExportDownload(ids.jobId);

    // Then
    expect(verified).toMatchObject({ path: outputPath, format, projectId, revision: 4 });
    expect(parseExportReceipt(JSON.parse(receiptJson)).validation).toEqual(built.validation);
    expect(PLATFORM_TRANSFORMATION_VERSION).toBe(1);

    // When the published bytes are tampered with
    await writeFile(outputPath, new Uint8Array([...built.bytes.slice(0, built.bytes.byteLength - 1), (built.bytes[built.bytes.byteLength - 1] ?? 0) ^ 0xff]));
    await expect(verifyExportDownload(ids.jobId)).rejects.toBeInstanceOf(ExportDownloadError);
  });
});
