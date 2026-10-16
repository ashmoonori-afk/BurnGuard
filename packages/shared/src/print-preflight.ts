/** Print readiness summary shown before a PDF export. Pure transport shapes; no filesystem or browser types. */

/** Below this effective resolution a placement prints visibly soft. */
export const PRINT_PPI_WARN = 300;
/** Below this effective resolution a placement prints as obviously low quality. */
export const PRINT_PPI_STRONG_WARN = 150;

export type PrintImageSeverity = "ok" | "warn" | "strong_warn";
export type PrintFontStatus = "resolved" | "missing" | "remote";
export type PrintBrowserReadiness = "usable" | "unusable" | "inconclusive";

export type PrintPreflightPage = {
  readonly index: number;
  readonly name: string;
  readonly width_px: number;
  readonly height_px: number;
  readonly width_mm: number;
  readonly height_mm: number;
};

export type PrintPreflightFont = {
  readonly family: string;
  readonly status: PrintFontStatus;
  /** Project-relative, forward-slash path of the referenced file; null for a remote reference. */
  readonly path: string | null;
  readonly license_present: boolean;
};

export type PrintPreflightImage = {
  readonly page: number;
  readonly page_name: string;
  readonly locator: string;
  readonly intrinsic_width_px: number;
  readonly intrinsic_height_px: number;
  /** Lowest axis of the visible source pixels per printed inch. Computed from intrinsic pixels only; upscaling is not detected. */
  readonly effective_ppi: number;
  readonly severity: PrintImageSeverity;
};

export type PrintPreflightV1 = {
  readonly schema_version: 1;
  readonly pages: readonly PrintPreflightPage[];
  readonly fonts: readonly PrintPreflightFont[];
  readonly images: readonly PrintPreflightImage[];
  readonly browser: PrintBrowserReadiness;
  /** Source files carry no reliable history of prior resampling. Optional for older producers. */
  readonly source_upscaling_detection?: "unsupported";
};
