import { describe, expect, test } from "bun:test";
import { PLATFORM_PRESETS } from "@bg/shared";
import { INITIAL_BRIEF_FORM, buildCreateProjectRequest, type ProjectDraft } from "../src/lib/project-creation";
import { manualCanvasPatch, presetIdForFrameCount } from "../src/lib/graphic-set-form";

const carousel = PLATFORM_PRESETS.find((preset) => preset.id === "facebook-feed-carousel");
if (carousel === undefined || carousel.limits.max_frames === undefined) throw new TypeError("expected the Facebook carousel preset with a frame limit");
const maxFrames = carousel.limits.max_frames;

function draft(overrides: Partial<ProjectDraft> = {}): ProjectDraft {
  return {
    ...INITIAL_BRIEF_FORM,
    name: "SNS 카드뉴스",
    type: "graphic",
    backendId: "claude-code",
    designSystemId: null,
    audience: "SNS 방문자",
    objective: "행사 참여를 안내한다",
    graphicKind: "card_news",
    frameCount: 6,
    presetId: carousel.id,
    graphicWidth: carousel.width,
    graphicHeight: carousel.height,
    ...overrides,
  };
}

describe("platform preset detachment (UX-17)", () => {
  test("Given a preset-sized draft When the canvas is edited by hand Then the built request carries no preset id", () => {
    const edited = { ...draft(), ...manualCanvasPatch({ width: 800, height: 800 }) };

    const result = buildCreateProjectRequest(edited, []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new TypeError(result.problem);
    expect(result.request.options?.graphic_set?.preset_id).toBeUndefined();
    expect(result.request.options?.graphic_canvas).toEqual({ schema_version: 1, width: 800, height: 800 });
  });

  test("Given a preset with a frame limit When the count stays within it Then the preset is kept", () => {
    expect(presetIdForFrameCount(carousel.id, maxFrames)).toBe(carousel.id);
    expect(presetIdForFrameCount(carousel.id, 1)).toBe(carousel.id);
  });

  test("Given a preset with a frame limit When the count exceeds it Then the preset is dropped and the draft still builds", () => {
    const presetId = presetIdForFrameCount(carousel.id, maxFrames + 1);

    expect(presetId).toBeNull();
    const result = buildCreateProjectRequest(draft({ presetId, frameCount: maxFrames + 1 }), []);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new TypeError(result.problem);
    expect(result.request.options?.graphic_set?.preset_id).toBeUndefined();
  });

  test("Given no preset or an unlimited preset When the count changes Then nothing is invented", () => {
    expect(presetIdForFrameCount(null, 40)).toBeNull();
    const unlimited = PLATFORM_PRESETS.find((preset) => preset.limits.max_frames === undefined);
    if (unlimited === undefined) throw new TypeError("expected a preset without a frame limit");
    expect(presetIdForFrameCount(unlimited.id, 40)).toBe(unlimited.id);
  });

  test("Given a cleared count field When the preset is checked Then it is kept until a real count exceeds the limit", () => {
    expect(presetIdForFrameCount(carousel.id, Number.NaN)).toBe(carousel.id);
  });
});
