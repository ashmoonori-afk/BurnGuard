import path from "node:path";
import { bundledDesignSystemId, bundledDesignSystems } from "../data/bundled-design-systems";
import { bundledFontStylesheet } from "../data/bundled-fonts";
import { resolveRepoRoot } from "../lib/paths";
import { readManagedFile } from "./artifact-tree-storage";
import { inspectCanonicalTree } from "./canonical-tree-manifest";
import { readDesignSystemSourceFile } from "./design-system-layout";
import { renderDeckReferencePreview } from "./deck-reference-preview";
import { deckReferenceFor } from "../data/deck-references";

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
    : relative === BUNDLED_WEBSITE_THUMBNAIL ? `thumbnails/${theme.slug}.webp`
    : relative === `preview/media/${theme.slug}.webp` ? `media/${theme.slug}.webp` : null;
  if (file === null) return relative === "preview/fonts.css" ? Buffer.from(await bundledFontStylesheet(repoRoot)) : null;
  const { root, pending } = bundledManifest(repoRoot);
  const entry = (await pending).files.find(entry => entry.path === file);
  if (!entry) return null;
  const bytes = await readManagedFile(root, entry);
  return relative === BUNDLED_WEBSITE_PREVIEW
    ? Buffer.from(bytes.toString("utf8").replace('href="../../assets/fonts/fonts.css"', 'href="./fonts.css"'))
    : bytes;
}
