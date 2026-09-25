import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DECK_STAGE_JS } from "../runtime/deck-stage";
import { readBundledFontUrl, bundledFontFiles } from "../data/bundled-fonts";
import { inspectCanonicalTree } from "./canonical-tree-manifest";
import { resolveWithin } from "../security/path-boundary";

/** An @font-face rule, which cannot nest braces; whether it is served from the shared font endpoint is checked on the match so the pattern cannot backtrack. */
const FONT_FACE = /@font-face\s*\{[^{}]*\}/gi;
/** Above this many distinct bundled families, pruning is skipped so the family search stays small; the bundle ships 72. */
const MAX_PRUNED_FAMILIES = 128;
/** A longer family name is never searched for and keeps its faces; bundled names are under 20 characters. */
const MAX_PRUNED_FAMILY_LENGTH = 256;
const bundledFace = (face: string): boolean => face.includes("/runtime/fonts/");
const faceFamily = (face: string): string | undefined => /font-family\s*:\s*(['"]?)([^'";}]+)\1/i.exec(face)?.[2]?.trim().toLowerCase();

/** Which `names` occur in `text`, in one Aho-Corasick pass; a substring search per name costs the text once per name, and more for some shapes. */
function namesIn(text: string, names: readonly string[]): Set<string> {
  const next: Map<number, number>[] = [new Map()];
  const ends: string[][] = [[]];
  for (const name of names) {
    let state = 0;
    for (let index = 0; index < name.length; index++) {
      const code = name.charCodeAt(index);
      let to = next[state]!.get(code);
      if (to === undefined) {
        to = next.push(new Map()) - 1;
        ends.push([]);
        next[state]!.set(code, to);
      }
      state = to;
    }
    ends[state]!.push(name);
  }
  // Breadth-first, each state falls back to the longest proper suffix of its path that is also a state.
  const fail = new Int32Array(next.length);
  const order = [...next[0]!.values()];
  for (let head = 0; head < order.length; head++) {
    for (const [code, to] of next[order[head]!]!) {
      let back = fail[order[head]!]!;
      while (back !== 0 && !next[back]!.has(code)) back = fail[back]!;
      fail[to] = next[back]!.get(code) ?? 0;
      order.push(to);
    }
  }
  const reached = new Uint8Array(next.length);
  for (let index = 0, state = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    while (state !== 0 && !next[state]!.has(code)) state = fail[state]!;
    state = next[state]!.get(code) ?? 0;
    reached[state] = 1;
  }
  // Reaching a state also reaches its fallbacks; deepest first, so each is marked before it is read.
  const found = new Set<string>();
  for (const state of order.reverse()) {
    if (!reached[state]) continue;
    reached[fail[state]!] = 1;
    for (const name of ends[state]!) found.add(name);
  }
  return found;
}

/** Export closures must work independently of the installed app's shared font endpoint. */
export async function prepareBundledFontExport(root: string): Promise<void> {
  const manifest = await inspectCanonicalTree(root);
  const texts = new Map<string, string>();
  for (const file of manifest.files) if (/\.(css|html?|[cm]?js|svg|json)$/i.test(file.path)) texts.set(file.path, await readFile(path.join(root, file.path), "utf8"));
  // Ship only families the document names outside the bundled faces themselves; a face whose family cannot be read is kept.
  const usage = [...texts.values()].map((text) => text.replace(FONT_FACE, (face) => bundledFace(face) ? "" : face)).join("\n").toLowerCase();
  const families = new Set([...texts.values()].flatMap((text) => (text.match(FONT_FACE) ?? []).filter(bundledFace).map(faceFamily)));
  let used: Set<string> | undefined;
  const keep = (family: string | undefined): boolean => {
    if (!family || family.length > MAX_PRUNED_FAMILY_LENGTH || families.size > MAX_PRUNED_FAMILIES) return true;
    used ??= namesIn(usage, [...families].filter((name): name is string => !!name && name.length <= MAX_PRUNED_FAMILY_LENGTH));
    return used.has(family);
  };
  const written = new Map<string, string>();
  for (const [file, text] of texts) {
    if (!/\.(css|html?)$/i.test(file)) continue;
    const absolute = path.join(root, file);
    let source = text.replace(FONT_FACE, (face) => !bundledFace(face) || keep(faceFamily(face)) ? face : "");
    const fontUrl = /url\(\s*['"]?(\/runtime\/fonts\/[a-f0-9]{64}\/[A-Za-z0-9_.-]+\.woff2)['"]?\s*\)/g;
    const fontPaths = new Set([...source.matchAll(fontUrl)].map((match) => match[1]!));
    if (source === text && !fontPaths.size) continue;
    // Each distinct font is resolved once and every reference is rewritten in one pass; a replace per reference is quadratic.
    const replacements = new Map<string, string>();
    for (const fontPath of fontPaths) {
      const font = await readBundledFontUrl(fontPath);
      if (!font) throw new Error("Bundled export font unavailable");
      const relative = `fonts/bundled/${font.sha256}-${font.name}`;
      if (!written.has(relative)) {
        await mkdir(path.join(root, "fonts/bundled"), { recursive: true });
        await writeFile(path.join(root, relative), font.bytes, { flag: "wx" });
        written.set(relative, font.name);
      }
      replacements.set(fontPath, `url('${path.posix.relative(path.posix.dirname(file), relative)}')`);
    }
    source = source.replace(fontUrl, (_reference, fontPath: string) => replacements.get(fontPath)!);
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
