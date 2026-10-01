import { describe, expect, test } from "bun:test";
import { MAX_USER_MESSAGE_CHARS } from "@bg/shared";
import { t, type MessageKey } from "../src/i18n/t";
import { apiErrorCopy } from "../src/lib/error-copy";

class FakeApiError extends Error {
  readonly code: string;
  readonly details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const KNOWN_CODES = [
  "invalid_name",
  "invalid_backend",
  "invalid_project_options",
  "forbidden",
  "has_active_projects",
  "is_template",
  "network_error",
  "session_busy",
  "agent_control_files_present",
  "project_not_found",
  "project_path_unavailable",
  "invalid_source_url",
  "website_fetch_failed",
  "figma_token_missing",
  "upload_extract_failed",
  "unsafe_source_content",
];

/** Codes the routes emit that gained recovery copy, each with the exact key it must resolve to. */
const ADDED_CODES: readonly (readonly [string, MessageKey])[] = [
  ["pdf_support_missing", "errors.pdf_support_missing"],
  ["invalid_color_value", "errors.invalid_color_value"],
  ["graphic_requires_authenticated_codex", "errors.graphic_requires_authenticated_codex"],
  ["codex_authentication_probe_failed", "errors.codex_authentication_probe_failed"],
  ["acquisition_limit", "errors.acquisition_limit"],
  ["website_content_refused", "errors.website_content_refused"],
  ["acquisition_timeout", "errors.acquisition_timeout"],
  ["acquisition_aborted", "errors.acquisition_aborted"],
  ["invalid_upload", "errors.invalid_upload"],
  ["invalid_font_upload", "errors.invalid_font_upload"],
  ["system_id_conflict", "errors.system_id_conflict"],
  ["catalog_operation_failed", "errors.catalog_operation_failed"],
  ["design_system_not_found", "errors.design_system_not_found"],
  ["design_system_file_not_found", "errors.design_system_file_not_found"],
  ["invalid_design_system", "errors.invalid_design_system"],
  ["invalid_project_import", "errors.invalid_project_import"],
  ["pinterest_unavailable", "errors.pinterest_unavailable"],
  ["invalid_pinterest_request", "errors.invalid_pinterest_request"],
  ["message_too_long", "errors.message_too_long"],
  ["turn_capacity_exhausted", "errors.turn_capacity_exhausted"],
  ["active_page_unavailable", "errors.active_page_unavailable"],
  ["invalid_active_page", "errors.invalid_active_page"],
  ["document_save_failed", "errors.document_save_failed"],
  ["artifact_prepare_failed", "errors.artifact_prepare_failed"],
  ["invalid_body", "errors.invalid_body"],
  ["snapshot_not_found", "errors.snapshot_not_found"],
  ["non_leaf_text_target", "errors.non_leaf_text_target"],
  ["invalid_attribute_url", "errors.invalid_attribute_url"],
  ["ambiguous_node_id", "errors.ambiguous_node_id"],
  ["node_not_found", "errors.node_not_found"],
  ["snapshot_failed", "errors.snapshot_failed"],
  ["recovery_failed", "errors.recovery_failed"],
  ["invalid_graphic_export_options", "errors.invalid_graphic_export_options"],
  ["export_not_found", "errors.export_not_found"],
  ["format_requires_web", "errors.format_requires_project_type"],
  ["format_requires_frames", "errors.format_requires_project_type"],
  ["format_requires_deck", "errors.format_requires_project_type"],
  ["format_requires_logo", "errors.format_requires_project_type"],
  ["invalid_export_format", "errors.invalid_export_format"],
];

/** Codes the Settings routes and the settings PATCH emit; Settings renders exactly apiErrorCopy(error) for them. */
const SETTINGS_CODES: readonly (readonly [string, MessageKey])[] = [
  ["local_fonts_unavailable", "errors.local_fonts_unavailable"],
  ["bundled_fonts_unavailable", "errors.bundled_fonts_unavailable"],
  ["update_unsupported", "settings.updateUnsupported"],
  ["update_not_ready", "errors.update_not_ready"],
  ["install_in_progress", "errors.install_in_progress"],
  ["python_not_found", "settings.pythonMissing"],
  ["invalid_locale", "errors.invalid_locale"],
  ["invalid_theme", "errors.invalid_theme"],
  ["invalid_request", "errors.invalid_body"],
];

/** message_too_long interpolates the shared limit when the error carries none. */
function expectedCopy(key: MessageKey): string {
  return key === "errors.message_too_long" ? t(key, { limit: MAX_USER_MESSAGE_CHARS }) : t(key);
}

describe("apiErrorCopy", () => {
  test.each(SETTINGS_CODES)("Given the Settings backend code %s When mapped Then it resolves to %s", (code, key) => {
    expect(apiErrorCopy(new FakeApiError(code, "private internal error"))).toBe(expectedCopy(key));
  });

  test("Given a PDF extraction failure When mapped Then it offers the matching recovery step", () => {
    for (const [code, step] of Object.entries({ pdf_password_required: "암호를 해제", pdf_invalid: "다시 저장", pdf_runtime_unavailable: "업데이트", pdf_extraction_timeout: "나누어", pdf_size_limit: "줄이거나", pdf_page_limit: "페이지", pdf_text_limit: "텍스트", attachment_extract_failed: "새 사본" })) {
      expect(apiErrorCopy(new FakeApiError(code, "private internal error"))).toContain(step);
    }
  });

  test("Given every documented ApiError code When mapped Then it returns Korean copy, never the raw message", () => {
    for (const code of KNOWN_CODES) {
      const englishMessage = `raw backend message for ${code}`;
      const copy = apiErrorCopy(new FakeApiError(code, englishMessage));
      expect(copy).not.toBe(englishMessage);
      expect(copy.length).toBeGreaterThan(0);
      expect(/[ㄱ-힝]/u.test(copy)).toBe(true);
    }
  });

  test("Given an unknown ApiError code When mapped Then it falls back to a generic Korean message", () => {
    const copy = apiErrorCopy(new FakeApiError("some_unmapped_code", "boom"));
    expect(copy).toBe("요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.");
  });

  test("Given a plain Error without a code When mapped Then it falls back instead of showing the raw message", () => {
    const copy = apiErrorCopy(new Error("TypeError: fetch failed"));
    expect(copy).toBe("요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.");
  });

  test("Given a non-error thrown value When mapped Then it still returns the generic fallback", () => {
    expect(apiErrorCopy("just a string")).toBe(
      "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
    expect(apiErrorCopy(null)).toBe(
      "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
  });

  test.each([["invalid_export_options", "errors.invalid_export_options"], ["pdf_resource_limit", "errors.pdf_resource_limit"]] as const)("Given the export admission rejection %s When mapped Then it resolves to %s", (code, key) => {
    expect(apiErrorCopy(new FakeApiError(code, "private internal error"))).toBe(t(key));
  });

  test("Given an installer that could not be started When mapped Then it resolves to errors.install_start_failed", () => {
    expect(apiErrorCopy(new FakeApiError("install_start_failed", "private internal error"))).toBe(t("errors.install_start_failed"));
  });

  test("Given has_active_projects When mapped Then the copy tells the user to delete the referencing projects", () => {
    const copy = apiErrorCopy(new FakeApiError("has_active_projects", "Active projects reference this system"));
    expect(copy).toContain("삭제");
  });

  test.each(ADDED_CODES)("Given the backend code %s When mapped Then it resolves to the Korean copy of %s", (code, key) => {
    const copy = apiErrorCopy(new FakeApiError(code, "private internal error"));
    expect(copy).toBe(expectedCopy(key));
    expect(/[ㄱ-힝]/u.test(copy)).toBe(true);
  });

  test("Given message_too_long with the server limit When mapped Then the copy carries the locale-formatted limit", () => {
    const copy = apiErrorCopy(new FakeApiError("message_too_long", "Message exceeds 200000 characters", { limit: 200000 }));
    expect(copy).toContain("200,000");
    expect(copy).not.toContain("{limit}");
    expect(apiErrorCopy(new FakeApiError("message_too_long", "raw"))).toContain("200,000");
  });
});
