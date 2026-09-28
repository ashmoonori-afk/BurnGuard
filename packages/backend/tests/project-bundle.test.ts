import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";
import JSZip from "jszip";
import { PROJECT_BUNDLE_MANIFEST_PATH, parseProjectBundleManifest, type ProjectBundleManifest } from "@bg/shared";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { projectsDir, systemsDir } from "../src/lib/paths";
import { getProjectDetail } from "../src/db/project-read-repository";
import { getDesignSystemDetail } from "../src/db/seed";
import { getContentReceipt } from "../src/db/catalog-repository";
import { validateCatalogReceiptTree } from "../src/services/catalog-files";
import { projectBundleImportReceiptsDir, projectBundlePayloadStage, reconcileProjectBundleImports, writeBundleImportOwnerMarker, writeProjectBundleImportReceipt } from "../src/services/project-bundle-import-receipt";
import { symlink } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { exportProjectBundle, importProjectBundleFile } from "../src/services/project-bundle";
import { readProjectDesignSystemPin } from "../src/services/project-design-system-pin";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { reconcileArtifactState } from "../src/services/artifact-recovery";
import { listSessionAttachments } from "../src/db/attachments";
import { selectContextAttachments } from "../src/services/context";

const suffix = `${process.pid}-${crypto.randomUUID()}`;
const sourceProjectId = `bundle-source-${suffix}`;
const sourceSessionId = `bundle-session-${suffix}`;
const sourceSystemId = `bundle-system-${suffix}`;
const sourceProjectDir = path.join(projectsDir, sourceProjectId);
const sourceSystemDir = path.join(systemsDir, sourceSystemId);
const createdProjectIds: string[] = [];
const createdSystemIds: string[] = [];

beforeAll(async () => {
  await runMigrations();
  await mkdir(path.join(sourceProjectDir, ".attachments"), { recursive: true });
  await mkdir(path.join(sourceProjectDir, ".meta", "checkpoints", "snapshots", "turn-1"), { recursive: true });
  await mkdir(path.join(sourceProjectDir, "assets"), { recursive: true });
  await mkdir(path.join(sourceProjectDir, "docs", "attachments"), { recursive: true });
  await mkdir(path.join(sourceSystemDir, "fonts"), { recursive: true });
  await writeFile(path.join(sourceProjectDir, "index.html"), '<link rel="stylesheet" href="assets/site.css"><h1>portable</h1>');
  await writeFile(path.join(sourceProjectDir, "assets", "site.css"), 'body{font-family:"Bundle Missing Font QA"}');
  await writeFile(path.join(sourceProjectDir, ".attachments", "source.txt"), "retained source");
  await writeFile(path.join(sourceProjectDir, "docs", "attachments", "brief.md"), "# Retained brief");
  await writeFile(path.join(sourceProjectDir, ".meta", "checkpoints", "turn-1.json"), JSON.stringify({ turn_id: "turn-1", created_at: 11 }));
  await writeFile(path.join(sourceProjectDir, ".meta", "checkpoints", "snapshots", "turn-1", "index.html"), "<h1>before</h1>");
  await writeFile(path.join(sourceSystemDir, "SKILL.md"), "# Custom system");
  await writeFile(path.join(sourceSystemDir, "colors_and_type.css"), ':root{--brand:#123456;font-family:"Bundle Missing Font QA"}');
  await writeFile(path.join(sourceSystemDir, "fonts", "custom.woff2"), Buffer.from("wOF2custom"));
  await writeFile(path.join(sourceSystemDir, "README.md"), "# Custom system");
  await writeFile(path.join(sourceSystemDir, "fonts", "fonts.css"), "");
  const sidecarContent = { entries: [{ path: "SKILL.md" }] };
  await writeFile(path.join(sourceSystemDir, "extraction-provenance.json"), JSON.stringify({
    schema_version: 1, digest_algorithm: "sha256", generated_at: 1, content: sidecarContent,
    content_digest: createHash("sha256").update(JSON.stringify(sidecarContent)).digest("hex"),
  }));
  const tree = await inspectCanonicalTree(sourceProjectDir);
  const context = "custom pinned context";
  const tokens = ":root{--brand:#123456}";
  const pinDigest = createHash("sha256").update(JSON.stringify([context, tokens])).digest("hex");
  const db = getSqlite();
  db.prepare("INSERT INTO design_systems(id,name,description,status,source_type,is_template,dir_path,skill_md_path,tokens_css_path,readme_md_path,created_at,updated_at) VALUES (?,?,?,'published','manual',0,?,?,?,NULL,1,1)")
    .run(sourceSystemId, "Custom portable system", "description", sourceSystemDir, path.join(sourceSystemDir, "SKILL.md"), path.join(sourceSystemDir, "colors_and_type.css"));
  db.prepare("INSERT INTO projects(id,name,type,design_system_id,dir_path,entrypoint,backend_id,options_json,created_at,updated_at,current_revision,current_digest) VALUES (?,?,'prototype',?,?,'index.html','codex',NULL,1,1,7,?)")
    .run(sourceProjectId, "Portable source", sourceSystemId, sourceProjectDir, tree.tree_digest);
  db.prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)")
    .run(sourceSessionId, sourceProjectId);
  db.prepare("INSERT INTO attachments(id,session_id,turn_id,file_path,mime_type,original_name,size_bytes,sha256,source_role,source_role_explicit,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,1)")
    .run(`attachment-${suffix}`, sourceSessionId, "turn-1", path.join(sourceProjectDir, ".attachments", "source.txt"), "text/plain", "source.txt", 15, createHash("sha256").update("retained source").digest("hex"), "ordinary_content", 1);
  db.prepare("INSERT INTO project_design_system_pins(project_id,system_id,revision,digest,context,tokens) VALUES (?,?,3,?,?,?)")
    .run(sourceProjectId, sourceSystemId, pinDigest, context, tokens);
  createdProjectIds.push(sourceProjectId);
  createdSystemIds.push(sourceSystemId);
});

