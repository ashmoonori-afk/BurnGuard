import { MAX_USER_MESSAGE_CHARS } from "@bg/shared";
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
  invalid_export_options: "errors.invalid_export_options",
  pdf_resource_limit: "errors.pdf_resource_limit",
  source_changed: "errors.source_changed",
  project_in_use: "errors.project_in_use",
  backend_unavailable: "errors.backend_unavailable",
  install_start_failed: "errors.install_start_failed",
  agent_control_files_present: "errors.agent_control_files_present",
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
  logo_requires_authenticated_codex: "errors.logo_requires_authenticated_codex",
  logo_deliverables_missing: "errors.logo_deliverables_missing",
  logo_image_provenance_missing: "errors.logo_image_provenance_missing",
  design_review_failed: "errors.design_review_failed",
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
  graphic_requires_authenticated_codex: "errors.graphic_requires_authenticated_codex",
  codex_authentication_probe_failed: "errors.codex_authentication_probe_failed",
  acquisition_limit: "errors.acquisition_limit",
  acquisition_timeout: "errors.acquisition_timeout",
  invalid_upload: "errors.invalid_upload",
  invalid_font_upload: "errors.invalid_font_upload",
  system_id_conflict: "errors.system_id_conflict",
  catalog_operation_failed: "errors.catalog_operation_failed",
  design_system_not_found: "errors.design_system_not_found",
  design_system_file_not_found: "errors.design_system_file_not_found",
  invalid_design_system: "errors.invalid_design_system",
  invalid_project_import: "errors.invalid_project_import",
  pinterest_unavailable: "errors.pinterest_unavailable",
  invalid_pinterest_request: "errors.invalid_pinterest_request",
  message_too_long: "errors.message_too_long",
  turn_capacity_exhausted: "errors.turn_capacity_exhausted",
  active_page_unavailable: "errors.active_page_unavailable",
  invalid_active_page: "errors.invalid_active_page",
  document_save_failed: "errors.document_save_failed",
  artifact_prepare_failed: "errors.artifact_prepare_failed",
  invalid_body: "errors.invalid_body",
  snapshot_not_found: "errors.snapshot_not_found",
  non_leaf_text_target: "errors.non_leaf_text_target",
  invalid_attribute_url: "errors.invalid_attribute_url",
  ambiguous_node_id: "errors.ambiguous_node_id",
  node_not_found: "errors.node_not_found",
  snapshot_failed: "errors.snapshot_failed",
  recovery_failed: "errors.recovery_failed",
  invalid_graphic_export_options: "errors.invalid_graphic_export_options",
  export_not_found: "errors.export_not_found",
  format_requires_web: "errors.format_requires_project_type",
  format_requires_frames: "errors.format_requires_project_type",
  format_requires_deck: "errors.format_requires_project_type",
  format_requires_logo: "errors.format_requires_project_type",
  invalid_export_format: "errors.invalid_export_format",
};

/** Resolve at call time so changing the locale also changes error recovery copy. */
export function apiErrorCopy(error: unknown): string {
  const code = errorCode(error);
  if (code === "message_too_long") return t(ERROR_COPY[code], { limit: errorLimit(error) ?? MAX_USER_MESSAGE_CHARS });
  return t(code !== null && Object.hasOwn(ERROR_COPY, code) ? ERROR_COPY[code] : "errors.fallback");
}

/** The route reports the ceiling it enforced in `details.limit`; the shared constant covers an older server. */
function errorLimit(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("details" in error)) return null;
  const details = (error as { details: unknown }).details;
  if (typeof details !== "object" || details === null || !("limit" in details)) return null;
  const limit = (details as { limit: unknown }).limit;
  return typeof limit === "number" && Number.isFinite(limit) ? limit : null;
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
