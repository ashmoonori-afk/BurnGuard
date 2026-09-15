import { lstat, readFile } from "node:fs/promises";
import { parse, type HTMLElement } from "node-html-parser";
import { resolveWithin } from "../security/path-boundary";
import { localAssetReferences } from "./export-closure";

/** Structural completion, not a claim that copy or image quality has been reviewed. */
export function hasGeneratedContent(node: HTMLElement): boolean {
  if (node.hasAttribute("data-bg-placeholder") || node.querySelector("[data-bg-placeholder]")) return false;
  const content = parse(node.innerHTML);
  for (const ignored of content.querySelectorAll("script,style,template,[data-speaker-notes],[data-deck-nav]")) ignored.remove();
  const text = content.textContent.trim();
  if (/^\d+\s*\/\s*\d+$/.test(text)) return false;
  return text.length > 0 || content.querySelector("img[src],svg,canvas,video[src]") !== null || /background(?:-image)?\s*:[^;{}]*url\(/i.test(node.innerHTML);
}

export async function generationOutputComplete(directory: string, entrypoint: string, projectType: string, expectedSlides?: number): Promise<boolean> {
  try {
    const file = resolveWithin(directory, entrypoint);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 16 * 1024 * 1024) throw new Error("generation_file_invalid");
    const source = await readFile(file, "utf8");
    if (source.includes("Send your first prompt in chat to expand this deck.") || source.includes("Start with one clear visual message.")) return false;
    const root = parse(source);
    if (!hasGeneratedContent(root)) return false;
    const units = root.querySelectorAll("[data-bg-unit]");
    if (units.some(node => node.getAttribute("data-bg-complete") !== "true" || !hasGeneratedContent(node))) return false;
    if (projectType === "slide_deck") {
      const slides = root.querySelectorAll("[data-slide]");
      if (!slides.length || (expectedSlides !== undefined && slides.length !== expectedSlides) || slides.some(node => node.parentNode?.closest("[data-slide]") || !hasGeneratedContent(node))) return false;
      if (!root.querySelectorAll("script[src]").some(node => /^\/?(?:\.\/)?runtime\/deck-stage\.js(?:[?#].*)?$/.test(node.getAttribute("src") ?? ""))) return false;
    }
    // Reuse the asset parser; virtual runtime/font routes are not local images.
    for (const asset of localAssetReferences(source, entrypoint).filter(value => /\.(?:png|jpe?g|webp|gif|avif|svg)$/i.test(value))) {
      const image = await lstat(resolveWithin(directory, asset));
      if (!image.isFile() || image.isSymbolicLink() || image.nlink !== 1 || image.size === 0) return false;
    }
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
