import { cp } from "node:fs/promises";
import path from "node:path";
import { resolveRepoRoot } from "../lib/paths";

export const ORIGINAL_SAMPLE_TAG = "[burnguard:original-sample]";
export const originalSamples = [
  { slug: "sonnel", name: "SONNEL", description: "Tactile sound objects and playful precision." },
  { slug: "foliover", name: "FOLIOVER", description: "An independent journal of materials and culture." },
  { slug: "oddward", name: "ODDWARD", description: "Experimental creative work with expressive typography." },
  { slug: "velune", name: "VELUNE", description: "Sculptural light and considered interiors." },
] as const;
export const originalSampleFormats = [
  { type: "prototype", directory: "web", entrypoint: "index.html", label: "Web" },
  { type: "slide_deck", directory: "slides", entrypoint: "deck.html", label: "Slides" },
  { type: "graphic", directory: "graphic", entrypoint: "index.html", label: "Graphic" },
] as const;
export const originalGraphicCanvas = { schema_version: 1, width: 1080, height: 1350 } as const;
export function originalSampleSystemId(slug: string): string { return `sample-system-original-${slug}`; }
export function findOriginalSample(systemId: string | null) {
  return originalSamples.find((sample) => originalSampleSystemId(sample.slug) === systemId);
}
export async function copyOriginalSample(slug: string, directory: string, destination: string, repoRoot = resolveRepoRoot()): Promise<void> {
  const source = path.join(repoRoot, "samples", "original", slug);
  await cp(path.join(source, directory), destination, { recursive: true });
  await cp(path.join(source, "assets"), path.join(destination, "assets"), { recursive: true });
}
