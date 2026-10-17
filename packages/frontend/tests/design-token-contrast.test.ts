import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import config from "../tailwind.config";

type Rgb = readonly [number, number, number];
type Theme = "light" | "dark";

const CSS = readFileSync(path.join(import.meta.dir, "../src/index.css"), "utf8");

/** Reads the "--name: r g b;" triples from one theme block of src/index.css. */
function readTokens(theme: Theme): Map<string, Rgb> {
  const header = theme === "light" ? ":root {" : ':root[data-theme="dark"] {';
  const start = CSS.indexOf(header);
  if (start < 0) throw new Error(`missing theme block ${theme}`);
  const block = CSS.slice(start, CSS.indexOf("\n  }", start));
  const tokens = new Map<string, Rgb>();
  for (const match of block.matchAll(/--([a-z-]+):\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*;/g)) {
    tokens.set(match[1]!, [Number(match[2]), Number(match[3]), Number(match[4])]);
  }
  return tokens;
}

const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb): number => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = luminance(a) >= luminance(b) ? [luminance(a), luminance(b)] : [luminance(b), luminance(a)];
  return (hi + 0.05) / (lo + 0.05);
}
const over = (fg: Rgb, alpha: number, bg: Rgb): Rgb => [0, 1, 2].map((i) => fg[i]! * alpha + bg[i]! * (1 - alpha)) as unknown as Rgb;

const THEMES: readonly Theme[] = ["light", "dark"];
const tokensByTheme: Record<Theme, Map<string, Rgb>> = { light: readTokens("light"), dark: readTokens("dark") };
function token(theme: Theme, name: string): Rgb {
  const value = tokensByTheme[theme].get(name);
  if (value === undefined) throw new Error(`token --${name} is not defined in the ${theme} theme`);
  return value;
}

// Regular text below 18px needs 4.5:1 (WCAG 1.4.3).
const TEXT_PAIRS: readonly (readonly [string, string])[] = [
  ["foreground", "background"], ["foreground", "card"], ["card-foreground", "card"], ["popover-foreground", "popover"],
  ["muted-foreground", "background"], ["muted-foreground", "card"], ["muted-foreground", "muted"],
  ["primary-foreground", "primary"], ["secondary-foreground", "secondary"], ["accent-foreground", "accent"],
  ["destructive-foreground", "destructive"], ["success-foreground", "success"], ["warning-foreground", "warning"],
  ["accent", "card"], ["accent", "background"], ["accent", "accent-soft"],
  ["success-text", "card"], ["success-text", "background"], ["success-text", "muted"],
  ["warning-text", "card"], ["warning-text", "background"], ["warning-text", "muted"],
  ["destructive", "card"],
];

describe("design token contrast", () => {
  for (const theme of THEMES) {
    for (const [fg, bg] of TEXT_PAIRS) {
      test(`Given the ${theme} theme When --${fg} is drawn on --${bg} Then the ratio is at least 4.5`, () => {
        expect(contrast(token(theme, fg), token(theme, bg))).toBeGreaterThanOrEqual(4.5);
      });
    }

    test(`Given the ${theme} theme When a control edge sits on card, background or muted Then --input reaches 3:1 on card and background`, () => {
      expect(contrast(token(theme, "input"), token(theme, "card"))).toBeGreaterThanOrEqual(3);
      expect(contrast(token(theme, "input"), token(theme, "background"))).toBeGreaterThanOrEqual(3);
    });

    test(`Given the ${theme} theme When the focus ring is drawn Then --ring reaches 3:1 on background and card`, () => {
      expect(contrast(token(theme, "ring"), token(theme, "background"))).toBeGreaterThanOrEqual(3);
      expect(contrast(token(theme, "ring"), token(theme, "card"))).toBeGreaterThanOrEqual(3);
    });

    test(`Given the ${theme} theme When a button is disabled Then its label (--muted-foreground on --muted) keeps 3:1`, () => {
      expect(contrast(token(theme, "muted-foreground"), token(theme, "muted"))).toBeGreaterThanOrEqual(3);
    });

    test(`Given the ${theme} theme When status text sits on its own translucent fill over card Then it keeps 4.5:1`, () => {
      for (const [text, fill, alpha] of [["warning-text", "warning", 0.15], ["warning-text", "warning", 0.1], ["success-text", "success", 0.1]] as const) {
        const surface = over(token(theme, fill), alpha, token(theme, "card"));
        expect(contrast(token(theme, text), surface)).toBeGreaterThanOrEqual(4.5);
      }
    });

    test(`Given the ${theme} theme When --accent-soft is used as a selected fill Then it differs from card and --input stays a visible edge on it`, () => {
      expect(token(theme, "accent-soft")).not.toEqual(token(theme, "card"));
      expect(contrast(token(theme, "input"), token(theme, "accent-soft"))).toBeGreaterThanOrEqual(2);
    });
  }

  test("Given both themes When the semantic text-safe tokens are listed Then each theme defines the same token names", () => {
    expect([...tokensByTheme.dark.keys()].filter((name) => !name.startsWith("color-") && !tokensByTheme.light.has(name))).toEqual([]);
    for (const name of ["accent-soft", "success-text", "warning-text", "input"]) {
      expect(tokensByTheme.light.has(name)).toBe(true);
      expect(tokensByTheme.dark.has(name)).toBe(true);
    }
  });

  test("Given tailwind.config When the new tokens are resolved Then each maps to its css variable", () => {
    const colors = (config.theme?.extend?.colors ?? {}) as Record<string, Record<string, string>>;
    expect(colors.accent?.soft).toContain("var(--accent-soft)");
    expect(colors.success?.text).toContain("var(--success-text)");
    expect(colors.warning?.text).toContain("var(--warning-text)");
  });
});
