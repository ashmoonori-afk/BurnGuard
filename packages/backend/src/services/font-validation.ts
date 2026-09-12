const FONT_SIGNATURES = new Set([0x00010000, 0x74727565, 0x4f54544f, 0x774f4646, 0x774f4632]);

/** Decode before persisting a font or changing a system's role tokens. */
export async function isValidFontData(data: Uint8Array): Promise<boolean> {
  if (data.byteLength < 12) return false;
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (!FONT_SIGNATURES.has(bytes.readUInt32BE(0))) return false;
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
