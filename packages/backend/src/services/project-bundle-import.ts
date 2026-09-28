import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
import { resolveRepoRoot, systemsDir } from "../lib/paths";
import { resolveWithin } from "../security/path-boundary";
import { inspectCanonicalTree } from "./canonical-tree-manifest";
import { indexProjectFiles } from "./managed-project-files";
import { getLocalFonts } from "./local-fonts";
import { readProjectBundleZip } from "./project-bundle-archive";
import { ProjectBundleError } from "./project-bundle-error";
import { validateProjectBundleMetadata } from "./project-bundle-validation";

export async function importProjectBundleFile(file: File, name?: string): Promise<ProjectBundleImportResponse> {
  const { manifest, entries } = await readProjectBundleZip(file);
  validateProjectBundleMetadata(manifest);
  const projectName = name?.trim() || manifest.project.name;
  if (!projectName || projectName.length > 200) throw new ProjectBundleError("invalid_project_bundle");
  let customSystemId: string | null = null;
  let customSystemDir: string | null = null;
  let createdProject: Awaited<ReturnType<typeof createProjectRecord>> | null = null;
  try {
    const system = await restoreDesignSystem(manifest.design_system, entries, manifest.files);
    customSystemId = system.created_id;
    customSystemDir = system.created_dir;
    createdProject = await createProjectRecord({
      name: projectName,
      type: manifest.project.type,
      designSystemId: null,
      backendId: manifest.project.backend_id,
      optionsJson: manifest.project.options_json,
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
    const pinSystemId = selectedSystemId ?? (manifest.design_system.kind === "none" ? null :
      manifest.design_system.kind === "builtin" ? manifest.design_system.id : customSystemId);
    const db = getSqlite();
    const project = createdProject;
    db.transaction(() => {
      db.prepare("UPDATE projects SET design_system_id=?,current_revision=?,current_digest=? WHERE id=?")
        .run(selectedSystemId, manifest.project.current_revision, manifest.project.current_digest, project.id);
      if (manifest.design_system.pin && pinSystemId) {
        const pin = manifest.design_system.pin;
        db.prepare("INSERT OR REPLACE INTO project_design_system_pins(project_id,system_id,revision,digest,context,tokens) VALUES (?,?,?,?,?,?)")
          .run(project.id, pinSystemId, pin.revision, pin.digest, pin.context, pin.tokens);
      }
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
    await indexProjectFiles(createdProject.id);
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
    if (error instanceof ProjectBundleError) throw error;
    throw new ProjectBundleError("invalid_project_bundle");
  }
}

async function restoreDesignSystem(
  system: ProjectBundleDesignSystem,
  entries: ReadonlyMap<string, Uint8Array>,
  files: readonly ProjectBundleFile[],
): Promise<{ readonly selected_id: string | null; readonly created_id: string | null; readonly created_dir: string | null; readonly missing_builtin: string | null }> {
  if (system.kind === "none") return { selected_id: null, created_id: null, created_dir: null, missing_builtin: null };
  if (system.kind === "builtin") {
    const present = await getDesignSystemDetail(system.id);
    return { selected_id: present ? system.id : null, created_id: null, created_dir: null, missing_builtin: present ? null : system.id };
  }
  const id = `bundle-${ulid().toLowerCase()}`;
  const destination = resolveWithin(systemsDir, id);
  const stage = resolveWithin(systemsDir, `bundle-stage-${ulid().toLowerCase()}`);
  await mkdir(stage, { recursive: false });
  try {
    await writeEntries({
      root: stage,
      entries,
      files,
      prefix: "design-system/",
      kinds: new Set(["design_system"]),
    });
    await rename(stage, destination);
    await createDesignSystemRecord({
      id,
      name: system.name,
      description: system.description,
      status: system.status,
      sourceType: system.source_type ?? "manual",
      sourceUri: null,
      isTemplate: system.is_template,
      dirPath: destination,
      skillMdPath: system.skill_md_path ? resolveWithin(destination, system.skill_md_path) : null,
      tokensCssPath: system.tokens_css_path ? resolveWithin(destination, system.tokens_css_path) : null,
      readmeMdPath: system.readme_md_path ? resolveWithin(destination, system.readme_md_path) : null,
      thumbnailPath: null,
    });
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

type WriteEntriesInput = {
  readonly root: string;
  readonly entries: ReadonlyMap<string, Uint8Array>;
  readonly files: readonly ProjectBundleFile[];
  readonly prefix: string;
  readonly kinds: ReadonlySet<ProjectBundleFile["kind"]>;
  readonly include?: (entry: ProjectBundleFile) => boolean;
};

async function writeEntries(input: WriteEntriesInput): Promise<void> {
  for (const file of input.files) {
    if (!input.kinds.has(file.kind) || !file.path.startsWith(input.prefix) || input.include?.(file) === false) continue;
    const bytes = input.entries.get(file.path);
    if (!bytes) throw new ProjectBundleError("invalid_project_bundle");
    const relative = file.path.slice(input.prefix.length);
    const target = resolveWithin(input.root, ...relative.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "wx" });
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
