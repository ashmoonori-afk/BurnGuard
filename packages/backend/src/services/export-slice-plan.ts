/** Section-aware slicing for long product-detail pages (doc/14 T49). */
const MAX_SLICE_PIXELS = 16_000_000;
const MAX_SLICES = 100;

export type SliceRegion = { readonly top: number; readonly bottom: number; readonly cut_through_content: boolean };
export type SliceFinding = { readonly code: "cut_through_content"; readonly slice: number };
export type SlicePlan = { readonly slices: readonly SliceRegion[]; readonly findings: readonly SliceFinding[] };
export type SliceRequest = {
  readonly pageHeight: number;
  readonly width: number;
  readonly sectionBottoms: readonly number[];
  readonly sliceHeight: number;
};

export class SlicePlanError extends Error {
  readonly name = "SlicePlanError";
  constructor(readonly code: "invalid_page_height" | "invalid_width" | "invalid_slice_height" | "invalid_section_bottoms" | "slice_pixel_limit" | "slice_count_limit") { super(code); }
}

/**
 * Cuts the page at the lowest section bottom that still fits inside `sliceHeight`.
 * When no section boundary fits, the slice is cut at `sliceHeight` and reported as
 * a forced cut so the caller can surface it instead of silently splitting content.
 */
export function planSlices(request: SliceRequest): SlicePlan {
  if (!positiveInteger(request.pageHeight)) throw new SlicePlanError("invalid_page_height");
  if (!positiveInteger(request.width)) throw new SlicePlanError("invalid_width");
  if (!positiveInteger(request.sliceHeight)) throw new SlicePlanError("invalid_slice_height");
  if (request.width * Math.min(request.sliceHeight, request.pageHeight) > MAX_SLICE_PIXELS) throw new SlicePlanError("slice_pixel_limit");
  const bottoms = normalizeBottoms(request.sectionBottoms, request.pageHeight);
  const slices: SliceRegion[] = [];
  const findings: SliceFinding[] = [];
  let top = 0;
  while (top < request.pageHeight) {
    if (slices.length >= MAX_SLICES) throw new SlicePlanError("slice_count_limit");
    const limit = top + request.sliceHeight;
    if (request.pageHeight <= limit) {
      slices.push({ top, bottom: request.pageHeight, cut_through_content: false });
      break;
    }
    const boundary = lastBoundaryWithin(bottoms, top, limit);
    const cut = boundary === null;
    slices.push({ top, bottom: cut ? limit : boundary, cut_through_content: cut });
    if (cut) findings.push({ code: "cut_through_content", slice: slices.length });
    top = cut ? limit : boundary;
  }
  return { slices, findings };
}

function normalizeBottoms(values: readonly number[], pageHeight: number): readonly number[] {
  for (const value of values) if (!positiveInteger(value) || value > pageHeight) throw new SlicePlanError("invalid_section_bottoms");
  return [...new Set(values)].sort((left, right) => left - right);
}

function lastBoundaryWithin(bottoms: readonly number[], top: number, limit: number): number | null {
  let found: number | null = null;
  for (const bottom of bottoms) if (bottom > top && bottom <= limit) found = bottom;
  return found;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
