import type { Comment } from "@bg/shared";

export function buildCommentEditRequest(comment: Comment): string {
  return `다음 저장된 코멘트에 따라 대상 파일의 요소를 수정해 주세요. 현재 파일에서 대상을 먼저 확인하고 필요한 변경만 적용한 뒤 변경 파일과 결과를 알려 주세요.\n${JSON.stringify({ comment_id: comment.id, file: comment.rel_path, element: comment.node_selector || "body", slide_index: comment.slide_index, artifact_revision: comment.artifact_revision, artifact_digest: comment.artifact_digest, request: comment.body })}`;
}

export async function saveAndRequestCommentEdit(save: () => Promise<Comment>, send: (comment: Comment, text: string) => Promise<void>): Promise<void> {
  const persisted = await save();
  if (!persisted.body.trim() || persisted.resolved_at !== null) throw new Error("comment_target_unavailable");
  await send(persisted, buildCommentEditRequest(persisted));
}
