import { readFile } from "node:fs/promises";
import { createCanvas, loadImage } from "./export-native-modules";
import { openRenderSession, type RenderPhase } from "./export-render-session";
import { analyzePixels, validatePngStatistics, type PngValidation } from "./export-png-validation";

export async function renderToPng(input: {
  readonly stagedDir: string;
  readonly entrypoint: string;
  readonly outputPath: string;
  readonly width: number;
  readonly height: number;
  readonly dpr: 1 | 2;
  readonly deck: boolean;
  readonly signal: AbortSignal;
  readonly onPhase?: (phase: RenderPhase) => void;
}): Promise<PngValidation> {
  const session = await openRenderSession({ stagedDir: input.stagedDir, entrypoint: input.entrypoint, viewport: { width: input.width, height: input.height, dpr: input.dpr }, deck: input.deck, signal: input.signal, ...(input.onPhase === undefined ? {} : { onPhase: input.onPhase }) });
  try {
    await session.page.screenshot({ path: input.outputPath, type: "png", fullPage: false, animations: "disabled" });
    const bytes = new Uint8Array(await readFile(input.outputPath));
    const width = input.width * input.dpr; const height = input.height * input.dpr; const canvas = createCanvas(width, height); const context = canvas.getContext("2d"); const image = await loadImage(bytes); context.drawImage(image, 0, 0, width, height); const pixels = context.getImageData(0, 0, width, height).data; const statistics = analyzePixels(Uint8Array.from(pixels), width, height);
    return validatePngStatistics(bytes, { width: input.width * input.dpr, height: input.height * input.dpr }, statistics);
  } finally {
    await session.close();
  }
}
