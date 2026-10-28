import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import history from "../data/bundled-theme-history.json";

/**
 * Shipped legacy tree digests and retired runtime file hashes retain their existing history format.
 * Optional additive histories recognize each reserved subtree independently of the legacy tree.
 * `scripts/build-bundled-theme-history.ts` regenerates legacy history from git.
 */
export type BundledThemeHistory = {
  readonly themes: Readonly<Record<string, readonly string[]>>;
  readonly retired: Readonly<Record<string, readonly string[]>>;
  readonly additive?: Readonly<Record<string, Partial<Readonly<Record<AdditiveThemeDirectory, readonly string[]>>>>>;
};

export const bundledThemeHistory: BundledThemeHistory = history;

const FONT_DIRECTORY = "fonts";
const RETIRED_DIRECTORY = "liquid-glass";
const ADDITIVE_DIRECTORIES = ["palette", "canonical"] as const;
export type AdditiveThemeDirectory = (typeof ADDITIVE_DIRECTORIES)[number];

export type InstalledThemeState = "current" | "outdated" | "edited";

export async function readThemeFiles(root: string): Promise<Map<string, string> | null> {
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) return null;
  const files = new Map<string, string>();
  const visit = async (directory: string): Promise<boolean> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      const info = await lstat(target);
      if (info.isSymbolicLink()) return false;
      if (info.isDirectory()) {
        if (!(await visit(target))) return false;
        continue;
      }
      if (!info.isFile()) return false;
      files.set(path.relative(root, target).split(path.sep).join("/"), themeFileHash(await readFile(target)));
    }
    return true;
  };
  return (await visit(root)) ? files : null;
}

export function themeFileHash(bytes: Uint8Array): string {
  // Windows checkouts may carry CRLF; the shipped content is the same either way.
  const text = Buffer.from(bytes).toString("latin1").replaceAll("\r\n", "\n");
  return createHash("sha256").update(Buffer.from(text, "latin1")).digest("hex");
}

export function themeTreeDigest(files: ReadonlyMap<string, string>): string {
  return fileTreeDigest(new Map([...files].filter(([relative]) =>
    !isFontFile(relative) && !isRetiredFile(relative) && !ADDITIVE_DIRECTORIES.some(directory => inDirectory(relative, directory)))));
}

/** Independent identity for an app-owned addition, never part of legacy recognition. */
export function themeAdditiveDigest(files: ReadonlyMap<string, string>, directory: AdditiveThemeDirectory): string {
  return fileTreeDigest(new Map([...files].filter(([relative]) => inDirectory(relative, directory))));
}

function fileTreeDigest(files: ReadonlyMap<string, string>): string {
  const lines = [...files]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([relative, hash]) => `${relative}\t${hash}\n`);
  return createHash("sha256").update(lines.join("")).digest("hex");
}

const isFontFile = (relative: string) => relative.split("/")[0] === FONT_DIRECTORY;
const isRetiredFile = (relative: string) => relative.split("/")[0] === RETIRED_DIRECTORY;
const inDirectory = (relative: string, directory: string) => relative.startsWith(`${directory}/`);

/**
 * Classifies legacy bytes only: a recognized older tree remains eligible for additive publication,
 * never for replacement with current legacy bytes. Unknown legacy or retired files are preserved.
 */
export async function installedThemeState(
  installed: string,
  source: string,
  slug: string,
  themeHistory: BundledThemeHistory = bundledThemeHistory,
): Promise<InstalledThemeState> {
  const files = await readThemeFiles(installed);
  if (files === null) return "edited";
  const digest = themeTreeDigest(files);
  if (!(themeHistory.themes[slug] ?? []).includes(digest)) return "edited";
  const retired = [...files].filter(([relative]) => isRetiredFile(relative));
  if (retired.some(([relative, hash]) => !(themeHistory.retired[relative] ?? []).includes(hash))) return "edited";
  const shipped = await readThemeFiles(source);
  if (shipped === null) throw new Error("Bundled theme source contains an unsafe entry");
  return retired.length === 0 && digest === themeTreeDigest(shipped) ? "current" : "outdated";
}

