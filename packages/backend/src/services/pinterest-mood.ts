import { isolatedImagePalette } from "./image-palette-process";
import { parse } from "node-html-parser";
import { PINTEREST_PIN_LIMIT, type CreatePinterestMoodRequest, type CreatePinterestMoodResponse } from "@bg/shared";
import { createAcquisitionBudget, ExtractionAcquisitionError, throwIfAcquisitionAborted } from "./extraction-acquisition";
import { DesignSystemExtractError } from "./extraction-errors";
import { fetchWebsiteResource } from "./extraction-website";
import { persistCanonicalExtraction } from "./design-system-extract";
import type { ExtractionDiscovery } from "./extraction-provenance";
import type { SourceAnalysis } from "./extraction-local-tree";

export { imagePalette } from "./image-palette";

export function parsePinterestMoodRequest(value: unknown): CreatePinterestMoodRequest {
  if (!value || typeof value !== "object" || Object.keys(value).some((key) => key !== "name" && key !== "pin_urls") ||
    !("pin_urls" in value) || !Array.isArray(value.pin_urls) || value.pin_urls.length < 1 || value.pin_urls.length > PINTEREST_PIN_LIMIT ||
    ("name" in value && (typeof value.name !== "string" || !value.name.trim() || value.name.length > 100))) {
    throw new DesignSystemExtractError("invalid_pinterest_request", `Provide 1–${PINTEREST_PIN_LIMIT} public Pinterest pin URLs and an optional name (100 characters maximum).`);
  }
  const urls = value.pin_urls.map((url: unknown) => {
    if (typeof url !== "string" || !/^https:\/\/(?:www\.)?pinterest\.com\/pin\/[0-9]{1,30}\/?$/.test(url.trim())) {
      throw new DesignSystemExtractError("invalid_pinterest_request", "Only public https://www.pinterest.com/pin/123/ URLs are supported; boards and shortened links are not supported.");
    }
    return `https://www.pinterest.com/pin/${new URL(url.trim()).pathname.split("/")[2]}/`;
  });
  return { pin_urls: [...new Set(urls)], ...("name" in value && typeof value.name === "string" ? { name: value.name.trim() } : {}) };
}

export async function collectPinterestMood(input: CreatePinterestMoodRequest, signal: AbortSignal, fetchResource = fetchWebsiteResource) {
  const request = parsePinterestMoodRequest(input);
  const pins: { url: string; status: "analyzed" | "unavailable" }[] = [];
  const discoveries: ExtractionDiscovery[] = [];
  const colors = new Set<string>();
  let totalBytes = 0;
  const noteBytes = (bytes: number) => { totalBytes += bytes; if (totalBytes > 24_000_000) throw new DesignSystemExtractError("acquisition_limit", "Pinterest collection exceeds the download limit."); };
  for (const url of request.pin_urls) {
    throwIfAcquisitionAborted(signal);
    try {
      const page = await fetchResource(new URL(url), { signal, kind: "html", maxBytes: 2_000_000, noteBytes, userAgent: "BurnGuard/1.0" });
      if (page.finalUrl.toString() !== url) throw new Error("pin_unavailable");
      const imageUrl = parse(page.text).querySelector('meta[property="og:image"]')?.getAttribute("content");
      if (!imageUrl) throw new Error("pin_unavailable");
      const image = new URL(imageUrl);
      if (image.protocol !== "https:" || image.hostname !== "i.pinimg.com" || image.port || image.username || image.password) throw new Error("unsupported_image_host");
      const resource = await fetchResource(image, { signal, kind: "asset", maxBytes: 4_000_000, noteBytes, userAgent: "BurnGuard/1.0" });
      const palette = await isolatedImagePalette(resource.buffer, { signal });
      if (!palette.length) throw new Error("empty_palette");
      for (const color of palette) {
        colors.add(color);
        discoveries.push({ domain: "token", key: `sample-${color.slice(1)}`, value: color, sourceLocator: url, confidence: 0.75, state: "observed", lineage: ["pin-image-quantized-pixels"] });
      }
      pins.push({ url, status: "analyzed" });
    } catch (error) {
      throwIfAcquisitionAborted(signal);
      if (totalBytes > 24_000_000) throw error;
      pins.push({ url, status: "unavailable" });
    }
  }
  if (!colors.size) throw new DesignSystemExtractError("pinterest_unavailable", "No public pin images could be read. Pins may be private or unavailable; try a website or an uploaded reference instead.");
  const palette = [...colors].slice(0, 24);
  discoveries.push({ domain: "token", key: "brand-primary", value: palette[0]!, sourceLocator: "pin-image-palette", confidence: 0.4, state: "inferred", lineage: ["first-successful-pin-dominant-color"] });
  discoveries.push({ domain: "typography", key: "scaffold-font", value: "Inter", sourceLocator: "burnguard:scaffold", confidence: 1, state: "defaulted" });
  const brightness = palette.reduce((sum, color) => sum + [1, 3, 5].reduce((n, index) => n + Number.parseInt(color.slice(index, index + 2), 16), 0) / 3, 0) / palette.length;
  const mood = brightness > 170 ? "Light palette" : brightness < 85 ? "Dark palette" : "Mid-tone palette";
  discoveries.push({ domain: "layout", key: "palette-mood", value: mood, sourceLocator: "pin-image-palette", confidence: 0.4, state: "inferred", lineage: ["mean-sampled-brightness"] });
  const notes = ["Pinterest mood draft; sampled image colors are not original brand tokens.", `Inferred mood: ${mood}; inferred only from average sampled brightness.`, "Typography, spacing and component layouts use scaffold defaults; they were not extracted from pin images.", ...pins.map((pin) => `${pin.status}: ${pin.url}`)];
  const analysis: SourceAnalysis = { brandName: request.name ?? "Pinterest mood", discoveries, colors: palette, cssDeclarations: [], cssParseIssues: [], cssVars: new Map([["brand-primary", palette[0]!]]), fontFamilies: [], fontSizes: [], fontWeights: [], spacingValues: [], radii: [], shadows: [], borders: [], notes, logoFiles: [], uiKitFiles: [], rawFiles: [], homepageHtml: null, fetchedPageCount: pins.filter((pin) => pin.status === "analyzed").length, componentSamples: { buttons: [], cards: [], forms: [], tables: [], badges: [], headings: [], body: [] }, artifactCopies: [] };
  return { analysis, pins };
}

export async function extractPinterestMood(input: CreatePinterestMoodRequest, signal?: AbortSignal): Promise<CreatePinterestMoodResponse> {
  const budget = createAcquisitionBudget(signal, 60_000);
  try {
    const { analysis, pins } = await collectPinterestMood(input, budget.signal);
    const result = await persistCanonicalExtraction({ requestedId: analysis.brandName, brandName: analysis.brandName, sourceType: "website", sourceReference: pins.find((pin) => pin.status === "analyzed")!.url, lineage: null, analysis, signal: budget.signal });
    return { ...result, pins };
  } catch (error) {
    if (error instanceof ExtractionAcquisitionError) throw new DesignSystemExtractError("acquisition_timeout", "Pinterest collection was cancelled or timed out.");
    throw error;
  } finally { budget.dispose(); }
}
