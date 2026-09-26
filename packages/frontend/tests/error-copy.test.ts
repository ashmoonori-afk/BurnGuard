import { describe, expect, test } from "bun:test";
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
  "invalid_source_url",
  "website_fetch_failed",
  "figma_token_missing",
  "upload_extract_failed",
  "unsafe_source_content",
];

/** Codes the routes emit that gained recovery copy; each must resolve past the generic fallback. */
const ADDED_CODES = [
  "graphic_requires_authenticated_codex",
  "codex_authentication_probe_failed",
  "acquisition_limit",
  "acquisition_timeout",
  "invalid_upload",
  "invalid_font_upload",
  "system_id_conflict",
  "catalog_operation_failed",
  "design_system_not_found",
  "design_system_file_not_found",
  "invalid_design_system",
  "invalid_project_import",
  "pinterest_unavailable",
  "invalid_pinterest_request",
  "message_too_long",
  "turn_capacity_exhausted",
  "active_page_unavailable",
  "invalid_active_page",
  "document_save_failed",
  "artifact_prepare_failed",
  "invalid_body",
  "snapshot_not_found",
  "non_leaf_text_target",
  "invalid_attribute_url",
  "ambiguous_node_id",
  "node_not_found",
  "snapshot_failed",
  "recovery_failed",
  "invalid_graphic_export_options",
  "export_not_found",
  "format_requires_web",
  "format_requires_frames",
  "format_requires_deck",
  "format_requires_logo",
  "invalid_export_format",
];

describe("apiErrorCopy", () => {
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

  test.each(["invalid_export_options", "pdf_resource_limit"])("Given the export admission rejection %s When mapped Then it has its own recovery copy instead of the generic fallback", (code) => {
    expect(apiErrorCopy(new FakeApiError(code, "private internal error"))).not.toBe(apiErrorCopy(new FakeApiError("__unknown__", "boom")));
  });

  test("Given an installer that could not be started When mapped Then it has its own recovery copy instead of the generic fallback", () => {
    expect(apiErrorCopy(new FakeApiError("install_start_failed", "private internal error"))).not.toBe(apiErrorCopy(new FakeApiError("__unknown__", "boom")));
  });

  test("Given has_active_projects When mapped Then the copy tells the user to delete the referencing projects", () => {
    const copy = apiErrorCopy(new FakeApiError("has_active_projects", "Active projects reference this system"));
    expect(copy).toContain("삭제");
  });

  test.each(ADDED_CODES)("Given the backend code %s When mapped Then it has Korean recovery copy instead of the generic fallback", (code) => {
    const copy = apiErrorCopy(new FakeApiError(code, "private internal error"));
    expect(copy).not.toBe(apiErrorCopy(new FakeApiError("__unknown__", "boom")));
    expect(/[ㄱ-힝]/u.test(copy)).toBe(true);
  });

  test("Given message_too_long with the server limit When mapped Then the copy carries the locale-formatted limit", () => {
    const copy = apiErrorCopy(new FakeApiError("message_too_long", "Message exceeds 200000 characters", { limit: 200000 }));
    expect(copy).toContain("200,000");
    expect(copy).not.toContain("{limit}");
    expect(apiErrorCopy(new FakeApiError("message_too_long", "raw"))).toContain("200,000");
  });
});
