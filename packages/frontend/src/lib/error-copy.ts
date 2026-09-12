import { t, type MessageKey } from "@/i18n/t";

/** Backend messages are internal; map known codes to localized recovery copy. */
const ERROR_COPY: Record<string, MessageKey> = {
  session_not_found: "errors.session_not_found",
  permission_not_pending: "errors.permission_not_pending",
  stale_artifact_identity: "errors.stale_artifact_identity",
  project_directory_missing: "errors.project_directory_missing",
  export_corrupt: "errors.export_corrupt",
  export_not_ready: "errors.export_not_ready",
  export_terminal: "errors.export_terminal",
  export_retry_conflict: "errors.export_retry_conflict",
  output_missing: "errors.output_missing",
  receipt_corrupt: "errors.receipt_corrupt",
  retention_expired: "errors.retention_expired",
  render_failed: "errors.render_failed",
  validation_failed: "errors.validation_failed",
  source_changed: "errors.source_changed",
  project_in_use: "errors.project_in_use",
  backend_unavailable: "errors.backend_unavailable",
  path_unavailable: "errors.path_unavailable",
  immutable_reference_mutated: "errors.immutable_reference_mutated",
  immutable_reference_path_unavailable: "errors.immutable_reference_path_unavailable",
  immutable_reference_escaped: "errors.immutable_reference_escaped",
  private_input_unavailable: "errors.private_input_unavailable",
  publication_failed: "errors.publication_failed",
  operation_conflict: "errors.operation_conflict",
  operation_cancelled: "errors.operation_cancelled",
  turn_failed: "errors.turn_failed",
  invalid_name: "errors.invalid_name",
  invalid_backend: "errors.invalid_backend",
  invalid_generation_options: "errors.invalid_generation_options",
  commandcode_unavailable: "errors.commandcode_unavailable",
  invalid_llm_api_keys: "errors.invalid_llm_api_keys",
  unsupported_generation_model_effort: "errors.unsupported_generation_model_effort",
  graphic_starter_unchanged: "errors.graphic_starter_unchanged",
  invalid_project_options: "errors.invalid_project_options",
  forbidden: "errors.forbidden",
  has_active_projects: "errors.has_active_projects",
  is_template: "errors.is_template",
  network_error: "errors.network_error",
  session_busy: "errors.session_busy",
  project_not_found: "errors.project_not_found",
  invalid_source_url: "errors.invalid_source_url",
  website_fetch_failed: "errors.website_fetch_failed",
  figma_token_missing: "errors.figma_token_missing",
  upload_extract_failed: "errors.upload_extract_failed",
  pdf_password_required: "errors.pdf_password_required",
  pdf_invalid: "errors.pdf_invalid",
  pdf_runtime_unavailable: "errors.pdf_runtime_unavailable",
  pdf_extraction_timeout: "errors.pdf_extraction_timeout",
  pdf_size_limit: "errors.pdf_size_limit",
  pdf_page_limit: "errors.pdf_page_limit",
  pdf_text_limit: "errors.pdf_text_limit",
  attachment_extract_failed: "errors.attachment_extract_failed",
  unsafe_source_content: "errors.unsafe_source_content",
  upload_file_required: "errors.upload_file_required",
};

/** Resolve at call time so changing the locale also changes error recovery copy. */
export function apiErrorCopy(error: unknown): string {
  const code = errorCode(error);
  return t(code !== null && Object.hasOwn(ERROR_COPY, code) ? ERROR_COPY[code] : "errors.fallback");
}

function errorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return null;
}
