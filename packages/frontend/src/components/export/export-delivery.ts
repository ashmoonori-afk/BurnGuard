import { t, type MessageKey } from "@/i18n/t";
import type { ExportJob } from "@bg/shared";

export type DeliveryStage = "saving" | "rendering" | "validating" | "ready" | "failure";

export const DELIVERY_STAGE_LABEL: Record<DeliveryStage, string> = {
  get saving() { return t("export.stage.saving"); },
  get rendering() { return t("export.stage.rendering"); },
  get validating() { return t("export.stage.validating"); },
  get ready() { return t("export.stage.ready"); },
  get failure() { return t("export.stage.failure"); },
};

/** Legacy Korean copy exports; the UI resolves export.packageReady/packageNote live. */
export const PACKAGE_READY_LABEL = "패키지 다운로드됨";
export const PACKAGE_PUBLISH_NOTE =
  "아직 플랫폼에 게시됨 상태가 아니에요. 가이드를 따라 직접 올려야 게시돼요.";

export function exportDeliveryStage(job: ExportJob): DeliveryStage {
  if (job.status === "failed") return "failure";
  const attempt = job.latest_attempt;
  if (attempt === null) {
    if (job.status === "succeeded") return "ready";
    return job.status === "running" ? "rendering" : "saving";
  }
  switch (attempt.status) {
    case "failed":
    case "cancelled":
    case "corrupt":
    case "expired":
      return "failure";
    case "pending":
    case "running":
    case "validating":
    case "retrying":
    case "recovering":
    case "validated":
      break;
  }
  switch (attempt.progress.stage) {
    case "queued":
    case "snapshotting":
      return "saving";
    case "rendering":
      return "rendering";
    case "validating":
    case "publishing":
      return "validating";
    case "complete":
      return "ready";
  }
}

export type FindingSeverity = "error" | "warning" | "info";

export const FINDING_SEVERITY_LABEL: Record<FindingSeverity, string> = {
  get error() { return t("export.severity.error"); },
  get warning() { return t("export.severity.warning"); },
  get info() { return t("export.severity.info"); },
};

export type PlatformFindingView = {
  readonly code: string;
  readonly severity: FindingSeverity;
  readonly page: string;
  readonly message: string;
};

/**
 * The backend reports lint results as `{ code, path }`; severity and the
 * Korean explanation live here so an unknown future code still shows up with
 * its identity intact instead of being dropped.
 */
const FINDING_COPY: Record<string, { readonly severity: FindingSeverity; readonly message: MessageKey }> = {
  cafe24_disallowed_extension: {
    severity: "warning",
    message: "export.finding.cafe24_disallowed_extension",
  },
  cafe24_file_over_30mb: {
    severity: "warning",
    message: "export.finding.cafe24_file_over_30mb",
  },
  cafe24_folder_over_1000_files: {
    severity: "warning",
    message: "export.finding.cafe24_folder_over_1000_files",
  },
  cafe24_korean_asset_filename: {
    severity: "warning",
    message: "export.finding.cafe24_korean_asset_filename",
  },
  cafe24_jquery_duplicate: {
    severity: "warning",
    message: "export.finding.cafe24_jquery_duplicate",
  },
  cafe24_unresolved_link: {
    severity: "info",
    message: "export.finding.cafe24_unresolved_link",
  },
  imweb_page_over_1m_chars: {
    severity: "error",
    message: "export.finding.imweb_page_over_1m_chars",
  },
  imweb_page_over_500k_chars: {
    severity: "warning",
    message: "export.finding.imweb_page_over_500k_chars",
  },
  imweb_local_font: {
    severity: "warning",
    message: "export.finding.imweb_local_font",
  },
  imweb_form_or_iframe: {
    severity: "warning",
    message: "export.finding.imweb_form_or_iframe",
  },
  imweb_image_needs_hosting: {
    severity: "warning",
    message: "export.finding.imweb_image_needs_hosting",
  },
  imweb_global_selector: {
    severity: "warning",
    message: "export.finding.imweb_global_selector",
  },
  imweb_duplicate_id: {
    severity: "warning",
    message: "export.finding.imweb_duplicate_id",
  },
  imweb_document_script: {
    severity: "warning",
    message: "export.finding.imweb_document_script",
  },
  platform_dynamic_reference: {
    severity: "warning",
    message: "export.finding.platform_dynamic_reference",
  },
  "png_zip:cut_through_content": {
    severity: "warning",
    message: "export.finding.png_zip:cut_through_content",
  },
};

function pageIdentity(path: string | null): string {
  if (path === null || path.trim() === "") return t("export.allPages");
  const last = path.split("/").at(-1);
  return last === undefined || last === "" ? path : last;
}

export function platformFindings(job: ExportJob): readonly PlatformFindingView[] {
  return (job.latest_attempt?.findings ?? []).map((finding) => {
    const copy = FINDING_COPY[finding.code];
    return {
      code: finding.code,
      severity: copy?.severity ?? "warning",
      page: pageIdentity(finding.path),
      message: copy === undefined ? t("export.unknownFinding", { name: finding.code }) : t(copy.message),
    };
  });
}

/** A failed export can be handed to the AI only when the attempt left findings that describe what to fix. */
export function offersFixRequest(job: ExportJob): boolean {
  return exportDeliveryStage(job) === "failure" && platformFindings(job).length > 0;
}
