import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { FileInfo } from "@bg/shared/harness";
import { replaceManagedProjectFiles } from "../db/managed-file-repository";
import { getProjectDetail } from "../db/project-read-repository";
import { PathBoundaryError, assertSafeName, resolveWithin } from "../security/path-boundary";
import { inspectCanonicalTree } from "./canonical-tree-manifest";
import { isProjectDocumentPath } from "./project-document-paths";

const IGNORED_DIRS = new Set([".attachments", ".burnguard-inputs", ".meta", ".git", ".omc", ".claude"]);

export async function indexProjectFiles(projectId: string) {
  const project = await getProjectDetail(projectId);
  if (project === null) return null;
  const manifest = await inspectCanonicalTree(project.dir_path);
  const hashes = new Map(manifest.files.map((file) => [file.path, file.sha256]));
  const files = (await scanProjectDir(project.dir_path)).map((file) => ({ ...file, hash: hashes.get(file.rel_path) ?? null }));
  replaceManagedProjectFiles(projectId, files);
  return files;
}

export async function resolveProjectFile(projectId: string, relPath: string) {
  const project = await getProjectDetail(projectId);
  if (project === null) return null;
  const normalized = normalizeRelativePath(relPath);
  if (normalized === null) return null;
  try {
    return { project, relPath: normalized, absolutePath: resolveWithin(project.dir_path, normalized) };
  } catch (error) {
    if (error instanceof PathBoundaryError) return null;
    throw error;
  }
}

export async function resolveDrawFile(projectId: string, relPath: string) {
  const project = await getProjectDetail(projectId);
  if (project === null) return null;
  const normalized = normalizeRelativePath(relPath);
  if (normalized === null) return null;
  try {
    const absolutePath = resolveWithin(project.dir_path, ".meta", "draws", `${normalized}.svg`);
    return { project, relPath: normalized, absolutePath, parentDir: path.dirname(absolutePath) };
  } catch (error) {
    if (error instanceof PathBoundaryError) return null;
    throw error;
  }
}

export function isTransientFilePath(relPath: string): boolean {
  return /^\..+\.\d+\.\d+\.tmp$/.test(path.posix.basename(relPath));
}

async function scanProjectDir(projectDir: string): Promise<FileInfo[]> {
  const output: FileInfo[] = [];
  const root = resolveWithin(projectDir);
  await walk(root, root, output);
  return output.sort((left, right) => left.rel_path.localeCompare(right.rel_path));
}

async function walk(root: string, current: string, output: FileInfo[]): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const relative = path.relative(root, path.join(current, entry.name)).replaceAll("\\", "/");
    if (isProjectDocumentPath(relative) && entry.name.startsWith(".")) continue;
    if (isTransientFilePath(relative)) continue;
    let absolute: string;
    try { absolute = resolveWithin(root, relative); }
    catch (error) {
      if (error instanceof PathBoundaryError) continue;
      throw error;
    }
    const info = await stat(absolute);
    if (entry.isDirectory()) {
      output.push({ rel_path: relative, category: "folder", size_bytes: null, updated_at: info.mtimeMs });
      await walk(root, absolute, output);
    } else {
      output.push({ rel_path: relative, category: categorize(relative), size_bytes: info.size, updated_at: info.mtimeMs });
    }
  }
}

function categorize(relative: string): FileInfo["category"] {
  switch (path.extname(relative).toLowerCase()) {
    case ".html": case ".htm": return "html";
    case ".css": return "stylesheet";
    case ".js": case ".mjs": case ".cjs": case ".ts": case ".tsx": return "script";
    case ".md": case ".txt": case ".json": return "document";
    case ".png": case ".jpg": case ".jpeg": case ".gif": case ".svg": case ".webp": return "asset";
    default: return "other";
  }
}

function normalizeRelativePath(relative: string): string | null {
  try { return relative.replaceAll("\\", "/").split("/").map(assertSafeName).join("/"); }
  catch (error) {
    if (error instanceof PathBoundaryError) return null;
    throw error;
  }
}
