import type { NormalizedEvent, TurnErrorCode, TurnNotApplied, TurnRejectionReason } from "@bg/shared";
import { PathBoundaryError } from "../security/path-boundary";
import { LogoDeliverableError } from "./logo-deliverables";

const COPY: Readonly<Record<TurnErrorCode, string>> = {
  graphic_requires_authenticated_codex: "그래픽 생성에는 이미지 생성이 가능한 로그인된 연결이 필요해요. 모델 선택과 로그인 상태를 확인해 주세요.",
  graphic_starter_unchanged: "그래픽 화면이 아직 초기 상태라 결과를 반영하지 않았어요. 다시 생성을 요청해 주세요.",
  logo_requires_authenticated_codex: "로고 생성에는 이미지 생성이 가능한 로그인된 연결이 필요해요. 모델 선택과 로그인 상태를 확인해 주세요.",
  logo_deliverables_missing: "로고 결과물이 아직 규격을 갖추지 못해 반영하지 않았어요. 다시 생성을 요청해 주세요.",
  logo_image_provenance_missing: "로고 이미지의 생성 출처를 확인하지 못해 반영하지 않았어요. 이미지 생성 도구로 시안을 다시 만들어 주세요.",
  design_review_failed: "디자인 검사·수정을 완료하지 못해 반영하지 않았어요. 기존 결과는 유지돼요.",
  commandcode_unavailable: "CommandCode 연결을 사용할 수 없어요. Claude Code 설치와 설정의 API 키를 확인해 주세요.",
  unsupported_generation_model_effort: "선택한 모델이나 추론 강도를 사용할 수 없어요. 모델을 다시 선택해 주세요.",
  backend_unavailable: "선택한 작업 도구를 사용할 수 없어요. 설치 상태를 확인해 주세요.",
  agent_control_files_present: "프로젝트에 AI 도구 설정 파일이 있어 생성을 시작하지 않았어요. 파일명을 변경한 후 다시 시도해 주세요.",
  path_unavailable: "프로젝트 파일에 안전하게 접근할 수 없어요. 다시 시도해 주세요.",
  immutable_reference_mutated: "읽기 전용 참조 파일이 변경되어 작업을 중단했어요.",
  immutable_reference_path_unavailable: "읽기 전용 참조 파일에 안전하게 접근할 수 없어 작업을 중단했어요.",
  immutable_reference_escaped: "읽기 전용 참조 파일은 결과물에 복사할 수 없어요.",
  private_input_unavailable: "첨부 파일을 안전하게 준비하지 못했어요. 다시 시도해 주세요.",
  publication_failed: "결과물을 안전하게 저장하지 못했어요. 다시 시도해 주세요.",
  operation_conflict: "다른 작업이 진행 중이에요. 잠시 후 다시 시도해 주세요.",
  operation_cancelled: "작업이 취소되었어요.",
  turn_failed: "요청을 처리하지 못했어요. 다시 시도해 주세요.",
  deck_source_page_limit: "내용 자료의 페이지가 슬라이드 한도(80장)를 넘어 1:1로 옮길 수 없어요. 페이지 수 유지를 끄거나 자료를 나눠 주세요.",
};

/**
 * A domain error records a private `detail` that names a candidate id, a manifest field or a path;
 * this is the only place that detail is turned into something a client may see. The mapping is
 * total over the details the logo gate can raise and closed at the edges: an unrecognised detail
 * yields no reason at all rather than a guess, so a new failure mode can never inherit the
 * treatment — including repairability — of an existing one.
 */
const LOGO_REASONS: ReadonlyMap<string, TurnRejectionReason> = new Map([
  ["manifest_missing", "logo_manifest_missing"],
  ["manifest_invalid", "logo_manifest_invalid"],
  ["manifest_path_unsafe", "logo_manifest_invalid"],
  ["selection_missing", "logo_selection_invalid"],
  ["selection_unknown", "logo_selection_invalid"],
  ["selection_not_recorded", "logo_selection_invalid"],
  ["round_count", "logo_history_changed"],
  ["rounds_changed", "logo_history_changed"],
  ["rounds_exhausted", "logo_history_changed"],
  ["prior_candidate_changed", "logo_history_changed"],
  ["selected_candidate_changed", "logo_history_changed"],
  ["image_generation_missing", "logo_candidate_provenance"],
  ["candidate_unprovenanced", "logo_candidate_provenance"],
  ["svg_missing", "logo_svg_missing"],
  ["svg_not_file", "logo_svg_missing"],
  ["svg_empty", "logo_svg_missing"],
  ["svg_path_unsafe", "logo_svg_missing"],
  ["svg_source_missing", "logo_svg_source_mismatch"],
  ["svg_source_mismatch", "logo_svg_source_mismatch"],
  ["starter_unchanged", "logo_guidelines_invalid"],
]);

