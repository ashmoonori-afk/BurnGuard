const FONT_SIGNATURES = new Set([0x00010000, 0x74727565, 0x4f54544f, 0x774f4646, 0x774f4632]);
const MAX_FONT_BYTES = 16_000_000;
const MAX_FONT_TABLES = 128;
const MAX_EXPANDED_FONT_BYTES = 64 * 1024 * 1024;
const WOFF2_TAGS = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];

/** Bound both original and transformed tables before fontkit's lazy allocation/decompression. */
export function hasBoundedFontTables(bytes: Buffer): boolean {
  if (bytes.length < 12 || bytes.length > MAX_FONT_BYTES) return false;
  const signature = bytes.readUInt32BE(0);
  if (!FONT_SIGNATURES.has(signature)) return false;
  if (signature !== 0x774f4646 && signature !== 0x774f4632) return true;
  const woff2 = signature === 0x774f4632, headerSize = woff2 ? 48 : 44;
  if (bytes.length < headerSize || bytes.readUInt32BE(8) !== bytes.length || bytes.readUInt16BE(14) !== 0) return false;
  const flavor = bytes.readUInt32BE(4), count = bytes.readUInt16BE(12);
  if (![0x00010000, 0x74727565, 0x4f54544f].includes(flavor) || count === 0 || count > MAX_FONT_TABLES) return false;
  const declared = bytes.readUInt32BE(16);
  if (declared > MAX_EXPANDED_FONT_BYTES) return false;
  let expanded = 12 + count * 16, transformedBytes = 0, cursor = headerSize;
  const tags = new Set<string>(), ranges: { start: number; end: number }[] = [];
  const base128 = (): number | null => {
    let value = 0;
    for (let index = 0; index < 5; index++) {
      if (cursor >= bytes.length || value > 0x1ffffff) return null;
      const byte = bytes.readUInt8(cursor++);
      if (index === 0 && byte === 0x80) return null;
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    return null;
  };
  if (!woff2 && headerSize + count * 20 > bytes.length) return false;
  for (let index = 0; index < count; index++) {
    let tag: string, length: number, storedLength: number;
    if (!woff2) {
      tag = bytes.toString("ascii", cursor, cursor + 4);
      const offset = bytes.readUInt32BE(cursor + 4);
      storedLength = bytes.readUInt32BE(cursor + 8); length = bytes.readUInt32BE(cursor + 12);
      if (storedLength > length || offset < headerSize + count * 20 || offset + storedLength > bytes.length) return false;
      ranges.push({ start: offset, end: offset + storedLength }); cursor += 20;
    } else {
      if (cursor >= bytes.length) return false;
      const flags = bytes.readUInt8(cursor++), tagIndex = flags & 0x3f, version = flags >>> 6;
      if (tagIndex === 63) {
        if (cursor + 4 > bytes.length) return false;
        tag = bytes.toString("ascii", cursor, cursor + 4); cursor += 4;
      } else {
        const knownTag = WOFF2_TAGS[tagIndex];
        if (knownTag === undefined) return false;
        tag = knownTag;
      }
      const original = base128(); if (original === null) return false;
      length = original; storedLength = original;
      const glyphTable = tag === "glyf" || tag === "loca";
      if (glyphTable ? version !== 0 && version !== 3 : version !== 0 && !(tag === "hmtx" && version === 1)) return false;
      if (glyphTable ? version === 0 : version !== 0) {
        const transformed = base128(); if (transformed === null || (tag === "loca" && transformed !== 0)) return false;
        storedLength = transformed;
      }
    }
    if (tags.has(tag)) return false;
    tags.add(tag);
    expanded += Math.ceil(length / 4) * 4;
    transformedBytes += storedLength;
    if (expanded > MAX_EXPANDED_FONT_BYTES || transformedBytes > MAX_EXPANDED_FONT_BYTES) return false;
  }
  if (expanded !== declared) return false;
  if (woff2) return cursor + bytes.readUInt32BE(20) <= bytes.length;
  ranges.sort((a, b) => a.start - b.start);
  return ranges.every((range, index) => {
    const previous = ranges[index - 1];
    return previous === undefined || range.start >= previous.end;
  });
}

/** Decode before persisting a font or changing a system's role tokens. */
export async function isValidFontData(data: Uint8Array): Promise<boolean> {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (!hasBoundedFontTables(bytes)) return false;
  const { create } = await import("fontkit");
  try {
    const font = create(bytes);
    if (!("numGlyphs" in font)) return false;
    // These tables are lazy: inspect mappings and an outline, not only the magic bytes.
    const characters = font.characterSet;
    const outline = font.getGlyph(0).path;
    return Number.isFinite(font.unitsPerEm) && font.unitsPerEm > 0
      && Number.isInteger(font.numGlyphs) && font.numGlyphs > 0
      && Array.isArray(characters) && Array.isArray(outline.commands);
  } catch (error) {
    if (error instanceof Error) return false;
    throw error;
  }
}
