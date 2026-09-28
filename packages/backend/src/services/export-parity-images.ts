import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";
import type { ExportParityPage } from "@bg/shared";
import { createCanvas, getDocument, loadImage } from "./export-native-modules";
import {
  compareParityPages,
  type ParityPixelPage,
} from "./export-parity";
import { sha256 } from "./export-receipt";

const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_HEIGHT = 100;
const MAX_RASTER_WIDTH = 320;
const MAX_RASTER_HEIGHT = 200;
const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_PARITY_PAGES = 100;

export async function decodeParityImage(
  bytes: Uint8Array,
): Promise<ParityPixelPage> {
  const image = await loadImage(bytes);
  const width = image.width;
  const height = image.height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new TypeError("Parity image dimensions are invalid");
  }
  const raster = rasterDimensions(width, height);
  const canvas = createCanvas(raster.width, raster.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, raster.width, raster.height);
  return {
    width,
    height,
    raster_width: raster.width,
    raster_height: raster.height,
    rgba: Uint8Array.from(
      context.getImageData(0, 0, raster.width, raster.height).data,
    ),
  };
}

export async function pdfParityPages(
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<readonly ParityPixelPage[]> {
  signal.throwIfAborted();
  const loading = getDocument({ data: Uint8Array.from(bytes) });
  const document = await loading.promise;
  try {
    if (document.numPages < 1 || document.numPages > MAX_PARITY_PAGES) {
      throw new TypeError("PDF parity page count is invalid");
    }
    const pages: ParityPixelPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      signal.throwIfAborted();
      const page = await document.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const width = Math.max(1, Math.round(viewport.width));
        const height = Math.max(1, Math.round(viewport.height));
        const raster = rasterDimensions(width, height);
        const rasterViewport = page.getViewport({
          scale: raster.width / width,
        });
        const canvas = createCanvas(raster.width, raster.height);
        const context = canvas.getContext("2d");
        const task = Reflect.apply(page.render, page, [
          { canvas, canvasContext: context, viewport: rasterViewport },
        ]);
        const promise = Reflect.get(task, "promise");
        const cancel = Reflect.get(task, "cancel");
        if (!(promise instanceof Promise)) {
          throw new TypeError("PDF parity raster task unavailable");
        }
        if (typeof cancel !== "function") {
          throw new TypeError("PDF parity cancellation unavailable");
        }
        const abort = (): void => {
          Reflect.apply(cancel, task, []);
        };
        signal.addEventListener("abort", abort, { once: true });
        try {
          await promise;
          signal.throwIfAborted();
        } finally {
          signal.removeEventListener("abort", abort);
        }
        pages.push({
          width,
          height,
          raster_width: raster.width,
          raster_height: raster.height,
          rgba: Uint8Array.from(
            context.getImageData(0, 0, raster.width, raster.height).data,
          ),
        });
      } finally {
        page.cleanup();
      }
    }
    return pages;
  } finally {
    await document.destroy();
    await loading.destroy();
  }
}

export function parityThumbnail(
  source: ParityPixelPage,
  output: ParityPixelPage,
): Uint8Array {
  const canvas = createCanvas(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
  drawContained(context, source, 0, 0, THUMBNAIL_WIDTH / 2, THUMBNAIL_HEIGHT);
  drawContained(
    context,
    output,
    THUMBNAIL_WIDTH / 2,
    0,
    THUMBNAIL_WIDTH / 2,
    THUMBNAIL_HEIGHT,
  );
  context.fillStyle = "#dce4ea";
  context.fillRect(THUMBNAIL_WIDTH / 2 - 1, 0, 2, THUMBNAIL_HEIGHT);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

export function attachParityThumbnails(
  source: readonly ParityPixelPage[],
  output: readonly ParityPixelPage[],
  options: { readonly warnDimensionMismatch?: boolean } = {},
): {
  readonly summary: ReturnType<typeof compareParityPages>;
  readonly thumbnails: readonly {
    readonly page: number;
    readonly bytes: Uint8Array;
  }[];
} {
  const summary = compareParityPages({
    source,
    output,
    ...options,
  });
  const thumbnails = summary.pages.map((page) => ({
    page: page.page,
    bytes: parityThumbnail(
      requiredPage(source, page.page),
      requiredPage(output, page.page),
    ),
  }));
  const pages: ExportParityPage[] = summary.pages.map((page, index) => {
    const thumbnail = thumbnails[index];
    if (thumbnail === undefined) throw new TypeError("Parity thumbnail is missing");
    return {
      ...page,
      thumbnail_available: true,
      thumbnail_sha256: sha256(thumbnail.bytes),
    };
  });
  return { summary: { ...summary, pages }, thumbnails };
}

function requiredPage(
  pages: readonly ParityPixelPage[],
  page: number,
): ParityPixelPage {
  const value = pages[page - 1];
  if (value === undefined) throw new TypeError("Parity page is missing");
  return value;
}

function drawContained(
  context: SKRSContext2D,
  page: ParityPixelPage,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const source = parityCanvas(page);
  const scale = Math.min(
    width / page.raster_width,
    height / page.raster_height,
  );
  const renderedWidth = page.raster_width * scale;
  const renderedHeight = page.raster_height * scale;
  context.drawImage(
    source,
    x + (width - renderedWidth) / 2,
    y + (height - renderedHeight) / 2,
    renderedWidth,
    renderedHeight,
  );
}

function parityCanvas(page: ParityPixelPage): Canvas {
  const canvas = createCanvas(page.raster_width, page.raster_height);
  const context = canvas.getContext("2d");
  const imageData = context.createImageData(
    page.raster_width,
    page.raster_height,
  );
  imageData.data.set(page.rgba);
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function rasterDimensions(
  width: number,
  height: number,
): { readonly width: number; readonly height: number } {
  const scale = Math.min(
    1,
    MAX_RASTER_WIDTH / width,
    MAX_RASTER_HEIGHT / height,
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
