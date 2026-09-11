import { beforeAll, describe, expect, test } from "bun:test";
import { getSqlite } from "../src/db/sqlite-client";
import { buildPrompt } from "../src/harness/prompt-builder";
import { ensureLearningSchema } from "./learning-fixture";

type BuildContext = Parameters<typeof buildPrompt>[0];

beforeAll(() => ensureLearningSchema(getSqlite()));

function context(
  optionsJson: string | null,
  projectType: BuildContext["project"]["project_type"] = "slide_deck",
): BuildContext {
  return {
    project: {
      project_id: "brief-project",
      project_name: "분기 영업 보고서",
      project_type: projectType,
      project_dir: "/tmp/brief-project",
      entrypoint: projectType === "slide_deck" ? "deck.html" : "index.html",
      options_json: optionsJson,
      current_revision: 0,
      current_digest: null,
    },
    designSystem: null,
    files: [],
    attachments: [],
    openComments: [],
  };
}

function taggedJson(prompt: string, tag: string): Readonly<Record<string, unknown>> {
  const match = prompt.match(new RegExp(`<${tag}>\\n([^\\n]+)\\n</${tag}>`));
  expect(match).not.toBeNull();
  const parsed: unknown = JSON.parse(match?.[1] ?? "{}");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Expected ${tag} to contain an object`);
  }
  return parsed;
}

describe("design brief prompt context", () => {
  test("Given a versioned project brief When the prompt is built Then machine fields are injected", async () => {
    const designBrief = {
      schema_version: 1,
      output_type: "slide_deck",
      audience: "영업팀 리더",
      objective: "분기 성과와 다음 행동을 공유한다",
      content_source: "attached",
      locale: "ko-KR",
      brand_mode: "selected_design_system",
      visual_mood: "formal",
      density: "balanced",
      output_size: "widescreen-16x9",
    } as const;
    const prompt = await buildPrompt(
      context(JSON.stringify({ design_brief: designBrief })),
      { type: "user.message", text: "이 자료로 영업 보고서를 만들어줘" },
    );

    expect(taggedJson(prompt, "burnguard-design-brief-v1")).toEqual(
      designBrief,
    );
  });

  test("Given a graphic project When the prompt is built Then exact one-artboard PNG delivery is explicit", async () => {
    const prompt = await buildPrompt(
      context(JSON.stringify({
        graphic_canvas: { schema_version: 1, width: 1200, height: 628 },
        design_brief: {
          schema_version: 1,
          output_type: "graphic",
          audience: "SNS 방문자",
          objective: "행사 참여를 안내한다",
          content_source: "none",
          locale: "ko-KR",
          brand_mode: "none",
          visual_mood: "friendly",
          density: "balanced",
          output_size: "custom",
        },
      }), "graphic"),
      { type: "user.message", text: "행사 그래픽을 만들어줘" },
    );

    expect(taggedJson(prompt, "burnguard-graphic-output-v1")).toEqual({
      schema_version: 1,
      width_css_px: 1200,
      height_css_px: 628,
      artboard_count: 1,
      delivery_format: "png",
      kind: "single",
      frames: [{ sequence: 1, width_css_px: 1200, height_css_px: 628, purpose: "single" }],
    });
    expect(prompt).not.toContain("## Slide deck skill");
  });

  test("Given prototype pages in the brief When the prompt is built Then the page contract is emitted", async () => {
    // Given
    const designBrief = {
      schema_version: 1, output_type: "prototype", audience: "방문자", objective: "서비스 소개",
      content_source: "none", locale: "ko-KR", brand_mode: "none", visual_mood: "formal",
      density: "balanced", output_size: "responsive", pages: ["about.html", "제품/상세.html"],
    } as const;

    // When
    const prompt = await buildPrompt(context(JSON.stringify({ design_brief: designBrief }), "prototype"), { type: "user.message", text: "사이트를 만들어줘" });

    // Then
    expect(taggedJson(prompt, "burnguard-design-brief-v1")["pages"]).toEqual(["about.html", "제품/상세.html"]);
    expect(prompt).toContain("Create exactly these pages as real local files linked from the shared nav: index.html, about.html, 제품/상세.html");
  });

  test("Given malformed project options When the prompt is built Then no partial brief leaks", async () => {
    const prompt = await buildPrompt(
      context(
        JSON.stringify({
          design_brief: {
            schema_version: 1,
            output_type: "slide_deck",
            audience: "",
          },
        }),
      ),
      { type: "user.message", text: "자료를 만들어줘" },
    );

    expect(prompt).not.toMatch(
      /<burnguard-design-brief-v1>\n[^\n]+\n<\/burnguard-design-brief-v1>/u,
    );
  });
});
