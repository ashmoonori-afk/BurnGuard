import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { renderDeckToPdf } from "../src/services/export-pdf";
import { pdfPointsForPaper } from "../src/services/export-pdf-contract";

/** Three side-by-side 1080x1350 cards: inline-block with the default baseline alignment and a preview margin. */
const inlineArtboardsHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Cards</title><style>html,body{margin:0;background:#dddddd;font:16px sans-serif}[data-graphic-artboard]{display:inline-block;margin:20px;width:1080px;height:1350px;box-sizing:border-box;padding:40px;background:#ffffff;border:6px solid #222222}</style></head><body>${Array.from({ length: 3 }, (_, index) => `<section data-graphic-artboard><h2 style="margin:0">Card ${index + 1}</h2></section>`).join("")}</body></html>`;

/** Three gated slides authored as inline-block boxes with the default baseline alignment. */
const inlineDeckHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Deck</title><style>html,body{margin:0}body[data-deck-ready] .slide:not([data-active]){display:none}.slide{display:inline-block;width:100vw;height:100vh;background:#2468ac;box-sizing:border-box;padding:40px}</style><script src="/runtime/deck-stage.js" defer></script></head><body>${'<section data-slide class="slide"><div style="width:200px;height:200px;background:#e03050"></div></section>'.repeat(3)}</body></html>`;

describe("inline-level export pages", () => {
  test.each([
    { name: "three inline-block 1080x1350 artboards", html: inlineArtboardsHtml, paper: "artboard", selector: "[data-graphic-artboard]", points: pdfPointsForPaper("artboard", { width: 1080, height: 1350 }) },
    { name: "a three-slide inline-block deck", html: inlineDeckHtml, paper: "widescreen-16x9", selector: "[data-slide]", points: pdfPointsForPaper("widescreen-16x9") },
  ])("Given $name on $paper paper When exported to PDF Then each authored page prints exactly one PDF page", async ({ html, paper, selector, points }) => {
    // Given
    const stagedDir = await mkdtemp(path.join(tmpdir(), "bg-inline-pdf-"));
    try {
      await writeFile(path.join(stagedDir, "index.html"), html);
      const outputPath = path.join(stagedDir, "pages.pdf");

      // When
      const validation = await renderDeckToPdf({ stagedDir, entrypoint: "index.html", outputPath, paper, selector, signal: AbortSignal.timeout(45_000) });

      // Then
      const pdf = await PDFDocument.load(await readFile(outputPath));
      expect(validation.pages).toBe(3);
      expect(pdf.getPageCount()).toBe(3);
      for (const page of pdf.getPages()) {
        expect(Math.abs(page.getWidth() - points.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(page.getHeight() - points.height)).toBeLessThanOrEqual(1);
      }
    } finally { await rm(stagedDir, { recursive: true, force: true }); }
  }, 60_000);
});
