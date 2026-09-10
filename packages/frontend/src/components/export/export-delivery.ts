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

export type FindingSeverity = "error" | "warning" | "info";

export const FINDING_SEVERITY_LABEL: Record<FindingSeverity, string> = {
  error: "고쳐야 함",
  warning: "확인 필요",
  info: "참고",
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
const FINDING_COPY: Record<string, { readonly severity: FindingSeverity; readonly message: string }> = {
  cafe24_disallowed_extension: {
    severity: "warning",
    message: "카페24 업로더가 받지 않는 확장자예요. FTP로 올리거나 시스템 글꼴로 바꿔 주세요.",
  },
  cafe24_file_over_30mb: {
    severity: "warning",
    message: "파일 하나가 30MB를 넘어요. 이미지를 줄이거나 FTP로 올려 주세요.",
  },
  cafe24_folder_over_1000_files: {
    severity: "warning",
    message: "폴더 하나에 파일이 1,000개를 넘어요. 폴더를 나눠 올려 주세요.",
  },
  cafe24_korean_asset_filename: {
    severity: "warning",
    message: "한글 파일 이름은 쇼핑몰 주소에서 깨질 수 있어요. 영문 이름으로 바꿔 주세요.",
  },
  cafe24_jquery_duplicate: {
    severity: "warning",
    message: "스마트디자인이 이미 제이쿼리를 불러와요. 중복으로 불러오는 스크립트를 빼 주세요.",
  },
  cafe24_unresolved_link: {
    severity: "info",
    message: "페이지 사이 링크를 그대로 뒀어요. 설치한 뒤 메뉴 URL로 연결해 주세요.",
  },
  imweb_page_over_1m_chars: {
    severity: "error",
    message: "코드 위젯 한 개가 100만 자 제한을 넘어요. 페이지를 나눠 주세요.",
  },
  imweb_page_over_500k_chars: {
    severity: "warning",
    message: "코드 위젯이 50만 자를 넘었어요. 100만 자 제한에 가까우니 페이지를 나눠 주세요.",
  },
  imweb_local_font: {
    severity: "warning",
    message: "아임웹에는 글꼴 파일을 올릴 수 없어요. 시스템 글꼴로 보여요.",
  },
  imweb_form_or_iframe: {
    severity: "warning",
    message: "폼과 iframe은 코드 위젯 안에서 동작을 보장하지 않아요. 아임웹 기본 기능을 써 주세요.",
  },
  imweb_image_needs_hosting: {
    severity: "warning",
    message: "큰 이미지는 아임웹 게시판에 첨부해 URL을 만든 뒤 에셋 주소에 넣어 주세요.",
  },
  imweb_global_selector: {
    severity: "warning",
    message: "스타일이 위젯 밖까지 적용돼요. 아임웹 페이지 전체 모양이 바뀔 수 있어요.",
  },
  imweb_duplicate_id: {
    severity: "warning",
    message: "같은 id가 여러 조각에 있어요. 한 페이지에 두 위젯을 넣으면 충돌해요.",
  },
  imweb_document_script: {
    severity: "warning",
    message: "스크립트가 문서 전체를 건드려요. 위젯 밖 영역까지 영향을 줄 수 있어요.",
  },
  platform_dynamic_reference: {
    severity: "warning",
    message: "스크립트가 만들어 내는 주소는 바꾸지 못했어요. 게시한 에셋 주소로 직접 고쳐 주세요.",
  },
  "png_zip:cut_through_content": {
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

/** A failed export can be handed to the AI only when the attempt left findings that describe what to fix. */
export function offersFixRequest(job: ExportJob): boolean {
  return exportDeliveryStage(job) === "failure" && platformFindings(job).length > 0;
}
