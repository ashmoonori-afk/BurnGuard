import { inflateRawSync } from "node:zlib";
import { decodeParityImage } from "./export-parity-images";
import { composeParityPage } from "./export-parity-compose";
import type { ParityPixelPage } from "./export-parity";
import path from "node:path";

const MAX_PARITY_PAGES = 100;
const MAX_PARITY_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_PARITY_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_PARITY_ARCHIVE_ENTRIES = 4_000;

type ParityArchiveEntry = {
  readonly name: Uint8Array;
  readonly flags: number;
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly crc: number;
  readonly localHeaderOffset: number;
};

export type ParityArchive = {
  readonly read: (name: string, signal: AbortSignal) => Uint8Array;
  readonly has: (name: string) => boolean;
};

/**
 * Parity reads archives without JSZip: the central directory must be traversed exactly, names must
 * be unique, every declared size is bounded up front, and each entry is inflated with a hard
 * maxOutputLength equal to its declared size, so actual output can never exceed the budget.
 */
export function openParityArchive(
  bytes: Uint8Array,
  limits: { readonly totalReadBytes?: number } = {},
): ParityArchive {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let offset = bytes.byteLength - 22; offset >= Math.max(0, bytes.byteLength - 22 - 0xffff); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new TypeError("Parity archive directory is missing");
  const count = view.getUint16(eocd + 10, true);
  const size = view.getUint32(eocd + 12, true);
  const start = view.getUint32(eocd + 16, true);
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff || count > MAX_PARITY_ARCHIVE_ENTRIES || start + size > eocd) {
    throw new TypeError("Parity archive directory is unsupported");
  }
  const entries = new Map<string, ParityArchiveEntry>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let cursor = start;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > start + size || view.getUint32(cursor, true) !== 0x02014b50) throw new TypeError("Parity archive directory is invalid");
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressed = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const next = cursor + 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
    if ((flags & 0x0001) !== 0 || (method !== 0 && method !== 8) || compressedSize === 0xffffffff || uncompressed === 0xffffffff) {
      throw new TypeError("Parity archive entry is unsupported");
    }
    if (uncompressed > MAX_PARITY_ENTRY_BYTES) throw new TypeError("Parity archive entry exceeds its byte budget");
    total += uncompressed;
    if (total > MAX_PARITY_UNCOMPRESSED_BYTES) throw new TypeError("Parity archive exceeds its byte budget");
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (entries.has(name)) throw new TypeError("Parity archive entry is duplicated");
    entries.set(name, { name: bytes.subarray(cursor + 46, cursor + 46 + nameLength), flags, method, compressedSize, size: uncompressed, crc, localHeaderOffset: view.getUint32(cursor + 42, true) });
    cursor = next;
  }
  if (cursor !== start + size) throw new TypeError("Parity archive directory length is inconsistent");
  const readBudget = limits.totalReadBytes ?? MAX_PARITY_UNCOMPRESSED_BYTES;
  let readTotal = 0;
  return {
    has: (name) => entries.has(name),
    read: (name, signal) => {
      signal.throwIfAborted();
      const entry = entries.get(name);
      if (entry === undefined) throw new TypeError("Parity archive entry is missing");
      // Every read is charged, so repeated reads of one entry cannot exceed the aggregate budget.
      readTotal += entry.size;
      if (readTotal > readBudget) throw new TypeError("Parity archive reads exceed their byte budget");
      const local = entry.localHeaderOffset;
      if (local + 30 > start || view.getUint32(local, true) !== 0x04034b50) throw new TypeError("Parity archive entry is invalid");
      const localFlags = view.getUint16(local + 6, true);
      const localNameLength = view.getUint16(local + 26, true);
      const localName = bytes.subarray(local + 30, local + 30 + localNameLength);
      // The local header must describe the same entry as the central directory (no split views).
      if (view.getUint16(local + 8, true) !== entry.method || (localFlags & 0x0809) !== (entry.flags & 0x0809) ||
        localName.byteLength !== entry.name.byteLength || localName.some((byte, index) => byte !== entry.name[index])) {
        throw new TypeError("Parity archive local header is inconsistent");
      }
      const dataStart = local + 30 + localNameLength + view.getUint16(local + 28, true);
      if (dataStart + entry.compressedSize > start) throw new TypeError("Parity archive entry is invalid");
      if ((entry.flags & 0x0008) === 0) {
        if (view.getUint32(local + 14, true) !== entry.crc || view.getUint32(local + 18, true) !== entry.compressedSize ||
          view.getUint32(local + 22, true) !== entry.size) throw new TypeError("Parity archive local header is inconsistent");
      } else {
        let descriptor = dataStart + entry.compressedSize;
        if (descriptor + 4 <= start && view.getUint32(descriptor, true) === 0x08074b50) descriptor += 4;
        if (descriptor + 12 > start || view.getUint32(descriptor, true) !== entry.crc ||
          view.getUint32(descriptor + 4, true) !== entry.compressedSize || view.getUint32(descriptor + 8, true) !== entry.size) {
          throw new TypeError("Parity archive data descriptor is inconsistent");
        }
      }
      const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
      const output = entry.method === 0
        ? compressed
        : new Uint8Array(inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size) }));
      if (output.byteLength !== entry.size || (Bun.hash.crc32(output) >>> 0) !== entry.crc) {
        throw new TypeError("Parity archive entry is corrupt");
      }
      return output;
    },
  };
}

