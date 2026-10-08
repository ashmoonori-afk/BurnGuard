import path from "node:path";
import type {
  ProjectBundleAttachment,
  ProjectBundleCheckpoint,
  ProjectBundleDesignSystem,
  ProjectBundleManifest,
} from "@bg/shared";
import {
  APP_VERSION,
  PROJECT_BUNDLE_CREDENTIAL_EXCLUSIONS,
  PROJECT_BUNDLE_FORMAT_VERSION,
} from "@bg/shared";
import { getSqlite } from "../db/sqlite-client";
import { getDesignSystemDetail } from "../db/seed";
import { getProjectDetail } from "../db/project-read-repository";
import { projectsDir, resolveManagedPath, systemsDir } from "../lib/paths";
import { PathBoundaryError, assertSafeName } from "../security/path-boundary";
import { inspectCanonicalTree } from "./canonical-tree-manifest";
import { acquireArtifactProjectLock } from "./artifact-project-lock";
import { readProjectDesignSystemPin } from "./project-design-system-pin";
import { parseStoredProjectOptions } from "./project-options";
import {
  collectDesignSystemBundleEntries,
  collectProjectBundleEntries,
  createBundleBudget,
  createProjectBundleZip,
  type BundleEntry,
} from "./project-bundle-archive";
import { ProjectBundleError } from "./project-bundle-error";

type AttachmentRow = {
  readonly turn_id: string | null;
  readonly file_path: string;
  readonly mime_type: string;
  readonly original_name: string;
  readonly size_bytes: number;
  readonly sha256: string | null;
  readonly source_role: "ordinary_content" | "immutable_reference";
  readonly source_role_explicit: number;
};

type ProjectBundleExportFaults = {
  readonly afterProjectRead?: () => void | Promise<void>;
};

export async function exportProjectBundle(projectId: string, faults: ProjectBundleExportFaults = {}): Promise<{
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly manifest: ProjectBundleManifest;
}> {
  const release = await acquireArtifactProjectLock(getSqlite(), projectId);
  try {
  const project = await getProjectDetail(projectId);
  if (!project) throw new ProjectBundleError("project_bundle_not_found");
  if (project.current_digest === null) throw new ProjectBundleError("project_bundle_unavailable");
  const projectRoot = resolveManagedPath(projectsDir, project.dir_path);
  const live = await inspectCanonicalTree(projectRoot);
  if (live.tree_digest !== project.current_digest) throw new ProjectBundleError("project_bundle_unavailable");
  const budget = createBundleBudget();
  const projectEntries = await collectProjectBundleEntries(projectRoot, budget);
  await faults.afterProjectRead?.();
  const system = project.design_system_id ? await getDesignSystemDetail(project.design_system_id) : null;
  let systemEntries: readonly BundleEntry[] = [];
  let systemRoot: string | null = null;
  const missingBuiltin = getSqlite().query<{ readonly ref: string | null }, [string]>("SELECT missing_design_system_ref ref FROM projects WHERE id=?").get(projectId)?.ref ?? null;
  let designSystem: ProjectBundleDesignSystem = missingBuiltin !== null && !system
    ? { kind: "builtin", id: missingBuiltin, pin: null }
    : { kind: "none", pin: portablePin(projectId) };
  if (system) {
    if (system.source_type === "sample") {
      designSystem = { kind: "builtin", id: system.id, pin: portablePin(projectId) };
    } else {
      systemRoot = resolveManagedPath(systemsDir, system.dir_path);
      systemEntries = await collectDesignSystemBundleEntries(systemRoot, budget);
      designSystem = {
        kind: "custom",
        original_id: system.id,
        name: system.name,
        description: system.description,
        status: system.status,
        source_type: system.source_type,
        is_template: system.is_template,
        skill_md_path: relativeSystemPath(systemRoot, system.skill_md_path),
        tokens_css_path: relativeSystemPath(systemRoot, system.tokens_css_path),
        readme_md_path: relativeSystemPath(systemRoot, system.readme_md_path),
        pin: portablePin(projectId),
      };
    }
  }
  const entries = [...projectEntries, ...systemEntries].sort((left, right) => left.file.path.localeCompare(right.file.path));
  const attachments = attachmentRecords(projectId, projectRoot, entries);
  const manifest: ProjectBundleManifest = {
    format: "burnguard-project",
    format_version: PROJECT_BUNDLE_FORMAT_VERSION,
    app_version: APP_VERSION,
    exported_at: Date.now(),
    project: {
      name: project.name,
      type: project.type,
      entrypoint: project.entrypoint,
      backend_id: project.backend_id,
      options_json: project.options_json === null ? null : JSON.stringify(parseStoredProjectOptions(project.options_json)),
      current_revision: project.current_revision,
      current_digest: project.current_digest,
    },
    files: entries.map((entry) => entry.file),
    attachments,
    checkpoints: checkpointRecords(entries),
    design_system: designSystem,
    fonts: fontReferences(entries),
    credential_exclusions: PROJECT_BUNDLE_CREDENTIAL_EXCLUSIONS,
  };
  const confirmedProjectEntries = await collectProjectBundleEntries(projectRoot);
  const confirmedSystemEntries = systemRoot ? await collectDesignSystemBundleEntries(systemRoot) : [];
  const latestProject = await getProjectDetail(projectId);
  const liveAfter = await inspectCanonicalTree(projectRoot);
  if (!sameEntries(projectEntries, confirmedProjectEntries) ||
    !sameEntries(systemEntries, confirmedSystemEntries) ||
    latestProject?.current_revision !== project.current_revision ||
    latestProject.current_digest !== project.current_digest ||
    latestProject.design_system_id !== project.design_system_id ||
    liveAfter.tree_digest !== project.current_digest ||
    JSON.stringify(attachmentRecords(projectId, projectRoot, entries)) !== JSON.stringify(attachments) ||
    JSON.stringify(portablePin(projectId)) !== JSON.stringify(designSystem.pin)) {
    throw new ProjectBundleError("project_bundle_unavailable");
  }
  const bytes = await createProjectBundleZip(manifest, entries);
  const name = Array.from(project.name)
    .map((character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? "_" : character)
    .join("").replace(/[ .]+$/, "").slice(0, 120) || "BurnGuard-project";
  let filename = `BurnGuard-${name}.burnguard-project`;
  try { assertSafeName(filename); }
  catch (error) {
    if (!(error instanceof PathBoundaryError)) throw error;
    filename = `BurnGuard-project-${project.id.slice(-8)}.burnguard-project`;
  }
  return { bytes, filename, manifest };
  } finally { release(); }
}

function sameEntries(left: readonly BundleEntry[], right: readonly BundleEntry[]): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const candidate = right[index];
    return candidate?.file.path === entry.file.path && candidate.file.kind === entry.file.kind &&
      candidate.file.size_bytes === entry.file.size_bytes && candidate.file.sha256 === entry.file.sha256;
  });
}

