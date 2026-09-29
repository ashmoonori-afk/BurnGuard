/**
 * The upload extractor states a missing or outdated pypdf with a fixed "PDF upload requires ..." sentinel
 * (upload-extractor-py.ts); that is the app's missing component, not a damaged file.
 */
export function uploadFailureCode(detail: string): "pdf_support_missing" | "upload_extract_failed" {
  return /PDF upload requires (?:the Python package 'pypdf'|pypdf )/.test(detail) ? "pdf_support_missing" : "upload_extract_failed";
}

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
      | "pdf_support_missing"
      | "website_fetch_failed"
      | "website_content_refused"
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
