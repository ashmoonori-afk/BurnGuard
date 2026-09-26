import { describe, expect, test } from "bun:test";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import type { ProjectType } from "@bg/shared";
import tailwindConfig from "../tailwind.config";
import { projectToCard, systemToCard } from "../src/components/home/mappers";

const PROJECT_TYPES: readonly ProjectType[] = ["prototype", "slide_deck", "graphic", "logo", "from_template", "other"];

async function compileUtilities(markup: string): Promise<string> {
  const result = await postcss([
    tailwindcss({ ...tailwindConfig, content: [{ raw: markup }] }),
  ]).process("@tailwind utilities;", { from: undefined });
  return result.css;
}

function variableNames(block: string): readonly string[] {
  return [...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]!);
}

function cssBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new TypeError(`missing block ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

describe("dark theme selector (UX-02)", () => {
  test("Given the app keys dark tokens on data-theme When a dark: utility compiles Then its selector matches the attribute, never a .dark class", async () => {
    const css = await compileUtilities('<div class="dark:bg-blue-950/50"></div>');
    expect(css).toContain(':where([data-theme="dark"], [data-theme="dark"] *)');
    expect(css).not.toContain(".dark *");
  });
});

describe("theme token coverage (UX-32)", () => {
  test("Given the semantic tokens of :root When the dark block is read Then every one of them is redefined there", async () => {
    const css = await Bun.file(new URL("../src/index.css", import.meta.url)).text();
    const light = variableNames(cssBlock(css, ":root")).filter((name) => !name.startsWith("--color-") && name !== "--radius");
    const dark = new Set(variableNames(cssBlock(css, ':root[data-theme="dark"]')));
    expect(light.length).toBeGreaterThan(0);
    expect(light.filter((name) => !dark.has(name))).toEqual([]);
  });

  test.each(PROJECT_TYPES)("Given a %s project When mapped to a card Then its tint is a theme token, not a raw palette shade", (type) => {
    const card = projectToCard({ id: "p", name: "n", type, design_system_id: null, design_system_name: null, thumbnail_path: null, updated_at: 0, archived_at: null });
    expect(card.tintClass).toMatch(/^bg-tint-[a-z]+$/);
  });

  test("Given four design systems When mapped Then each tint is a theme token and the cycle stays distinct", () => {
    const tints = [0, 1, 2, 3].map((index) => systemToCard({ id: `s${index}`, name: "s", status: "published", is_template: false, thumbnail_path: null, updated_at: 0 }, index).tintClass);
    expect(new Set(tints).size).toBe(4);
    for (const tint of tints) expect(tint).toMatch(/^bg-tint-[a-z]+$/);
  });

  test("Given the tint utilities When compiled Then each resolves through a --tint variable defined for both themes", async () => {
    const tints = [...PROJECT_TYPES.map((type) => projectToCard({ id: "p", name: "n", type, design_system_id: null, design_system_name: null, thumbnail_path: null, updated_at: 0, archived_at: null }).tintClass), ...[0, 1, 2, 3].map((index) => systemToCard({ id: "s", name: "s", status: "published", is_template: false, thumbnail_path: null, updated_at: 0 }, index).tintClass)];
    const css = await compileUtilities(`<div class="${tints.join(" ")}"></div>`);
    const index = await Bun.file(new URL("../src/index.css", import.meta.url)).text();
    const dark = new Set(variableNames(cssBlock(index, ':root[data-theme="dark"]')));
    const light = new Set(variableNames(cssBlock(index, ":root")));
    for (const tint of new Set(tints)) {
      const variable = `--tint-${tint.slice("bg-tint-".length)}`;
      expect(css).toContain(`var(${variable})`);
      expect(light.has(variable), variable).toBe(true);
      expect(dark.has(variable), variable).toBe(true);
    }
  });
});