function attachmentRecords(projectId: string, projectRoot: string, entries: readonly BundleEntry[]): readonly ProjectBundleAttachment[] {
  const byPath = new Map(entries.map((entry) => [entry.file.path, entry.file]));
  return getSqlite().query<AttachmentRow, [string]>(`SELECT a.turn_id,a.file_path,a.mime_type,a.original_name,a.size_bytes,a.sha256,a.source_role,a.source_role_explicit
    FROM attachments a JOIN sessions s ON s.id=a.session_id WHERE s.project_id=? ORDER BY a.created_at,a.id`).all(projectId).map((row) => {
    const relative = path.relative(projectRoot, resolveManagedPath(projectRoot, row.file_path)).split(path.sep).join("/");
    const archivePath = `project/${relative}`;
    const file = byPath.get(archivePath);
    if (!file || row.sha256 === null || file.sha256 !== row.sha256 || file.size_bytes !== row.size_bytes) throw new ProjectBundleError("project_bundle_unavailable");
    return {
      path: archivePath,
      turn_id: row.turn_id,
      mime_type: row.mime_type,
      original_name: row.original_name,
      size_bytes: row.size_bytes,
      sha256: row.sha256,
      source_role: row.source_role,
      source_role_explicit: row.source_role_explicit === 1,
    };
  });
}

function checkpointRecords(entries: readonly BundleEntry[]): readonly ProjectBundleCheckpoint[] {
  const records: ProjectBundleCheckpoint[] = [];
  for (const entry of entries) {
    if (entry.file.kind !== "checkpoint" || !/^project\/\.meta\/checkpoints\/[^/]+\.json$/.test(entry.file.path)) continue;
    try {
      const value: unknown = JSON.parse(new TextDecoder().decode(entry.bytes));
      if (typeof value === "object" && value !== null && "turn_id" in value && typeof value.turn_id === "string" &&
        "created_at" in value && typeof value.created_at === "number" && Number.isSafeInteger(value.created_at)) {
        records.push({ path: entry.file.path, turn_id: value.turn_id, created_at: value.created_at });
      }
    } catch {
      // A torn checkpoint receipt must not block the user's backup path; its bytes still travel in the bundle.
      console.warn("[project-bundle] skipped malformed checkpoint", entry.file.path);
    }
  }
  return records;
}

function fontReferences(entries: readonly BundleEntry[]): ProjectBundleManifest["fonts"] {
  const families = new Set<string>();
  const embedded = new Set<string>();
  const files = entries.filter((entry) => /\.(?:woff2?|ttf|otf)$/i.test(entry.file.path)).map((entry) => entry.file.path);
  for (const entry of entries) {
    if (!/\.(?:css|html?)$/i.test(entry.file.path) || entry.bytes.byteLength > 2 * 1024 * 1024) continue;
    const source = new TextDecoder().decode(entry.bytes);
    for (const match of source.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) {
      for (const family of splitFamilies(match[1] ?? "")) families.add(family);
    }
    for (const block of source.matchAll(/@font-face\s*{([^}]+)}/gi)) {
      const family = /font-family\s*:\s*([^;}{]+)/i.exec(block[1] ?? "")?.[1];
      if (family) splitFamilies(family).forEach((value) => { embedded.add(value); });
    }
  }
  const generic = new Set(["serif", "sans-serif", "monospace", "system-ui", "cursive", "fantasy", "ui-sans-serif", "ui-serif", "ui-monospace"]);
  return {
    families: [...families].filter((family) => !embedded.has(family) && !generic.has(family.toLocaleLowerCase("en-US"))).sort(),
    files: files.sort(),
  };
}

function splitFamilies(value: string): readonly string[] {
  return value
    .split(",")
    .map((family) => family.trim().replace(/^["']|["']$/g, ""))
    .filter((family) => Boolean(family) && !/^var\(/i.test(family));
}

function relativeSystemPath(root: string, absolute: string | null): string | null {
  if (absolute === null) return null;
  return path.relative(root, resolveManagedPath(root, absolute)).split(path.sep).join("/");
}

function portablePin(projectId: string): ProjectBundleDesignSystem["pin"] {
  const pin = readProjectDesignSystemPin(projectId);
  return pin ? { revision: pin.revision, digest: pin.digest, context: pin.context, tokens: pin.tokens } : null;
}
