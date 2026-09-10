export const MIN_CANVAS_ZOOM = 0.01;
export const MAX_CANVAS_ZOOM = 64;
export function zoomCanvasAt(zoom: number, pan: { x: number; y: number }, offset: { x: number; y: number }, delta: number) {
  const next = Math.max(MIN_CANVAS_ZOOM, Math.min(MAX_CANVAS_ZOOM, zoom * Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.002)));
  const ratio = next / zoom;
  return { zoom: next, pan: { x: pan.x + offset.x * (1 - ratio), y: pan.y + offset.y * (1 - ratio) } };
}
