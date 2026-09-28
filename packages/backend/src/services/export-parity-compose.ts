import { createCanvas } from "./export-native-modules";
import type { ParityPixelPage } from "./export-parity";

const MAX_RASTER_WIDTH = 320;
const MAX_RASTER_HEIGHT = 200;

export function composeParityPage(input: {
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly source: ParityPixelPage;
  readonly placement: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly crop?: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
}): ParityPixelPage {
  const raster = rasterDimensions(input.pageWidth, input.pageHeight);
  const canvas = createCanvas(raster.width, raster.height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, raster.width, raster.height);
  const source = createCanvas(
    input.source.raster_width,
    input.source.raster_height,
  );
  const sourceContext = source.getContext("2d");
  const sourceData = sourceContext.createImageData(
    input.source.raster_width,
    input.source.raster_height,
  );
  sourceData.data.set(input.source.rgba);
  sourceContext.putImageData(sourceData, 0, 0);
  const crop = input.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
  context.drawImage(
    source,
    input.source.raster_width * crop.left,
    input.source.raster_height * crop.top,
    input.source.raster_width * (1 - crop.left - crop.right),
    input.source.raster_height * (1 - crop.top - crop.bottom),
    (input.placement.x / input.pageWidth) * raster.width,
    (input.placement.y / input.pageHeight) * raster.height,
    (input.placement.width / input.pageWidth) * raster.width,
    (input.placement.height / input.pageHeight) * raster.height,
  );
  return {
    width: input.pageWidth,
    height: input.pageHeight,
    raster_width: raster.width,
    raster_height: raster.height,
    rgba: Uint8Array.from(
      context.getImageData(0, 0, raster.width, raster.height).data,
    ),
  };
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
