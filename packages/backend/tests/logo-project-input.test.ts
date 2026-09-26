import { describe, expect, test } from "bun:test";
import type { LogoSetV1 } from "@bg/shared";
import { parseProjectInput, ProjectInputError } from "../src/routes/home-project-input";

const logoSet: LogoSetV1 = {
  schema_version: 1,
  brand_name: "누림",
  niche: "친환경 생활용품",
  character: ["단정한", "따뜻한"],
  logo_type: "combination",
  symbol_keywords: ["잎", "물결"],
};

function inputError(body: unknown): ProjectInputError {
  try {
    parseProjectInput(body);
  } catch (error) {
    if (error instanceof ProjectInputError) return error;
    throw error;
  }
  throw new Error("Expected parseProjectInput to reject");
}

describe("logo project input boundary", () => {
  test("Given a logo set When parsed Then logo creation uses index.html and persists the set", () => {
    const parsed = parseProjectInput({
      name: "  누림 로고  ",
      type: "logo",
      design_system_id: null,
      backend_id: "codex",
      options: { logo_set: logoSet },
    });

    expect(parsed).toMatchObject({ name: "누림 로고", type: "logo", entrypoint: "index.html" });
    expect(JSON.parse(parsed.optionsJson ?? "null")).toEqual({
      use_speaker_notes: false,
      copy_as_is: false,
      design_brief: null,
      research_purpose: null,
      graphic_canvas: null,
      graphic_set: { schema_version: 1, kind: "single", frame_count: 1 },
      logo_set: logoSet,
    });
  });

  test("Given a logo project without a logo set When parsed Then options.logo_set is the rejected path", () => {
    const error = inputError({
      name: "누림 로고",
      type: "logo",
      design_system_id: null,
      backend_id: "codex",
      options: {},
    });

    expect(error.code).toBe("invalid_project_options");
    expect(error.details).toEqual({ path: "options.logo_set" });
  });

  test("Given a logo project with no options at all When parsed Then it is rejected on the same path", () => {
    const error = inputError({
      name: "누림 로고",
      type: "logo",
      design_system_id: null,
      backend_id: "codex",
    });

    expect(error.code).toBe("invalid_project_options");
    expect(error.details).toEqual({ path: "options.logo_set" });
  });

  test("Given a logo set on a prototype When parsed Then the set is refused", () => {
    const error = inputError({
      name: "웹",
      type: "prototype",
      design_system_id: null,
      backend_id: "codex",
      options: { logo_set: logoSet },
    });

    expect(error.code).toBe("invalid_project_options");
    expect(error.details).toEqual({ path: "options.logo_set" });
  });

  test("Given a malformed logo set When parsed Then the contract path is reported", () => {
    const error = inputError({
      name: "누림 로고",
      type: "logo",
      design_system_id: null,
      backend_id: "codex",
      options: { logo_set: { ...logoSet, logo_type: "sticker" } },
    });

    expect(error.code).toBe("invalid_project_options");
    expect(error.details).toEqual({ code: "invalid_field", path: "options.logo_set.logo_type" });
  });

  test("Given a graphic project When parsed Then the logo gate leaves it untouched", () => {
    expect(parseProjectInput({
      name: "카드",
      type: "graphic",
      design_system_id: null,
      backend_id: "codex",
      options: { graphic_canvas: { schema_version: 1, width: 1080, height: 1080 } },
    })).toMatchObject({ type: "graphic", entrypoint: "index.html" });
  });
});
