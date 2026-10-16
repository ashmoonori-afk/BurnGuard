import { Database } from "bun:sqlite";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseDesignSystemRules, type DesignSystemRules } from "@bg/shared";
import { resolveWithin } from "../security/path-boundary";

/**
 * Read-only view of a local BurnGuard profile for the user's own coding agent: it opens the profile database in
 * read-only mode and reads files below the managed roots, so it never writes and opens no network listener.
 */
export type ProfileReader = { readonly db: Database; readonly root: string; close(): void };

const IGNORED_TOP_LEVEL = new Set([".meta", ".attachments", ".burnguard-inputs", ".git"]);
const MAX_LISTED_FILES = 2000;

export function openProfileReader(root: string): ProfileReader {
  if (!path.isAbsolute(root)) throw new Error("profile root must be an absolute directory");
  const db = new Database(path.join(root, "burnguard.db"), { readonly: true });
  return { db, root, close: () => db.close() };
}

export type ProjectListItem = { readonly id: string; readonly name: string; readonly type: string; readonly design_system: string | null; readonly updated_at: number };

export function listProjects(reader: ProfileReader): readonly ProjectListItem[] {
  return reader.db.query<ProjectListItem, []>(`SELECT p.id, p.name, p.type, ds.name AS design_system, p.updated_at
    FROM projects p LEFT JOIN design_systems ds ON ds.id = p.design_system_id
    WHERE p.archived_at IS NULL ORDER BY p.updated_at DESC`).all();
}

type ProjectRow = { id: string; name: string; type: string; dir_path: string; entrypoint: string; options_json: string | null; design_system_id: string | null };
type SystemRow = { id: string; name: string; dir_path: string; tokens_css_path: string | null };

export type ProjectView = {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly directory: string;
  readonly entrypoint: string;
  readonly files: readonly string[];
  readonly files_truncated: boolean;
  readonly standing_instructions: string | null;
  readonly design_system: { readonly id: string; readonly name: string; readonly directory: string; readonly tokens_file: string | null; readonly rules: DesignSystemRules } | null;
};

/** A managed directory as stored, refused unless it resolves inside the given managed root. */
function managedDirectory(managedRoot: string, stored: string): string {
  const relative = path.relative(managedRoot, path.resolve(managedRoot, stored));
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("stored directory is outside its managed root");
  return resolveWithin(managedRoot, ...relative.split(path.sep));
}

async function listFiles(dir: string): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  const walk = async (current: string, prefix: string): Promise<boolean> => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (prefix === "" && IGNORED_TOP_LEVEL.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!(await walk(path.join(current, entry.name), rel))) return false; continue; }
      if (!entry.isFile()) continue;
      if (files.length >= MAX_LISTED_FILES) return false;
      files.push(rel);
    }
    return true;
  };
  const complete = await walk(dir, "");
  return { files, truncated: !complete };
}

function standingInstructions(optionsJson: string | null): string | null {
  if (optionsJson === null) return null;
  try {
    const value: unknown = JSON.parse(optionsJson);
    const text = typeof value === "object" && value !== null ? Reflect.get(value, "standing_instructions") : null;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  } catch { return null; }
}

async function readRules(dir: string): Promise<DesignSystemRules> {
  const file = path.join(dir, "rules.json");
  try {
    if (!(await lstat(file)).isFile()) return { schema_version: 1, rules: [] };
    return parseDesignSystemRules(JSON.parse(await readFile(file, "utf8")));
  } catch { return { schema_version: 1, rules: [] }; }
}

export async function readProject(reader: ProfileReader, projectId: string): Promise<ProjectView | null> {
  const project = reader.db.query<ProjectRow, [string]>("SELECT id, name, type, dir_path, entrypoint, options_json, design_system_id FROM projects WHERE id = ? AND archived_at IS NULL").get(projectId);
  if (!project) return null;
  const directory = managedDirectory(path.join(reader.root, "data", "projects"), project.dir_path);
  const { files, truncated } = await listFiles(directory);
  let design: ProjectView["design_system"] = null;
  if (project.design_system_id) {
    const system = reader.db.query<SystemRow, [string]>("SELECT id, name, dir_path, tokens_css_path FROM design_systems WHERE id = ?").get(project.design_system_id);
    if (system) {
      const systemDir = managedDirectory(path.join(reader.root, "data", "systems"), system.dir_path);
      const tokens = system.tokens_css_path ? path.resolve(systemDir, system.tokens_css_path) : null;
      design = { id: system.id, name: system.name, directory: systemDir, tokens_file: tokens && !path.relative(systemDir, tokens).startsWith("..") ? tokens : null, rules: await readRules(systemDir) };
    }
  }
  return { id: project.id, name: project.name, type: project.type, directory, entrypoint: project.entrypoint, files, files_truncated: truncated, standing_instructions: standingInstructions(project.options_json), design_system: design };
}

/** The markdown brief a coding agent reads before continuing a project in place. */
export function renderProjectBrief(view: ProjectView): string {
  const lines = [`# ${view.name}`, "", `- project id: ${view.id}`, `- type: ${view.type}`, `- directory: ${view.directory}`, `- entrypoint: ${view.entrypoint}`, ""];
  if (view.standing_instructions) lines.push("## Always apply in this project", "", view.standing_instructions, "");
  if (view.design_system) {
    lines.push("## Design system", "", `- name: ${view.design_system.name}`, `- directory: ${view.design_system.directory}`);
    if (view.design_system.tokens_file) lines.push(`- tokens: ${view.design_system.tokens_file}`);
    const dos = view.design_system.rules.rules.filter((rule) => rule.kind === "do");
    const donts = view.design_system.rules.rules.filter((rule) => rule.kind === "dont");
    if (dos.length) lines.push("", "### Do", ...dos.map((rule) => `- ${rule.text}`));
    if (donts.length) lines.push("", "### Don't", ...donts.map((rule) => `- ${rule.text}`));
    lines.push("");
  }
  lines.push("## Files", "", ...view.files.map((file) => `- ${file}`));
  if (view.files_truncated) lines.push(`- ... (first ${MAX_LISTED_FILES} files shown)`);
  return `${lines.join("\n")}\n`;
}
