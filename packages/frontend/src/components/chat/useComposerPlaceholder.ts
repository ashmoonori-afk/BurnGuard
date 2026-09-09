export function useComposerPlaceholder(disabled: boolean): string {
  return disabled
    ? "현재 작업이 끝나면 다음 요청을 보낼 수 있어요."
    : "만들고 싶은 결과나 바꿀 부분을 알려 주세요.\n예: 제목을 짧게 바꾸고 여백을 넓혀 주세요.";
}
