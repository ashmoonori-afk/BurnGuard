export class ExportError extends Error {
  readonly name = "ExportError";

  constructor(readonly code: "not_implemented" | "platform_lint_failed" | "platform_package_incomplete" | "invalid_asset_destination") {
    super(code);
  }
}
