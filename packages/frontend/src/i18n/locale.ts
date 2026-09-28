import { create } from "zustand";

export const LOCALES = ["ko", "en", "zh-CN"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_STORAGE_KEY = "burnguard.locale";

function parseLocale(value: string | null): Locale | null {
  return value === "ko" || value === "en" || value === "zh-CN" ? value : null;
}

/**
 * First-run language from the OS's primary language tag: Korean -> ko,
 * Simplified Chinese -> zh-CN, anything else (including Traditional Chinese) -> en.
 */
export function detectSystemLocale(languages: readonly string[]): Locale {
  const [language, ...subtags] = (languages[0] ?? "").toLowerCase().split(/[-_]/);
  if (language === "ko") return "ko";
  if (language === "zh") {
    if (subtags.includes("hans")) return "zh-CN";
    if (subtags.includes("hant") || subtags.some((tag) => ["tw", "hk", "mo"].includes(tag))) return "en";
    return "zh-CN";
  }
  return "en";
}

export function resolveInitialLocale(stored: string | null, systemLanguages: readonly string[]): Locale {
  return parseLocale(stored) ?? detectSystemLocale(systemLanguages);
}

function systemLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  const languages: readonly string[] | undefined = navigator.languages;
  if (languages !== undefined && languages.length > 0) return languages;
  return typeof navigator.language === "string" ? [navigator.language] : [];
}

/** The locale the user chose on this device, or null before any explicit choice. */
export function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    return parseLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch (error) {
    if (error instanceof DOMException) return null;
    throw error;
  }
}

export function localeTag(locale: Locale): string {
  return locale === "ko" ? "ko-KR" : locale === "en" ? "en-US" : "zh-CN";
}

export function applyDocumentLocale(locale: Locale): void {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

function initialLocale(): Locale {
  return readStoredLocale() ?? detectSystemLocale(systemLanguages());
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
/**
 * Makes the shared setting authoritative while lazily publishing an existing
 * browser-local choice from releases that stored locale only in localStorage.
 * Without any saved choice, the OS-detected locale stays in effect and is not
 * saved, so only an explicit choice in Settings persists.
 */
export async function synchronizePortableLocale(
  load: () => Promise<{ locale: Locale | null }>,
  save: (locale: Locale) => Promise<{ locale: Locale | null }>,
  readStored: () => Locale | null = readStoredLocale,
): Promise<void> {
  const settings = await load();
  if (settings.locale !== null) {
    useLocaleStore.getState().setLocale(settings.locale);
    return;
  }
  const stored = readStored();
  if (stored === null) return;
  const updated = await save(stored);
  useLocaleStore.getState().setLocale(updated.locale ?? stored);
}
