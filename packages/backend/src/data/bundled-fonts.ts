import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { cacheDir, resolveRepoRoot } from "../lib/paths";
import { readManagedFile } from "../services/artifact-tree-storage";
import { resolveWithin } from "../security/path-boundary";

type BundledFontFile = { readonly name: string; readonly bytes: Buffer; readonly sha256: string };
const bundles = new Map<string, Promise<ReadonlyMap<string, BundledFontFile>>>();
const fontStore = path.join(cacheDir, "bundled-fonts");

/** Seed one persistent shared store; keep old hashes usable after app/font updates. */
export function bundledFontFiles(repoRoot = resolveRepoRoot()): Promise<ReadonlyMap<string, BundledFontFile>> {
  let pending = bundles.get(repoRoot);
  if (!pending) {
    pending = (async () => {
      const source = path.join(repoRoot, "assets/fonts");
      await mkdir(fontStore, { recursive: true });
      if ((await lstat(fontStore)).isSymbolicLink()) throw new Error("Shared font store is unsafe");
      const entries = await Promise.all((await readdir(source)).map(async name => {
        const bytes = await readFile(path.join(source, name));
        return [name, { name, bytes, sha256: createHash("sha256").update(bytes).digest("hex") }] as const;
      }));
      for (const [, file] of entries) {
        if (!file.name.endsWith(".woff2")) continue;
        const name = `${file.sha256}-${file.name}`;
        await writeFile(resolveWithin(fontStore, name), file.bytes, { flag: "wx" }).catch(async (error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
          await readManagedFile(fontStore, { path: name, size: file.bytes.length, sha256: file.sha256 });
        });
      }
      return new Map(entries);
    })();
    bundles.set(repoRoot, pending);
    void pending.catch(() => { bundles.delete(repoRoot); });
  }
  return pending;
}

export function bundledFontUrl(file: BundledFontFile): string {
  return `/runtime/fonts/${file.sha256}/${file.name}`;
}

export async function bundledFontStylesheet(repoRoot = resolveRepoRoot()): Promise<string> {
  const bundle = await bundledFontFiles(repoRoot);
  return bundle.get("fonts.css")!.bytes.toString("utf8").replace(/url\('\.\/([^']+)'\)/g, (source, name: string) => {
    const file = bundle.get(name);
    return file && name.endsWith(".woff2") ? `url('${bundledFontUrl(file)}')` : source;
  });
}

/** Public lookup accepts only exact content-addressed font names in the installed bundle. */
export async function readBundledFontUrl(urlPath: string): Promise<BundledFontFile | null> {
  const match = /^\/runtime\/fonts\/([a-f0-9]{64})\/([A-Za-z0-9_.-]+\.woff2)$/.exec(urlPath);
  if (!match) return null;
  const file = (await bundledFontFiles()).get(match[2]!);
  if (file?.sha256 === match[1]) return file;
  try {
    const name = `${match[1]}-${match[2]}`;
    const info = await lstat(resolveWithin(fontStore, name));
    if (!info.isFile() || info.size > 4 * 1024 * 1024) return null;
    const bytes = await readManagedFile(fontStore, { path: name, size: info.size, sha256: match[1]! });
    if (bytes.toString("ascii", 0, 4) !== "wOF2") return null;
    return { name: match[2]!, bytes, sha256: match[1]! };
  } catch { return null; }
}

/** Initialization only: brand fonts survive; common binaries stay in the installed bundle. */
export async function copyBundledFonts(destination: string, repoRoot = resolveRepoRoot()): Promise<void> {
  const bundle = await bundledFontFiles(repoRoot);
  const target = path.join(destination, "fonts");
  await mkdir(target, { recursive: true });
  const originalCss = bundle.get("fonts.css")!.bytes.toString("utf8");
  const sharedCss = await bundledFontStylesheet(repoRoot);
  for (const file of bundle.values()) {
    if (file.name !== "fonts.css" && file.name !== "fonts.md") continue;
    const bytes = file.name === "fonts.css" ? sharedCss : file.bytes;
    await writeFile(path.join(target, file.name), bytes, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  }
  // Convert only the known legacy stylesheet in an unpublished template stage.
  if (await readFile(path.join(target, "fonts.css"), "utf8") !== originalCss) return;
  await writeFile(path.join(target, "fonts.css"), sharedCss);
  for (const file of bundle.values()) {
    if (!file.name.endsWith(".woff2")) continue;
    const copied = await readFile(path.join(target, file.name)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (copied?.equals(file.bytes)) await rm(path.join(target, file.name));
  }
}
