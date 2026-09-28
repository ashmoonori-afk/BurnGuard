import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { ulid } from "ulid";
import {
  parseBundledFontManifest,
  type ProjectBundleDesignSystem,
  type ProjectBundleFile,
  type ProjectBundleImportResponse,
  type ProjectBundleImportWarning,
} from "@bg/shared";
import { getSqlite } from "../db/sqlite-client";
import { createDesignSystemRecord, createProjectRecord, getDesignSystemDetail } from "../db/seed";
import { projectsDir, resolveRepoRoot, systemsDir } from "../lib/paths";
import { resolveWithin } from "../security/path-boundary";
import { inspectCanonicalTree } from "./canonical-tree-manifest";
import { indexProjectFiles } from "./managed-project-files";
import { getLocalFonts } from "./local-fonts";
import { readProjectBundleZip } from "./project-bundle-archive";
import { ProjectBundleError } from "./project-bundle-error";
import { validateProjectBundleMetadata } from "./project-bundle-validation";
import { parseProjectOptions } from "./project-options";
import { ensureProjectDesignSystemPin } from "./project-design-system-pin";
import { clearProjectBundleImportReceipt, projectBundlePayloadStage, projectBundleSystemStage, writeProjectBundleImportReceipt } from "./project-bundle-import-receipt";
import { commitDesignSystemReceipt, prepareDesignSystemReceipt } from "../db/design-system-repository";
import { getDb } from "../db/client";
import { ExtractionSidecarError, readValidatedExtractionSidecar } from "./extraction-sidecar";

export async function importProjectBundleFile(file: File, name?: string): Promise<ProjectBundleImportResponse> {
  const operationId = ulid();
  const projectId = ulid();
  const payloadStage = projectBundlePayloadStage(operationId);
  await writeProjectBundleImportReceipt({ schema_version: 1, operation_id: operationId, project_id: projectId, system_id: null, phase: "pending" });
  let manifest: Awaited<ReturnType<typeof readProjectBundleZip>>["manifest"];
  let entries: Awaited<ReturnType<typeof readProjectBundleZip>>["entries"];
  try {
    await mkdir(payloadStage, { recursive: false });
    ({ manifest, entries } = await readProjectBundleZip(file, payloadStage, validateProjectBundleMetadata));
  } catch (error) {
    await rm(payloadStage, { recursive: true, force: true });
    await clearProjectBundleImportReceipt(operationId);
    throw error;
  }
  try { return await importStagedBundle(manifest, entries, name, operationId, projectId, payloadStage); }
  finally { await rm(payloadStage, { recursive: true, force: true }); }
}

