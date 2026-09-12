/**
 * Brand palette surfaced by the Tweaks color picker. Mirrors the raw
 * scale in `src/index.css` so swatches pick from the same well as the
 * semantic tokens (--primary, --accent, etc.). Kept as a literal list
 * — not parsed from the stylesheet — so the picker works in SSR /
 * test contexts where CSS variables haven't been evaluated.
 */
import type { MessageKey } from "@/i18n/t";

export interface PaletteSwatch {
  name: string;
  hex: string;
}

export interface PaletteGroup {
  title: MessageKey;
  swatches: PaletteSwatch[];
}

export const BRAND_PALETTE: PaletteGroup[] = [
  {
    title: "modes.palette.grey",
    swatches: [
      { name: "white", hex: "#ffffff" },
      { name: "grey-50", hex: "#f1f3f5" },
      { name: "grey-100", hex: "#dce4ea" },
      { name: "grey-150", hex: "#e2e7ec" },
      { name: "grey-200", hex: "#bbc5cc" },
      { name: "grey-300", hex: "#a6aeb2" },
      { name: "grey-400", hex: "#9fa8ad" },
      { name: "grey-500", hex: "#757b80" },
      { name: "grey-600", hex: "#5e646c" },
      { name: "grey-700", hex: "#464a4d" },
      { name: "grey-800", hex: "#2f3133" },
      { name: "grey-900", hex: "#17191a" },
      { name: "black", hex: "#111111" },
    ],
  },
  {
    title: "modes.palette.blue",
    swatches: [
      { name: "blue-50", hex: "#ecf4ff" },
      { name: "blue-100", hex: "#ddebff" },
      { name: "blue-200", hex: "#bcd8ff" },
      { name: "blue-300", hex: "#6d95ff" },
      { name: "blue-400", hex: "#4062ff" },
      { name: "blue-500", hex: "#004fff" },
      { name: "blue-600", hex: "#2455d9" },
      { name: "blue-700", hex: "#0335e2" },
      { name: "blue-800", hex: "#002ad6" },
      { name: "blue-900", hex: "#0014c4" },
    ],
  },
  {
    title: "modes.palette.accent",
    swatches: [
      { name: "green-500", hex: "#00ce78" },
      { name: "red-500", hex: "#ff524c" },
      { name: "orange-500", hex: "#ff7659" },
      { name: "yellow-100", hex: "#fff5e4" },
      { name: "yellow-500", hex: "#fca63d" },
    ],
  },
];
