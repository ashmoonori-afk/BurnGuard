import { describe, expect, test } from "bun:test";
import {
  LOGO_CANDIDATE_COUNT,
  LOGO_FILES,
  LOGO_PAGE,
  LOGO_TYPES,
  parseLogoAction,
  type LogoManifestV1,
} from "@bg/shared";
import {
  LOGO_TYPE_CHOICES,
  latestLogoRound,
  logoActionMessage,
  parseProjectLogoCanvas,
  parseProjectLogoManifest,
} from "../src/lib/logo-project";

function candidate(round: number, position: number) {
  return {
    id: `candidate-${position}`,
    file: `${LOGO_FILES.explorations}/round-${round}/candidate-${position}.png`,
    logo_type: "wordmark",
    prompt: "flat vector wordmark on a plain ground",
    rationale: "이름을 그대로 읽히게 만든 안",
  };
}

function manifest(rounds: number, selected: LogoManifestV1["selected"] = null): unknown {
  return {
    schema_version: 1,
    rounds: Array.from({ length: rounds }, (_, index) => ({
      round: index + 1,
      candidates: Array.from({ length: LOGO_CANDIDATE_COUNT }, (_, position) => candidate(index + 1, position + 1)),
    })),
    selected,
  };
}

describe("logo project canvas", () => {
  test("Given a logo project When the canvas is read Then the fixed 1920x1080 artboard is used", () => {
    expect(parseProjectLogoCanvas("logo")).toEqual({
      schema_version: 1,
      width: LOGO_PAGE.width,
      height: LOGO_PAGE.height,
    });
  });

  test.each(["graphic", "prototype", "slide_deck", "from_template", "other"] as const)(
    "Given a %s project When the logo canvas is read Then nothing is claimed",
    (projectType) => {
      expect(parseProjectLogoCanvas(projectType)).toBeNull();
    },
  );
});

describe("logo manifest parsing", () => {
  test("Given a manifest written by the turn When parsed Then every round is available", () => {
    const parsed = parseProjectLogoManifest(manifest(2, { round: 2, candidate_id: "candidate-3" }));

    if (parsed === null) throw new TypeError("expected a parsed manifest");
    expect(parsed.rounds).toHaveLength(2);
    expect(parsed.rounds[1]?.candidates).toHaveLength(LOGO_CANDIDATE_COUNT);
    expect(parsed.selected).toEqual({ round: 2, candidate_id: "candidate-3" });
    expect(latestLogoRound(parsed)?.round).toBe(2);
  });

  test.each([
    null,
    "{",
    {},
    { schema_version: 1, rounds: [], selected: null },
    { schema_version: 2, rounds: [{ round: 1, candidates: [] }], selected: null },
    { schema_version: 1, rounds: [{ round: 1, candidates: [candidate(1, 1)] }], selected: null },
    { schema_version: 1, rounds: [{ round: 1, candidates: Array.from({ length: 4 }, (_, index) => candidate(1, index + 1)) }], selected: { round: 9, candidate_id: "candidate-1" } },
  ])("Given a garbled manifest When parsed Then the panel sees nothing instead of throwing", (input) => {
    expect(parseProjectLogoManifest(input)).toBeNull();
  });
});

describe("logo action message", () => {
  test("Given a regenerate request When the message is built Then the sentinel and a human line are sent", () => {
    const message = logoActionMessage({ action: "regenerate" });

    expect(message).toContain('<burnguard-logo-action-v1>{"action":"regenerate"}</burnguard-logo-action-v1>');
    expect(parseLogoAction(message)).toEqual({ action: "regenerate" });
    expect(message.split("\n").at(-1)?.trim().length).toBeGreaterThan(0);
  });

  test("Given a selected candidate When the message is built Then the harness reads the exact selection", () => {
    const message = logoActionMessage({ action: "select", round: 2, candidate_id: "candidate-3" });

    expect(parseLogoAction(message)).toEqual({ action: "select", round: 2, candidate_id: "candidate-3" });
    expect(message).toContain("3");
  });
});

describe("logo type choices", () => {
  test("Given the shared logo types When the form choices are listed Then each carries its own message key", () => {
    expect(LOGO_TYPE_CHOICES.map((choice) => choice.value)).toEqual([...LOGO_TYPES]);
    expect(LOGO_TYPE_CHOICES.map((choice) => choice.label)).toEqual(LOGO_TYPES.map((type) => `home.logo.type.${type}`));
  });
});
