#!/usr/bin/env bun
// Records every shipped bundled-theme tree so seeding can upgrade untouched copies in existing profiles.
// Run after any change under `design system themes/<slug>/`: bun scripts/build-bundled-theme-history.ts
import { $ } from "bun";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { bundledDesignSystems } from "../packages/backend/src/data/bundled-design-systems";
import { readThemeFiles, themeFileHash, themeTreeDigest } from "../packages/backend/src/services/bundled-theme-refresh";

const repo = path.resolve(import.meta.dir, "..");
const output = path.join(repo, "packages/backend/src/data/bundled-theme-history.json");
const RETIRED_SOURCE = "assets/liquid-glass/";
const RETIRED_TARGET = "liquid-glass/";

const git = async (...args: string[]): Promise<Buffer> => (await $`git ${args}`.cwd(repo).quiet()).stdout;
if ((await git("rev-parse", "--is-shallow-repository")).toString().trim() !== "false") {
  throw new Error("Theme history needs the full git history; run git fetch --unshallow first");
}

const blobs = new Map<string, string>();
async function blobHash(sha: string): Promise<string> {
  const cached = blobs.get(sha);
  if (cached !== undefined) return cached;
  const hash = themeFileHash(await git("cat-file", "blob", sha));
  blobs.set(sha, hash);
  return hash;
}

async function treeAt(commit: string, prefix: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const record of (await git("ls-tree", "-r", "-z", commit, "--", prefix)).toString("utf8").split("\0")) {
    if (record === "") continue;
    const [meta, file] = record.split("\t") as [string, string];
    files.set(file.slice(prefix.length), await blobHash(meta.split(" ")[2]!));
  }
  return files;
}

const commitsTouching = async (prefix: string): Promise<string[]> =>
  (await git("log", "--format=%H", "--", prefix)).toString("utf8").split("\n").filter(Boolean);

const themes: Record<string, string[]> = {};
for (const { slug } of bundledDesignSystems) {
  const prefix = `design system themes/${slug}/`;
  const digests = new Set<string>();
  for (const commit of await commitsTouching(prefix)) {
    const files = await treeAt(commit, prefix);
    if (files.size > 0) digests.add(themeTreeDigest(files));
  }
  const current = await readThemeFiles(path.join(repo, prefix));
  if (current === null) throw new Error(`Theme ${slug} contains an unsafe entry`);
  digests.add(themeTreeDigest(current));
  themes[slug] = [...digests].sort();
}

const retired: Record<string, Set<string>> = {};
for (const commit of await commitsTouching(RETIRED_SOURCE)) {
  for (const [file, hash] of await treeAt(commit, RETIRED_SOURCE)) {
    const key = `${RETIRED_TARGET}${file}`;
    retired[key] = (retired[key] ?? new Set()).add(hash);
  }
}

const sorted = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).sort(([left], [right]) => (left < right ? -1 : 1)));
await writeFile(output, `${JSON.stringify({
  themes: sorted(themes),
  retired: sorted(Object.fromEntries(Object.entries(retired).map(([file, hashes]) => [file, [...hashes].sort()]))),
}, null, 2)}\n`);
