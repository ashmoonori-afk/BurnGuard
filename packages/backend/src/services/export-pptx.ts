import PptxGenJS from "pptxgenjs";
import type { PptxSize } from "@bg/shared";
import { parsePng } from "./export-png-validation";

interface PptxLayoutDims {
  name: string;
  width: number; // inches
  height: number; // inches
}

export function pptxLayoutForSize(size: PptxSize): PptxLayoutDims {
  switch (size) {
    case "4x3":
      // Standard PowerPoint 4:3 layout = 10in × 7.5in.
      return { name: "BG_4x3", width: 10, height: 7.5 };
    case "16x9":
    default:
      // 16:9 widescreen = 10in × 5.625in (PptxGenJS default ratio).
      return { name: "BG_16x9", width: 10, height: 5.625 };
  }
}

export class PptxExportError extends Error {
  readonly code: "chromium_not_installed" | "chromium_launch_timeout" | "deck_not_ready" | "render_failed";

  constructor(code: PptxExportError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export interface CapturedSlide {
  width: number;
  height: number;
  png: Uint8Array;
  notes: string;
}

/** Preserve the browser's complete composition; contain it without stretching into the selected paper ratio. */
export async function writePptx(slides: readonly CapturedSlide[], outputPath: string, size: PptxSize = "16x9"): Promise<void> {
  if (!slides.length || slides.length > 100) throw new PptxExportError("deck_not_ready", "Expected 1–100 slides");
  const layout = pptxLayoutForSize(size), pres = new PptxGenJS();
  pres.defineLayout(layout); pres.layout = layout.name;
  pres.author = "BurnGuard"; pres.subject = "Design-preserving slide images; source text is available in notes";
  for (const slide of slides) {
    if (![slide.width, slide.height].every(value => Number.isFinite(value) && value > 0)) throw new PptxExportError("render_failed", "Invalid slide capture");
    try { parsePng(slide.png); } catch { throw new PptxExportError("render_failed", "Invalid slide capture"); }
    const page = pres.addSlide(), scale = Math.min(layout.width / slide.width, layout.height / slide.height);
    const w = slide.width * scale, h = slide.height * scale;
    page.background = { color: "FFFFFF" };
    page.addImage({ data: "image/png;base64," + Buffer.from(slide.png).toString("base64"), x: (layout.width - w) / 2, y: (layout.height - h) / 2, w, h, altText: slide.notes.slice(0, 500) || "Slide design" });
    if (slide.notes) page.addNotes(slide.notes.slice(0, 100000));
  }
  await pres.writeFile({ fileName: outputPath });
}
