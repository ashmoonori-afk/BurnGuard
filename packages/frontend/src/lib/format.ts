/**
 * UI formatting helpers. No data-source dependencies.
 */
import { t, type MessageKey } from "@/i18n/t";
import { localeTag, useLocaleStore } from "@/i18n/locale";

/**
 * Returns a human-friendly relative label like "오늘", "어제", or an
 * explicit ko-KR date for anything older. A timestamp in the future
 * (clock skew) collapses to "오늘". Matches the label convention shown
 * in the Home cards (ref/스크린샷 2026-04-22 093043.png).
 */
export function formatRelativeDay(ts: number, now: number = Date.now()): string {
  const diffMs = now - ts;
  const dayMs = 24 * 60 * 60 * 1000;

  if (diffMs < 0) return t("home.date.today");
  if (diffMs < dayMs) return t("home.date.today");
  if (diffMs < 2 * dayMs) return t("home.date.yesterday");
  if (diffMs < 7 * dayMs) {
    const days = Math.floor(diffMs / dayMs);
    return t("home.date.daysAgo", { count: days });
  }
  return new Date(ts).toLocaleDateString(localeTag(useLocaleStore.getState().locale));
}

const PROJECT_TYPE_LABEL: Record<string, MessageKey> = {
  prototype: "home.type.prototype",
  slide_deck: "home.type.slide_deck",
  graphic: "home.type.graphic",
  from_template: "home.type.from_template",
  other: "home.type.other",
};

export function projectTypeLabel(type: string): string {
  const key = PROJECT_TYPE_LABEL[type];
  return key === undefined ? type : t(key);
}
