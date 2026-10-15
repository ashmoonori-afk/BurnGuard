import type { PrintPreflightImage, PrintPreflightV1 } from "@bg/shared/print-preflight";

export type PrintPreflightView = {
  readonly pages: { readonly count: number; readonly size: string } | null;
  readonly missingFonts: readonly string[];
  readonly remoteFonts: readonly string[];
  readonly lowImages: readonly PrintPreflightImage[];
};

/** Pure view model: the first page's size stands for the set, and only flagged placements are listed, weakest first. */
export function summarizePrintPreflight(data: PrintPreflightV1): PrintPreflightView {
  const first = data.pages[0];
  return {
    pages: first === undefined ? null : { count: data.pages.length, size: `${first.width_mm}×${first.height_mm} mm (${first.width_px}×${first.height_px} px)` },
    missingFonts: data.fonts.filter((font) => font.status === "missing").map((font) => font.path === null ? font.family : `${font.family} (${font.path})`),
    remoteFonts: data.fonts.filter((font) => font.status === "remote").map((font) => font.family),
    lowImages: data.images.filter((image) => image.severity !== "ok").sort((left, right) => left.effective_ppi - right.effective_ppi),
  };
}
