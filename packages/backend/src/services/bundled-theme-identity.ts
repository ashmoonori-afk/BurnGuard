import { createHash } from "node:crypto";
import history from "../data/bundled-theme-history.json";

export const ADDITIVE_DIRECTORIES = ["palette", "canonical"] as const;
export const RETIRED_DIRECTORY = "liquid-glass";
export type AdditiveThemeDirectory = (typeof ADDITIVE_DIRECTORIES)[number];

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

export function themeFileHash(bytes: Uint8Array): string {
  // Windows checkouts may carry CRLF; the shipped content is the same either way.
  const text = Buffer.from(bytes).toString("latin1").replaceAll("\r\n", "\n");
  return createHash("sha256").update(Buffer.from(text, "latin1")).digest("hex");
}

export function themeTreeDigest(files: ReadonlyMap<string, string>): string {
  return fileTreeDigest(new Map([...files].filter(([relative]) =>
    relative.split("/")[0] !== "fonts" && relative.split("/")[0] !== RETIRED_DIRECTORY &&
    !ADDITIVE_DIRECTORIES.some(directory => relative.startsWith(`${directory}/`)))));
}

/** Independent identity for an app-owned addition, never part of legacy recognition. */
export function themeAdditiveDigest(files: ReadonlyMap<string, string>, directory: AdditiveThemeDirectory): string {
  return fileTreeDigest(new Map([...files].filter(([relative]) => relative.startsWith(`${directory}/`))));
}

function fileTreeDigest(files: ReadonlyMap<string, string>): string {
  const lines = [...files]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([relative, hash]) => `${relative}\t${hash}\n`);
  return createHash("sha256").update(lines.join("")).digest("hex");
}
