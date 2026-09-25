import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DECK_STAGE_JS } from "../runtime/deck-stage";
import { readBundledFontUrl, bundledFontFiles } from "../data/bundled-fonts";
import { inspectCanonicalTree } from "./canonical-tree-manifest";
import { resolveWithin } from "../security/path-boundary";

/** An @font-face rule, which cannot nest braces; whether it is served from the shared font endpoint is checked on the match so the pattern cannot backtrack. */
const FONT_FACE = /@font-face\s*\{[^{}]*\}/gi;
/** Above this many distinct bundled families, pruning is skipped so the usage scan stays bounded; the bundle ships 72. */
const MAX_PRUNED_FAMILIES = 128;
const bundledFace = (face: string): boolean => face.includes("/runtime/fonts/");
const faceFamily = (face: string): string | undefined => /font-family\s*:\s*(['"]?)([^'";}]+)\1/i.exec(face)?.[2]?.trim().toLowerCase();

/** Export closures must work independently of the installed app's shared font endpoint. */
export async function prepareBundledFontExport(root: string): Promise<void> {
  const manifest = await inspectCanonicalTree(root);
  const texts = new Map<string, string>();
  for (const file of manifest.files) if (/\.(css|html?|[cm]?js|svg|json)$/i.test(file.path)) texts.set(file.path, await readFile(path.join(root, file.path), "utf8"));
  // Ship only families the document names outside the bundled faces themselves; a face whose family cannot be read is kept.
  const usage = [...texts.values()].map((text) => text.replace(FONT_FACE, (face) => bundledFace(face) ? "" : face)).join("\n").toLowerCase();
  const families = new Set([...texts.values()].flatMap((text) => (text.match(FONT_FACE) ?? []).filter(bundledFace).map(faceFamily)));
  const used = new Map<string, boolean>();
  const keep = (family: string | undefined): boolean => {
    if (family === undefined || families.size > MAX_PRUNED_FAMILIES) return true;
    if (!used.has(family)) used.set(family, usage.includes(family));
    return used.get(family) === true;
  };
  const written = new Map<string, string>();
  for (const [file, text] of texts) {
    if (!/\.(css|html?)$/i.test(file)) continue;
    const absolute = path.join(root, file);
    let source = text.replace(FONT_FACE, (face) => !bundledFace(face) || keep(faceFamily(face)) ? face : "");
    const matches = [...source.matchAll(/url\(\s*['"]?(\/runtime\/fonts\/[a-f0-9]{64}\/[A-Za-z0-9_.-]+\.woff2)['"]?\s*\)/g)];
    if (source === text && !matches.length) continue;
    for (const match of matches) {
      const font = await readBundledFontUrl(match[1]!);
      if (!font) throw new Error("Bundled export font unavailable");
      const relative = `fonts/bundled/${font.sha256}-${font.name}`;
      if (!written.has(relative)) {
        await mkdir(path.join(root, "fonts/bundled"), { recursive: true });
        await writeFile(path.join(root, relative), font.bytes, { flag: "wx" });
        written.set(relative, font.name);
      }
      source = source.replaceAll(match[0], `url('${path.posix.relative(path.posix.dirname(file), relative)}')`);
    }
    await writeFile(absolute, source);
  }
  if (written.size) {
    const bundle = await bundledFontFiles();
    const families = (JSON.parse(bundle.get("manifest.json")?.bytes.toString("utf8") ?? "{}") as { readonly families?: readonly { readonly file: string; readonly licenseFile: string }[] }).families ?? [];
    const licenses = new Set(families.map((family) => family.licenseFile));
    const shipped = [...written.values()].map((name) => families.find((family) => family.file === name)?.licenseFile);
    // A license travels only with a shipped family; a face missing from the manifest keeps every license.
    const kept = shipped.includes(undefined) ? licenses : new Set(shipped);
    for (const file of bundle.values()) {
      if (/\.(txt|md|json)$/i.test(file.name) && (!licenses.has(file.name) || kept.has(file.name))) await writeFile(path.join(root, "fonts/bundled", file.name), file.bytes, { flag: "wx" });
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
