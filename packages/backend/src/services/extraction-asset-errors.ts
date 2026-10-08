export class DesignSystemAssetEditError extends Error {
  readonly name = "DesignSystemAssetEditError";
  constructor(
    readonly code:
      | "design_system_not_found"
      | "tokens_file_missing"
      | "invalid_color_token"
      | "invalid_color_value"
      | "invalid_font_upload"
      | "unsafe_managed_path"
      | "token_file_unreadable",
    message: string,
  ) {
    super(message);
  }
}
