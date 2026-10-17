/**
 * UI formatting helpers. No data-source dependencies.
 */
import { t, type MessageKey } from "@/i18n/t";
import { useLocaleStore } from "@/i18n/locale";
import { formatFullDateTime, formatUpdatedAt } from "@/lib/date-format";

/** Relative day label for card metadata in the active locale; see `formatUpdatedAt`. */
export function formatRelativeDay(ts: number, now: number = Date.now()): string {
  return formatUpdatedAt(ts, useLocaleStore.getState().locale, now);
}

/** Full date and time of a timestamp in the active locale, for tooltips. */
export function formatFullDate(ts: number): string {
  return formatFullDateTime(ts, useLocaleStore.getState().locale);
}

const PROJECT_TYPE_LABEL: Record<string, MessageKey> = {
  prototype: "home.type.prototype",
  slide_deck: "home.type.slide_deck",
  graphic: "home.type.graphic",
  logo: "home.type.logo",
  from_template: "home.type.from_template",
  other: "home.type.other",
};

export function projectTypeLabel(type: string): string {
  const key = PROJECT_TYPE_LABEL[type];
  return key === undefined ? type : t(key);
}
