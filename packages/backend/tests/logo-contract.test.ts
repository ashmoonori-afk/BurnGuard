import { describe, expect, test } from "bun:test";
import {
  LOGO_CANDIDATE_COUNT,
  LOGO_DIRECTION_IDS,
  LOGO_DIRECTION_PARTS,
  LOGO_DIRECTION_PRIMITIVES,
  LOGO_FILES,
  LOGO_IDEA_FILES,
  LOGO_PAGE,
  MOODBOARD_LIMITS,
  MOODBOARD_MIME_TYPES,
  UpgradeContractError,
  parseExportOptions,
  parseLogoAction,
  parseLogoDesignSystemPatchV1,
  parseLogoDirectionsV1,
  parseLogoManifestV1,
  parseLogoMoodboardV1,
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

  test("Given a readme section that smuggles a second top-level heading, When parsed, Then readme_section is rejected", () => {
    expect(invalidPath(() => parseLogoDesignSystemPatchV1({
      schema_version: 1,
      colors: [],
      readme_section: "## Logo\nMark\n\n## Typography\nInjected second section",
      logo_asset: "logo.svg",
    }))).toBe("readme_section");
    expect(parseLogoDesignSystemPatchV1({
      schema_version: 1,
      colors: [],
      readme_section: "## Logo\n\n### Clear space\n\nx = cap height.",
      logo_asset: "logo.svg",
    }).readme_section).toContain("### Clear space");
  });
});

const CONCRETE_TYPES = ["wordmark", "abstract", "combination"] as const;

function directions(overrides: Record<string, unknown> = {}): unknown {
  return {
    schema_version: 1,
    brand_name: "Northvale",
    directions: [1, 2, 3].map((number, index) => ({
      id: `direction-${number}`,
      name: `Direction ${number}`,
      logo_type: CONCRETE_TYPES[index],
      color: { hero: "#17233B", support: ["#8899AA", "#CCDDEE"], ground: "#FFFFFF" },
      shape: { primitive: LOGO_DIRECTION_PRIMITIVES[index], construction: "two arcs, 2px stroke" },
      mood: ["calm", "precise"],
      rationale: "reads clearly at small sizes",
      sketch: { file: LOGO_IDEA_FILES[index], kind: "svg" },
    })),
    ...overrides,
  };
}

function nestedDirections(index: number, overrides: Record<string, unknown>): unknown {
  const base = directions() as { directions: Record<string, unknown>[] };
  base.directions[index] = { ...base.directions[index], ...overrides };
  return base;
}

function hex64(value: number): string {
  return value.toString(16).padStart(64, "0");
}

function hex16(value: number): string {
  return value.toString(16).padStart(16, "0");
}

function fileItem(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "file",
    id: hex64(index),
    sha256: hex64(index),
    mime_type: "image/png",
    size_bytes: 1024,
    original_name: `reference-${index}.png`,
    fingerprint: hex16(index),
    added_at: index,
    ...overrides,
  };
}

function linkItem(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "link",
    id: hex64(1000 + index),
    url: `https://www.pinterest.com/pin/${100000000 + index}/`,
    added_at: index,
    ...overrides,
  };
}

function moodboard(items: unknown[], overrides: Record<string, unknown> = {}): unknown {
  return { schema_version: 1, revision: 3, digest: "a".repeat(64), items, ...overrides };
}

