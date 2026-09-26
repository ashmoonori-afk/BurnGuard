import type { GenerationOptions } from "@bg/shared";

/**
 * Every panel-initiated send (comment edit, quality fix, UX review, chart, 3D) takes the stored
 * composer draft's generation options and otherwise sends none, so the backend applies the
 * configured defaults rather than a second hard-coded fallback.
 */
export function panelGenerationFor(draft: { readonly generation?: GenerationOptions } | null): GenerationOptions | undefined {
  return draft?.generation;
}
