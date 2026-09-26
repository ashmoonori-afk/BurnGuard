import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSettings } from "@/api/home";

export const THEME_STORAGE_KEY = "burnguard.theme";
export type ResolvedTheme = "light" | "dark";

export function resolveTheme(theme: "light" | "dark" | "auto", systemDark: boolean): ResolvedTheme {
  return theme === "auto" ? (systemDark ? "dark" : "light") : theme;
}

/** The theme resolved last time, so the first paint after launch matches it instead of flashing light. */
export function readCachedTheme(): ResolvedTheme | null {
  try {
    const cached = window.localStorage.getItem(THEME_STORAGE_KEY);
    return cached === "dark" || cached === "light" ? cached : null;
  } catch {
    return null;
  }
}

/** Runs before the first render; the server value replaces the cache once settings load. */
export function applyLaunchTheme(): void {
  const cached = readCachedTheme();
  if (cached !== null) document.documentElement.dataset["theme"] = cached;
}

export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset["theme"] = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* the next launch simply starts without a cached theme */
  }
}

export function useTheme() {
  const { data } = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const theme = data?.theme;
  useEffect(() => {
    // Until settings arrive the launch cache (or the light default) stays in place.
    if (theme === undefined) return;
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { applyTheme(resolveTheme(theme, preference.matches)); };
    apply();
    preference.addEventListener("change", apply);
    return () => preference.removeEventListener("change", apply);
  }, [theme]);
}
