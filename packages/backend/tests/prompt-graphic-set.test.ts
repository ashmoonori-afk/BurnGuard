import { beforeAll, describe, expect, test } from "bun:test";
import type { GraphicSetV1 } from "@bg/shared";
import { getSqlite } from "../src/db/sqlite-client";
import { buildPrompt } from "../src/harness/prompt-builder";
import { PROTOTYPE_NAVIGATION_CONTRACT } from "../src/harness/skills/prototype-skill";
import { ensureLearningSchema } from "./learning-fixture";

type BuildContext = Parameters<typeof buildPrompt>[0];

const canvas = { schema_version: 1, width: 1080, height: 1350 } as const;
const detailCanvas = { schema_version: 1, width: 860, height: 12_000 } as const;

beforeAll(() => ensureLearningSchema(getSqlite()));

function makeContext(overrides: Partial<BuildContext["project"]> = {}): BuildContext {
  return {
    project: {
      project_id: "p1",
      project_name: "Test project",
      project_type: "prototype",
      entrypoint: "index.html",
      project_dir: "/tmp/p1",
      options_json: null,
      ...overrides,
    },
    files: [],
    attachments: [],
    designSystem: null,
    openComments: [],
  } as BuildContext;
}

function graphicContext(graphicSet: GraphicSetV1, graphicCanvas: typeof canvas | typeof detailCanvas = canvas): BuildContext {
  return makeContext({
    project_type: "graphic",
    options_json: JSON.stringify({ graphic_canvas: graphicCanvas, graphic_set: graphicSet }),
  });
}

function outputBlock(prompt: string): Record<string, unknown> {
  const match = /<burnguard-graphic-output-v1>\n([^\n]+)\n<\/burnguard-graphic-output-v1>/u.exec(prompt);
  if (match?.[1] === undefined) throw new TypeError("graphic output block missing");
  const parsed: unknown = JSON.parse(match[1]);
  if (typeof parsed !== "object" || parsed === null) throw new TypeError("graphic output block is not an object");
  return { ...parsed };
}

function ruleKinds(prompt: string): readonly string[] {
  return [...prompt.matchAll(/<burnguard-graphic-rules-v1 kind="([a-z_]+)">/gu)].map((match) => match[1] ?? "");
}

async function promptFor(context: BuildContext, contextMode: "full" | "compact" = "full"): Promise<string> {
  return await buildPrompt(context, { type: "user.message", text: "카드뉴스를 만들어줘" }, { contextMode });
}

