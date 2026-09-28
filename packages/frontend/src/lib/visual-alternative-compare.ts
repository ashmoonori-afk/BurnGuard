import type { VisualAlternativeSummary } from "@bg/shared";

export const COMPARE_VIEWPORTS = {
  desktop: { width: 1280, height: 720 },
  mobile: { width: 390, height: 844 },
} as const;

export type CompareViewport = keyof typeof COMPARE_VIEWPORTS;

export function compareViewport(
  viewport: CompareViewport,
): { readonly width: number; readonly height: number } {
  return COMPARE_VIEWPORTS[viewport];
}

export function readyCompareAlternatives(
  alternatives: readonly VisualAlternativeSummary[],
  generationId?: string,
): readonly VisualAlternativeSummary[] {
  return alternatives.filter(
    (alternative) =>
      alternative.status === "ready" &&
      alternative.entrypoint_url !== null &&
      (generationId === undefined || alternative.generation_id === generationId),
  );
}
