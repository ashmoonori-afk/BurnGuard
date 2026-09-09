export interface LocalFontsV1 {
  readonly schema_version: 1;
  readonly families: readonly string[];
}

export function parseLocalFonts(value: unknown): LocalFontsV1 {
  if (!value || typeof value !== "object" || !("schema_version" in value) || value.schema_version !== 1 || !("families" in value) || !Array.isArray(value.families) || value.families.length > 10000 || value.families.some((family: unknown) => typeof family !== "string" || !family.trim() || family.length > 200 || /[\x00-\x1f/\\]/.test(family))) throw new Error("invalid_local_fonts");
  return { schema_version: 1, families: [...new Set(value.families as string[])].sort() };
}
