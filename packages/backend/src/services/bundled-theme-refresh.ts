import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import history from "../data/bundled-theme-history.json";
import { getSqlite } from "../db/sqlite-client";
import { getCatalogRow, getCurrentSystemContent } from "../db/catalog-repository";
import { defaultManagedTreeIo } from "./artifact-tree-storage";
import { withSystemContentAccess } from "./system-content-access";
import { contentHash, parseContentProvenance, SystemContentError } from "./system-content-format";
import {
  contentObservationDigest, observeSystemContent, publishSystemContent,
  type ContentEnvironment, type ContentValidator,
} from "./system-content-publication";
import { inspectContentTree, readPreservedFile, safeContentChild } from "./system-content-tree";
import { DEFAULT_CANONICAL_TREE_LIMITS } from "./canonical-tree-manifest";
import { readCanonicalCandidate } from "./canonical-theme-files";

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
  let entries = 0;
  let bytes = 0;
  const visit = async (directory: string): Promise<boolean> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      entries += 1;
      if (entries > DEFAULT_CANONICAL_TREE_LIMITS.files) return false;
      const target = path.join(directory, entry.name);
      const info = await lstat(target);
      if (info.isSymbolicLink()) return false;
      if (info.isDirectory()) {
        if (!(await visit(target))) return false;
        continue;
      }
      if (!info.isFile() || info.nlink !== 1 || info.size > DEFAULT_CANONICAL_TREE_LIMITS.bytes - bytes) return false;
      const relative = path.relative(root, target).split(path.sep).join("/");
      const content = await readPreservedFile(root, relative, undefined, DEFAULT_CANONICAL_TREE_LIMITS.bytes - bytes);
      bytes += content.byteLength;
      files.set(relative, themeFileHash(content));
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

/** Shipped hashes, not receipt/client metadata, authorize each complete additive subtree. */
export function bundledAdditionValidator(themeHistory: BundledThemeHistory = bundledThemeHistory): ContentValidator {
  return async (root, journal) => {
    const slug = journal.system_id.startsWith("builtin-theme-") ? journal.system_id.slice("builtin-theme-".length) : "";
    if (slug === "" || journal.mode !== "replace" || journal.palette_history !== null || journal.write_set.length === 0) {
      throw new SystemContentError("system_content_corrupt");
    }
    const files = await readThemeFiles(root);
    if (files === null || !(themeHistory.themes[slug] ?? []).includes(themeTreeDigest(files))) {
      throw new SystemContentError("system_content_corrupt");
    }
    const directories = new Set<AdditiveThemeDirectory>();
    for (const name of journal.write_set) {
      const directory = ADDITIVE_DIRECTORIES.find(candidate => inDirectory(name, candidate));
      if (directory === undefined) throw new SystemContentError("system_content_corrupt");
      directories.add(directory);
    }
    for (const directory of directories) {
      if (!(themeHistory.additive?.[slug]?.[directory] ?? []).includes(themeAdditiveDigest(files, directory))) {
        throw new SystemContentError("system_content_corrupt");
      }
    }
  };
}

/** Publish exact additive file changes, cloning installed bytes through the shared publisher. */
export async function refreshBundledTheme(
  id: string,
  source: string,
  destination: string,
  themeHistory: BundledThemeHistory = bundledThemeHistory,
  move: (from: string, to: string) => Promise<void> = rename,
  environment?: ContentEnvironment,
): Promise<void> {
  const validate = environment?.validators["bundled-addition"] ?? bundledAdditionValidator(themeHistory);
  const env: ContentEnvironment = environment ?? {
    db: getSqlite(), systemsRoot: path.dirname(destination), operationId: randomUUID, now: Date.now,
    io: { ...defaultManagedTreeIo, rename: move }, validators: { "bundled-addition": validate },
  };
  // A standalone installer may have no catalog row yet, or be installing into a different root.
  // This negative check grants no authority; the publisher rereads the row under its lease.
  const installedRow = getCatalogRow(env.db, id);
  if (installedRow === null || path.isAbsolute(installedRow.dirPath) && installedRow.dirPath !== destination) return;
  await withSystemContentAccess(env.db, env.systemsRoot, [id], async lease => {
    const base = await observeSystemContent(env, id, lease);
    if (base.row === null || base.tree === null || base.live !== destination || base.row.lifecycle !== "active") return;
    const slug = id.slice("builtin-theme-".length);
    if (await installedThemeState(destination, source, slug, themeHistory) === "edited") return;
    const sourceTree = await inspectContentTree(source);
    const installed = await readThemeFiles(destination);
    const shipped = await readThemeFiles(source);
    if (installed === null || shipped === null) return;
    const entries = await readdir(destination, { withFileTypes: true });
    const additions = ADDITIVE_DIRECTORIES.filter(directory => {
      if (![...shipped.keys()].some(relative => inDirectory(relative, directory))) return false;
      if (!(themeHistory.additive?.[slug]?.[directory] ?? []).includes(themeAdditiveDigest(shipped, directory))) return false;
      // A differently cased name also collides on Windows; never merge user directories into a bundle.
      const occupied = entries.filter(entry => entry.name.toLowerCase() === directory);
      if (occupied.length === 0) return true;
      if (occupied.length !== 1 || occupied[0]?.name !== directory || !occupied[0].isDirectory()) return false;
      const current = themeAdditiveDigest(installed, directory);
      const next = themeAdditiveDigest(shipped, directory);
      return current !== next && (themeHistory.additive?.[slug]?.[directory] ?? []).includes(current);
    });
    if (additions.length === 0) return;
    const selected = (name: string) => additions.some(directory => inDirectory(name, directory));
    const payload = new Map<string, Buffer>();
    for (const entry of sourceTree.inventory) {
      if (entry[0] === "file" && selected(entry[1])) payload.set(entry[1], await readPreservedFile(source, entry[1], entry));
    }
    const oldFiles = new Map(base.tree.inventory.filter(entry => entry[0] === "file" && selected(entry[1])).map(entry => [entry[1], entry]));
    const writeSet = [...new Set([...oldFiles.keys(), ...payload.keys()])].filter(name => {
      const next = payload.get(name), old = oldFiles.get(name);
      return next === undefined || old === undefined || old[2] !== next.length || old[3] !== contentHash(next);
    }).sort();
    if (writeSet.length === 0) return;
    const head = getCurrentSystemContent(env.db, id);
    if (head !== null && head.schemaVersion === 1 && head.operation !== "content" && head.parentReceiptId === null) {
      throw new SystemContentError("system_content_corrupt");
    }
    const sourceExtraction = head === null ? null : head.schemaVersion === 2
      ? parseContentProvenance(JSON.parse(head.provenanceJson)).source_extraction
      : { receipt_id: head.operation === "content" ? head.id : head.parentReceiptId ?? head.id, digest: head.digest };
    await publishSystemContent(env, {
      systemId: id, mode: "replace", expectedDigest: contentObservationDigest(base), lease,
      adapter: {
        provenance: { format: "system-content-v1", writer: "bundled-addition", source_extraction: sourceExtraction },
        writeSet: () => writeSet,
        transform: async stage => {
          for (const name of writeSet) {
            const target = await safeContentChild(stage, ...name.split("/"));
            const bytes = payload.get(name);
            if (bytes === undefined) await rm(target);
            else {
              await mkdir(path.dirname(target), { recursive: true });
              await writeFile(target, bytes);
            }
          }
        },
        validate,
        canonicalTransfer: async (_base, stage) => (await readCanonicalCandidate(stage))?.proof ?? null,
      },
    });
  });
}
