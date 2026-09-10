import type { ExportJob } from "@bg/shared";

export type DeliveryStage = "saving" | "rendering" | "validating" | "ready" | "failure";

export const DELIVERY_STAGE_LABEL: Record<DeliveryStage, string> = {
  saving: "저장하는 중…",
  rendering: "그리는 중…",
  validating: "검사하는 중…",
  ready: "완료",
  failure: "실패",
};

/** A package in the user's downloads folder is not a published shop page. */
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

export type FindingSeverity = "error" | "warning";

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
const FINDING_COPY: Record<string, { readonly severity: FindingSeverity; readonly message: string }> = {
  imweb_image_needs_hosting: {
    severity: "warning",
    message: "큰 이미지는 아임웹 게시판에 첨부해 URL을 만든 뒤 에셋 주소에 넣어 주세요.",
  },
  imweb_widget_too_large: {
    severity: "error",
    message: "코드 위젯 한 개가 100만 자 제한을 넘어요. 페이지를 나눠 주세요.",
  },
  unresolved_link: {
    severity: "warning",
    message: "페이지 사이 링크를 플랫폼 주소로 바꾸지 못했어요. 설치 후 메뉴 URL로 연결해 주세요.",
  },
  cafe24_layout_conflict: {
    severity: "error",
    message: "기존 레이아웃과 충돌해요. 전용 레이아웃 파일로 저장해 주세요.",
  },
  cut_through_content: {
    severity: "warning",
    message: "조각 경계가 섹션 안쪽을 잘랐어요. 섹션 높이를 줄이거나 최대 높이를 늘려 주세요.",
  },
};

function pageIdentity(path: string | null): string {
  if (path === null || path.trim() === "") return "전체";
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
      message: copy?.message ?? `점검 항목 ${finding.code}을(를) 확인해 주세요.`,
    };
  });
}
