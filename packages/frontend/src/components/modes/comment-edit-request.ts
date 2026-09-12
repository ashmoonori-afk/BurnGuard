import type { Comment } from "@bg/shared";
import { t } from "@/i18n/t";

const LEGACY_INSTRUCTIONS = "다음 저장된 코멘트에 따라 대상 파일의 요소를 수정해 주세요. 현재 파일에서 대상을 먼저 확인하고 필요한 변경만 적용한 뒤 변경 파일과 결과를 알려 주세요.";
const COMMENT_EDIT_INSTRUCTIONS = `${LEGACY_INSTRUCTIONS} 이미지 재생성 요청은 실행 전에 대화와 프로젝트에서 기존 이미지 생성 프롬프트를 확인하고, '기존 프롬프트'와 요청을 반영한 '수정 프롬프트'를 함께 보여 준 뒤 '이 프롬프트로 재생성할까요?'라고 물어보세요. 기존 프롬프트를 찾지 못하면 확인할 수 없다고 명시하고 원문을 지어내지 마세요. 사용자의 명시적인 확인을 받을 때까지 이미지 생성 도구를 호출하거나 파일을 변경하지 마세요. 이미 승인된 수정 프롬프트는 다시 묻지 말고 실행하세요. 승인 후에는 해당 프롬프트로 재생성하고 대상 요소에 적용한 뒤, 내장 캔버스의 최신 preview-report.json으로 이미지 로딩과 넘침을 확인하세요. 이 정보는 현재 페이지의 DOM 관찰이며 스크린샷 검수가 아닙니다. 별도 브라우저 실행 실패를 내장 화면의 권한 차단으로 설명하지 마세요. 이미지 재생성 이외의 수정도 같은 내장 화면 피드백을 확인하세요. 검증을 사용자에게 떠넘기거나 확인하지 않은 결과를 완료로 보고하지 마세요. 사용자에게는 프롬프트 비교와 확인 질문, 또는 변경 파일과 실제 수행한 검증 결과만 간결하게 보여 주고 내부 코멘트 ID, 선택자, 리비전, 다이제스트나 아래 JSON을 그대로 노출하지 마세요.`;

export function buildCommentEditRequest(comment: Comment): string {
  return `${COMMENT_EDIT_INSTRUCTIONS}\n${JSON.stringify({ comment_id: comment.id, file: comment.rel_path, element: comment.node_selector || "body", slide_index: comment.slide_index, artifact_revision: comment.artifact_revision, artifact_digest: comment.artifact_digest, request: comment.body })}`;
}

/** Keep the original request in history/provider input; only simplify generated chat copy. */
export function commentEditDisplayText(text: string): string {
  const newline = text.indexOf("\n");
  const instructions = text.slice(0, newline);
  if (instructions !== LEGACY_INSTRUCTIONS && instructions !== COMMENT_EDIT_INSTRUCTIONS) return text;
  try {
    const target: unknown = JSON.parse(text.slice(newline + 1));
    if (target === null || typeof target !== "object" || Array.isArray(target)) return text;
    const data = target as Record<string, unknown>;
    if (typeof data.comment_id !== "string" || typeof data.file !== "string" || typeof data.element !== "string" || typeof data.request !== "string") return text;
    if (data.slide_index !== null && (!Number.isSafeInteger(data.slide_index) || Number(data.slide_index) < 0)) return text;
    if (data.artifact_revision !== null && (!Number.isSafeInteger(data.artifact_revision) || Number(data.artifact_revision) < 0)) return text;
    if (data.artifact_digest !== null && typeof data.artifact_digest !== "string") return text;
    if (Object.keys(data).some((key) => !["comment_id", "file", "element", "slide_index", "artifact_revision", "artifact_digest", "request"].includes(key))) return text;
    const heading = data.slide_index === null
      ? t("workspace.comments.editDisplay", { file: data.file })
      : t("workspace.comments.editDisplaySlide", { file: data.file, slide: Number(data.slide_index) + 1 });
    return `${heading}\n${data.request}`;
  } catch {
    return text;
  }
}

export async function saveAndRequestCommentEdit(save: () => Promise<Comment>, send: (comment: Comment, text: string) => Promise<void>): Promise<void> {
  const persisted = await save();
  if (!persisted.body.trim() || persisted.resolved_at !== null) throw new Error("comment_target_unavailable");
  await send(persisted, buildCommentEditRequest(persisted));
}