afterAll(async () => {
  const db = getSqlite();
  for (const projectId of createdProjectIds) {
    const project = await getProjectDetail(projectId);
    db.prepare("DELETE FROM projects WHERE id=?").run(projectId);
    if (project) await rm(project.dir_path, { recursive: true, force: true });
  }
  for (const systemId of createdSystemIds) {
    const row = db.query<{ dir_path: string }, [string]>("SELECT dir_path FROM design_systems WHERE id=?").get(systemId);
    db.prepare("DELETE FROM design_systems WHERE id=?").run(systemId);
    if (row) await rm(row.dir_path, { recursive: true, force: true });
  }
});

test("Given a project with retained sources, checkpoints, a custom system, and a pin When bundled and imported Then a new editable project restores every portable part", async () => {
  // Given
  const exported = await exportProjectBundle(sourceProjectId);
  const zip = await JSZip.loadAsync(exported.bytes);
  const manifestEntry = zip.file(PROJECT_BUNDLE_MANIFEST_PATH);
  if (!manifestEntry) throw new Error("missing manifest");
  const manifest = parseProjectBundleManifest(JSON.parse(await manifestEntry.async("text")));

  // When
  const restored = await importProjectBundleFile(new File([exported.bytes], exported.filename), "Restored portable");
  createdProjectIds.push(restored.id);
  const project = await getProjectDetail(restored.id);
  if (!project) throw new Error("missing restored project");
  if (project.design_system_id) createdSystemIds.push(project.design_system_id);

  // Then
  expect(restored.id).not.toBe(sourceProjectId);
  expect(project.name).toBe("Restored portable");
  expect(project.current_revision).toBe(7);
  expect(await readFile(path.join(project.dir_path, "index.html"), "utf8")).toContain("portable");
  expect(await readFile(path.join(project.dir_path, ".attachments", "source.txt"), "utf8")).toBe("retained source");
  expect(await readFile(path.join(project.dir_path, "docs", "attachments", "brief.md"), "utf8")).toBe("# Retained brief");
  expect(await readFile(path.join(project.dir_path, ".meta", "checkpoints", "snapshots", "turn-1", "index.html"), "utf8")).toContain("before");
  expect(project.design_system_id).not.toBe(sourceSystemId);
  const restoredPin = readProjectDesignSystemPin(restored.id);
  expect(restoredPin?.system_id).toBe(project.design_system_id ?? "");
  expect(restoredPin?.context).not.toBe(manifest.design_system.pin?.context);
  expect(manifest.credential_exclusions).toContain("config.json");
  expect(restored.warnings).toContainEqual({ code: "missing_font", reference: "Bundle Missing Font QA" });
  const attachments = await listSessionAttachments(restored.session_id);
  const attachment = attachments[0];
  if (!attachment) throw new Error("missing restored attachment");
  expect(attachment.turn_id).toBe("turn-1");
  expect(selectContextAttachments(attachments, [], "continue")).toContain(attachment.file_path);
});

