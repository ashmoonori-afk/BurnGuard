import { describe, expect, test } from "bun:test";
import { chromium } from "../../backend/node_modules/playwright-core";
import { renderInitialArtifact } from "../../backend/src/db/templates";
import { parseDesignBriefV1, type CreateProjectRequest } from "@bg/shared";
import {
  buildCreateProjectRequest,
  type BuildResult,
  type ProjectDraft,
  PROBLEM_MESSAGE,
} from "../src/lib/project-creation";
import {
  DETAIL_BRIEF_FIELDS,
  GRAPHIC_KIND_CHOICES,
  defaultFrameCount,
  presetChoicesFor,
} from "../src/lib/graphic-set-form";

function draft(overrides: Partial<ProjectDraft> = {}): ProjectDraft {
  return {
    name: "SNS 그래픽",
    type: "graphic",
    backendId: "claude-code",
    designSystemId: null,
    audience: "SNS 방문자",
    objective: "행사 참여를 안내한다",
    contentSource: "none",
    visualMood: "friendly",
    density: "balanced",
    outputSize: "responsive",
    graphicWidth: 1080,
    graphicHeight: 1080,
    useSpeakerNotes: false,
    copyAsIs: false,
    pages: [],
    graphicKind: "single",
    frameCount: 1,
    frames: [],
    presetId: null,
    detailBrief: {},
    ...overrides,
  };
}

function expectRequest(result: BuildResult): CreateProjectRequest {
  if (!result.ok) throw new TypeError(`expected request: ${result.problem}`);
  return result.request;
}

describe("graphic project creation", () => {
  test.each([
    [1080, 1080],
    [1200, 628],
    [1080, 1920],
    [1440, 900],
  ])("builds exact default preset and custom graphic dimensions", (width, height) => {
    const request = expectRequest(buildCreateProjectRequest(draft({
      graphicWidth: width,
      graphicHeight: height,
    }), []));

    expect(request.options?.graphic_canvas).toEqual({
      schema_version: 1,
      width,
      height,
    });
    expect(parseDesignBriefV1(request.options?.design_brief)).toMatchObject({
      output_type: "graphic",
      output_size: "custom",
    });
  });

  test.each([
    [319, 1080, "graphic_width_invalid"],
    [4097, 1080, "graphic_width_invalid"],
    [1080.5, 1080, "graphic_width_invalid"],
    [1080, 239, "graphic_height_invalid"],
    [1080, 16_385, "graphic_height_invalid"],
    [4000, 4001, "graphic_pixel_limit"],
  ] as const)("rejects invalid graphic dimensions before create", (width, height, problem) => {
    expect(buildCreateProjectRequest(draft({
      graphicWidth: width,
      graphicHeight: height,
    }), [])).toEqual({ ok: false, problem });
  });

  test("keeps non-graphic request options unchanged", () => {
    const request = expectRequest(buildCreateProjectRequest(draft({
      type: "prototype",
      graphicWidth: 1200,
      graphicHeight: 628,
    }), []));
    expect(request.options?.graphic_canvas).toBeUndefined();
    expect(parseDesignBriefV1(request.options?.design_brief).output_size).toBe("responsive");
  });
});

