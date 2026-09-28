import type { CssDeclarationEvidence } from "./extraction-css";

export type SourceLayoutMeasurement = {
  /** Only values actually observed in the source; callers fall back to scaffold defaults for the rest. */
  readonly tokens: Readonly<Record<string, string>>;
};

const px = (value: string): number | null => {
  const match = /^(-?\d*\.?\d+)(px|rem|em)$/i.exec(value.trim());
  if (!match) return null;
  const number = Number(match[1]) * (match[2]!.toLowerCase() === "px" ? 1 : 16);
  return Number.isFinite(number) ? Math.round(number) : null;
};

/** Most frequent value; ties go to the larger value so the result does not depend on source order. */
function mode(values: readonly number[]): number | null {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: number | null = null;
  for (const [value, count] of counts) {
    const bestCount = best === null ? 0 : counts.get(best)!;
    if (count > bestCount || (count === bestCount && best !== null && value > best)) best = value;
  }
  return best;
}

const firstLength = (value: string): number | null => px(value.trim().split(/\s+/)[0] ?? "");

/**
 * Measures the page grid from parsed source CSS: container width from max-width, breakpoints from
 * media-query width conditions, page columns from repeat(), gutter from column gaps, section rhythm
 * from large vertical padding, and the spacing scale from margin/padding/gap lengths.
 */
export function measureSourceLayout(declarations: readonly CssDeclarationEvidence[], spacingValues: readonly string[]): SourceLayoutMeasurement {
  const tokens: Record<string, string> = {};
  const values = (properties: readonly string[]) => declarations.filter(item => properties.includes(item.property.toLowerCase())).map(item => item.value);

  const container = mode(values(["max-width"]).map(px).filter((value): value is number => value !== null && value >= 720 && value <= 1680));
  if (container !== null) tokens["--layout-max"] = `${container}px`;

  const columns = values(["grid-template-columns"]).flatMap(value => [...value.matchAll(/repeat\(\s*(\d{1,2})\s*,/gi)].map(match => Number(match[1])));
  const pageColumns = columns.filter(count => count >= 8 && count <= 24);
  if (pageColumns.length) tokens["--layout-columns"] = String(Math.max(...pageColumns));

  const gutter = mode(values(["column-gap", "gap", "grid-gap", "grid-column-gap"]).map(value => firstLength(value.split(/\s+/).at(-1) ?? "")).filter((value): value is number => value !== null && value >= 8 && value <= 64));
  if (gutter !== null) tokens["--layout-gutter"] = `${gutter}px`;

  const vertical = [
    ...values(["padding", "padding-block"]).map(firstLength),
    ...values(["padding-top", "padding-bottom", "padding-block-start", "padding-block-end"]).map(px),
  ].filter((value): value is number => value !== null && value >= 48 && value <= 200);
  const rhythm = mode(vertical);
  if (rhythm !== null) tokens["--layout-section-y"] = `clamp(${Math.round(rhythm * 0.6)}px, 8vw, ${rhythm}px)`;

  // One sample per declaration, so a breakpoint that wraps more rules weighs more.
  const breakpoints = declarations
    .flatMap(item => [...item.context.matchAll(/(?:min-width|max-width)\s*:\s*(\d*\.?\d+(?:px|rem|em))|width\s*[<>]=?\s*(\d*\.?\d+(?:px|rem|em))/gi)])
    .map(match => px(match[1] ?? match[2] ?? ""))
    .filter((value): value is number => value !== null);
  const md = mode(breakpoints.filter(value => value >= 560 && value <= 1024));
  if (md !== null) {
    tokens["--layout-bp-md"] = `${md}px`;
    const lg = mode(breakpoints.filter(value => value - md >= 160 && value <= 1600));
    if (lg !== null) tokens["--layout-bp-lg"] = `${lg}px`;
  }

  const lengths = [...new Set(spacingValues.flatMap(value => value.trim().split(/\s+/)).map(px).filter((value): value is number => value !== null && value >= 2 && value <= 160))].sort((a, b) => a - b);
  // Sample evenly so a long list keeps both its smallest and its largest steps.
  const scale = lengths.length <= 10 ? lengths : [...new Set(Array.from({ length: 10 }, (_, index) => lengths[Math.round(index * (lengths.length - 1) / 9)]!))];
  if (scale.length >= 3) tokens["--layout-spacing-scale"] = scale.map(value => `${value}px`).join(" ");

  return { tokens };
}
