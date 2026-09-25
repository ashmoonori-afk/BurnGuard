import { describe, expect, test } from "bun:test";
import { PDF_PRINT_CSS, pdfDimensionsForPaper } from "../src/services/export-pdf-contract";

describe("PDF_PRINT_CSS", () => {
  test("Given authored grid or flex slides When print CSS is applied Then it forces no display type and still hides the nav", () => {
    // The single-slide gate is lifted by revealExportPages, which pins each hidden page to its own active display.
    expect(PDF_PRINT_CSS).not.toMatch(/display:\s*block/);
    expect(PDF_PRINT_CSS).toContain("[data-deck-nav]");
    expect(PDF_PRINT_CSS).toMatch(/display:\s*none\s*!important/);
  });

  test("Given a deck painting its page background When print CSS is applied Then the html and body background is left to the author", () => {
    expect(PDF_PRINT_CSS).not.toMatch(/background/);
  });

  test("breaks a page between slides except after the last", () => {
    expect(PDF_PRINT_CSS).toContain("page-break-after: always");
    expect(PDF_PRINT_CSS).toContain("break-after: page");
    expect(PDF_PRINT_CSS).toContain("[data-slide]:last-of-type");
    expect(PDF_PRINT_CSS).toMatch(/last-of-type[^}]*page-break-after:\s*auto/);
  });

  test("Given graphic artboards When print CSS is applied Then they use the same page isolation contract as slides", () => {
    // Given / When / Then
    expect(PDF_PRINT_CSS).toMatch(/\[data-slide\], \[data-graphic-artboard\] \{[^}]*break-after: page/);
    expect(PDF_PRINT_CSS).toContain("[data-graphic-artboard]:last-of-type");
  });

  test("does not declare an @page rule (page size is driven by the paper option)", () => {
    // The @page { size: A4 landscape } rule used to live here. After
    // P4 export audit fix 7, the user picks paper / orientation per
    // export and `page.pdf({ format, width, height, landscape })`
    // drives the dimensions. A stray @page rule would override that
    // choice via preferCSSPageSize behaviour, so this guard prevents
    // a regression that re-pins everyone to A4.
    expect(PDF_PRINT_CSS).not.toMatch(/@page\b/);
  });

  test("maps every persisted paper option to stable Chromium dimensions", () => {
    expect(pdfDimensionsForPaper("a4")).toEqual({ format: "A4" });
    expect(pdfDimensionsForPaper("letter")).toEqual({ format: "Letter" });
    expect(pdfDimensionsForPaper("widescreen-16x9")).toEqual({ width: "13.333in", height: "7.5in" });
  });
});