describe("graphic set creation", () => {
  test("Given a card news set with a preset When built Then the graphic set rides in the options", () => {
    const request = expectRequest(buildCreateProjectRequest(draft({
      graphicKind: "card_news",
      frameCount: 6,
      presetId: "instagram-feed-portrait",
      graphicWidth: 1080,
      graphicHeight: 1350,
    }), []));

    expect(request.options?.graphic_set).toEqual({
      schema_version: 1,
      kind: "card_news",
      frame_count: 6,
      preset_id: "instagram-feed-portrait",
    });
  });

  test("Given a banner set When built Then each frame size is carried", () => {
    const request = expectRequest(buildCreateProjectRequest(draft({
      graphicKind: "banner_set",
      frameCount: 2,
      frames: [
        { width: 1080, height: 1080, label: "정사각형" },
        { width: 1200, height: 628, label: "가로형" },
      ],
    }), []));

    expect(request.options?.graphic_set).toEqual({
      schema_version: 1,
      kind: "banner_set",
      frame_count: 2,
      frames: [
        { width: 1080, height: 1080, label: "정사각형" },
        { width: 1200, height: 628, label: "가로형" },
      ],
    });
  });

  test("Given a product detail brief When built Then only answered fields are sent", () => {
    const request = expectRequest(buildCreateProjectRequest(draft({
      graphicKind: "product_detail",
      frameCount: 1,
      graphicWidth: 860,
      graphicHeight: 12_000,
      detailBrief: { persona_pain: "  매일 재고를 손으로 세요  ", urgency: "", evidence: "재구매율 40%" },
    }), []));

    expect(request.options?.graphic_set).toEqual({
      schema_version: 1,
      kind: "product_detail",
      frame_count: 1,
      detail_brief: { persona_pain: "매일 재고를 손으로 세요", evidence: "재구매율 40%" },
    });
  });

  test("Given a tall detail page When built Then the raised canvas height limit is accepted", () => {
    const request = expectRequest(buildCreateProjectRequest(draft({
      graphicKind: "product_detail",
      graphicWidth: 860,
      graphicHeight: 16_384,
    }), []));

    expect(request.options?.graphic_canvas).toEqual({ schema_version: 1, width: 860, height: 16_384 });
  });

  test.each([
    [{ graphicKind: "card_news" as const, frameCount: 41 }],
    [{ graphicKind: "card_news" as const, frameCount: 0 }],
    [{ graphicKind: "card_news" as const, frameCount: 3, frames: [{ width: 1080, height: 1080, label: "a" }] }],
    [{ graphicKind: "banner_set" as const, frameCount: 2, frames: [{ width: 1080, height: 1080, label: "a" }] }],
    [{ graphicKind: "card_news" as const, frameCount: 2, detailBrief: { urgency: "지금" } }],
    [{ graphicKind: "product_detail" as const, frameCount: 1, detailBrief: { urgency: "가".repeat(501) } }],
  ])("Given an impossible graphic set combination When built Then creation is refused with a message", (overrides) => {
    const result = buildCreateProjectRequest(draft(overrides), []);

    expect(result.ok).toBe(false);
    if (result.ok) throw new TypeError("expected a rejected graphic set");
    expect(PROBLEM_MESSAGE[result.problem].length).toBeGreaterThan(0);
    expect(result.problem).toBe("graphic_set_invalid");
  });

  test("Given a non-graphic project When built Then no graphic set is sent", () => {
    const request = expectRequest(buildCreateProjectRequest(draft({ type: "slide_deck", graphicKind: "card_news", frameCount: 6 }), []));

    expect(request.options?.graphic_set).toBeUndefined();
  });
});

