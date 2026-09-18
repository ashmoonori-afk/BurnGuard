import { describe, expect, test } from "bun:test";
import {
  LOGO_CANDIDATE_COUNT,
  LOGO_FILES,
  LOGO_PAGE,
  UpgradeContractError,
  parseExportOptions,
  parseLogoAction,
  parseLogoDesignSystemPatchV1,
  parseLogoManifestV1,
  parseLogoSetV1,
  resolveLogoPhase,
  surfaceForProjectType,
  type LogoManifestV1,
} from "@bg/shared";

const validSet = {
  schema_version: 1,
  brand_name: "Northvale",
  niche: "boutique asset management for founders",
  character: ["calm", "precise", "trusted"],
  logo_type: "combination",
  symbol_keywords: ["mountain", "shield"],
};

function manifest(overrides: Partial<LogoManifestV1> = {}): unknown {
  const candidates = Array.from({ length: LOGO_CANDIDATE_COUNT }, (_, index) => ({
    id: `candidate-${index + 1}`,
    file: `explorations/round-1/candidate-${index + 1}.png`,
    logo_type: (["wordmark", "abstract", "combination", "emblem"] as const)[index],
    prompt: "flat vector-style mark on a plain white ground",
    rationale: "one idea, readable at 16px",
  }));
  return { schema_version: 1, rounds: [{ round: 1, candidates }], selected: null, ...overrides };
}

function invalidPath(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof UpgradeContractError) return error.path;
    throw error;
  }
  throw new Error("expected UpgradeContractError");
}

describe("logo set contract", () => {
  test("Given a complete logo brief, When parsed, Then every field survives and defaults are not invented", () => {
    const parsed = parseLogoSetV1(validSet);
    expect(parsed).toEqual({ ...validSet, schema_version: 1 });
  });

  test("Given an unknown key, When parsed, Then the exact key is rejected", () => {
    expect(invalidPath(() => parseLogoSetV1({ ...validSet, extra: 1 }))).toBe("extra");
  });

  test("Given an unknown logo type, When parsed, Then logo_type is rejected", () => {
    expect(invalidPath(() => parseLogoSetV1({ ...validSet, logo_type: "hologram" }))).toBe("logo_type");
  });

  test("Given an empty character list, When parsed, Then character is rejected", () => {
    expect(invalidPath(() => parseLogoSetV1({ ...validSet, character: [] }))).toBe("character");
  });

  test("Given a missing brand name, When parsed, Then brand_name is rejected", () => {
    const { brand_name: _omit, ...rest } = validSet;
    expect(invalidPath(() => parseLogoSetV1(rest))).toBe("brand_name");
  });
});

describe("logo manifest and phase", () => {
  test("Given four candidates in one round, When parsed, Then the round is accepted and the phase is explore", () => {
    const parsed = parseLogoManifestV1(manifest());
    expect(parsed.rounds[0]?.candidates).toHaveLength(LOGO_CANDIDATE_COUNT);
    expect(resolveLogoPhase(parsed, null)).toBe("explore");
  });

  test("Given three candidates, When parsed, Then the candidate count is rejected by path", () => {
    const three = manifest() as { rounds: { candidates: unknown[] }[] };
    three.rounds[0]!.candidates = three.rounds[0]!.candidates.slice(0, 3);
    expect(invalidPath(() => parseLogoManifestV1(three))).toBe("rounds.0.candidates");
  });

  test("Given a select action in the message, When the phase is resolved, Then it is finalize", () => {
    const text = 'Go with the third one <burnguard-logo-action-v1>{"action":"select","round":1,"candidate_id":"candidate-3"}</burnguard-logo-action-v1>';
    const action = parseLogoAction(text);
    expect(action).toEqual({ action: "select", round: 1, candidate_id: "candidate-3" });
    expect(resolveLogoPhase(parseLogoManifestV1(manifest()), action)).toBe("finalize");
  });

  test("Given a regenerate action, When resolved, Then the phase stays explore", () => {
    const action = parseLogoAction('<burnguard-logo-action-v1>{"action":"regenerate"}</burnguard-logo-action-v1>');
    expect(action).toEqual({ action: "regenerate" });
    expect(resolveLogoPhase(parseLogoManifestV1(manifest()), action)).toBe("explore");
  });

  test("Given a message without a sentinel, When parsed, Then there is no action", () => {
    expect(parseLogoAction("make it bluer")).toBeNull();
  });

  test("Given the file map, Then it names the master vector, manifest and guidelines entrypoint", () => {
    expect(LOGO_FILES).toEqual({
      logo: "logo.svg",
      explorations: "explorations",
      manifest: "explorations/manifest.json",
      guidelines: "index.html",
      design_system_patch: "design-system-patch.json",
    });
    expect(LOGO_PAGE).toEqual({ width: 1920, height: 1080 });
  });
});

describe("logo design-system patch", () => {
  test("Given hex colours and a readme section, When parsed, Then they are accepted", () => {
    const parsed = parseLogoDesignSystemPatchV1({
      schema_version: 1,
      colors: [{ name: "brand-primary", value: "#17233B" }],
      readme_section: "## Logo\n\nUse the master mark.",
      logo_asset: "logo.svg",
    });
    expect(parsed.colors).toHaveLength(1);
  });

  test("Given a non-hex colour, When parsed, Then the colour path is rejected", () => {
    expect(invalidPath(() => parseLogoDesignSystemPatchV1({
      schema_version: 1,
      colors: [{ name: "brand-primary", value: "rgb(1,2,3)" }],
      readme_section: "## Logo",
      logo_asset: "logo.svg",
    }))).toBe("colors.0.value");
  });
});

describe("logo surface and export options", () => {
  test("Given a logo project, Then it renders into the content surface", () => {
    expect(surfaceForProjectType("logo")).toBe("content");
  });

  test("Given svg export options, When empty, Then they parse to an empty object and reject extra keys", () => {
    expect(parseExportOptions("svg", {})).toEqual({});
    expect(invalidPath(() => parseExportOptions("svg", { pdf_paper: "a4" }))).toBe("pdf_paper");
  });
});