describe("logo idea directions contract", () => {
  test("Given three concrete directions, When parsed, Then ids, sketches and fields survive", () => {
    const parsed = parseLogoDirectionsV1(directions());
    expect(parsed.directions.map((direction) => direction.id)).toEqual([...LOGO_DIRECTION_IDS]);
    expect(parsed.directions.map((direction) => direction.sketch.file)).toEqual([...LOGO_IDEA_FILES]);
    expect(parsed.directions[0]?.color.hero).toBe("#17233B");
    expect(parsed.brand_name).toBe("Northvale");
  });

  test("Given two directions sharing a name, When parsed, Then directions.name is rejected", () => {
    const base = directions() as { directions: Record<string, unknown>[] };
    base.directions[1]!.name = base.directions[0]!.name;
    expect(invalidPath(() => parseLogoDirectionsV1(base))).toBe("directions.name");
  });

  test("Given two directions whose names differ only in case, When parsed, Then directions.name is rejected", () => {
    const base = directions() as { directions: Record<string, unknown>[] };
    base.directions[1]!.name = String(base.directions[0]!.name).toUpperCase();
    expect(invalidPath(() => parseLogoDirectionsV1(base))).toBe("directions.name");
  });

  test("Given two letter-led directions of different logo types, When parsed, Then the shared primitive is accepted", () => {
    const base = directions() as { directions: { shape: Record<string, unknown> }[] };
    base.directions[0]!.shape.primitive = "letterform";
    base.directions[2]!.shape.primitive = "letterform";
    expect(parseLogoDirectionsV1(base).directions.map((direction) => direction.shape.primitive)).toEqual(["letterform", "square", "letterform"]);
  });

  test("Given two directions sharing both logo type and shape primitive, When parsed, Then the primitive is rejected", () => {
    const base = directions() as { directions: { logo_type: unknown; shape: Record<string, unknown> }[] };
    base.directions[2]!.logo_type = base.directions[0]!.logo_type;
    base.directions[2]!.shape.primitive = base.directions[0]!.shape.primitive;
    expect(invalidPath(() => parseLogoDirectionsV1(base))).toBe("directions.shape.primitive");
  });

  test("Given four directions, When parsed, Then the count is rejected", () => {
    const base = directions() as { directions: unknown[] };
    base.directions.push(base.directions[0]);
    expect(invalidPath(() => parseLogoDirectionsV1(base))).toBe("directions");
  });

  test("Given an auto logo type, When parsed, Then the concrete type is required", () => {
    expect(invalidPath(() => parseLogoDirectionsV1(nestedDirections(0, { logo_type: "auto" })))).toBe("directions.0.logo_type");
  });

  test("Given a mismatched sketch file, When parsed, Then the file path is rejected", () => {
    const base = nestedDirections(1, { sketch: { file: "ideas/sketch-direction-3.svg", kind: "svg" } });
    expect(invalidPath(() => parseLogoDirectionsV1(base))).toBe("directions.1.sketch.file");
  });

  test("Given a fourth support colour, When parsed, Then support is rejected", () => {
    const base = nestedDirections(0, { color: { hero: "#17233B", support: ["#111111", "#222222", "#333333", "#444444"], ground: "#FFFFFF" } });
    expect(invalidPath(() => parseLogoDirectionsV1(base))).toBe("directions.0.color.support");
  });

  test("Given a non-hex ground, When parsed, Then the nested path is rejected", () => {
    const base = nestedDirections(0, { color: { hero: "#17233B", support: [], ground: "white" } });
    expect(invalidPath(() => parseLogoDirectionsV1(base))).toBe("directions.0.color.ground");
  });

  test("Given an unknown nested key, When parsed, Then the exact key is rejected", () => {
    const base = nestedDirections(0, { shape: { primitive: "circle", construction: "arc", extra: 1 } });
    expect(invalidPath(() => parseLogoDirectionsV1(base))).toBe("extra");
  });
});

describe("logo ideate and adopt actions", () => {
  test("Given an ideate sentinel, When resolved, Then the phase is ideate", () => {
    const action = parseLogoAction('<burnguard-logo-action-v1>{"action":"ideate"}</burnguard-logo-action-v1>');
    expect(action).toEqual({ action: "ideate" });
    expect(resolveLogoPhase(parseLogoManifestV1(manifest()), action)).toBe("ideate");
  });

  test("Given an adopt pick set, When parsed, Then picks survive and the phase is explore", () => {
    const text = '<burnguard-logo-action-v1>{"action":"adopt","picks":[{"direction_id":"direction-1","take":["name","color"]},{"direction_id":"direction-3","take":["mood"]}]}</burnguard-logo-action-v1>';
    const action = parseLogoAction(text);
    expect(action).toEqual({
      action: "adopt",
      picks: [
        { direction_id: "direction-1", take: ["name", "color"] },
        { direction_id: "direction-3", take: ["mood"] },
      ],
    });
    expect(resolveLogoPhase(parseLogoManifestV1(manifest()), action)).toBe("explore");
  });

  test("Given a malformed adopt pick set, When parsed, Then the action is absent", () => {
    const cases = [
      '{"action":"adopt","picks":[]}',
      '{"action":"adopt","picks":[{"direction_id":"direction-1","take":["name"]},{"direction_id":"direction-2","take":["mood"]},{"direction_id":"direction-3","take":["shape"]},{"direction_id":"direction-1","take":["color"]}]}',
      '{"action":"adopt","picks":[{"direction_id":"direction-1","take":["name"]},{"direction_id":"direction-1","take":["mood"]}]}',
      '{"action":"adopt","picks":[{"direction_id":"direction-1","take":[]}]}',
      '{"action":"adopt","picks":[{"direction_id":"direction-1","take":["name","name"]}]}',
      '{"action":"adopt","picks":[{"direction_id":"direction-1","take":["logo"]}]}',
      '{"action":"adopt","picks":[{"direction_id":"direction-4","take":["name"]}]}',
      '{"action":"adopt","picks":[{"direction_id":"direction-1","take":["name"],"extra":1}]}',
      '{"action":"adopt","picks":[{"direction_id":"direction-1","take":["name"]}],"extra":1}',
    ];
    for (const body of cases) {
      expect(parseLogoAction(`<burnguard-logo-action-v1>${body}</burnguard-logo-action-v1>`)).toBeNull();
    }
  });

  test("Given the exported part and primitive lists, Then they are the contract values", () => {
    expect(LOGO_DIRECTION_PARTS).toEqual(["name", "color", "shape", "mood"]);
    expect(LOGO_DIRECTION_PRIMITIVES).toContain("letterform");
  });
});