test("Given a restored bundle When startup reconciliation and a new edit run Then the baseline remains usable and revision history advances", async () => {
  // Given
  const exported = await exportProjectBundle(sourceProjectId);
  const restored = await importProjectBundleFile(new File([exported.bytes], exported.filename), "Restored lifecycle");
  createdProjectIds.push(restored.id);
  const before = await getProjectDetail(restored.id);
  if (!before?.current_digest) throw new Error("missing restored identity");
  if (before.design_system_id) createdSystemIds.push(before.design_system_id);

  // When
  await reconcileArtifactState(getSqlite());
  const operation = await new ArtifactCoordinator(getSqlite()).run({
    projectId: restored.id,
    projectDir: before.dir_path,
    kind: "turn",
    expectedRevision: before.current_revision,
    expectedArtifactDigest: before.current_digest,
    mutate: async (stage) => { await writeFile(path.join(stage, "after-restore.html"), "<h1>editable</h1>"); },
  });

  // Then
  expect(operation.status).toBe("committed");
  expect(operation.resultRevision).toBe(8);
  expect(await readFile(path.join(before.dir_path, "after-restore.html"), "utf8")).toContain("editable");
});

test("Given a bundle that references an unavailable builtin system When imported Then its archived pin stays inert and a warning identifies the missing ID", async () => {
  // Given
  const exported = await exportProjectBundle(sourceProjectId);
  const zip = await JSZip.loadAsync(exported.bytes);
  const manifestEntry = zip.file(PROJECT_BUNDLE_MANIFEST_PATH);
  if (!manifestEntry) throw new Error("missing manifest");
  const original = parseProjectBundleManifest(JSON.parse(await manifestEntry.async("text")));
  const missingId = "builtin-theme-not-installed";
  for (const file of original.files.filter((entry) => entry.kind === "design_system")) zip.remove(file.path);
  const manifest = {
    ...original,
    files: original.files.filter((entry) => entry.kind !== "design_system"),
    design_system: { kind: "builtin" as const, id: missingId, pin: original.design_system.pin },
    fonts: {
      families: original.fonts.families,
      files: original.fonts.files.filter((filePath) => !filePath.startsWith("design-system/")),
    },
  };
  zip.file(PROJECT_BUNDLE_MANIFEST_PATH, JSON.stringify(manifest));
  const file = new File([await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })], "missing-system.burnguard-project");

  // When
  const restored = await importProjectBundleFile(file, "Missing builtin");
  createdProjectIds.push(restored.id);

  // Then
  expect(restored.warnings).toContainEqual({ code: "missing_builtin_design_system", reference: missingId });
  expect((await getProjectDetail(restored.id))?.design_system_id).toBeNull();
  expect(readProjectDesignSystemPin(restored.id)).toBeNull();
});

test("Given an external edit during export When the snapshot is confirmed Then the bundle fails instead of mixing revisions", async () => {
  // Given
  const entrypoint = path.join(sourceProjectDir, "index.html");
  const original = await readFile(entrypoint);

  // When / Then
  try {
    await expect(exportProjectBundle(sourceProjectId, {
      afterProjectRead: async () => { await writeFile(entrypoint, "<h1>racing edit</h1>"); },
    })).rejects.toMatchObject({ code: "project_bundle_unavailable" });
  } finally {
    await writeFile(entrypoint, original);
  }
});

async function rewrittenBundle(mutate: (manifest: ProjectBundleManifest, zip: JSZip) => ProjectBundleManifest): Promise<File> {
  const exported = await exportProjectBundle(sourceProjectId);
  const zip = await JSZip.loadAsync(exported.bytes);
  const entry = zip.file(PROJECT_BUNDLE_MANIFEST_PATH);
  if (!entry) throw new Error("missing manifest");
  const manifest = mutate(parseProjectBundleManifest(JSON.parse(await entry.async("text"))), zip);
  zip.file(PROJECT_BUNDLE_MANIFEST_PATH, JSON.stringify(manifest));
  return new File([await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })], "rewritten.burnguard-project");
}

