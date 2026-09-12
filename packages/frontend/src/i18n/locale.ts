import { create } from "zustand";

export const LOCALES = ["ko", "en", "zh-CN"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_STORAGE_KEY = "burnguard.locale";

export function resolveInitialLocale(stored: string | null): Locale {
  return stored === "en" || stored === "zh-CN" ? stored : "ko";
}

export function localeTag(locale: Locale): string {
  return locale === "ko" ? "ko-KR" : locale === "en" ? "en-US" : "zh-CN";
}

export function applyDocumentLocale(locale: Locale): void {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

function initialLocale(): Locale {
  if (typeof window === "undefined") return "ko";
  try {
    return resolveInitialLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch (error) {
    if (error instanceof DOMException) return "ko";
    throw error;
  }
}

interface LocaleState {
  readonly locale: Locale;
  readonly setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: initialLocale(),
  setLocale: (locale) => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      } catch (error) {
        if (!(error instanceof DOMException)) throw error;
      }
    }
    applyDocumentLocale(locale);
    set({ locale });
  },
}));
