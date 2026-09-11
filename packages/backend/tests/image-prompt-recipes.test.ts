import { expect, test } from "bun:test";
import { IMAGE_PROMPT_RECIPES, IMAGE_RECIPE_GROUPS, IMAGE_STYLE_PRESETS, parseGenerationStyle } from "@bg/shared";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { appendImageProduction, IMAGE_PRODUCTION_RULES } from "../src/harness/prompt-image-production";
import { parsePng } from "../src/services/export-png-validation";

test("Given the image recipe catalog When selected or automatically included Then all categories are usable within a bounded prompt", () => {
  const groups = new Set(Object.values(IMAGE_PROMPT_RECIPES).map(recipe => recipe.group));
  expect([...groups].sort()).toEqual(Object.keys(IMAGE_RECIPE_GROUPS).sort());
  const all: string[] = []; appendImageProduction(all);
  expect(all.join("\n").length).toBeLessThan(16000);
  expect(all.filter(line => line === IMAGE_PRODUCTION_RULES)).toHaveLength(1);
  for (const [id, recipe] of Object.entries(IMAGE_PROMPT_RECIPES)) {
    const selection = parseGenerationStyle({ schema_version: 1, image_style: "watercolor", copy_tone: "calm", image_recipe: id });
    expect(selection.image_recipe).toBe(id);
    const selected: string[] = []; appendImageProduction(selected, selection.image_recipe);
    expect(selected.filter(line => /^[a-z_]+ \|/.test(line))).toEqual([`${id} | ${recipe.label}: ${recipe.prompt}`]);
    expect(selected.join("\n").length).toBeLessThan(4000);
    expect(all).toContain(`${id} | ${recipe.label}: ${recipe.prompt}`);
  }
  const legacy = { schema_version: 1, image_style: "brand", copy_tone: "brand" };
  expect(parseGenerationStyle(legacy)).toEqual(legacy);
  expect(parseGenerationStyle({ ...legacy, image_recipe: "auto" }).image_recipe).toBe("auto");
  for (const image_recipe of [null, "", "constructor", "__proto__", "unknown", {}, ["portrait"], "</script>"]) {
    expect(() => parseGenerationStyle({ ...legacy, image_recipe })).toThrow();
  }
});

test("Given the documented image examples When checked against the catalog Then every style and domain has a distinct intact asset and exact prompt", () => {
  const directory = new URL("../../../doc/images/image-recipes/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("prompts.json", directory), "utf8")) as {
    shared_prompt: string;
    examples: { id: string; style: string; recipe: string; asset: string; prompt: string;
      output: { width: number; height: number; bytes: number; sha256: string } }[];
  };
  const gallery = readFileSync(new URL("README.md", directory), "utf8");
  expect(manifest.shared_prompt.length).toBeGreaterThan(100);
  expect(manifest.examples.map(example => example.style).sort()).toEqual(Object.keys(IMAGE_STYLE_PRESETS).sort());
  const groups = new Set<string>();
  const hashes = new Set<string>();
  for (const example of manifest.examples) {
    const selection = parseGenerationStyle({ schema_version: 1, image_style: example.style, copy_tone: "brand", image_recipe: example.recipe });
    if (!selection.image_recipe || selection.image_recipe === "auto") throw new Error("Examples need an explicit purpose");
    groups.add(IMAGE_PROMPT_RECIPES[selection.image_recipe].group);
    expect(example.asset).toMatch(/^\d{2}-[a-z-]+\.png$/);
    expect(example.asset).toBe(`${example.id}.png`);
    expect(example.prompt.length).toBeGreaterThan(100);
    expect(gallery).toContain(`](${example.asset})`);
    expect(gallery).toContain(example.prompt);
    const bytes = readFileSync(new URL(example.asset, directory));
    const dimensions = parsePng(bytes);
    expect(dimensions.width).toBe(dimensions.height);
    expect(dimensions.width).toBeGreaterThanOrEqual(1024);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    expect(example.output).toEqual({ ...dimensions, bytes: bytes.length, sha256 });
    hashes.add(sha256);
  }
  expect(hashes.size).toBe(manifest.examples.length);
  expect([...groups].sort()).toEqual(Object.keys(IMAGE_RECIPE_GROUPS).sort());
}, 30_000);