const REJECTION_REASONS: ReadonlySet<string> = new Set<TurnRejectionReason>([
  "logo_manifest_missing", "logo_manifest_invalid", "logo_history_changed", "logo_selection_invalid",
  "logo_candidate_invalid", "logo_candidate_provenance", "logo_svg_missing", "logo_svg_invalid",
  "logo_svg_source_mismatch", "logo_guidelines_invalid",
]);

/** Identifiers this server mints (ULIDs and fixture ids); never a path and never model-authored. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
/** How deep a wrapped error is followed before the chain is treated as unreadable. */
const MAX_CAUSE_DEPTH = 4;

function logoRejectionReason(detail: string): TurnRejectionReason | undefined {
  const head = detail.split(":")[0] ?? "";
  const mapped = LOGO_REASONS.get(head);
  if (mapped !== undefined) return mapped;
  if (head.startsWith("candidate_")) return "logo_candidate_invalid";
  if (head.startsWith("guidelines_")) return "logo_guidelines_invalid";
  // Everything the allowlist parser refuses about the document itself.
  return head.startsWith("svg_") ? "logo_svg_invalid" : undefined;
}

/**
 * The finite reason behind an error, following `cause` so a wrapper that keeps the original does
 * not lose it. The artifact coordinator does NOT keep it — it rethrows a fresh error carrying only
 * the public message — so the turn records the reason at the throw site and hands it to the event;
 * this function covers every other path and the unwrapped case.
 */
export function turnRejectionReason(error: unknown, depth = 0): TurnRejectionReason | undefined {
  if (error instanceof LogoDeliverableError) return logoRejectionReason(error.detail);
  if (depth >= MAX_CAUSE_DEPTH || !(error instanceof Error) || error.cause === undefined) return undefined;
  return turnRejectionReason(error.cause, depth + 1);
}

function safeReason(value: unknown): TurnRejectionReason | undefined {
  return typeof value === "string" && REJECTION_REASONS.has(value) ? value as TurnRejectionReason : undefined;
}

/** Rebuilds the not-applied notice from validated primitives so no field can smuggle a payload. */
function safeNotApplied(value: unknown): TurnNotApplied | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { turnId, operationId, repairs } = value as Partial<TurnNotApplied>;
  if (typeof turnId !== "string" || !SAFE_ID.test(turnId)) return undefined;
  if (typeof operationId !== "string" || !SAFE_ID.test(operationId)) return undefined;
  if (typeof repairs !== "number" || !Number.isInteger(repairs) || repairs < 0 || repairs > 4) return undefined;
  return { turnId, operationId, repairs };
}

export function sanitizeTurnEvent(event: NormalizedEvent, cause?: unknown): NormalizedEvent {
  if (event.type !== "status.error") return event;
  // Drop both additions before rebuilding them, so an unvalidated value can never survive the spread.
  const { reason: claimedReason, notApplied: claimedNotApplied, ...rest } = event;
  const code = turnErrorCode(cause, event.code ?? event.message);
  const reason = safeReason(claimedReason) ?? turnRejectionReason(cause);
  const notApplied = safeNotApplied(claimedNotApplied);
  return {
    ...rest, code, message: COPY[code],
    ...(reason === undefined ? {} : { reason }),
    ...(notApplied === undefined ? {} : { notApplied }),
  };
}

export function turnErrorCode(error: unknown, fallback?: string): TurnErrorCode {
  if (error instanceof PathBoundaryError) return "path_unavailable";
  return knownCode(errorCode(error)) ??
    knownCode(error instanceof Error ? error.message : undefined) ??
    knownCode(fallback) ??
    "turn_failed";
}

function knownCode(candidate: string | undefined): TurnErrorCode | undefined {
  switch (candidate) {
    case "graphic_requires_authenticated_codex":
    case "graphic_starter_unchanged":
    case "logo_requires_authenticated_codex":
    case "logo_deliverables_missing":
    case "logo_image_provenance_missing":
    case "design_review_failed":
    case "commandcode_unavailable":
    case "unsupported_generation_model_effort":
    case "backend_unavailable":
    case "agent_control_files_present":
    case "immutable_reference_mutated":
    case "immutable_reference_path_unavailable":
    case "immutable_reference_escaped":
    case "operation_conflict":
    case "operation_cancelled":
    case "publication_failed":
    case "turn_failed":
    case "deck_source_page_limit":
      return candidate;
    case "stage_attachment_input_invalid":
    case "private_input_unavailable":
      return "private_input_unavailable";
    case "invalid_name":
    case "outside_root":
    case "invalid_path":
    case "path_unavailable":
    case "project_path_unavailable":
      return "path_unavailable";
    default:
      return undefined;
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}
