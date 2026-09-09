/**
 * UI formatting helpers. No data-source dependencies.
 */

/**
 * Returns a human-friendly relative label like "오늘", "어제", or an
 * explicit ko-KR date for anything older. A timestamp in the future
 * (clock skew) collapses to "오늘". Matches the label convention shown
 * in the Home cards (ref/스크린샷 2026-04-22 093043.png).
 */
export function formatRelativeDay(ts: number, now: number = Date.now()): string {
  const diffMs = now - ts;
  const dayMs = 24 * 60 * 60 * 1000;

  if (diffMs < 0) return "오늘";
  if (diffMs < dayMs) return "오늘";
  if (diffMs < 2 * dayMs) return "어제";
  if (diffMs < 7 * dayMs) {
    const days = Math.floor(diffMs / dayMs);
    return `${days}일 전`;
  }
  return new Date(ts).toLocaleDateString("ko-KR");
}

const PROJECT_TYPE_LABEL: Record<string, string> = {
  prototype: "웹디자인",
  slide_deck: "슬라이드 덱",
  graphic: "그래픽",
  from_template: "템플릿",
  other: "기타",
};

export function projectTypeLabel(type: string): string {
  return PROJECT_TYPE_LABEL[type] ?? type;
}
