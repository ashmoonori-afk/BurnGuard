import { expect, test } from "bun:test";
import { zoomCanvasAt } from "../src/components/canvas/canvas-zoom";
test("Given cursor anchored zoom When enlarged beyond 300 percent Then the same artwork point stays under the cursor", () => {
  const oldZoom = 3, oldPan = { x: 50, y: -20 }, offset = { x: 100, y: 200 };
  const next = zoomCanvasAt(oldZoom, oldPan, offset, -200);
  expect(next.zoom).toBeGreaterThan(3);
  expect(next.pan.x + offset.x / oldZoom * next.zoom).toBeCloseTo(oldPan.x + offset.x);
  expect(next.pan.y + offset.y / oldZoom * next.zoom).toBeCloseTo(oldPan.y + offset.y);
  expect(zoomCanvasAt(64, oldPan, offset, -500).zoom).toBe(64);
  expect(zoomCanvasAt(0.01, oldPan, offset, 500).zoom).toBe(0.01);
});
