import { describe, expect, test } from "bun:test";
import { parseDesignBriefV1, type CreateProjectRequest } from "@bg/shared";
import {
  buildCreateProjectRequest,
  requiresImageBackend,
  PROBLEM_MESSAGE,
  type BuildResult,
  type ProjectDraft,
} from "../src/lib/project-creation";

function draft(overrides: Partial<ProjectDraft> = {}): ProjectDraft {
  return {
    name: "온새미로 로고",
    type: "logo",
    backendId: "codex",
    designSystemId: null,
    audience: "동네 단골 손님",
    objective: "빵집 간판과 포장에 쓸 로고를 만든다",
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
    logoBrandName: "온새미로",
    logoNiche: "유기농 베이커리",
    logoCharacter: ["따뜻한", "정직한"],
    logoType: "auto",
    logoSymbolKeywords: [],
    logoAvoid: "",
    ...overrides,
  };
}

function expectRequest(result: BuildResult): CreateProjectRequest {
  if (!result.ok) throw new TypeError(`expected request: ${result.problem}`);
  return result.request;
}

describe("logo project creation", () => {
  test("Given a minimal logo brief When built Then the request carries exactly the required logo set", () => {
    const request = expectRequest(buildCreateProjectRequest(draft(), []));

    expect(request.type).toBe("logo");
    expect(request.options?.logo_set).toEqual({
      schema_version: 1,
      brand_name: "온새미로",
      niche: "유기농 베이커리",
      character: ["따뜻한", "정직한"],
      logo_type: "auto",
    });
    expect(request.options?.graphic_canvas).toBeUndefined();
    expect(request.options?.graphic_set).toBeUndefined();
    expect(parseDesignBriefV1(request.options?.design_brief)).toMatchObject({
      output_type: "logo",
      output_size: "custom",
    });
  });

  test("Given symbols and an avoid note When built Then both ride along trimmed", () => {
    const request = expectRequest(buildCreateProjectRequest(draft({
      logoType: "combination",
      logoSymbolKeywords: ["  밀 이삭  ", "오븐"],
      logoAvoid: "  흔한 방패 문양은 피해 주세요  ",
    }), []));

    expect(request.options?.logo_set).toEqual({
      schema_version: 1,
      brand_name: "온새미로",
      niche: "유기농 베이커리",
      character: ["따뜻한", "정직한"],
      logo_type: "combination",
      symbol_keywords: ["밀 이삭", "오븐"],
      avoid: "흔한 방패 문양은 피해 주세요",
    });
  });

  test.each([
    [{ logoBrandName: "   " }],
    [{ logoNiche: "" }],
    [{ logoCharacter: [] }],
    [{ logoCharacter: ["하나", "둘", "셋", "넷", "다섯", "여섯", "일곱", "여덟"] }],
    [{ logoCharacter: ["가".repeat(41)] }],
    [{ logoSymbolKeywords: ["1", "2", "3", "4", "5", "6", "7", "8", "9"] }],
    [{ logoAvoid: "가".repeat(301) }],
    [{ logoBrandName: "가".repeat(81) }],
  ])("Given an impossible logo brief When built Then creation is refused before the request", (overrides) => {
    const result = buildCreateProjectRequest(draft(overrides), []);

    expect(result.ok).toBe(false);
    if (result.ok) throw new TypeError("expected a rejected logo brief");
    expect(result.problem).toBe("logo_set_invalid");
    expect(PROBLEM_MESSAGE[result.problem].length).toBeGreaterThan(0);
  });

  test("Given a non-logo project When built Then no logo set is sent", () => {
    const request = expectRequest(buildCreateProjectRequest(draft({ type: "slide_deck" }), []));

    expect(request.options?.logo_set).toBeUndefined();
  });

  test("Given the image-generating project types When the backend gate is asked Then only those are gated", () => {
    expect(requiresImageBackend("logo")).toBe(true);
    expect(requiresImageBackend("graphic")).toBe(true);
    for (const type of ["prototype", "slide_deck", "from_template", "other"] as const) {
      expect(requiresImageBackend(type)).toBe(false);
    }
  });
});
