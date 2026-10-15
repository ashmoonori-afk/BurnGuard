import { describe, expect, test } from "bun:test";
import type { PrintPreflightV1 } from "@bg/shared/print-preflight";
import { classifyRenderPhaseFailure } from "../src/components/export/export-options";
import { summarizePrintPreflight } from "../src/components/export/print-preflight-view";

const REPORT: PrintPreflightV1 = {
  schema_version: 1,
  browser: "usable",
  pages: [
    { index: 1, name: "Cover", width_px: 793.7, height_px: 1122.5, width_mm: 210, height_mm: 297 },
    { index: 2, name: "Story", width_px: 793.7, height_px: 1122.5, width_mm: 210, height_mm: 297 },
  ],
  fonts: [
    { family: "Brand Sans", status: "resolved", path: "fonts/BrandSans.woff2", license_present: true },
    { family: "Quiet Serif", status: "missing", path: "fonts/QuietSerif.woff2", license_present: false },
    { family: "Cdn", status: "remote", path: null, license_present: false },
  ],
  images: [
    { page: 1, page_name: "Cover", locator: "img#hero", intrinsic_width_px: 3000, intrinsic_height_px: 4200, effective_ppi: 363, severity: "ok" },
    { page: 2, page_name: "Story", locator: "img[1] a.jpg", intrinsic_width_px: 600, intrinsic_height_px: 850, effective_ppi: 72.5, severity: "strong_warn" },
    { page: 2, page_name: "Story", locator: "img[2] b.jpg", intrinsic_width_px: 1800, intrinsic_height_px: 2500, effective_ppi: 218, severity: "warn" },
  ],
};

describe("print preflight view", () => {
  test("Given a report, When summarised, Then pages, missing and remote fonts and flagged images are separated", () => {
    const view = summarizePrintPreflight(REPORT);
    expect(view.pages?.count).toBe(2);
    expect(view.missingFonts).toEqual(["Quiet Serif (fonts/QuietSerif.woff2)"]);
    expect(view.remoteFonts).toEqual(["Cdn"]);
    expect(view.lowImages.map((image) => image.severity)).toEqual(["strong_warn", "warn"]);
  });

  test("Given a report without pages, When summarised, Then no page line is offered", () => {
    expect(summarizePrintPreflight({ ...REPORT, pages: [] }).pages).toBeNull();
  });
});

describe("render phase failure classification", () => {
  for (const phase of ["load", "fonts", "layout", "raster", "write"] as const) {
    test(`Given a ${phase} timeout code in the failure message, When classified, Then the phase and kind come back`, () => {
      expect(classifyRenderPhaseFailure(`Export failed: render_timeout_${phase}`)).toEqual({ kind: "timeout", phase });
      expect(classifyRenderPhaseFailure(`Export failed: render_failed_${phase}`)).toEqual({ kind: "failed", phase });
    });
  }

  test("Given a message without a phase code, When classified, Then nothing is claimed", () => {
    expect(classifyRenderPhaseFailure("Export failed: chromium_launch_timeout")).toBeNull();
    expect(classifyRenderPhaseFailure(null)).toBeNull();
  });
});