describe("logo moodboard contract", () => {
  test("Given one file and one link, When parsed, Then both items survive with their limits", () => {
    const parsed = parseLogoMoodboardV1(moodboard([fileItem(0), linkItem(0)]));
    expect(parsed.items).toHaveLength(2);
    expect(parsed.revision).toBe(3);
    expect(MOODBOARD_LIMITS).toEqual({ max_files: 12, max_links: 16, max_file_bytes: 5 * 1024 * 1024, max_total_bytes: 25 * 1024 * 1024, max_url_chars: 2048 });
    expect(MOODBOARD_MIME_TYPES).toEqual(["image/png", "image/jpeg", "image/webp"]);
  });

  test("Given an id that does not match its sha256, When parsed, Then the file id is rejected", () => {
    expect(invalidPath(() => parseLogoMoodboardV1(moodboard([fileItem(0, { id: hex64(9) })])))).toBe("items.0.id");
  });

  test("Given two items sharing an id, When parsed, Then duplicate ids are rejected", () => {
    const duplicate = fileItem(5);
    expect(invalidPath(() => parseLogoMoodboardV1(moodboard([fileItem(5), { ...duplicate, original_name: "copy.png" }])))).toBe("items.id");
  });

  test("Given an unsupported mime type, When parsed, Then the file mime is rejected", () => {
    expect(invalidPath(() => parseLogoMoodboardV1(moodboard([fileItem(0, { mime_type: "image/gif" })])))).toBe("items.0.mime_type");
  });

  test("Given a file over five megabytes, When parsed, Then the size is rejected", () => {
    expect(invalidPath(() => parseLogoMoodboardV1(moodboard([fileItem(0, { size_bytes: MOODBOARD_LIMITS.max_file_bytes + 1 })])))).toBe("items.0.size_bytes");
  });

  test("Given a short fingerprint, When parsed, Then the fingerprint is rejected", () => {
    expect(invalidPath(() => parseLogoMoodboardV1(moodboard([fileItem(0, { fingerprint: "abc" })])))).toBe("items.0.fingerprint");
  });

  test("Given an original name with a path separator, When parsed, Then the name is rejected", () => {
    expect(invalidPath(() => parseLogoMoodboardV1(moodboard([fileItem(0, { original_name: "a/b.png" })])))).toBe("items.0.original_name");
  });

  test("Given thirteen files, When parsed, Then the file count is rejected", () => {
    const many = Array.from({ length: 13 }, (_, index) => fileItem(200 + index));
    expect(invalidPath(() => parseLogoMoodboardV1(moodboard(many)))).toBe("items.files");
  });

  test("Given seventeen links, When parsed, Then the link count is rejected", () => {
    const many = Array.from({ length: 17 }, (_, index) => linkItem(index));
    expect(invalidPath(() => parseLogoMoodboardV1(moodboard(many)))).toBe("items.links");
  });

  test("Given files whose total exceeds twenty-five megabytes, When parsed, Then the total is rejected", () => {
    const many = Array.from({ length: 12 }, (_, index) => fileItem(300 + index, { size_bytes: 2_300_000 }));
    expect(invalidPath(() => parseLogoMoodboardV1(moodboard(many)))).toBe("items.total_bytes");
  });

  test("Given a non-https link, When parsed, Then the url is rejected", () => {
    expect(invalidPath(() => parseLogoMoodboardV1(moodboard([linkItem(0, { url: "http://example.com/pin/1" })])))).toBe("items.0.url");
  });

  test("Given a link with credentials, When parsed, Then the url is rejected", () => {
    expect(invalidPath(() => parseLogoMoodboardV1(moodboard([linkItem(0, { url: "https://user:pass@example.com/pin/1" })])))).toBe("items.0.url");
  });

  test("Given a link with a control character, When parsed, Then the url is rejected", () => {
    expect(invalidPath(() => parseLogoMoodboardV1(moodboard([linkItem(0, { url: "https://example.com/pin/1\u0001x" })])))).toBe("items.0.url");
  });

  test("Given a link over the url cap, When parsed, Then the url is rejected", () => {
    const long = `https://example.com/${'a'.repeat(MOODBOARD_LIMITS.max_url_chars)}`;
    expect(invalidPath(() => parseLogoMoodboardV1(moodboard([linkItem(0, { url: long })])))).toBe("items.0.url");
  });

  test("Given a bad digest, revision or unknown key, When parsed, Then each path is rejected", () => {
    expect(invalidPath(() => parseLogoMoodboardV1(moodboard([fileItem(0)], { digest: "xyz" })))).toBe("digest");
    expect(invalidPath(() => parseLogoMoodboardV1(moodboard([fileItem(0)], { revision: -1 })))).toBe("revision");
    expect(invalidPath(() => parseLogoMoodboardV1(moodboard([fileItem(0)], { extra: 1 })))).toBe("extra");
  });

  test("Given an unknown item kind, When parsed, Then the item kind is rejected", () => {
    expect(invalidPath(() => parseLogoMoodboardV1(moodboard([{ kind: "video", id: hex64(0), added_at: 0 }])))).toBe("items.0.kind");
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
