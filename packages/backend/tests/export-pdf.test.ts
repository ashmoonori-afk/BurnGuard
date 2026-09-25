import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExportOptions, ProjectDetail } from "@bg/shared";
import { projectsDir } from "../src/lib/paths";
import { PDF_PRINT_CSS, pdfDimensionsForPaper } from "../src/services/export-pdf-contract";
import { assertExportAllowed, ExportServiceError } from "../src/services/exports";

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

describe("deck PDF admission", () => {
  const deckDir = path.join(projectsDir, `export-pdf-deck-admission-${process.pid}`);
  const deck = (entrypoint: string): ProjectDetail => ({ id: path.basename(deckDir), name: "Deck", type: "slide_deck", design_system_id: null, design_system_name: null, thumbnail_path: null, updated_at: 1, archived_at: null, dir_path: deckDir, entrypoint, backend_id: "claude-code", options_json: null, current_revision: 1, current_digest: null });

  beforeAll(async () => {
    await mkdir(deckDir, { recursive: true });
    for (const slides of [30, 31, 32]) await writeFile(path.join(deckDir, `deck-${slides}.html`), `<!doctype html><html><body>${"<section data-slide><h1>Slide</h1></section>".repeat(slides)}</body></html>`);
  });

  afterAll(async () => { await rm(deckDir, { recursive: true, force: true }); });

  test.each([
    { slides: 30, paper: "widescreen-16x9", options: { pdf_paper: "widescreen-16x9" } },
    { slides: 31, paper: "a4", options: { pdf_paper: "a4" } },
    { slides: 31, paper: "default a4", options: {} },
  ] as readonly { readonly slides: number; readonly paper: string; readonly options: ExportOptions }[])("Given a $slides-slide deck When PDF on $paper paper is requested Then the raster budget admits it", async ({ slides, options }) => {
    // Given / When / Then
    await expect(assertExportAllowed(deck(`deck-${slides}.html`), "pdf", options)).resolves.toBeUndefined();
  });

  test.each([
    { slides: 31, paper: "widescreen-16x9", options: { pdf_paper: "widescreen-16x9" } },
    { slides: 32, paper: "a4", options: { pdf_paper: "a4" } },
    { slides: 32, paper: "default a4", options: {} },
  ] as readonly { readonly slides: number; readonly paper: string; readonly options: ExportOptions }[])("Given a $slides-slide deck When PDF on $paper paper is requested Then admission refuses it with a typed resource limit before any attempt exists", async ({ slides, options }) => {
    // Given / When / Then
    await expect(assertExportAllowed(deck(`deck-${slides}.html`), "pdf", options)).rejects.toBeInstanceOf(ExportServiceError);
    await expect(assertExportAllowed(deck(`deck-${slides}.html`), "pdf", options)).rejects.toMatchObject({ code: "pdf_resource_limit" });
  });

  test("Given an oversized deck When PPTX is requested Then the PDF raster budget does not apply", async () => {
    // Given / When / Then
    await expect(assertExportAllowed(deck("deck-32.html"), "pptx", { pptx_size: "16x9" })).resolves.toBeUndefined();
  });
});