async function importStagedBundle(
  manifest: Awaited<ReturnType<typeof readProjectBundleZip>>["manifest"],
  entries: ReadonlyMap<string, string>,
  name: string | undefined,
  operationId: string,
  projectId: string,
  payloadStage: string,
): Promise<ProjectBundleImportResponse> {
  const projectName = name?.trim() || manifest.project.name;
  if (!projectName || projectName.length > 200) throw new ProjectBundleError("invalid_project_bundle");
  const optionsJson = canonicalProjectOptionsJson(manifest.project.options_json);
  let customSystemId: string | null = null;
  let customSystemDir: string | null = null;
  let createdProject: Awaited<ReturnType<typeof createProjectRecord>> | null = null;
  const plannedSystem = manifest.design_system.kind === "custom"
    ? (() => { const id = `bundle-${ulid().toLowerCase()}`; return { id, stage: projectBundleSystemStage(id) }; })()
    : null;
  await writeProjectBundleImportReceipt({
    schema_version: 1,
    operation_id: operationId,
    project_id: projectId,
    system_id: plannedSystem?.id ?? null,
    phase: "pending",
  });
  try {
    const system = await restoreDesignSystem(manifest.design_system, entries, manifest.files, plannedSystem);
    customSystemId = system.created_id;
    customSystemDir = system.created_dir;
    createdProject = await createProjectRecord({
      projectId,
      name: projectName,
      type: manifest.project.type,
      designSystemId: null,
      backendId: manifest.project.backend_id,
      optionsJson,
      entrypoint: manifest.project.entrypoint,
      thumbnailPath: null,
      initializeArtifact: async (stage) => writeEntries({
        root: stage,
        entries,
        files: manifest.files,
        prefix: "project/",
        kinds: new Set(["project"]),
        include: (entry) => !entry.path.startsWith("project/docs/attachments/"),
      }),
    });
    await writeEntries({
      root: createdProject.dir_path,
      entries,
      files: manifest.files,
      prefix: "project/",
      kinds: new Set(["attachment", "checkpoint"]),
    });
    await writeEntries({
      root: createdProject.dir_path,
      entries,
      files: manifest.files,
      prefix: "project/",
      kinds: new Set(["project"]),
      include: (entry) => entry.path.startsWith("project/docs/attachments/"),
    });
    const actual = await inspectCanonicalTree(createdProject.dir_path);
    if (actual.tree_digest !== manifest.project.current_digest) throw new ProjectBundleError("project_bundle_digest");
    const selectedSystemId = system.selected_id;
    const db = getSqlite();
    const project = createdProject;
    db.transaction(() => {
      db.prepare("UPDATE projects SET design_system_id=?,missing_design_system_ref=?,current_revision=?,current_digest=? WHERE id=?")
        .run(selectedSystemId, system.missing_builtin, manifest.project.current_revision, manifest.project.current_digest, project.id);
      for (const attachment of manifest.attachments) {
        const relative = attachment.path.slice("project/".length);
        db.prepare(`INSERT INTO attachments(id,session_id,turn_id,file_path,mime_type,original_name,size_bytes,sha256,source_role,source_role_explicit,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
          ulid(), project.session_id, attachment.turn_id,
          resolveWithin(project.dir_path, relative), attachment.mime_type,
          attachment.original_name, attachment.size_bytes, attachment.sha256,
          attachment.source_role, attachment.source_role_explicit ? 1 : 0, Date.now(),
        );
      }
    })();
    // Archive pin text is untrusted prompt input; the pin is rebuilt by the app renderer from the restored system.
    if (selectedSystemId !== null) await ensureProjectDesignSystemPin(createdProject.id);
    await indexProjectFiles(createdProject.id);
    await writeProjectBundleImportReceipt({ schema_version: 1, operation_id: operationId, project_id: projectId, system_id: plannedSystem?.id ?? null, phase: "committed" });
    await rm(payloadStage, { recursive: true, force: true });
    await clearProjectBundleImportReceipt(operationId);
    return {
      id: createdProject.id,
      session_id: createdProject.session_id,
      entrypoint: createdProject.entrypoint,
      warnings: await importWarnings(manifest.fonts.families, system.missing_builtin),
    };
  } catch (error) {
    const cleanupFailed = await cleanupImportedBundle({
      project: createdProject,
      customSystemId,
      customSystemDir,
    });
    if (cleanupFailed) throw new ProjectBundleError("project_bundle_unavailable");
    await rm(payloadStage, { recursive: true, force: true });
    await clearProjectBundleImportReceipt(operationId);
    if (error instanceof ProjectBundleError) throw error;
    throw new ProjectBundleError("invalid_project_bundle");
  }
}

const PROJECT_OPTIONS_JSON_LIMIT = 256 * 1024;

function canonicalProjectOptionsJson(value: string | null): string | null {
  if (value === null) return null;
  if (value.length > PROJECT_OPTIONS_JSON_LIMIT) throw new ProjectBundleError("invalid_project_bundle");
  try { return JSON.stringify(parseProjectOptions(JSON.parse(value))); }
  catch (error) {
    if (error instanceof Error) throw new ProjectBundleError("invalid_project_bundle");
    throw error;
  }
}

async function restoreDesignSystem(
  system: ProjectBundleDesignSystem,
  entries: ReadonlyMap<string, string>,
  files: readonly ProjectBundleFile[],
  planned: { readonly id: string; readonly stage: string } | null,
): Promise<{ readonly selected_id: string | null; readonly created_id: string | null; readonly created_dir: string | null; readonly missing_builtin: string | null }> {
  if (system.kind === "none") return { selected_id: null, created_id: null, created_dir: null, missing_builtin: null };
  if (system.kind === "builtin") {
    const present = await getDesignSystemDetail(system.id);
    return { selected_id: present ? system.id : null, created_id: null, created_dir: null, missing_builtin: present ? null : system.id };
  }
  if (planned === null) throw new ProjectBundleError("invalid_project_bundle");
  const { id, stage } = planned;
  const destination = resolveWithin(systemsDir, id);
  await mkdir(stage, { recursive: false });
  try {
    await writeEntries({
      root: stage,
      entries,
      files,
      prefix: "design-system/",
      kinds: new Set(["design_system"]),
    });
    // Every custom system BurnGuard creates carries a verifiable extraction sidecar; without one the
    // copy could never receive a trusted catalog receipt, so the bundle is rejected.
    try { await readValidatedExtractionSidecar(stage); }
    catch (error) {
      if (error instanceof ExtractionSidecarError) throw new ProjectBundleError("invalid_project_bundle");
      throw error;
    }
    await rename(stage, destination);
    await createDesignSystemRecord({
      id,
      name: system.name,
      description: system.description,
      status: system.status,
      sourceType: "manual",
      sourceUri: null,
      isTemplate: false,
      dirPath: destination,
      skillMdPath: system.skill_md_path ? resolveWithin(destination, system.skill_md_path) : null,
      tokensCssPath: system.tokens_css_path ? resolveWithin(destination, system.tokens_css_path) : null,
      readmeMdPath: system.readme_md_path ? resolveWithin(destination, system.readme_md_path) : null,
      thumbnailPath: null,
    });
    await recordImportedContentReceipt(id, destination);
  } catch (error) {
    const cleanupFailed = await cleanupImportedBundle({
      project: null,
      customSystemId: id,
      customSystemDir: destination,
      extraPaths: [stage],
    });
    if (cleanupFailed) throw new ProjectBundleError("project_bundle_unavailable");
    throw error;
  }
  return { selected_id: id, created_id: id, created_dir: destination, missing_builtin: null };
}

async function recordImportedContentReceipt(systemId: string, root: string): Promise<void> {
  const sidecar = await readValidatedExtractionSidecar(root);
  const manifest = await inspectCanonicalTree(root);
  const provenance: unknown = JSON.parse(await readFile(path.join(root, "extraction-provenance.json"), "utf8"));
  if (typeof provenance !== "object" || provenance === null) throw new ProjectBundleError("invalid_project_bundle");
  const receiptId = `bundle-${systemId}-1-${sidecar.content_digest.slice(0, 12)}`;
  const now = Date.now();
  prepareDesignSystemReceipt(getDb(), {
    id: receiptId,
    designSystemId: systemId,
    contentRevision: 1,
    schemaVersion: 1,
    digest: sidecar.content_digest,
    manifest,
    provenance: provenance as Readonly<Record<string, unknown>>,
    createdAt: now,
  });
  commitDesignSystemReceipt(getDb(), { id: receiptId, digest: sidecar.content_digest, updatedAt: now });
}

type WriteEntriesInput = {
  readonly root: string;
  readonly entries: ReadonlyMap<string, string>;
  readonly files: readonly ProjectBundleFile[];
  readonly prefix: string;
  readonly kinds: ReadonlySet<ProjectBundleFile["kind"]>;
  readonly include?: (entry: ProjectBundleFile) => boolean;
};

async function writeEntries(input: WriteEntriesInput): Promise<void> {
  for (const file of input.files) {
    if (!input.kinds.has(file.kind) || !file.path.startsWith(input.prefix) || input.include?.(file) === false) continue;
    const source = input.entries.get(file.path);
    if (!source) throw new ProjectBundleError("invalid_project_bundle");
    const relative = file.path.slice(input.prefix.length);
    const target = resolveWithin(input.root, ...relative.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target, fsConstants.COPYFILE_EXCL);
  }
}

async function importWarnings(families: readonly string[], missingBuiltin: string | null): Promise<readonly ProjectBundleImportWarning[]> {
  const warnings: ProjectBundleImportWarning[] = [];
  if (missingBuiltin) warnings.push({ code: "missing_builtin_design_system", reference: missingBuiltin });
  let installed: readonly string[] = [];
  try { installed = (await getLocalFonts()).families; }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    installed = [];
  }
  const bundledPath = path.join(resolveRepoRoot(), "assets", "fonts", "manifest.json");
  const bundled = parseBundledFontManifest(JSON.parse(await readFile(bundledPath, "utf8")));
  installed = [...installed, ...bundled.families];
  const available = new Set(installed.map((family) => family.toLocaleLowerCase("en-US")));
  for (const family of families) {
    if (!available.has(family.toLocaleLowerCase("en-US"))) warnings.push({ code: "missing_font", reference: family });
  }
  return warnings;
}

async function cleanupImportedBundle(input: {
  readonly project: Awaited<ReturnType<typeof createProjectRecord>> | null;
  readonly customSystemId: string | null;
  readonly customSystemDir: string | null;
  readonly extraPaths?: readonly string[];
}): Promise<boolean> {
  let failed = false;
  if (input.project) {
    try { getSqlite().prepare("DELETE FROM projects WHERE id=?").run(input.project.id); }
    catch (error) {
      if (!(error instanceof Error)) throw error;
      failed = true;
    }
  }
  if (input.customSystemId) {
    try { getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(input.customSystemId); }
    catch (error) {
      if (!(error instanceof Error)) throw error;
      failed = true;
    }
  }
  const paths = [
    ...(input.project ? [input.project.dir_path] : []),
    ...(input.customSystemDir ? [input.customSystemDir] : []),
    ...(input.extraPaths ?? []),
  ];
  const removals = await Promise.allSettled(paths.map((target) => rm(target, { recursive: true, force: true })));
  return failed || removals.some((result) => result.status === "rejected");
}
