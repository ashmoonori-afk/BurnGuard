import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { extractDesignSystemLayout, supplementDesignSystemLayout, type DesignSystemLayout } from "@bg/shared";
import { bundledDesignSystems, bundledDesignSystemId } from "../data/bundled-design-systems";
import { originalSamples, originalSampleSystemId } from "../data/original-samples";
import { sampleLayoutFiles } from "../data/sample-layouts";
import { resolveRepoRoot } from "../lib/paths";
import { resolveWithin } from "../security/path-boundary";
import { readManagedFile } from "./artifact-tree-storage";

export type LayoutSystem = { readonly id: string; readonly dir_path: string; readonly tokens_css_path: string | null; readonly readme_md_path: string | null };
const SAMPLE_KEYS = { "clearinvoice-static-saas": "split-saas", "taskly-liquid-glass": "liquid-orb", "mindloop-monochrome": "editorial", "velorah-cinematic": "cinematic", "pulse-fund-ops-dashboard": "dashboard", "daon-korean-saas": "editorial" } as const;

export async function readDesignSystemLayout(system: LayoutSystem): Promise<DesignSystemLayout> {
  const root = system.dir_path;
  const [css, readme] = await Promise.all([
    system.tokens_css_path ? readDesignSystemSourceFile(root, path.relative(root, system.tokens_css_path)) : "",
    system.readme_md_path ? readDesignSystemSourceFile(root, path.relative(root, system.readme_md_path)) : "",
  ]);
  const local = extractDesignSystemLayout(css, readme);
  const preset = system.id === "splash" ? "splash" : system.id.startsWith("sample-system-") ? SAMPLE_KEYS[system.id.slice("sample-system-".length) as keyof typeof SAMPLE_KEYS] : undefined;
  if (preset) return supplementDesignSystemLayout(local, sampleLayoutFiles(preset).layout);
  const source = bundledDesignSystemSourceDir(system.id);
  if (source === null || path.resolve(source) === path.resolve(root)) return local;
  const [bundledCss, bundledReadme] = await Promise.all([readDesignSystemSourceFile(source, "colors_and_type.css"), readDesignSystemSourceFile(source, "README.md")]);
  // Fill missing bundled rules in older installations without overwriting authored files or receipts.
  return supplementDesignSystemLayout(local, extractDesignSystemLayout(bundledCss, bundledReadme));
}

/** Repository copy of a system that ships with the app, or null for a user-made system. */
export function bundledDesignSystemSourceDir(id: string): string | null {
  const bundled = bundledDesignSystems.find(theme => bundledDesignSystemId(theme.slug) === id);
  const original = originalSamples.find(sample => originalSampleSystemId(sample.slug) === id);
  const relative = bundled ? ["design system themes", bundled.slug] : original ? ["samples", "original", original.slug, "design-system"] : id === "northvale-capital" ? ["design system sample"] : null;
  return relative === null ? null : path.join(resolveRepoRoot(), ...relative);
}

/** Bounded, symlink-refusing read of one file inside a design-system directory. */
export async function readDesignSystemSourceFile(root: string, relative: string): Promise<string> {
  try { if ((await lstat(root)).isSymbolicLink()) throw new Error("Design system layout source is invalid"); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return ""; throw error; }
  const file = resolveWithin(root, ...relative.split(path.sep));
  let handle;
  try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return ""; throw error; }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 256 * 1024) throw new Error("Design system layout source is invalid");
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    // Reuse publication identity checks before any candidate bytes enter API or prompt context.
    return (await readManagedFile(root, { path: relative.replaceAll("\\", "/"), size: info.size, sha256: createHash("sha256").update(bytes.subarray(0, offset)).digest("hex") })).toString("utf8");
  } finally { await handle.close(); }
}
