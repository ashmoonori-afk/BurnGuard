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
      | "token_file_unreadable"
      | "design_system_archived"
      | "invalid_rule_kind"
      | "invalid_rule_text"
      | "invalid_rule_origin"
      | "rule_limit_reached"
      | "rule_not_found"
      | "rules_file_invalid",
    message: string,
  ) {
    super(message);
  }
}