export type BundledThemeRefresh = (id: string, source: string, destination: string, themeHistory: BundledThemeHistory) => Promise<void>;

const previousThemePath = (destination: string): string => path.join(path.dirname(destination), `.${path.basename(destination)}.previous`);

async function themeDirectoryExists(directory: string): Promise<boolean> {
  try {
    if (!(await lstat(directory)).isDirectory()) {
      throw Object.assign(new Error("Theme recovery requires a directory"), { code: "INVALID_THEME_DIRECTORY" });
    }
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

/** Restore an interrupted swap before seeding can mistake the missing destination for a first launch. */
export async function recoverBundledTheme(
  destination: string,
  move: (from: string, to: string) => Promise<void> = rename,
): Promise<void> {
  const previous = previousThemePath(destination);
  if (!(await themeDirectoryExists(previous))) return;
  if (await themeDirectoryExists(destination)) {
    await rm(previous, { recursive: true, force: true });
  } else {
    await move(previous, destination);
  }
}

/**
 * Copies the installed tree and overlays only missing or recognized app-owned additive directories.
 * Legacy files, including fonts and retired runtime files, are never replaced. A failed swap puts
 * the old folder back. The previous copy stays outside extraction staging cleanup so a killed
 * process or failed rollback cannot lose installed bytes; recovery restores it before seeding.
 */
export async function refreshBundledTheme(
  id: string,
  source: string,
  destination: string,
  themeHistory: BundledThemeHistory = bundledThemeHistory,
  move: (from: string, to: string) => Promise<void> = rename,
): Promise<void> {
  const slug = id.slice("builtin-theme-".length);
  if (await installedThemeState(destination, source, slug, themeHistory) === "edited") return;
  const installed = await readThemeFiles(destination);
  const shipped = await readThemeFiles(source);
  if (installed === null || shipped === null) return;
  const entries = await readdir(destination, { withFileTypes: true });
  const additions = ADDITIVE_DIRECTORIES.filter(directory => {
    if (![...shipped.keys()].some(relative => inDirectory(relative, directory))) return false;
    // A differently cased name also collides on Windows; never merge user directories into a bundle.
    const occupied = entries.filter(entry => entry.name.toLowerCase() === directory);
    if (occupied.length === 0) return true;
    if (occupied.length !== 1 || occupied[0]?.name !== directory || !occupied[0].isDirectory()) return false;
    const current = themeAdditiveDigest(installed, directory);
    const next = themeAdditiveDigest(shipped, directory);
    return current !== next && (themeHistory.additive?.[slug]?.[directory] ?? []).includes(current);
  });
  if (additions.length === 0) return;
  const root = path.dirname(destination);
  const stage = path.join(root, `.${id}.staging-${randomUUID()}`);
  const previous = previousThemePath(destination);
  try {
    await cp(destination, stage, { recursive: true });
    for (const directory of additions) {
      await rm(path.join(stage, directory), { recursive: true, force: true });
      // File history cannot prove ownership of empty directories. Carry them over without old files.
      const installedDirectory = path.join(destination, directory);
      if (await themeDirectoryExists(installedDirectory)) {
        await cp(installedDirectory, path.join(stage, directory), {
          recursive: true, filter: async entry => (await lstat(entry)).isDirectory(),
        });
      }
      await cp(path.join(source, directory), path.join(stage, directory), { recursive: true });
    }
    await move(destination, previous);
    try {
      await move(stage, destination);
    } catch (error) {
      await move(previous, destination);
      throw error;
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
    // Never delete the only remaining copy when restoring it failed too.
    if (await lstat(destination).then(() => true, () => false)) await rm(previous, { recursive: true, force: true });
  }
}
