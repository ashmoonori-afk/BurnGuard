import { useSyncExternalStore } from "react";
import type { HeaderTier } from "@/lib/project-header-actions";

const WIDE = "(min-width: 1280px)";
const MEDIUM = "(min-width: 640px)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const lists = [window.matchMedia(WIDE), window.matchMedia(MEDIUM)];
  for (const list of lists) list.addEventListener("change", onChange);
  return () => { for (const list of lists) list.removeEventListener("change", onChange); };
}

function snapshot(): HeaderTier {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "wide";
  if (window.matchMedia(WIDE).matches) return "wide";
  return window.matchMedia(MEDIUM).matches ? "medium" : "narrow";
}

/** Tracks the project header's width tier from viewport media queries. */
export function useHeaderTier(): HeaderTier {
  return useSyncExternalStore(subscribe, snapshot, () => "wide");
}
