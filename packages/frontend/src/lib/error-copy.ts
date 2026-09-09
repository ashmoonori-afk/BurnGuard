/**
 * Korean 해요체 copy for backend `ApiError` codes, each paired with a
 * concrete next step. The backend's `message` field is an internal,
 * English string (see routes/*.ts `fail(code, message)` calls) — it is
 * never fit to show a user, so every caller that surfaces an API
 * failure should render `apiErrorCopy(error)` instead of `error.message`.
 */

const ERROR_COPY: Record<string, string> = {
  session_not_found: "작업 세션을 찾을 수 없어요. 프로젝트를 다시 열어 주세요.",
  permission_not_pending: "이미 처리된 권한 요청이에요. 현재 작업 상태를 다시 확인해 주세요.",
  stale_artifact_identity: "파일이 변경됐어요. 최신 결과를 확인한 뒤 다시 시도해 주세요.",
  project_directory_missing: "프로젝트 폴더를 찾을 수 없어요. 폴더를 원래 위치로 복원한 뒤 다시 시도해 주세요.",
  export_corrupt: "내보낸 파일을 확인할 수 없어요. 다시 내보내기를 눌러 새 파일을 만들어 주세요.",
  export_not_ready: "아직 내려받을 수 없어요. 내보내기 상태를 확인한 뒤 다시 시도해 주세요.",
  export_terminal: "이미 내보내기가 끝났어요. 최신 상태를 확인해 주세요.",
  export_retry_conflict: "이미 다시 내보내는 중이거나 재시도할 수 없는 상태예요. 최신 목록을 확인해 주세요.",
  output_missing: "내보낸 파일이 없어 다시 만들어야 해요. 다시 시도를 눌러 주세요.",
  receipt_corrupt: "내보낸 파일을 확인할 수 없어요. 다시 시도를 눌러 새 파일을 만들어 주세요.",
  retention_expired: "파일 보관 기간이 끝났어요. 다시 내보내 주세요.",
  render_failed: "내보내기 파일을 만들지 못했어요. 설정과 원본을 확인한 뒤 다시 시도해 주세요.",
  validation_failed: "내보내기 품질 점검을 통과하지 못했어요. 품질 점검에서 문제를 확인해 주세요.",
  source_changed: "내보내는 동안 원본이 바뀌었어요. 최신 원본으로 다시 내보내 주세요.",
  project_in_use: "복구 기록이나 진행 중인 작업이 연결되어 삭제할 수 없어요. 프로젝트와 파일은 유지돼요.",
  backend_unavailable: "선택한 AI 도구를 실행할 수 없어요. 설정에서 설치 상태를 확인해 주세요.",
  path_unavailable: "프로젝트 파일에 접근하지 못했어요. 파일을 확인하고 다시 시도해 주세요.",
  immutable_reference_mutated: "원본 참고 자료 변경을 감지해 작업을 중단했어요. 원본을 유지한 채 다시 요청해 주세요.",
  immutable_reference_path_unavailable: "원본 참고 자료를 찾을 수 없어요. 자료를 다시 첨부해 주세요.",
  immutable_reference_escaped: "참고 자료의 저장 위치를 확인할 수 없어 작업을 중단했어요. 자료를 다시 첨부해 주세요.",
  private_input_unavailable: "첨부 자료에 접근하지 못했어요. 자료를 다시 첨부해 주세요.",
  publication_failed: "결과를 저장하지 못했어요. 파일과 작업 상태를 확인한 뒤 다시 시도해 주세요.",
  operation_conflict: "다른 변경과 겹쳐 작업을 마치지 못했어요. 최신 파일을 확인한 뒤 다시 요청해 주세요.",
  operation_cancelled: "작업을 중단했어요. 필요하면 요청을 다시 보내 주세요.",
  turn_failed: "AI 작업을 완료하지 못했어요. 요청 내용을 확인하고 다시 보내 주세요.",
  invalid_name: "이름을 확인해 주세요. 비어 있거나 너무 길면 저장할 수 없어요.",
  invalid_backend: "선택한 백엔드를 지원하지 않아요. 다른 백엔드를 골라 주세요.",
  invalid_generation_options: "모델과 추론 강도 설정을 다시 선택해 주세요.",
  commandcode_unavailable: "설정에서 CommandCode API 키를 저장하고 Claude Code를 선택해 주세요.",
  unsupported_generation_model_effort: "이 모델에서 지원하는 추론 강도를 다시 선택해 주세요.",
  graphic_starter_unchanged: "그래픽 화면이 초기 상태로 남아 결과를 반영하지 않았어요. 다시 생성을 요청해 주세요.",
  invalid_project_options:
    "프로젝트 옵션이 프로젝트 종류와 맞지 않아요. 값을 다시 확인한 뒤 시도해 주세요.",
  forbidden: "이 요청을 처리할 권한이 없어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.",
  has_active_projects:
    "이 디자인 시스템을 쓰는 프로젝트가 아직 있어요. 해당 프로젝트를 먼저 삭제한 뒤 다시 시도해 주세요.",
  is_template: "기본 제공 템플릿이라 삭제할 수 없어요.",
  network_error: "서버에 연결하지 못했어요. 로컬 서버가 켜져 있는지 확인한 뒤 다시 시도해 주세요.",
  session_busy: "지금 다른 작업이 진행 중이에요. 끝난 뒤 다시 시도해 주세요.",
  project_not_found: "프로젝트를 찾을 수 없어요. 목록을 새로고침한 뒤 다시 확인해 주세요.",
  invalid_source_url:
    "가져올 수 없는 주소예요. 공개 HTTPS 주소인지 확인한 뒤 다시 시도해 주세요.",
  website_fetch_failed:
    "웹사이트를 불러오지 못했어요. 주소가 맞는지 확인한 뒤 다시 시도해 주세요.",
  figma_token_missing:
    "Figma 액세스 토큰이 없어요. 설정 → Figma 액세스에서 먼저 등록한 뒤 다시 시도해 주세요.",
  upload_extract_failed:
    "업로드한 파일을 분석하지 못했어요. 파일이 손상되지 않았는지 확인한 뒤 다시 시도해 주세요.",
  unsafe_source_content:
    "안전하지 않은 내용이 감지돼 가져올 수 없어요. 다른 원본으로 다시 시도해 주세요.",
  // Client-side guard in HomeView's import form (mirrors the disabled
  // upload button, kept for defense in depth) — not a backend code.
  upload_file_required: "업로드할 .pptx 또는 .pdf 파일을 선택해 주세요.",
};

const FALLBACK_COPY = "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";

/**
 * Maps an unknown thrown value (typically `ApiError`, which carries a
 * string `code`) to its Korean copy. Anything without a known code —
 * including a plain `Error`, a non-`ApiError` throw, or an
 * unrecognized backend code — falls back to a generic Korean message
 * rather than ever showing the raw (usually English) error text.
 */
export function apiErrorCopy(error: unknown): string {
  const code = errorCode(error);
  if (code !== null && code in ERROR_COPY) {
    return ERROR_COPY[code];
  }
  return FALLBACK_COPY;
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
