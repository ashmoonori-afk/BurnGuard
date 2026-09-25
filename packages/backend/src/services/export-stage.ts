import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DECK_STAGE_JS } from "../runtime/deck-stage";
import { readBundledFontUrl, bundledFontFiles } from "../data/bundled-fonts";
import { inspectCanonicalTree } from "./canonical-tree-manifest";
import { resolveWithin } from "../security/path-boundary";

/** Export closures must work independently of the installed app's shared font endpoint. */
export async function prepareBundledFontExport(root: string): Promise<void> {
  const manifest = await inspectCanonicalTree(root);
  const written = new Set<string>();
  for (const file of manifest.files) {
    if (!/\.(css|html?)$/i.test(file.path)) continue;
    const absolute = path.join(root, file.path);
    let source = await readFile(absolute, "utf8");
    const matches = [...source.matchAll(/url\(\s*['"]?(\/runtime\/fonts\/[a-f0-9]{64}\/[A-Za-z0-9_.-]+\.woff2)['"]?\s*\)/g)];
    if (!matches.length) continue;
    for (const match of matches) {
      const font = await readBundledFontUrl(match[1]!);
      if (!font) throw new Error("Bundled export font unavailable");
      const relative = `fonts/bundled/${font.sha256}-${font.name}`;
      if (!written.has(relative)) {
        await mkdir(path.join(root, "fonts/bundled"), { recursive: true });
        await writeFile(path.join(root, relative), font.bytes, { flag: "wx" });
        written.add(relative);
      }
      source = source.replaceAll(match[0], `url('${path.posix.relative(path.posix.dirname(file.path), relative)}')`);
    }
    await writeFile(absolute, source);
  }
  if (written.size) {
    for (const file of (await bundledFontFiles()).values()) {
      if (/\.(txt|md|json)$/i.test(file.name)) await writeFile(path.join(root, "fonts/bundled", file.name), file.bytes, { flag: "wx" });
    }
  }
}
export async function prepareSlideDeckExport(projectDir: string, entrypoint: string): Promise<void> {
  const entrypointPath = resolveWithin(projectDir, entrypoint);
  const runtimeDir = path.join(projectDir, "runtime");
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(path.join(runtimeDir, "deck-stage.js"), DECK_STAGE_JS, "utf8");
  const relative = path.relative(path.dirname(entrypointPath), path.join(runtimeDir, "deck-stage.js")).replaceAll("\\", "/");
  // Only an attribute value that is exactly the absolute virtual path is rewritten; relative spellings stay, so reruns are no-ops.
  await writeFile(entrypointPath, (await readFile(entrypointPath, "utf8")).replace(/(=\s*["']?)\/runtime\/deck-stage\.js(?=[?#"'\s>])/gu, `$1${relative}`), "utf8");
}
