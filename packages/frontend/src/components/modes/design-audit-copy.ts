import type { DesignAuditCheckCode, DesignAuditCheckStatus, DesignAuditTargetedAction, DesignAuditUnknownReason } from "@bg/shared";
import type { DesignAuditErrorCode } from "@/lib/design-audit-state";

export const DESIGN_AUDIT_CHECK_COPY = {
  font_consistency: "글꼴 일관성", copy_review: "문안 기본 점검",
  text_overflow: "텍스트 넘침", element_overlap: "요소 겹침", minimum_text_size: "최소 글자 크기", contrast: "색상 대비",
  narrow_width: "좁은 화면", duplicate_node_id: "중복 요소 ID", missing_image: "이미지 참조", token_usage: "디자인 토큰 사용",
  site_nav_mismatch: "페이지 탐색 불일치", site_missing_aria_current: "현재 페이지 표시", site_dangling_link: "없는 페이지 링크",
  site_missing_shared_block: "공통 영역 표시", site_root_absolute_asset: "루트 기준 자산 경로",
} as const satisfies Record<DesignAuditCheckCode, string>;

export const DESIGN_AUDIT_STATUS_COPY = {
  pass: "통과", fail: "문제 발견", skipped: "검사 건너뜀", unmeasurable: "측정할 수 없음",
} as const satisfies Record<DesignAuditCheckStatus, string>;

export const DESIGN_AUDIT_ACTION_COPY = {
  align_font_roles: "제목·본문별 글꼴을 공통 디자인 토큰으로 통일하세요", revise_copy: "임시 문구를 완성하고 원문 의미에 맞게 문안을 다듬으세요",
  expand_or_reflow_text: "텍스트 영역을 넓히거나 재배치하세요", separate_overlapping_elements: "겹친 요소를 분리하세요",
  set_minimum_font_size: "글자 크기를 최소 기준 이상으로 조정하세요", increase_color_contrast: "전경과 배경의 대비를 높이세요",
  repair_narrow_layout: "좁은 화면 레이아웃을 조정하세요", assign_unique_node_ids: "요소마다 고유한 ID를 지정하세요",
  restore_image_reference: "유효한 이미지 참조를 복구하세요", replace_literal_with_token: "직접 입력한 값을 디자인 토큰으로 바꾸세요",
  repair_site_navigation: "모든 페이지의 탐색 구조를 맞추세요", mark_current_page: "현재 페이지 링크를 표시하세요",
  create_or_repair_site_link: "없는 페이지를 만들거나 링크를 고치세요", add_shared_blocks: "공통 영역과 콘텐츠 표시를 추가하세요",
  relativize_asset_path: "자산 경로를 페이지 기준 상대 경로로 바꾸세요",
} as const satisfies Record<DesignAuditTargetedAction, string>;

export const DESIGN_AUDIT_UNKNOWN_COPY = {
  no_measurable_candidates: "측정할 수 있는 대상이 없어요", unresolvable_rendering: "렌더링 결과를 확인할 수 없어요",
  tokens_not_exposed: "사용된 디자인 토큰 정보가 노출되지 않았어요",
} as const satisfies Record<DesignAuditUnknownReason, string>;

export const DESIGN_AUDIT_ERROR_COPY = {
  project_not_found: "프로젝트를 찾을 수 없어요.", project_path_unavailable: "프로젝트 파일 경로에 접근할 수 없어요.",
  stale_artifact_identity: "결과물이 변경됐어요. 다시 검사해 주세요.", audit_unavailable: "지금은 렌더링 품질 검사를 실행할 수 없어요.",
  stale_revision: "결과물이 변경됐어요. 다시 검사해 주세요.", stale_artifact_digest: "결과물이 변경됐어요. 다시 검사해 주세요.",
  stale_file_hash: "수정할 파일이 변경됐어요. 다시 검사해 주세요.", stale_node_fingerprint: "수정할 요소가 변경됐어요. 다시 검사해 주세요.",
  file_not_found: "수정할 파일을 찾을 수 없어요. 다시 검사해 주세요.", node_not_found: "수정할 요소를 찾을 수 없어요. 다시 검사해 주세요.",
  network_error: "품질 검사 서버에 연결할 수 없어요.", unknown_error: "요청을 완료하지 못했어요. 다시 시도해 주세요.",
} as const satisfies Record<DesignAuditErrorCode, string>;
