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
import type { PaletteTransferProof } from "@bg/shared/palette";
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
import { clearProjectBundleImportReceipt, projectBundlePayloadStage, projectBundleSystemStage, removeBundleImportOwnerMarker, writeBundleImportOwnerMarker, writeProjectBundleImportReceipt } from "./project-bundle-import-receipt";
import { commitDesignSystemReceipt, prepareDesignSystemReceipt } from "../db/design-system-repository";
import { getDb } from "../db/client";
import { ExtractionSidecarError, readValidatedExtractionSidecar } from "./extraction-sidecar";
import { assertSystemContentLease, withSystemContentAccess, type SystemContentLease } from "./system-content-access";
import { pathStat, safeContentChild } from "./system-content-tree";
import { SystemContentError } from "./system-content-format";
import { acquireArtifactProjectLock } from "./artifact-project-lock";
import { DesignSystemPaletteError, validatePaletteTransferAtRoot } from "./design-system-palette";
import { getPendingSystemOperation } from "../db/catalog-repository";
import { PaletteTransferRepositoryError, validatePaletteTransferReceipt } from "../db/palette-transfer-repository";
import { CatalogFileError, validateCatalogReceiptTree } from "./catalog-files";

type ImportOwnership = { readonly operationId: string; readonly projectId: string; readonly systemId: string | null };
type ProjectBundleImportEvents = {
  readonly atBoundary?: (name: "system-reserved" | "system-restored" | "project-created" | "before-commit" | "outer-committed" | "owner-removed", owner: ImportOwnership) => Promise<void>;
  readonly getLocalFonts?: typeof getLocalFonts;
};

export async function importProjectBundleFile(file: File, name?: string, events: ProjectBundleImportEvents = {}): Promise<ProjectBundleImportResponse> {
  const operationId = ulid();
  const projectId = ulid();
  const payloadStage = projectBundlePayloadStage(operationId);
  await writeProjectBundleImportReceipt({ schema_version: 1, operation_id: operationId, project_id: projectId, system_id: null, phase: "pending" });
  let manifest: Awaited<ReturnType<typeof readProjectBundleZip>>["manifest"];
  let entries: Awaited<ReturnType<typeof readProjectBundleZip>>["entries"];
  try {
    await mkdir(payloadStage, { recursive: false });
    ({ manifest, entries } = await readProjectBundleZip(file, payloadStage, validateProjectBundleMetadata));
    if (manifest.design_system.kind === "custom" && manifest.design_system.palette_transfer !== undefined) {
      await validateImportedPalette(resolveWithin(payloadStage, "design-system"), manifest.design_system.palette_transfer);
    }
  } catch (error) {
    await rm(payloadStage, { recursive: true, force: true });
    await clearProjectBundleImportReceipt(operationId);
    throw error;
  }
  try { return await importStagedBundle(manifest, entries, name, operationId, projectId, payloadStage, events); }
  finally { await rm(payloadStage, { recursive: true, force: true }); }
}

