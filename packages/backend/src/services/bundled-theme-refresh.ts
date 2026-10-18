import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import history from "../data/bundled-theme-history.json";

/**
 * Digests of every bundled theme tree that ever shipped, plus every file of the retired liquid-glass
 * runtime that seeding used to copy into each theme. `scripts/build-bundled-theme-history.ts`
 * regenerates it from git; `bundled-theme-refresh.test.ts` fails when a theme edit lands without it.
 */
export type BundledThemeHistory = {
  readonly themes: Readonly<Record<string, readonly string[]>>;
  readonly retired: Readonly<Record<string, readonly string[]>>;
};

export const bundledThemeHistory: BundledThemeHistory = history;

const FONT_DIRECTORY = "fonts";
const GENERATED_FONT_FILES = new Set(["fonts.css", "fonts.md"]);
const RETIRED_DIRECTORY = "liquid-glass";

export type InstalledThemeState = "current" | "outdated" | "edited";

export async function readThemeFiles(root: string): Promise<Map<string, string> | null> {
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
  const lines = [...files]
    .filter(([relative]) => !isFontFile(relative) && !isRetiredFile(relative))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([relative, hash]) => `${relative}\t${hash}\n`);
  return createHash("sha256").update(lines.join("")).digest("hex");
}

const isFontFile = (relative: string) => relative.split("/")[0] === FONT_DIRECTORY;
const isRetiredFile = (relative: string) => relative.split("/")[0] === RETIRED_DIRECTORY;

/**
 * `current` matches the installed bundle; `outdated` is an untouched copy of an older bundle;
 * `edited` is anything else, which seeding must never overwrite.
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

/**
 * Replaces an untouched older theme copy with the installed bundle. User-added font files are carried
 * over; the app-written font stylesheet is rewritten by `writeFonts`. Stage names match the startup
 * recovery prefix, so a killed refresh leaves nothing behind and the next launch seeds the theme again.
 */
export async function refreshBundledTheme(
  id: string,
  source: string,
  destination: string,
  writeFonts: (stage: string) => Promise<void>,
): Promise<void> {
  const root = path.dirname(destination);
  const stage = path.join(root, `.${id}.staging-${randomUUID()}`);
  const previous = path.join(root, `.${id}.staging-${randomUUID()}`);
  try {
    await cp(source, stage, { recursive: true });
    const fonts = path.join(destination, FONT_DIRECTORY);
    if ((await lstat(fonts).catch(() => null))?.isDirectory()) {
      await cp(fonts, path.join(stage, FONT_DIRECTORY), {
        recursive: true,
        filter: (entry) => path.dirname(entry) !== fonts || !GENERATED_FONT_FILES.has(path.basename(entry)),
      });
    }
    await writeFonts(stage);
    await rename(destination, previous);
    try {
      await rename(stage, destination);
    } catch (error) {
      await rename(previous, destination);
      throw error;
    }
  } finally {
    await Promise.all([rm(stage, { recursive: true, force: true }), rm(previous, { recursive: true, force: true })]);
  }
}
