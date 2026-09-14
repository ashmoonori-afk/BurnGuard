import type { DesignSystemLayout } from "./design-system-layout";

// Structural summary only: prose composition rules remain authoritative for generation.
export function designSystemLayoutPreview(layout: DesignSystemLayout) {
  const t = layout.tokens;
  const number = (key: string, fallback: number, min: number, max: number) => {
    const value = Number.parseFloat(t[key] ?? "");
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  };
  const columns = Math.round(number("--layout-columns", 12, 1, 24));
  const max = number("--layout-max", 1200, 320, 2400);
  const scale = 544 / 1440;
  const width = Math.min(544, max * scale);
  const x = (640 - width) / 2;
  const gap = Math.min(number("--layout-gutter", 24, 0, 80) * scale, width / (columns * 2));
  const unit = (width - gap * (columns - 1)) / columns;
  const structure = t["--layout-structure"] ?? (t["--family-ui-navigation-placement"] === "side" ? "sidebar" : "split");
  const heroRatio = (t["--layout-hero"] ?? "16 / 10").split("/").map(Number);
  const ratio = heroRatio.length === 2 && heroRatio.every(n => Number.isFinite(n) && n > 0) ? heroRatio[0]! / heroRatio[1]! : 1.6;
  const heroHeight = Math.min(140, Math.max(70, width * 0.5 / ratio));
  const blocks: { role: "navigation" | "message" | "media" | "support"; x: number; y: number; width: number; height: number }[] = [];
  const add = (role: typeof blocks[number]["role"], bx: number, y: number, bw: number, height: number) => blocks.push({ role, x: bx, y, width: Math.max(1, bw), height });
  if (structure === "sidebar") {
    const span = number("--family-ui-navigation-span", 2, 1, Math.max(1, columns / 3));
    const rail = (unit + gap) * span - gap;
    add("navigation", x, 72, rail, 228);
    add("message", x + rail + gap, 72, width - rail - gap, 42);
    add("media", x + rail + gap, 126, width - rail - gap, 120);
    add("support", x + rail + gap, 258, width - rail - gap, 42);
  } else {
    add("navigation", x, 72, width, 16);
    if (structure === "centered" || structure === "editorial") {
      add("message", x + width * 0.15, 102, width * 0.7, 36);
      add("media", x, 150, width, Math.min(heroHeight, 106));
    } else {
      add("message", x, 104, width * 0.4 - gap / 2, 84);
      add("media", x + width * 0.4 + gap / 2, structure === "offset" ? 122 : 104, width * 0.6 - gap / 2, heroHeight);
    }
    add("support", x, 276, width, 24);
  }
  return { columns, x, width, gap, unit, blocks };
}