async function importStagedBundle(
  manifest: Awaited<ReturnType<typeof readProjectBundleZip>>["manifest"],
  entries: ReadonlyMap<string, string>,
  name: string | undefined,
  operationId: string,
  projectId: string,
  payloadStage: string,
  events: ProjectBundleImportEvents,
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
  const owner = { operationId, projectId, systemId: plannedSystem?.id ?? null };
  const validatePaletteReceipt = async (receiptId: string): Promise<void> => {
    try {
      if (customSystemId === null || customSystemDir === null) throw new ProjectBundleError("project_bundle_unavailable");
      const receipt = getPendingSystemOperation(getSqlite(), customSystemId);
      if (receipt === null || receipt.id !== receiptId) throw new ProjectBundleError("project_bundle_unavailable");
      await validateCatalogReceiptTree(customSystemDir, receipt);
      const proof = validatePaletteTransferReceipt(getSqlite(), receipt);
      const declared = manifest.design_system.kind === "custom" ? manifest.design_system.palette_transfer ?? null : null;
      if (JSON.stringify(proof) !== JSON.stringify(declared)) throw new ProjectBundleError("project_bundle_digest");
      if (proof !== null) await validateImportedPalette(customSystemDir, proof);
    } catch (error) {
      if (error instanceof PaletteTransferRepositoryError || error instanceof CatalogFileError) throw new ProjectBundleError("project_bundle_digest");
      throw error;
    }
  };
  await writeProjectBundleImportReceipt({
    schema_version: 1,
    operation_id: operationId,
    project_id: projectId,
    system_id: plannedSystem?.id ?? null,
    phase: "pending",
  });
  const initializeProject = async () => {
    createdProject = await createProjectRecord({
      projectId,
      beforeInsert: (dirPath) => writeBundleImportOwnerMarker(dirPath, operationId),
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
    await events.atBoundary?.("project-created", owner);
  };
  let started = false;
  const run = async (lease?: SystemContentLease) => {
  started = true;
  let outerCommitted = false;
  try {
    const project = createdProject;
    if (project === null) throw new ProjectBundleError("project_bundle_unavailable");
    if (plannedSystem !== null) {
      if (lease === undefined) throw new ProjectBundleError("project_bundle_unavailable");
      assertSystemContentLease(lease, systemsDir, plannedSystem.id);
      if (await getDesignSystemDetail(plannedSystem.id) !== null ||
        await pathStat(await safeContentChild(systemsDir, plannedSystem.id)) !== null ||
        await pathStat(plannedSystem.stage) !== null) throw new ProjectBundleError("project_bundle_unavailable");
      await events.atBoundary?.("system-reserved", owner);
    }
    const system = await restoreDesignSystem(manifest.design_system, entries, manifest.files, plannedSystem, operationId, lease);
    customSystemId = system.created_id;
    customSystemDir = system.created_dir;
    await events.atBoundary?.("system-restored", owner);
    await writeEntries({
      root: project.dir_path,
      entries,
      files: manifest.files,
      prefix: "project/",
      kinds: new Set(["attachment", "checkpoint"]),
    });
    await writeEntries({
      root: project.dir_path,
      entries,
      files: manifest.files,
      prefix: "project/",
      kinds: new Set(["project"]),
      include: (entry) => entry.path.startsWith("project/docs/attachments/"),
    });
    const actual = await inspectCanonicalTree(project.dir_path);
    if (actual.tree_digest !== manifest.project.current_digest) throw new ProjectBundleError("project_bundle_digest");
    const selectedSystemId = system.selected_id;
    const db = getSqlite();
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
    if (selectedSystemId !== null) await ensureProjectDesignSystemPin(project.id, plannedSystem === null ? undefined : lease);
    await indexProjectFiles(project.id);
    const warnings = await importWarnings(manifest.fonts.families, system.missing_builtin, events.getLocalFonts ?? getLocalFonts);
    await events.atBoundary?.("before-commit", owner);
    if (system.receipt !== null) await validatePaletteReceipt(system.receipt.id);
    await writeProjectBundleImportReceipt({ schema_version: 1, operation_id: operationId, project_id: projectId, system_id: plannedSystem?.id ?? null, phase: "committed" });
    outerCommitted = true;
    await events.atBoundary?.("outer-committed", owner);
    await removeBundleImportOwnerMarker(project.dir_path);
    if (customSystemDir !== null) await removeBundleImportOwnerMarker(customSystemDir);
    await events.atBoundary?.("owner-removed", owner);
    if (system.receipt !== null) {
      await validatePaletteReceipt(system.receipt.id);
      commitDesignSystemReceipt(getDb(), { ...system.receipt, updatedAt: Date.now() });
    }
    await rm(payloadStage, { recursive: true, force: true });
    await clearProjectBundleImportReceipt(operationId);
    return {
      id: project.id,
      session_id: project.session_id,
      entrypoint: project.entrypoint,
      warnings,
    };
  } catch (error) {
    // A durable outer commit retains the imported system. Pending v1 authority blocks access
    // until startup finalizes it if owner cleanup or the inner receipt commit was interrupted.
    if (outerCommitted) throw new ProjectBundleError("project_bundle_unavailable");
    const cleanupFailed = await cleanupImportedBundle({
      project: createdProject,
      customSystemId,
      customSystemDir,
    }) || error instanceof BundleCleanupFailure;
    // Any failed cleanup keeps the pending receipt so startup reconciliation can finish it.
    if (cleanupFailed) throw new ProjectBundleError("project_bundle_unavailable");
    await rm(payloadStage, { recursive: true, force: true });
    await clearProjectBundleImportReceipt(operationId);
    if (error instanceof ProjectBundleError) throw error;
    throw new ProjectBundleError("invalid_project_bundle");
  }
  };
  try {
    // Artifact initialization acquires its own project locks before any system access.
    await initializeProject();
    const release = await acquireArtifactProjectLock(getSqlite(), projectId);
    try {
      if (plannedSystem === null) return await run();
      await mkdir(systemsDir, { recursive: true });
      return await withSystemContentAccess(getSqlite(), systemsDir, [plannedSystem.id], run);
    } finally { release(); }
  }
  catch (error) {
    if (!started) {
      const cleanupFailed = await cleanupImportedBundle({ project: createdProject, customSystemId: null, customSystemDir: null });
      if (cleanupFailed) throw new ProjectBundleError("project_bundle_unavailable");
      await clearProjectBundleImportReceipt(operationId);
    }
    if (error instanceof SystemContentError) throw new ProjectBundleError("project_bundle_unavailable");
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

class BundleCleanupFailure extends Error {
  constructor() { super("bundle_cleanup_failed"); }
}

async function restoreDesignSystem(
  system: ProjectBundleDesignSystem,
  entries: ReadonlyMap<string, string>,
  files: readonly ProjectBundleFile[],
  planned: { readonly id: string; readonly stage: string } | null,
  operationId: string,
  lease?: SystemContentLease,
): Promise<{ readonly selected_id: string | null; readonly created_id: string | null; readonly created_dir: string | null; readonly missing_builtin: string | null; readonly receipt: { readonly id: string; readonly digest: string } | null }> {
  if (system.kind === "none") return { selected_id: null, created_id: null, created_dir: null, missing_builtin: null, receipt: null };
  if (system.kind === "builtin") {
    const present = await getDesignSystemDetail(system.id);
    return { selected_id: present ? system.id : null, created_id: null, created_dir: null, missing_builtin: present ? null : system.id, receipt: null };
  }
  if (planned === null || lease === undefined) throw new ProjectBundleError("invalid_project_bundle");
  const { id, stage } = planned;
  assertSystemContentLease(lease, systemsDir, id);
  const destination = resolveWithin(systemsDir, id);
  await mkdir(stage, { recursive: false });
  let published = false;
  let rowCreated = false;
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
    if (system.palette_transfer !== undefined) await validateImportedPalette(stage, system.palette_transfer);
    await writeBundleImportOwnerMarker(stage, operationId);
    if (await pathStat(destination) !== null) throw new ProjectBundleError("project_bundle_unavailable");
    await rename(stage, destination);
    published = true;
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
    rowCreated = true;
    const receipt = await recordImportedContentReceipt(id, destination, system.palette_transfer);
    return { selected_id: id, created_id: id, created_dir: destination, missing_builtin: null, receipt };
  } catch (error) {
    const cleanupFailed = await cleanupImportedBundle({
      project: null,
      customSystemId: rowCreated ? id : null,
      customSystemDir: published ? destination : null,
      extraPaths: [stage],
    });
    if (cleanupFailed) throw new BundleCleanupFailure();
    throw error;
  }
}

async function recordImportedContentReceipt(systemId: string, root: string, paletteTransfer?: PaletteTransferProof): Promise<{ readonly id: string; readonly digest: string }> {
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
    ...(paletteTransfer === undefined ? {} : { paletteTransfer }),
  });
  return { id: receiptId, digest: sidecar.content_digest };
}

async function validateImportedPalette(root: string, proof: PaletteTransferProof): Promise<void> {
  try { await validatePaletteTransferAtRoot(root, proof); }
  catch (error) {
    if (error instanceof DesignSystemPaletteError) throw new ProjectBundleError("invalid_project_bundle");
    if (error instanceof SystemContentError) throw new ProjectBundleError("project_bundle_digest");
    throw error;
  }
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

async function importWarnings(families: readonly string[], missingBuiltin: string | null, fonts: typeof getLocalFonts): Promise<readonly ProjectBundleImportWarning[]> {
  const warnings: ProjectBundleImportWarning[] = [];
  if (missingBuiltin) warnings.push({ code: "missing_builtin_design_system", reference: missingBuiltin });
  if (families.length === 0) return warnings;
  let installed: readonly string[] = [];
  try { installed = (await fonts()).families; }
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
  // A directory is removed only after its row is gone; otherwise its owner marker and the pending
  // receipt must survive so startup reconciliation can retry the row deletion.
  const paths: string[] = [...(input.extraPaths ?? [])];
  if (input.project) {
    try {
      getSqlite().prepare("DELETE FROM projects WHERE id=?").run(input.project.id);
      paths.push(input.project.dir_path);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      failed = true;
    }
  }
  if (input.customSystemId) {
    try {
      getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(input.customSystemId);
      if (input.customSystemDir) paths.push(input.customSystemDir);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      failed = true;
    }
  } else if (input.customSystemDir) paths.push(input.customSystemDir);
  const removals = await Promise.allSettled(paths.map((target) => rm(target, { recursive: true, force: true })));
  return failed || removals.some((result) => result.status === "rejected");
}