describe("graphic output prompt block", () => {
  test("Given a six-frame card news set When the prompt is built Then the block declares the frame contract and card news rules", async () => {
    // Given
    const context = graphicContext({ schema_version: 1, kind: "card_news", frame_count: 6 });

    // When
    const prompt = await promptFor(context);

    // Then
    expect(outputBlock(prompt)).toMatchObject({
      schema_version: 1,
      kind: "card_news",
      artboard_count: 6,
      delivery_format: "png_zip",
      frames: Array.from({ length: 6 }, (_unused, index) => ({
        sequence: index + 1,
        width_css_px: 1080,
        height_css_px: 1350,
        purpose: index === 0 ? "cover" : index === 5 ? "cta" : "message",
      })),
    });
    expect(ruleKinds(prompt)).toEqual(["card_news"]);
  });

  test("Given a 9:16 card news set When the prompt is built Then the safe zone is declared in machine-readable form", async () => {
    // Given
    const context = graphicContext(
      { schema_version: 1, kind: "card_news", frame_count: 3 },
      { schema_version: 1, width: 1080, height: 1920 },
    );

    // When
    const block = outputBlock(await promptFor(context));

    // Then
    expect(block["safe_zone_css_px"]).toEqual({ top: 250, bottom: 250 });
  });

  test("Given a banner set When the prompt is built Then every declared size becomes one artboard", async () => {
    // Given
    const context = graphicContext({
      schema_version: 1,
      kind: "banner_set",
      frame_count: 2,
      frames: [
        { width: 1200, height: 628, label: "wide" },
        { width: 1200, height: 1200, label: "square" },
      ],
    });

    // When
    const prompt = await promptFor(context);

    // Then
    expect(outputBlock(prompt)).toMatchObject({
      kind: "banner_set",
      artboard_count: 2,
      frames: [
        { sequence: 1, width_css_px: 1200, height_css_px: 628, purpose: "banner", label: "wide" },
        { sequence: 2, width_css_px: 1200, height_css_px: 1200, purpose: "banner", label: "square" },
      ],
    });
    expect(ruleKinds(prompt)).toEqual(["banner_set"]);
  });

  test("Given a product detail set with a brief When the prompt is built Then only that kind gets the detail rules and labelled brief lines", async () => {
    // Given
    const context = graphicContext(
      {
        schema_version: 1,
        kind: "product_detail",
        frame_count: 1,
        detail_brief: { persona_pain: "새벽마다 재고를 세는 사장님", urgency: "이번 주 입고분 한정" },
      },
      detailCanvas,
    );

    // When
    const prompt = await promptFor(context);
    const block = outputBlock(prompt);

    // Then
    expect(block).toMatchObject({ kind: "product_detail", artboard_count: 1, delivery_format: "png_zip" });
    expect(block["question_order"]).toEqual(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "features", "payment_cta"]);
    expect(block["forbidden_hero_openings"]).toContain("AI-based");
    expect(ruleKinds(prompt)).toEqual(["product_detail"]);
    expect(prompt).toContain("entire 12000 CSS px height");
    expect(prompt).not.toContain("free height");
    expect(prompt).not.toContain("change one region");
    expect(prompt).toContain("--page-background");
    expect(prompt).toContain("every product-detail section must contain a relevant, visible image");
    expect(prompt).toContain("exclusively with Codex image generation");
    expect(prompt).toContain("summarize and polish even a full 500-character field");
    expect(prompt).toContain("- detail_brief.persona_pain: 새벽마다 재고를 세는 사장님");
    expect(prompt).toContain("- detail_brief.urgency: 이번 주 입고분 한정");
    expect(prompt).not.toContain("- detail_brief.evidence:");
  });

  test("Given a single-frame graphic When the prompt is built Then delivery stays single PNG and no detail rules appear", async () => {
    // Given
    const context = graphicContext({ schema_version: 1, kind: "single", frame_count: 1 });

    // When
    const prompt = await promptFor(context);

    // Then
    expect(outputBlock(prompt)).toMatchObject({ kind: "single", artboard_count: 1, delivery_format: "png" });
    expect(ruleKinds(prompt)).toEqual(["single"]);
  });

  test("Given a prototype project When the prompt is built Then no graphic block appears and the navigation contract stays single", async () => {
    // Given / When
    const prompt = await promptFor(makeContext());

    // Then
    expect(prompt).not.toContain("<burnguard-graphic-output-v1>");
    expect(ruleKinds(prompt)).toEqual([]);
    expect(prompt.split(PROTOTYPE_NAVIGATION_CONTRACT.trim())).toHaveLength(2);
  });

  test("Given compact and full context modes When a card news prompt is built Then the block appears exactly once in both and before delivery", async () => {
    // Given
    const context = graphicContext({ schema_version: 1, kind: "card_news", frame_count: 4 });

    // When / Then
    for (const contextMode of ["full", "compact"] as const) {
      const prompt = await promptFor(context, contextMode);
      expect(prompt.split("<burnguard-graphic-output-v1>")).toHaveLength(2);
      expect(prompt.split("<burnguard-graphic-rules-v1")).toHaveLength(2);
      expect(prompt.indexOf("<burnguard-graphic-output-v1>")).toBeLessThan(prompt.indexOf("## Delivery"));
      expect(outputBlock(prompt)).toMatchObject({ artboard_count: 4 });
    }
  });
});