/** Kept for callers that only need the up-front directory checks. */
export function preflightParityArchive(bytes: Uint8Array): void {
  openParityArchive(bytes);
}


export async function zipParityImages(
  bytes: Uint8Array,
  paths: readonly string[],
  signal: AbortSignal,
): Promise<readonly ParityPixelPage[]> {
  if (paths.length > MAX_PARITY_PAGES) {
    throw new TypeError("Parity page count is invalid");
  }
  signal.throwIfAborted();
  const archive = openParityArchive(bytes);
  const pages: ParityPixelPage[] = [];
  for (const path of paths) {
    if (!archive.has(path)) throw new TypeError("Parity image is missing");
    pages.push(await decodeParityImage(archive.read(path, signal)));
  }
  return pages;
}

export async function pptxParityImages(
  bytes: Uint8Array,
  slideCount: number,
  signal: AbortSignal,
): Promise<readonly ParityPixelPage[]> {
  if (
    !Number.isSafeInteger(slideCount) ||
    slideCount < 1 ||
    slideCount > MAX_PARITY_PAGES
  ) {
    throw new TypeError("PPTX parity slide count is invalid");
  }
  signal.throwIfAborted();
  const zip = openParityArchive(bytes);
  const requiredText = (name: string): string => {
    if (!zip.has(name)) throw new TypeError("PPTX parity part is missing");
    return new TextDecoder().decode(zip.read(name, signal));
  };
  const presentation = requiredText("ppt/presentation.xml");
  const presentationRels = relationships(
    requiredText("ppt/_rels/presentation.xml.rels"),
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
    signal.throwIfAborted();
    const slide = requiredText(slidePath);
    const relationPath = `${path.posix.dirname(slidePath)}/_rels/${path.posix.basename(slidePath)}.rels`;
    const slideRels = relationships(requiredText(relationPath));
    const pictures = [...slide.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/gu)];
    if (pictures.length !== 1) {
      throw new TypeError("PPTX parity requires one slide image");
    }
    const picture = pictures[0]?.[0] ?? "";
    const embed = /<a:blip\b[^>]*r:embed="([^"]+)"/u.exec(picture)?.[1];
    const target = relationshipTarget(slideRels, embed, "image");
    const imagePath = safeZipPath(path.posix.dirname(slidePath), target);
    if (!zip.has(imagePath)) throw new TypeError("PPTX parity image is missing");
    const source = await decodeParityImage(zip.read(imagePath, signal));
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
