export interface LocalFontsV1 {
  readonly schema_version: 1;
  readonly families: readonly string[];
}

/** assets/fonts/manifest.json: `{ families: [{ family, ... }] }`; only the family names cross the API. */
export function parseBundledFontManifest(value: unknown): LocalFontsV1 {
  if (!value || typeof value !== "object" || !("families" in value) || !Array.isArray(value.families) || value.families.some((entry: unknown) => !entry || typeof entry !== "object" || !("family" in entry))) throw new Error("invalid_font_manifest");
  return parseLocalFonts({ schema_version: 1, families: value.families.map((entry: { family: unknown }) => entry.family) });
}

export function parseLocalFonts(value: unknown): LocalFontsV1 {
  if (!value || typeof value !== "object" || !("schema_version" in value) || value.schema_version !== 1 || !("families" in value) || !Array.isArray(value.families) || value.families.length > 10000 || value.families.some((family: unknown) => typeof family !== "string" || !family.trim() || family.length > 200 || /[\x00-\x1f/\\]/.test(family))) throw new Error("invalid_local_fonts");
  return { schema_version: 1, families: [...new Set(value.families as string[])].sort() };
}
