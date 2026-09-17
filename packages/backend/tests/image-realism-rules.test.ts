import { beforeAll, describe, expect, test } from "bun:test";
import { IMAGE_STYLE_PRESETS, isPhotographicImageStyle, parseGenerationStyle } from "@bg/shared";
import { getSqlite } from "../src/db/sqlite-client";
import { DESIGN_CRAFT_RULES } from "../src/harness/design-craft";
import { buildPrompt } from "../src/harness/prompt-builder";
import { appendGenerationStyle } from "../src/harness/prompt-generation-style";
import { appendImageProduction } from "../src/harness/prompt-image-production";
import { IMAGE_REALISM_RULES, PHOTOREALISM_PROMPT_BLOCKLIST } from "../src/harness/prompt-image-realism";
import { ensureLearningSchema } from "./learning-fixture";

type BuildContext = Parameters<typeof buildPrompt>[0];

beforeAll(() => ensureLearningSchema(getSqlite()));

function makeContext(overrides: Partial<BuildContext["project"]> = {}): BuildContext {
  return {
    project: { project_id: "p1", project_name: "Realism", project_type: "prototype", entrypoint: "index.html", project_dir: "/tmp/p1", options_json: null, ...overrides },
    files: [],
    attachments: [],
    designSystem: null,
    openComments: [],
  } as BuildContext;
}

describe("image realism contract", () => {
  test("Given the realism rules, Then photorealism is the default and abstract imagery is prohibited", () => {
    expect(IMAGE_REALISM_RULES).toContain("photorealistic photography");
    expect(IMAGE_REALISM_RULES).toContain("Abstract imagery is prohibited");
    expect(IMAGE_REALISM_RULES).toContain("gradient blobs");
    expect(IMAGE_REALISM_RULES).toContain("plastic or airbrushed skin");
    expect(IMAGE_REALISM_RULES).toContain("lens");
    expect(IMAGE_REALISM_RULES).toContain("regenerate");
    for (const term of PHOTOREALISM_PROMPT_BLOCKLIST) expect(IMAGE_REALISM_RULES).toContain(term);
    expect(PHOTOREALISM_PROMPT_BLOCKLIST).toEqual(expect.arrayContaining(["abstract", "8k", "concept art", "ethereal"]));
    expect(IMAGE_REALISM_RULES.length).toBeLessThan(3200);
  });

  test("Given the craft rules, Then the realism contract is emitted exactly once inside them", () => {
    expect(DESIGN_CRAFT_RULES.split(IMAGE_REALISM_RULES)).toHaveLength(2);
    expect(DESIGN_CRAFT_RULES.indexOf("Default to photorealistic photography")).toBeGreaterThan(-1);
  });

  test("Given every project type, When the prompt is built, Then the realism contract appears once before delivery", async () => {
    for (const project_type of ["prototype", "slide_deck", "graphic"] as const) {
      const options_json = project_type === "graphic" ? JSON.stringify({ graphic_canvas: { schema_version: 1, width: 1080, height: 1350 } }) : null;
      const prompt = await buildPrompt(makeContext({ project_type, options_json }), { type: "user.message", text: "Make it" } as never);
      expect(prompt.split(IMAGE_REALISM_RULES)).toHaveLength(2);
      expect(prompt.indexOf(IMAGE_REALISM_RULES)).toBeLessThan(prompt.indexOf("## Delivery"));
    }
  });

  test("Given the image style presets, Then every preset declares a family and the brand default is photographic", () => {
    const families = new Set<string>();
    for (const [key, preset] of Object.entries(IMAGE_STYLE_PRESETS)) {
      expect(["photographic", "rendered", "handmade"]).toContain(preset.family);
      families.add(preset.family);
      expect(isPhotographicImageStyle(key as keyof typeof IMAGE_STYLE_PRESETS)).toBe(preset.family === "photographic");
    }
    expect([...families].sort()).toEqual(["handmade", "photographic", "rendered"]);
    expect(IMAGE_STYLE_PRESETS.brand.family).toBe("photographic");
    expect(IMAGE_STYLE_PRESETS.brand.prompt).toContain("photorealistic");
    expect(IMAGE_STYLE_PRESETS.illustration.family).toBe("handmade");
    expect(IMAGE_STYLE_PRESETS.three_d.family).toBe("rendered");
  });

  test("Given a saved style, When appended, Then a non-photographic choice is marked as an explicit exception and a photographic one keeps the contract", () => {
    const photographic: string[] = [];
    appendGenerationStyle(photographic, parseGenerationStyle({ schema_version: 1, image_style: "studio", copy_tone: "brand" }));
    expect(photographic.join("\n")).toContain("photographic treatment; keep the realism contract in full");
    expect(photographic.join("\n")).not.toContain("explicitly selected a non-photographic treatment");

    const handmade: string[] = [];
    appendGenerationStyle(handmade, parseGenerationStyle({ schema_version: 1, image_style: "watercolor", copy_tone: "brand" }));
    expect(handmade.join("\n")).toContain("explicitly selected a non-photographic treatment");
    expect(handmade.join("\n")).toContain("Abstract decoration stays prohibited");
  });

  test("Given automatic recipes, Then the production rules prefer photographic recipes and stay bounded", () => {
    const lines: string[] = [];
    appendImageProduction(lines);
    const text = lines.join("\n");
    expect(text).toContain("preferring photographic recipes");
    expect(text.length).toBeLessThan(16000);
    const selected: string[] = [];
    appendImageProduction(selected, "portrait");
    expect(selected.join("\n").length).toBeLessThan(4000);
  });

  test("Given a product-detail graphic, When the prompt is built, Then section imagery must be photographic and never abstract", async () => {
    const options_json = JSON.stringify({
      graphic_canvas: { schema_version: 1, width: 860, height: 12_000 },
      graphic_set: { schema_version: 1, kind: "product_detail", frame_count: 1 },
    });
    const prompt = await buildPrompt(makeContext({ project_type: "graphic", options_json }), { type: "user.message", text: "상세페이지" } as never);
    expect(prompt).toContain("photographic product and usage imagery by default");
    expect(prompt).toContain("never fill a section with abstract or gradient art");
    expect(prompt).toContain("every product-detail section must contain a relevant, visible image");
  });
});