describe("graphic set form choices", () => {
  test("platform clicks size default banners through the creation/render seam without replacing mixed frames", async () => {
    const compiler = Bun.spawn([
      process.execPath, "build", `${import.meta.dir}/fixtures/graphic-creation-browser.ts`,
      "--target=browser", "--format=iife",
    ], { stdout: "pipe", stderr: "pipe" });
    const [exitCode, script, errors] = await Promise.all([
      compiler.exited, new Response(compiler.stdout).text(), new Response(compiler.stderr).text(),
    ]);
    if (exitCode !== 0) throw new Error(`Graphic fixture bundle failed (${exitCode}): ${errors}`);
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      const rendered = await browser.newPage();
      await page.setContent('<div id="root"></div>');
      await page.addScriptTag({ content: script });
      const mount = (frames: ProjectDraft["frames"]) => page.evaluate(frames => {
        (globalThis as typeof globalThis & { mountGraphic(frames: ProjectDraft["frames"]): void }).mountGraphic(frames);
      }, frames);
      const readRequest = async () => expectRequest(JSON.parse(await page.locator("#request").innerText()) as BuildResult);
      const sizes = async (request: CreateProjectRequest) => {
        await rendered.setContent(renderInitialArtifact({ name: request.name, type: "graphic", options: request.options }));
        return rendered.locator("[data-graphic-artboard]").evaluateAll(elements => elements.map(element => ({
          width: parseFloat(getComputedStyle(element).width), height: parseFloat(getComputedStyle(element).height),
        })));
      };
      const choices = presetChoicesFor("banner_set");
      await mount([{ width: 1080, height: 1080, label: "Default" }]);
      const buttons = page.locator('[aria-labelledby="graphic-preset-label"] button');
      expect(await buttons.count()).toBe(16);
      for (const [index, { preset, available }] of choices.entries()) {
        if (!available) {
          expect(await buttons.nth(index).isDisabled()).toBe(true);
          continue;
        }
        await buttons.nth(index).click();
        const request = await readRequest();
        expect(request.options?.graphic_set?.preset_id).toBe(preset.id);
        expect(request.options?.graphic_set?.frames).toEqual([{ width: preset.width, height: preset.height, label: "Default" }]);
        expect(await sizes(request)).toEqual([{ width: preset.width, height: preset.height }]);
      }
      // One explicit frame even matches the old canvas: a mixed set must stay intact.
      const mixed = [{ width: 1080, height: 1080, label: "Square" }, { width: 1200, height: 628, label: "Wide" }];
      await mount(mixed);
      await buttons.nth(2).click();
      const request = await readRequest();
      expect(request.options?.graphic_canvas).toEqual({ schema_version: 1, width: 1080, height: 1920 });
      expect(request.options?.graphic_set?.frames).toEqual(mixed);
      expect(await sizes(request)).toEqual(mixed.map(({ width, height }) => ({ width, height })));
    } finally {
      await browser.close();
    }
  }, 60_000);

  test("Given a card news kind When defaults are read Then six frames are proposed", () => {
    expect(defaultFrameCount("card_news")).toBe(6);
    expect(defaultFrameCount("product_detail")).toBe(1);
    expect(defaultFrameCount("single")).toBe(1);
  });

  test("Given every graphic kind When the choices are listed Then each is labelled in Korean", () => {
    expect(GRAPHIC_KIND_CHOICES.map((choice) => choice.value)).toEqual([
      "single", "card_news", "product_detail", "banner_set", "thumbnail", "print",
    ]);
    expect(GRAPHIC_KIND_CHOICES.every((choice) => choice.label.trim().length > 0)).toBe(true);
  });

  test("Given a preset below the canvas minimum When presets are grouped Then it is listed as unavailable, never resized", () => {
    const grouped = presetChoicesFor("banner_set");
    const tiny = grouped.find((choice) => choice.preset.id === "naver-gfa-comment");

    if (tiny === undefined) throw new TypeError("expected the 112×112 preset in the banner group");
    expect(tiny.available).toBe(false);
    expect(tiny.preset.width).toBe(112);
    expect(grouped.every((choice) => choice.preset.kind === "banner_set")).toBe(true);
    expect(grouped.filter((choice) => choice.available).every((choice) => choice.preset.width >= 320 && choice.preset.height >= 240)).toBe(true);
  });

  test("Given an unverified preset When presets are grouped Then its confidence is exposed for the badge", () => {
    const grouped = presetChoicesFor("card_news");
    const derived = grouped.find((choice) => choice.preset.id === "instagram-feed-three-four");

    if (derived === undefined) throw new TypeError("expected the derived 3:4 preset");
    expect(derived.preset.confidence).toBe("unverified");
  });

  test("Given the detail brief fields When listed Then each of the seven questions has a Korean hint", () => {
    expect(DETAIL_BRIEF_FIELDS.map((field) => field.key)).toEqual([
      "persona_pain", "arrival_scene", "mechanism", "evidence", "journey", "risk_reducers", "urgency",
    ]);
    expect(DETAIL_BRIEF_FIELDS.every((field) => field.hint.trim().length > 0 && field.label.trim().length > 0)).toBe(true);
  });
});
