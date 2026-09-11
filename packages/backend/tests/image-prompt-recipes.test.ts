import { expect, test } from "bun:test";
import { IMAGE_PROMPT_RECIPES, IMAGE_RECIPE_GROUPS, parseGenerationStyle } from "@bg/shared";
import { appendImageProduction, IMAGE_PRODUCTION_RULES } from "../src/harness/prompt-image-production";

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
