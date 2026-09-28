export class FigmaImportError extends Error {
  readonly name = "FigmaImportError";

  constructor(
    readonly code:
      | "invalid_figma_export"
      | "invalid_figma_selection"
      | "unsafe_figma_asset"
      | "ambiguous_figma_asset"
      | "figma_import_failed",
  ) {
    super(code);
  }
}
