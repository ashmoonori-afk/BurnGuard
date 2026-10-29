import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import config from "../tailwind.config";

const SRC = path.join(import.meta.dir, "../src");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}
const SOURCES = walk(SRC).map((file) => ({ rel: path.relative(path.join(SRC, ".."), file).split(path.sep).join("/"), text: readFileSync(file, "utf8") }));

// Files allowed to keep raw palette classes. Each entry needs a reason; canvas user-content defaults are not Tailwind classes.
const RAW_PALETTE_ALLOWLIST: ReadonlyMap<string, string> = new Map([
  ["src/views/HomeView.tsx", "project-type tiles, owned by the home/shell work package"],
]);

/** Colour names the config defines: "accent", "accent-foreground", "tint-rose", "brand-500", ... */
function definedColours(): Set<string> {
  const names = new Set<string>();
  const colors = (config.theme?.extend?.colors ?? {}) as Record<string, string | Record<string, string>>;
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value === "string") names.add(key);
    else for (const sub of Object.keys(value)) names.add(sub === "DEFAULT" ? key : `${key}-${sub}`);
  }
  return names;
}

/** Tailwind default colours that product code may use without a config entry. */
const TAILWIND_DEFAULT_ALLOWLIST: ReadonlySet<string> = new Set(["white", "black", "transparent", "current", "inherit"]);

const COLOUR_PREFIX = "(?:ring-offset|bg|text|border|ring|fill|stroke|divide|outline|from|to|via|placeholder)";
const UTILITY = new RegExp(`(?<![\\w\\-/\\[.$#])(${COLOUR_PREFIX})-([a-z][a-z0-9-]*)(?:/[\\w.\\[\\]%]+)?(?![\\w\\-\\[:$])`, "g");

// Utilities that share a colour prefix but set something else (size, alignment, style, side, gradient direction ...).
const NON_COLOUR: Record<string, RegExp> = {
  text: /^(?:xs|sm|base|lg|xl|[2-9]xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/,
  bg: /^(?:cover|contain|center|top|bottom|left|right|(?:left|right)-(?:top|bottom)|(?:top|bottom)-(?:left|right)|no-repeat|repeat(?:-.*)?|fixed|local|scroll|clip-.*|origin-.*|blend-.*|gradient-.*|none|auto|opacity-.*)$/,
  border: /^(?:solid|dashed|dotted|double|none|hidden|collapse|separate|spacing.*|opacity-.*)$/,
  ring: /^(?:inset|offset-\d.*)$/,
  divide: /^(?:solid|dashed|dotted|double|none|opacity-.*)$/,
  outline: /^(?:none|dashed|dotted|double|hidden|offset-.*)$/,
  fill: /^(?:none)$/,
  stroke: /^(?:none)$/,
};
// Words that match the utility shape but are CSS property names or identifiers in strings, not classes.
const NOT_A_CLASS: ReadonlySet<string> = new Set([
  "border-box", "border-radius", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dashoffset", "stroke-dash",
  "text-size", "text-free", "text-stroke", "outline-spotlight-fill-text", "bg-star-prompt-title",
]);
const SIDE = /^(?:[trblxyse])(?:-(.+))?$/;

type Use = { readonly rel: string; readonly klass: string; readonly colour: string };

function colourUses(): Use[] {
  const uses: Use[] = [];
  for (const { rel, text } of SOURCES) {
    if (RAW_PALETTE_ALLOWLIST.has(rel)) continue;
    for (const match of text.matchAll(UTILITY)) {
      if (NOT_A_CLASS.has(match[0].replace(/\/.*$/, ""))) continue;
      const prefix = match[1]!;
      let name = match[2]!;
      if (prefix === "border" || prefix === "divide") {
        const side = SIDE.exec(name);
        if (side !== null) {
          if (side[1] === undefined || /^\d/.test(side[1]) || side[1] === "reverse") continue;
          name = side[1];
        }
      }
      if (NON_COLOUR[prefix]?.test(name) === true) continue;
      uses.push({ rel, klass: match[0], colour: name });
    }
  }
  return uses;
}

describe("colour utilities resolve to defined tokens", () => {
  test("Given a URL fragment and actual color classes When scanned Then only the classes require tokens", () => {
    const uses = [..."bg-palette #bg-palette=payload bg-card".matchAll(UTILITY)];
    expect(uses.map(match => match[2])).toEqual(["palette", "card"]);
  });

  test("Given every source file When its colour utility classes are scanned Then each names a config token or an allowlisted Tailwind default", () => {
    const defined = definedColours();
    const unresolved = colourUses().filter((use) => !defined.has(use.colour) && !TAILWIND_DEFAULT_ALLOWLIST.has(use.colour));
    expect(unresolved.map((use) => `${use.rel}: ${use.klass}`)).toEqual([]);
  });

  test("Given the scan When it runs on the source tree Then it sees the known tokens (guards against a scan that matches nothing)", () => {
    const seen = new Set(colourUses().map((use) => use.colour));
    for (const name of ["accent", "muted-foreground", "border", "card", "background"]) expect(seen.has(name)).toBe(true);
  });

  test("Given the earlier undefined accent-soft class When the config is read Then it is now a defined colour", () => {
    expect(definedColours().has("accent-soft")).toBe(true);
  });
});

const RAW_PALETTE = /(?<![\w-])(?:bg|text|border|ring|ring-offset|fill|stroke|divide|outline|from|to|via|placeholder)-(?:red|amber|emerald|yellow|green|blue|orange|rose|sky|violet|purple|teal|lime|cyan|indigo|pink|slate|gray|zinc|neutral|stone)-\d/g;

describe("no raw palette classes in product chrome", () => {
  test("Given every source file When it is scanned for raw Tailwind palette classes Then only allowlisted files contain any", () => {
    const offenders = SOURCES.filter(({ rel, text }) => !RAW_PALETTE_ALLOWLIST.has(rel) && RAW_PALETTE.test(text.replaceAll("\n", " ")))
      .map(({ rel, text }) => `${rel}: ${[...text.matchAll(RAW_PALETTE)].map((m) => m[0]).join(", ")}`);
    expect(offenders).toEqual([]);
  });

  test("Given the allowlist When an entry is listed Then it carries a reason", () => {
    for (const [file, reason] of RAW_PALETTE_ALLOWLIST) {
      expect(file.startsWith("src/")).toBe(true);
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});
