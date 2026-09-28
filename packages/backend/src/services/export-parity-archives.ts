import JSZip from "jszip";
import { decodeParityImage } from "./export-parity-images";
import { composeParityPage } from "./export-parity-compose";
import type { ParityPixelPage } from "./export-parity";
import path from "node:path";

const MAX_PARITY_PAGES = 100;

export async function zipParityImages(
  bytes: Uint8Array,
  paths: readonly string[],
): Promise<readonly ParityPixelPage[]> {
  if (paths.length > MAX_PARITY_PAGES) {
    throw new TypeError("Parity page count is invalid");
  }
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const pages: ParityPixelPage[] = [];
  for (const path of paths) {
    const entry = zip.file(path);
    if (entry === null) throw new TypeError("Parity image is missing");
    pages.push(await decodeParityImage(await entry.async("uint8array")));
  }
  return pages;
}

export async function pptxParityImages(
  bytes: Uint8Array,
  slideCount: number,
): Promise<readonly ParityPixelPage[]> {
  if (
    !Number.isSafeInteger(slideCount) ||
    slideCount < 1 ||
    slideCount > MAX_PARITY_PAGES
  ) {
    throw new TypeError("PPTX parity slide count is invalid");
  }
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const presentation = await requiredText(zip, "ppt/presentation.xml");
  const presentationRels = relationships(
    await requiredText(zip, "ppt/_rels/presentation.xml.rels"),
  );
  const size = slideSize(presentation);
  const slidePaths = [...presentation.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/gu)]
    .map((match) => relationshipTarget(presentationRels, match[1], "slide"))
    .map((target) => safeZipPath("ppt", target));
  if (slidePaths.length !== slideCount) {
    throw new TypeError("PPTX parity slide order is invalid");
  }
  const pages: ParityPixelPage[] = [];
  for (const slidePath of slidePaths) {
    const slide = await requiredText(zip, slidePath);
    const relationPath = `${path.posix.dirname(slidePath)}/_rels/${path.posix.basename(slidePath)}.rels`;
    const slideRels = relationships(await requiredText(zip, relationPath));
    const pictures = [...slide.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/gu)];
    if (pictures.length !== 1) {
      throw new TypeError("PPTX parity requires one slide image");
    }
    const picture = pictures[0]?.[0] ?? "";
    const embed = /<a:blip\b[^>]*r:embed="([^"]+)"/u.exec(picture)?.[1];
    const target = relationshipTarget(slideRels, embed, "image");
    const imagePath = safeZipPath(path.posix.dirname(slidePath), target);
    const entry = zip.file(imagePath);
    if (entry === null) throw new TypeError("PPTX parity image is missing");
    const source = await decodeParityImage(await entry.async("uint8array"));
    const geometry = pictureGeometry(picture);
    pages.push(
      composeParityPage({
        pageWidth: size.width,
        pageHeight: size.height,
        source,
        placement: geometry.placement,
        ...(geometry.crop === undefined ? {} : { crop: geometry.crop }),
      }),
    );
  }
  return pages;
}

type Relationship = {
  readonly id: string;
  readonly target: string;
  readonly type: string;
};

function relationships(xml: string): readonly Relationship[] {
  return [...xml.matchAll(/<Relationship\b[^>]*\/?>/gu)].map((match) => {
    const tag = match[0];
    const id = /\bId="([^"]+)"/u.exec(tag)?.[1];
    const target = /\bTarget="([^"]+)"/u.exec(tag)?.[1];
    const type = /\bType="([^"]+)"/u.exec(tag)?.[1];
    if (id === undefined || target === undefined || type === undefined) {
      throw new TypeError("PPTX relationship is invalid");
    }
    return { id, target, type };
  });
}

function relationshipTarget(
  values: readonly Relationship[],
  id: string | undefined,
  kind: "slide" | "image",
): string {
  const value = values.find(
    (candidate) =>
      candidate.id === id && candidate.type.endsWith(`/${kind}`),
  );
  if (value === undefined) throw new TypeError("PPTX relationship is missing");
  return value.target;
}

function slideSize(xml: string): { readonly width: number; readonly height: number } {
  const tag = /<p:sldSz\b[^>]*>/u.exec(xml)?.[0] ?? "";
  const width = positiveInteger(/\bcx="(\d+)"/u.exec(tag)?.[1]);
  const height = positiveInteger(/\bcy="(\d+)"/u.exec(tag)?.[1]);
  return {
    width: Math.max(1, Math.round((width / 914_400) * 96)),
    height: Math.max(1, Math.round((height / 914_400) * 96)),
  };
}

function pictureGeometry(xml: string): {
  readonly placement: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly crop?: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
} {
  const transform = /<a:xfrm\b([^>]*)>[\s\S]*?<a:off\b[^>]*x="(-?\d+)"[^>]*y="(-?\d+)"[^>]*\/>[\s\S]*?<a:ext\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"[^>]*\/>[\s\S]*?<\/a:xfrm>/u.exec(xml);
  if (transform === null || /\brot="(?!0")/u.test(transform[1] ?? "")) {
    throw new TypeError("PPTX parity transform is unsupported");
  }
  const cropTag = /<a:srcRect\b[^>]*\/>/u.exec(xml)?.[0];
  const crop = cropTag === undefined
    ? undefined
    : {
        left: cropRatio(cropTag, "l"),
        top: cropRatio(cropTag, "t"),
        right: cropRatio(cropTag, "r"),
        bottom: cropRatio(cropTag, "b"),
      };
  return {
    placement: {
      x: emuToCss(transform[2]),
      y: emuToCss(transform[3]),
      width: emuToCss(transform[4]),
      height: emuToCss(transform[5]),
    },
    ...(crop === undefined ? {} : { crop }),
  };
}

function cropRatio(tag: string, attribute: "l" | "t" | "r" | "b"): number {
  const value = new RegExp(`\\b${attribute}="(\\d+)"`, "u").exec(tag)?.[1];
  if (value === undefined) return 0;
  const ratio = positiveInteger(value, true) / 100_000;
  if (ratio > 1) throw new TypeError("PPTX parity crop is invalid");
  return ratio;
}

function emuToCss(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new TypeError("PPTX geometry is invalid");
  return (parsed / 914_400) * 96;
}

function positiveInteger(value: string | undefined, allowZero = false): number {
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    (allowZero ? parsed < 0 : parsed <= 0)
  ) {
    throw new TypeError("PPTX geometry is invalid");
  }
  return parsed;
}

function safeZipPath(base: string, target: string): string {
  const value = path.posix.normalize(path.posix.join(base, target));
  if (value.startsWith("../") || value.startsWith("/") || value.includes("\\")) {
    throw new TypeError("PPTX relationship path is invalid");
  }
  return value;
}

async function requiredText(zip: JSZip, name: string): Promise<string> {
  const entry = zip.file(name);
  if (entry === null) throw new TypeError("PPTX parity part is missing");
  return entry.async("string");
}
