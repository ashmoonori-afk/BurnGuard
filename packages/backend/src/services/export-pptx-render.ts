import type { PptxSize } from "@bg/shared";
import { PptxExportError, writePptx, type CapturedSlide } from "./export-pptx";

const CAPTURE_SLIDES_CSS = "[data-deck-nav],[data-speaker-notes]{display:none!important}[data-slide]:not([data-active]){display:none!important}";

export async function renderDeckToPptx(input: {
  readonly stagedDir: string;
  readonly entrypoint: string;
  readonly outputPath: string;
  readonly size?: PptxSize;
  readonly signal?: AbortSignal;
}): Promise<void> {
  const signal = input.signal ?? new AbortController().signal;
  const { openRenderSession, RenderSessionError } = await import("./export-render-session");
  let session;
  try { session = await openRenderSession({ stagedDir: input.stagedDir, entrypoint: input.entrypoint, viewport: { width: 1280, height: 720, dpr: 2 }, deck: true, signal }); }
  catch (error) { if (error instanceof RenderSessionError) throw new PptxExportError(error.code === "deck_not_ready" ? "deck_not_ready" : error.code === "chromium_not_installed" ? "chromium_not_installed" : error.code === "chromium_launch_timeout" ? "chromium_launch_timeout" : "render_failed", error.message); throw error; }
  try {
    const page = session.page; await page.addStyleTag({ content: CAPTURE_SLIDES_CSS });
    const slides = page.locator("[data-slide]"), count = await slides.count(), captured: CapturedSlide[] = [];
    if (count < 1 || count > 100) throw new PptxExportError("deck_not_ready", "Expected 1–100 slides");
    for (let index = 0; index < count; index++) {
      signal.throwIfAborted();
      await page.evaluate(index => { document.querySelectorAll("[data-slide]").forEach((slide, i) => slide.toggleAttribute("data-active", i === index)); }, index);
      const slide = slides.nth(index);
      await slide.scrollIntoViewIfNeeded();
      const content = await slide.evaluate(async element => {
        await Promise.all([...element.querySelectorAll("img")].map(async image => { image.loading = "eager"; if (!image.complete) await image.decode(); if (!image.naturalWidth) throw new Error("Slide image is unavailable"); }));
        const notes = [...element.querySelectorAll<HTMLElement>("[data-speaker-notes]")].map(note => note.textContent ?? "").join("\n");
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height, notes: `${(element as HTMLElement).innerText}\n${notes}`.trim() };
      });
      if (content.width * content.height * 4 > 16_000_000) throw new PptxExportError("render_failed", "Slide exceeds capture pixel budget");
      const png = await slide.screenshot({ type: "png", animations: "disabled", timeout: 30_000 });
      captured.push({ ...content, png });
    }
    await writePptx(captured, input.outputPath, input.size ?? "16x9");
  } finally { await session.close(); }
}
