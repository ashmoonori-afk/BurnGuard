import { describe, expect, test } from "bun:test";
import {
  parseDesignBriefV1,
  type CreateProjectRequest,
  type DesignSystemSummary,
  type ProjectType,
} from "@bg/shared";
import {
  BRIEF_LOCALE,
  buildCreateProjectRequest,
  keepSelectedDesignSystemId,
  selectableDesignSystems,
  type BuildResult,
  type ProjectDraft,
} from "../src/lib/project-creation";

function system(
  id: string,
  status: DesignSystemSummary["status"],
  isTemplate: boolean,
): DesignSystemSummary {
  return {
    id,
    name: id,
    status,
    is_template: isTemplate,
    thumbnail_path: null,
    updated_at: 1,
  };
}

const SYSTEMS: readonly DesignSystemSummary[] = [
  system("draft-system", "draft", false),
  system("review-system", "review", false),
  system("published-system", "published", false),
  system("draft-template", "draft", true),
  system("published-template", "published", true),
];

function draft(overrides: Partial<ProjectDraft> = {}): ProjectDraft {
  return {
    name: "분기 리뷰 덱",
    type: "slide_deck",
    backendId: "claude-code",
    designSystemId: null,
    audience: "국내 투자 심사역",
    objective: "다음 분기 투자 유치 승인을 받는다",
    contentSource: "none",
    visualMood: "formal",
    density: "balanced",
    outputSize: "widescreen-16x9",
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
  if (!result.ok) {
    throw new Error(`expected a request, got problem: ${result.problem}`);
  }
  return result.request;
}

describe("selectableDesignSystems", () => {
  test("Given original templates, When choosing a supported format, Then requests retain the actual format", () => {
    const originals = ["sonnel", "foliover", "oddward", "velune"].map((brand) =>
      system(`sample-system-original-${brand}`, "published", true));
    for (const type of ["prototype", "slide_deck", "graphic"] as const) {
      expect(selectableDesignSystems(originals, type)).toEqual(originals);
      for (const original of originals) {
        const request = expectRequest(buildCreateProjectRequest(draft({
          type, designSystemId: original.id, backendId: "codex", graphicHeight: 1350,
        }), originals));
        expect(request.type).toBe(type);
        expect(request.design_system_id).toBe(original.id);
        expect(request.options?.design_brief?.output_type).toBe(type);
        if (type === "graphic") expect(request.options?.graphic_canvas).toEqual({ schema_version: 1, width: 1080, height: 1350 });
      }
    }
    expect(selectableDesignSystems(originals, "other")).toEqual([]);
    expect(selectableDesignSystems([system(originals[0]!.id, "draft", true)], "prototype")).toEqual([]);
  });

  test("offers only published non-template systems to normal projects", () => {
    const normalTypes: ProjectType[] = ["prototype", "slide_deck", "other"];
    for (const type of normalTypes) {
      expect(selectableDesignSystems(SYSTEMS, type).map((s) => s.id)).toEqual([
        "published-system",
      ]);
    }
  });

  test("offers every published system to template projects", () => {
    expect(
      selectableDesignSystems(SYSTEMS, "from_template").map((s) => s.id),
    ).toEqual(["published-system", "published-template"]);
  });

  test("keeps template creation usable when real published systems have no template flag", () => {
    const realInstallSystems = [
      system("draft-system", "draft", false),
      system("published-system", "published", false),
    ];

    expect(
      selectableDesignSystems(realInstallSystems, "from_template").map(
        (entry) => entry.id,
      ),
    ).toEqual(["published-system"]);
    expect(
      buildCreateProjectRequest(
        draft({
          type: "from_template",
          designSystemId: "published-system",
          copyAsIs: true,
        }),
        realInstallSystems,
      ).ok,
    ).toBe(true);
  });
});

describe("keepSelectedDesignSystemId", () => {
  const selectable = [system("published-system", "published", false)];

  test("never selects a system on the user's behalf", () => {
    expect(keepSelectedDesignSystemId(null, selectable)).toBeNull();
    expect(keepSelectedDesignSystemId(null, [])).toBeNull();
  });

  test("drops a selection that is no longer selectable without falling back", () => {
    expect(keepSelectedDesignSystemId("draft-system", selectable)).toBeNull();
  });

  test("preserves an explicit selectable choice", () => {
    expect(keepSelectedDesignSystemId("published-system", selectable)).toBe(
      "published-system",
    );
  });
});

describe("buildCreateProjectRequest", () => {
  test("Given safe prototype page selections When building a request Then pages are canonical and exclude implied home", () => {
    // Given / When
    const request = expectRequest(buildCreateProjectRequest(draft({ type: "prototype", pages: ["about.html", "services.html"] }), SYSTEMS));

    // Then
    expect(parseDesignBriefV1(request.options?.design_brief).pages).toEqual(["about.html", "services.html"]);
  });

  test("Given duplicate, unsafe, home, excessive, or non-prototype pages When building a request Then page selection is rejected", () => {
    // Given
    const invalid = [
      draft({ type: "prototype", pages: ["about.html", "ABOUT.html"] }),
      draft({ type: "prototype", pages: ["../about.html"] }),
      draft({ type: "prototype", pages: ["index.html"] }),
      draft({ type: "prototype", pages: Array.from({ length: 13 }, (_, index) => `page-${index}.html`) }),
      draft({ type: "slide_deck", pages: ["about.html"] }),
    ];

    // When / Then
    for (const value of invalid) expect(buildCreateProjectRequest(value, SYSTEMS)).toEqual({ ok: false, problem: "pages_invalid" });
  });

  test("allows a normal project with no design system", () => {
    const request = expectRequest(
      buildCreateProjectRequest(draft({ type: "prototype" }), SYSTEMS),
    );
    expect(request.design_system_id).toBeNull();
    expect(parseDesignBriefV1(request.options?.design_brief).brand_mode).toBe(
      "none",
    );
  });

  test("rejects a normal project pointed at an unpublished system", () => {
    expect(
      buildCreateProjectRequest(
        draft({ type: "prototype", designSystemId: "draft-system" }),
        SYSTEMS,
      ),
    ).toEqual({ ok: false, problem: "design_system_not_selectable" });
  });

  test("requires an explicit published system for template projects", () => {
    expect(
      buildCreateProjectRequest(draft({ type: "from_template" }), SYSTEMS),
    ).toEqual({ ok: false, problem: "design_system_required" });
    expect(
      buildCreateProjectRequest(
        draft({ type: "from_template", designSystemId: "draft-template" }),
        SYSTEMS,
      ),
    ).toEqual({ ok: false, problem: "design_system_not_selectable" });
    expect(
      buildCreateProjectRequest(
        draft({ type: "from_template", designSystemId: "published-system" }),
        SYSTEMS,
      ),
    ).toMatchObject({
      ok: true,
      request: { design_system_id: "published-system" },
    });
  });

  test("carries copy_as_is only for template projects", () => {
    const template = expectRequest(
      buildCreateProjectRequest(
        draft({
          type: "from_template",
          designSystemId: "published-template",
          copyAsIs: true,
        }),
        SYSTEMS,
      ),
    );
    expect(template.design_system_id).toBe("published-template");
    expect(template.options?.copy_as_is).toBe(true);
    expect(parseDesignBriefV1(template.options?.design_brief).brand_mode).toBe(
      "template",
    );

    const deck = expectRequest(buildCreateProjectRequest(draft(), SYSTEMS));
    expect(deck.options?.copy_as_is).toBeUndefined();
  });

  test("emits a canonical design brief with exact type/locale/brand mapping", () => {
    const request = expectRequest(
      buildCreateProjectRequest(
        draft({
          name: "  분기 리뷰 덱  ",
          designSystemId: "published-system",
          audience: "  국내 투자 심사역  ",
          objective: "  투자 유치 승인  ",
          contentSource: "attached",
          visualMood: "premium",
          density: "sparse",
          outputSize: "a4",
          useSpeakerNotes: true,
        }),
        SYSTEMS,
      ),
    );

    expect(request.name).toBe("분기 리뷰 덱");
    expect(request.backend_id).toBe("claude-code");
    expect(request.options?.use_speaker_notes).toBe(true);
    expect(parseDesignBriefV1(request.options?.design_brief)).toEqual({
      schema_version: 1,
      output_type: "slide_deck",
      audience: "국내 투자 심사역",
      objective: "투자 유치 승인",
      content_source: "attached",
      locale: BRIEF_LOCALE,
      brand_mode: "selected_design_system",
      visual_mood: "premium",
      density: "sparse",
      output_size: "a4",
    });
  });

  test("requires a name and bounded brief text", () => {
    expect(buildCreateProjectRequest(draft({ name: "   " }), SYSTEMS)).toEqual({
      ok: false,
      problem: "name_required",
    });
    expect(buildCreateProjectRequest(draft({ audience: "" }), SYSTEMS)).toEqual({
      ok: false,
      problem: "audience_invalid",
    });
    expect(
      buildCreateProjectRequest(draft({ objective: " " }), SYSTEMS),
    ).toEqual({ ok: false, problem: "objective_invalid" });
    expect(
      buildCreateProjectRequest(draft({ audience: "가".repeat(201) }), SYSTEMS),
    ).toEqual({ ok: false, problem: "audience_invalid" });
    expect(
      buildCreateProjectRequest(
        draft({ objective: "가".repeat(1001) }),
        SYSTEMS,
      ),
    ).toEqual({ ok: false, problem: "objective_invalid" });
  });
});