test("Given archived options with unknown fields When imported Then only allowlisted project options are stored", async () => {
  const file = await rewrittenBundle((manifest) => ({
    ...manifest,
    project: { ...manifest.project, options_json: JSON.stringify({ copy_as_is: true, provider_api_key: "sk-bundle-secret", cache_dir: "/Users/someone/private" }) },
  }));

  const restored = await importProjectBundleFile(file, "Options allowlist");
  createdProjectIds.push(restored.id);
  const stored = (await getProjectDetail(restored.id))?.options_json ?? "";
  const detail = await getProjectDetail(restored.id);
  if (detail?.design_system_id) createdSystemIds.push(detail.design_system_id);

  expect(JSON.parse(stored).copy_as_is).toBe(true);
  expect(stored).not.toContain("sk-bundle-secret");
  expect(stored).not.toContain("/Users/someone");
});

test("Given a bundle carrying server scratch inputs When imported Then it is rejected", async () => {
  const payload = new TextEncoder().encode("scratch prompt");
  const file = await rewrittenBundle((manifest, zip) => {
    zip.file("project/.burnguard-inputs/prompt.txt", payload);
    return {
      ...manifest,
      files: [...manifest.files, { path: "project/.burnguard-inputs/prompt.txt", kind: "attachment", size_bytes: payload.byteLength, sha256: createHash("sha256").update(payload).digest("hex") }],
    };
  });

  await expect(importProjectBundleFile(file, "Scratch")).rejects.toMatchObject({ code: "invalid_project_bundle" });
});

test("Given archived template and sample provenance for a custom system When imported Then the copy is a plain manual system", async () => {
  const file = await rewrittenBundle((manifest) => manifest.design_system.kind !== "custom" ? manifest : ({
    ...manifest,
    design_system: { ...manifest.design_system, is_template: true, source_type: "sample" },
  }));

  const restored = await importProjectBundleFile(file, "Provenance");
  createdProjectIds.push(restored.id);
  const detail = await getProjectDetail(restored.id);
  if (!detail?.design_system_id) throw new Error("missing restored system");
  createdSystemIds.push(detail.design_system_id);
  const system = await getDesignSystemDetail(detail.design_system_id);

  expect(system?.is_template).toBe(false);
  expect(system?.source_type).toBe("manual");
});

