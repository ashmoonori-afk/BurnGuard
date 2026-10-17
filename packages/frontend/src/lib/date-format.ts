import { localeTag, type Locale } from "@/i18n/locale";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A calendar day (local time) as a whole number, so "yesterday" means the previous date, not 24 hours ago. */
const calendarDay = (ts: number): number => {
  const date = new Date(ts);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
};

const capitalize = (value: string, tag: string): string => value.slice(0, 1).toLocaleUpperCase(tag) + value.slice(1);

/** Short absolute date in the locale's own order and calendar words, e.g. "Aug 14, 2026" or "2026년 8월 14일". */
export function formatAbsoluteDate(ts: number, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), { year: "numeric", month: "short", day: "numeric" }).format(ts);
}

/** Full date and time for tooltips. */
export function formatFullDateTime(ts: number, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), { dateStyle: "medium", timeStyle: "short" }).format(ts);
}

/** "Today", "Yesterday", "3 days ago" in the active language for the past week, the absolute date after that. A future timestamp (clock skew) reads as today. */
export function formatUpdatedAt(ts: number, locale: Locale, now: number = Date.now()): string {
  const tag = localeTag(locale);
  const days = Math.max(0, calendarDay(now) - calendarDay(ts));
  if (days >= 7) return formatAbsoluteDate(ts, locale);
  return capitalize(new Intl.RelativeTimeFormat(tag, { numeric: "auto" }).format(days === 0 ? 0 : -days, "day"), tag);
}
