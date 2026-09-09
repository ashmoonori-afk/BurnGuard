/** Convert viewport pixels to an element's unscaled canvas coordinates. */
export function canvasPoint(element: HTMLElement | SVGSVGElement, clientX: number, clientY: number): [number, number] {
  const rect = element.getBoundingClientRect();
  return [
    (clientX - rect.left) * element.clientWidth / (rect.width || 1),
    (clientY - rect.top) * element.clientHeight / (rect.height || 1),
  ];
}