function addBundleFile(manifest: ProjectBundleManifest, zip: JSZip, archivePath: string, text: string): ProjectBundleManifest {
  const bytes = new TextEncoder().encode(text);
  zip.file(archivePath, bytes);
  return { ...manifest, files: [...manifest.files, { path: archivePath, kind: "design_system", size_bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") }] };
}

test("Given a leftover import receipt from a crash When startup reconciliation runs Then the uncommitted project and system are removed", async () => {
  const exported = await exportProjectBundle(sourceProjectId);
  const restored = await importProjectBundleFile(new File([exported.bytes], exported.filename), "Crashed import");
  const detail = await getProjectDetail(restored.id);
  if (!detail?.design_system_id) throw new Error("missing restored system");
  const operationId = "01J00000000000000000000000";
  await mkdir(projectBundlePayloadStage(operationId), { recursive: true });
  await writeBundleImportOwnerMarker(detail.dir_path, operationId);
  const system = await getDesignSystemDetail(detail.design_system_id);
  if (!system) throw new Error("missing restored system row");
  await writeBundleImportOwnerMarker(system.dir_path, operationId);
  await writeProjectBundleImportReceipt({ schema_version: 1, operation_id: operationId, project_id: restored.id, system_id: detail.design_system_id, phase: "pending" });

  const result = await reconcileProjectBundleImports(getSqlite());

  expect(result.rolled_back).toBe(1);
  expect(await getProjectDetail(restored.id)).toBeNull();
  expect(await getDesignSystemDetail(detail.design_system_id)).toBeNull();
  expect(await readdir(projectBundleImportReceiptsDir())).toEqual([]);
});

test("Given a successful import When it completes Then no import receipt or payload stage is left behind", async () => {
  const exported = await exportProjectBundle(sourceProjectId);
  const restored = await importProjectBundleFile(new File([exported.bytes], exported.filename), "Clean import");
  createdProjectIds.push(restored.id);
  const detail = await getProjectDetail(restored.id);
  if (detail?.design_system_id) createdSystemIds.push(detail.design_system_id);

  expect(await readdir(projectBundleImportReceiptsDir())).toEqual([]);
});

test("Given a restored extraction system When imported Then it carries a committed content receipt that validates against its bytes", async () => {
  const exported = await exportProjectBundle(sourceProjectId);
  const restored = await importProjectBundleFile(new File([exported.bytes], exported.filename), "Catalog receipt");
  createdProjectIds.push(restored.id);
  const detail = await getProjectDetail(restored.id);
  if (!detail?.design_system_id) throw new Error("missing restored system");
  createdSystemIds.push(detail.design_system_id);
  const system = await getDesignSystemDetail(detail.design_system_id);
  const receipt = getContentReceipt(getSqlite(), detail.design_system_id);

  expect(receipt?.status).toBe("committed");
  if (!receipt || !system) throw new Error("missing receipt");
  await expect(validateCatalogReceiptTree(system.dir_path, receipt)).resolves.toBeDefined();
});

test("Given a custom system without a verifiable sidecar When imported Then the bundle is rejected and nothing is left behind", async () => {
  const file = await rewrittenBundle((manifest, zip) => {
    zip.remove("design-system/extraction-provenance.json");
    return { ...manifest, files: manifest.files.filter((entry) => entry.path !== "design-system/extraction-provenance.json") };
  });

  await expect(importProjectBundleFile(file, "No sidecar")).rejects.toMatchObject({ code: "invalid_project_bundle" });
  expect(await readdir(projectBundleImportReceiptsDir())).toEqual([]);
});

test("Given a malformed or path-bearing receipt When startup reconciliation runs Then it is quarantined and deletes nothing", async () => {
  const root = projectBundleImportReceiptsDir();
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "01J00000000000000000000001.json"), JSON.stringify({ schema_version: 1, operation_id: "01J00000000000000000000001", project_id: sourceProjectId, system_id: null, phase: "pending", staging_paths: [projectsDir] }));

  const result = await reconcileProjectBundleImports(getSqlite());

  expect(result.quarantined).toBe(1);
  expect(await getProjectDetail(sourceProjectId)).not.toBeNull();
  await rm(path.join(root, "01J00000000000000000000001.json.quarantined"), { force: true });
});

test("Given a project restored with a missing builtin system When exported again Then the builtin reference survives", async () => {
  const file = await rewrittenBundle((manifest, zip) => {
    for (const entry of manifest.files.filter((item) => item.kind === "design_system")) zip.remove(entry.path);
    return {
      ...manifest,
      files: manifest.files.filter((entry) => entry.kind !== "design_system"),
      design_system: { kind: "builtin", id: "builtin-theme-gone", pin: null },
      fonts: { families: manifest.fonts.families, files: manifest.fonts.files.filter((item) => !item.startsWith("design-system/")) },
    };
  });
  const restored = await importProjectBundleFile(file, "Missing builtin round trip");
  createdProjectIds.push(restored.id);

  const again = await exportProjectBundle(restored.id);

  expect(again.manifest.design_system).toEqual({ kind: "builtin", id: "builtin-theme-gone", pin: null });
});

test("Given a pending receipt naming a project it never marked When startup reconciliation runs Then that project is untouched", async () => {
  const operationId = "01J00000000000000000000002";
  const victim = "01J0000000000000000000ABCD";
  const root = path.join(projectsDir, victim);
  await mkdir(root, { recursive: true });
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(victim, "Unrelated", root);
  createdProjectIds.push(victim);
  await writeProjectBundleImportReceipt({ schema_version: 1, operation_id: operationId, project_id: victim, system_id: null, phase: "pending" });

  await reconcileProjectBundleImports(getSqlite());

  expect(await getProjectDetail(victim)).not.toBeNull();
});

test("Given a receipt whose project directory is a link to another project When reconciled Then the link is never followed", async () => {
  const operationId = "01J00000000000000000000003";
  const linked = "01J0000000000000000000WXYZ";
  await writeBundleImportOwnerMarker(sourceProjectDir, operationId);
  await symlink(sourceProjectDir, path.join(projectsDir, linked), "dir");
  await writeProjectBundleImportReceipt({ schema_version: 1, operation_id: operationId, project_id: linked, system_id: null, phase: "pending" });

  await reconcileProjectBundleImports(getSqlite());

  expect(await readFile(path.join(sourceProjectDir, "index.html"), "utf8")).toContain("portable");
  await rm(path.join(projectsDir, linked), { force: true });
  await rm(path.join(sourceProjectDir, ".meta", "bundle-import-owner.json"), { force: true });
});
