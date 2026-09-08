import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSettings } from "@/api/home";

export function resolveTheme(theme: "light" | "dark" | "auto", systemDark: boolean): "light" | "dark" {
  return theme === "auto" ? (systemDark ? "dark" : "light") : theme;
}

export function useTheme() {
  const { data } = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  useEffect(() => {
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { document.documentElement.dataset.theme = resolveTheme(data?.theme ?? "light", preference.matches); };
    apply();
    preference.addEventListener("change", apply);
    return () => preference.removeEventListener("change", apply);
  }, [data?.theme]);
}
