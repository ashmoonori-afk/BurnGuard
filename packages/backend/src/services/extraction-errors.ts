export class DesignSystemExtractError extends Error {
  readonly name = "DesignSystemExtractError";
  constructor(
    readonly code:
      | "invalid_source_url"
      | "invalid_pinterest_request"
      | "pinterest_unavailable"
      | "invalid_upload"
      | "unsupported_source_type"
      | "git_clone_failed"
      | "upload_extract_failed"
      | "website_fetch_failed"
      | "figma_token_missing"
      | "figma_fetch_failed"
      | "unsafe_source_content"
      | "invalid_lineage"
      | "lineage_parent_mismatch"
      | "acquisition_timeout"
      | "acquisition_limit"
      | "publication_failed"
      | "system_id_conflict",
    message: string,
  ) {
    super(message);
  }
}
