import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";
import JSZip from "jszip";
import { PROJECT_BUNDLE_MANIFEST_PATH, parseProjectBundleManifest } from "@bg/shared";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { projectsDir, systemsDir } from "../src/lib/paths";
import { getProjectDetail } from "../src/db/project-read-repository";
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
  expect(readProjectDesignSystemPin(restored.id)?.digest).toBe(manifest.design_system.pin?.digest);
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

test("Given a bundle that references an unavailable builtin system When imported Then its pin survives and a warning identifies the missing ID", async () => {
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
  expect(readProjectDesignSystemPin(restored.id)?.system_id).toBe(missingId);
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
