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
  const heroRatio = (t["--layout-hero-media-ratio"] ?? t["--layout-hero"] ?? "16 / 10").split("/").map(Number);
  const ratio = heroRatio.length === 2 && heroRatio.every(n => Number.isFinite(n) && n > 0) ? heroRatio[0]! / heroRatio[1]! : 1.6;
  const heroHeight = Math.min(140, Math.max(70, width * 0.5 / ratio));
  const blocks: { role: "navigation" | "message" | "media" | "support" | "footer"; x: number; y: number; width: number; height: number }[] = [];
  const add = (role: typeof blocks[number]["role"], bx: number, y: number, bw: number, height: number) => blocks.push({ role, x: bx, y, width: Math.max(1, bw), height });
  if (t["--layout-nav-pattern"] || t["--layout-hero-pattern"] || t["--layout-footer-pattern"]) {
    const navPosition = t["--layout-nav-position"] ?? "top";
    const navHeight = number("--layout-nav-height", number("--layout-nav-h", 64, 32, 100), 32, 100) * scale;
    const navWidth = Math.min(width, number("--layout-nav-width", 1440, 80, 1440) * scale);
    const sideWidth = Math.min(width * 0.3, navWidth);
    const bodyX = navPosition === "side" ? x + sideWidth + gap : x;
    const bodyWidth = width - (bodyX - x);
    const footerHeight = number("--layout-footer-height", 100, 48, 180) * scale;
    const footerY = 300 - footerHeight - (navPosition === "bottom" ? navHeight + 8 : 0);
    const heroY = 72 + (navPosition === "top" ? navHeight + 10 : 0);
    const heroHeight = Math.min(footerY - heroY - 32, number("--layout-hero-min-height", 400, 120, 1000) * scale);
    const copyRatio = number("--layout-hero-copy-ratio", 42, 20, 80) / 100;
    const align = t["--layout-hero-align"] === "center" ? 0.5 : t["--layout-hero-align"] === "end" ? 1 : 0;
    const mediaPosition = t["--layout-hero-media-position"] ?? "right";
    const offset = number("--layout-hero-offset", 0, -120, 120) * scale;
    const message = (left: number, top: number, availableWidth: number, height: number) => {
      const messageWidth = Math.min(availableWidth, number("--layout-hero-title-measure", 30, 8, 90) * 4);
      add("message", left + (availableWidth - messageWidth) * align, top, messageWidth, height);
    };
    if (mediaPosition === "background") {
      add("media", bodyX, heroY, bodyWidth, heroHeight);
      message(bodyX + bodyWidth * (1 - copyRatio) * align, heroY + heroHeight * 0.25, bodyWidth * copyRatio, heroHeight * 0.5);
    } else if (mediaPosition === "below") {
      message(bodyX, heroY, bodyWidth, 30);
      add("media", bodyX, heroY + 38, bodyWidth, Math.max(1, Math.min(heroHeight - 38, bodyWidth / ratio)));
    } else {
      const copyWidth = bodyWidth * copyRatio - gap / 2;
      const mediaWidth = bodyWidth - copyWidth - gap;
      const mediaHeight = Math.min(heroHeight, Math.max(40, mediaWidth / ratio));
      const mediaX = mediaPosition === "left" ? bodyX : bodyX + copyWidth + gap;
      const copyX = mediaPosition === "left" ? bodyX + mediaWidth + gap : bodyX;
      add("media", mediaX, heroY + Math.min(heroHeight - mediaHeight, Math.max(0, offset)), mediaWidth, mediaHeight);
      message(copyX, heroY + Math.min(heroHeight * 0.3, Math.max(0, -offset)), copyWidth, Math.min(60, heroHeight * 0.7));
    }
    add("support", bodyX, footerY - 24, bodyWidth, 14);
    const footerColumns = Math.round(number("--layout-footer-columns", 3, 1, 6));
    const footerGap = Math.min(gap, bodyWidth / (footerColumns * 2));
    const footerWidth = (bodyWidth - footerGap * (footerColumns - 1)) / footerColumns;
    for (let index = 0; index < footerColumns; index++) add("footer", bodyX + index * (footerWidth + footerGap), footerY, footerWidth, footerHeight);
    if (navPosition === "side") add("navigation", x, 72, sideWidth, 228);
    else add("navigation", x + (width - navWidth) / 2, navPosition === "bottom" ? 300 - navHeight : 72, navWidth, navHeight);
    return { columns, x, width, gap, unit, blocks };
  }
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
