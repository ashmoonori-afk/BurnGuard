import path from "node:path";
import { bundledDesignSystemId, bundledDesignSystems } from "../data/bundled-design-systems";
import { resolveRepoRoot } from "../lib/paths";
import { readManagedFile } from "./artifact-tree-storage";
import { inspectCanonicalTree } from "./canonical-tree-manifest";
import { readDesignSystemSourceFile } from "./design-system-layout";
import { renderDeckReferencePreview } from "./deck-reference-preview";
import { deckReferenceFor } from "../data/deck-references";
import { SystemContentError } from "./system-content-format";
import { readPreservedFile } from "./system-content-tree";

export const BUNDLED_WEBSITE_PREVIEW = "preview/website.html";
export const BUNDLED_SLIDES_PREVIEW = "preview/slides.html";
export const hasBundledSlidesPreview = (id: string): boolean => {
  const theme = themeFor(id);
  return theme !== undefined && deckReferenceFor(theme.slug) !== undefined;
};
export const BUNDLED_WEBSITE_THUMBNAIL = "preview/thumbnail.webp";
const manifests = new Map<string, ReturnType<typeof inspectCanonicalTree>>();
const themeFor = (id: string) => bundledDesignSystems.find(theme => bundledDesignSystemId(theme.slug) === id);

function bundledManifest(repoRoot: string) {
  const root = path.join(repoRoot, "design system themes/previews");
  let pending = manifests.get(root);
  if (!pending) {
    // Installed resources are immutable for this process; individual reads still verify their hashes.
    pending = inspectCanonicalTree(root, { files: 256, bytes: 32 * 1024 * 1024 });
    manifests.set(root, pending);
    void pending.catch(() => manifests.delete(root));
  }
  return { root, pending };
}

async function previewFontStylesheet(repoRoot: string): Promise<Buffer<ArrayBuffer> | null> {
  const root = path.join(repoRoot, "assets/fonts");
  let pending = manifests.get(root);
  if (pending === undefined) {
    pending = inspectCanonicalTree(root);
    manifests.set(root, pending);
    void pending.catch(() => manifests.delete(root));
  }
  const manifest = await pending;
  const stylesheet = manifest.files.find(entry => entry.path === "fonts.css");
  if (stylesheet === undefined) return null;
  if (stylesheet.size > 256 * 1024) throw new SystemContentError("system_content_corrupt");
  const css = (await readPreservedFile(root, "fonts.css", ["file", "fonts.css", stylesheet.size, stylesheet.sha256], 256 * 1024)).toString("utf8");
  const fonts = new Map(manifest.files.map(entry => [entry.path, entry]));
  return Buffer.from(css.replace(/url\('\.\/([^']+)'\)/g, (source, name: string) => {
    const font = fonts.get(name);
    return font !== undefined && name.endsWith(".woff2") ? `url('/runtime/fonts/${font.sha256}/${name}')` : source;
  }));
}

export async function hasBundledSystemPreview(id: string, repoRoot = resolveRepoRoot()): Promise<boolean> {
  const theme = themeFor(id);
  if (!theme) return false;
  const { pending } = bundledManifest(repoRoot);
  const manifest = await pending;
  return [`${theme.slug}.html`, `media/${theme.slug}.webp`, `thumbnails/${theme.slug}.webp`]
    .every(file => manifest.files.some(entry => entry.path === file));
}

/** Virtual fallbacks keep existing authored trees and content receipts unchanged after an update. */
export async function readBundledSystemPreview(id: string, relative: string, repoRoot = resolveRepoRoot()): Promise<Buffer<ArrayBuffer> | null> {
  const theme = themeFor(id);
  if (!theme) return null;
  if (relative === BUNDLED_SLIDES_PREVIEW) {
    const root = path.join(repoRoot, "design system themes", theme.slug);
    const [css, slides] = await Promise.all([readDesignSystemSourceFile(root, "colors_and_type.css"), readDesignSystemSourceFile(root, "surfaces/slides.css")]);
    if (!css || !slides) return null;
    const html = renderDeckReferencePreview(theme.slug, theme.name, css, slides);
    return html === null ? null : Buffer.from(html);
  }
  const file = relative === BUNDLED_WEBSITE_PREVIEW ? `${theme.slug}.html`
    : relative === "preview/slides-thumbnail.webp" ? `thumbnails/slides-${theme.slug}.webp`
    : relative === BUNDLED_WEBSITE_THUMBNAIL ? `thumbnails/${theme.slug}.webp`
    : relative === `preview/media/${theme.slug}.webp` ? `media/${theme.slug}.webp` : null;
  if (file === null) return relative === "preview/fonts.css" ? previewFontStylesheet(repoRoot) : null;
  const { root, pending } = bundledManifest(repoRoot);
  const entry = (await pending).files.find(entry => entry.path === file);
  if (!entry) return null;
  const bytes = await readManagedFile(root, entry);
  return relative === BUNDLED_WEBSITE_PREVIEW
    ? Buffer.from(bytes.toString("utf8").replace('href="../../assets/fonts/fonts.css"', 'href="./fonts.css"'))
    : bytes;
}
