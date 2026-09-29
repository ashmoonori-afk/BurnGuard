import { parse, type HTMLElement } from "node-html-parser";

/**
 * Measures an authored CSS/SVG logo mark (`<svg data-bg-css-logo>`) against the logo construction rules the
 * capable model profiles receive. Rules that need visual judgement (the hidden second meaning, recognisability
 * at 16 px, the black-and-white version) are reported as `self_check`; the rest are measured from the markup.
 */

export const CSS_LOGO_RULE_IDS = ["LOGO_FORM", "LOGO_LINE", "LOGO_NEGATIVE_SPACE", "LOGO_GRID", "LOGO_COUNTERS", "LOGO_COLOR", "LOGO_SIMPLIFY"] as const;
export type CssLogoRuleId = typeof CSS_LOGO_RULE_IDS[number];

export interface CssLogoRuleResult {
  readonly rule: CssLogoRuleId;
  readonly status: "pass" | "fail" | "self_check";
  readonly measured?: number;
  readonly limit?: number;
}

export const CSS_LOGO_MAX_SHAPES = 5;
export const CSS_LOGO_MAX_COLORS = 2;
export const CSS_LOGO_GRID_SHARE = 2 / 3;
const ANGLE_TOLERANCE_DEG = 3;
const SMALLEST_SIZE_PX = 16;

const SHAPES = new Set(["circle", "ellipse", "rect", "polygon", "polyline", "line", "path"]);
const PAINT_NONE = /^(?:none|transparent)$/i;

function styleValue(element: HTMLElement, name: string): string | undefined {
  const style = element.getAttribute("style");
  if (style !== undefined) {
    for (const declaration of style.split(";")) {
      const [key, ...value] = declaration.split(":");
      if (key?.trim().toLowerCase() === name) return value.join(":").trim();
    }
  }
  return element.getAttribute(name)?.trim();
}

function inherited(element: HTMLElement, name: string, root: HTMLElement): string | undefined {
  for (let node: HTMLElement | null = element; node !== null; node = node === root ? null : node.parentNode) {
    const value = styleValue(node, name);
    if (value !== undefined && value !== "" && value !== "inherit") return value;
  }
  return undefined;
}

function numbers(value: string | undefined): number[] {
  return (value ?? "").split(/[\s,]+/).filter((part) => part !== "").map(Number).filter(Number.isFinite);
}

function segmentAngles(shape: HTMLElement): number[] {
  const tag = shape.rawTagName.toLowerCase();
  let points: number[] = [];
  if (tag === "polygon" || tag === "polyline") points = numbers(shape.getAttribute("points"));
  if (tag === "line") points = ["x1", "y1", "x2", "y2"].map((name) => Number(shape.getAttribute(name) ?? "0"));
  const pairs: Array<readonly [number, number]> = [];
  for (let index = 0; index + 1 < points.length; index += 2) pairs.push([points[index]!, points[index + 1]!]);
  if (tag === "polygon" && pairs.length > 2) pairs.push(pairs[0]!);
  const angles: number[] = [];
  for (let index = 0; index + 1 < pairs.length; index += 1) {
    const [x1, y1] = pairs[index]!;
    const [x2, y2] = pairs[index + 1]!;
    if (x1 === x2 && y1 === y2) continue;
    angles.push(Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI);
  }
  return angles;
}

const onGrid = (angle: number): boolean => {
  const offset = ((angle % 45) + 45) % 45;
  return Math.min(offset, 45 - offset) <= ANGLE_TOLERANCE_DEG;
};

export function checkCssLogoSvg(svg: HTMLElement): readonly CssLogoRuleResult[] {
  const shapes = svg.querySelectorAll("*").filter((element) => SHAPES.has(element.rawTagName.toLowerCase()));
  const stroked = shapes.filter((shape) => {
    const stroke = inherited(shape, "stroke", svg);
    return stroke !== undefined && !PAINT_NONE.test(stroke);
  });
  const widths = new Set(stroked.map((shape) => Number.parseFloat(inherited(shape, "stroke-width", svg) ?? "1")).filter(Number.isFinite));

  // Corner treatment: stroked joins and rect radii are either all round or all sharp. Circles, ellipses and
  // unstroked paths carry no measurable corner, so they do not vote.
  const corners = new Set<string>();
  for (const shape of shapes) {
    const tag = shape.rawTagName.toLowerCase();
    if (tag === "rect") corners.add(Number.parseFloat(shape.getAttribute("rx") ?? shape.getAttribute("ry") ?? "0") > 0 ? "round" : "sharp");
    else if (stroked.includes(shape) && tag !== "circle" && tag !== "ellipse") corners.add(inherited(shape, "stroke-linejoin", svg)?.toLowerCase() === "round" ? "round" : "sharp");
    else if (tag === "polygon" || tag === "polyline") corners.add("sharp");
  }

  const angles = shapes.flatMap(segmentAngles);
  const gridShare = angles.length === 0 ? 1 : angles.filter(onGrid).length / angles.length;

  const viewBox = numbers(svg.getAttribute("viewBox"));
  const extent = viewBox.length === 4 ? Math.max(viewBox[2]!, viewBox[3]!) : NaN;
  const thinnest = widths.size === 0 ? NaN : Math.min(...widths);
  const thinnestAtSmallest = Number.isFinite(extent) && extent > 0 && Number.isFinite(thinnest) ? thinnest * SMALLEST_SIZE_PX / extent : NaN;

  const colors = new Set<string>();
  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    for (const name of ["fill", "stroke", "stop-color"]) {
      const value = styleValue(element, name);
      if (value !== undefined && value !== "" && !PAINT_NONE.test(value) && value !== "inherit") colors.add(value.toLowerCase().replace(/\s+/g, ""));
    }
  }

  const measuredLine = widths.size <= 1 && corners.size <= 1;
  return [
    { rule: "LOGO_FORM", status: shapes.length >= 1 && shapes.length <= CSS_LOGO_MAX_SHAPES ? "pass" : "fail", measured: shapes.length, limit: CSS_LOGO_MAX_SHAPES },
    { rule: "LOGO_LINE", status: measuredLine ? "pass" : "fail", measured: Math.max(widths.size, corners.size), limit: 1 },
    { rule: "LOGO_NEGATIVE_SPACE", status: "self_check" },
    { rule: "LOGO_GRID", status: gridShare >= CSS_LOGO_GRID_SHARE ? "pass" : "fail", measured: Math.round(gridShare * 100) / 100, limit: Math.round(CSS_LOGO_GRID_SHARE * 100) / 100 },
    Number.isFinite(thinnestAtSmallest)
      ? { rule: "LOGO_COUNTERS", status: thinnestAtSmallest >= 1 ? "pass" : "fail", measured: Math.round(thinnestAtSmallest * 100) / 100, limit: 1 }
      : { rule: "LOGO_COUNTERS", status: "self_check" },
    { rule: "LOGO_COLOR", status: colors.size >= 1 && colors.size <= CSS_LOGO_MAX_COLORS ? "pass" : "fail", measured: colors.size, limit: CSS_LOGO_MAX_COLORS },
    { rule: "LOGO_SIMPLIFY", status: "self_check" },
  ];
}

export function checkCssLogos(html: string): readonly (readonly CssLogoRuleResult[])[] {
  return parse(html).querySelectorAll("svg[data-bg-css-logo]").map(checkCssLogoSvg);
}
