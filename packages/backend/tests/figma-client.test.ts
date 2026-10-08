import { describe, expect, spyOn, test } from "bun:test";
import {
  extractFigmaTokens,
  fetchFigmaFileMeta,
  FigmaApiError,
  parseFigmaUrl,
  pickFirstFillHex,
  slugifyStyleName,
} from "../src/services/figma";

describe("parseFigmaUrl", () => {
  test("extracts the file key from /file/<key>/<title> URLs", () => {
    const { fileKey } = parseFigmaUrl(
      "https://www.figma.com/file/abc123XYZ/Northvale-Tokens",
    );
    expect(fileKey).toBe("abc123XYZ");
  });

  test("accepts the newer /design/<key>/<title> URL form", () => {
    expect(parseFigmaUrl("https://www.figma.com/design/aBcD1234/foo").fileKey).toBe(
      "aBcD1234",
    );
  });

  test("accepts the prototype /proto/<key> URL form", () => {
    expect(parseFigmaUrl("https://www.figma.com/proto/xyz999/Pres").fileKey).toBe(
      "xyz999",
    );
  });

  test("treats a bare alphanumeric token as an already-extracted key", () => {
    expect(parseFigmaUrl("aBcDeFgH12345").fileKey).toBe("aBcDeFgH12345");
  });

  test("rejects non-figma hosts", () => {
    expect(() =>
      parseFigmaUrl("https://example.com/file/abc/Foo"),
    ).toThrow(FigmaApiError);
  });

  test("rejects URLs with no file segment", () => {
    expect(() => parseFigmaUrl("https://www.figma.com/profile/me")).toThrow(
      FigmaApiError,
    );
  });

  test("rejects empty input", () => {
    expect(() => parseFigmaUrl("")).toThrow(FigmaApiError);
  });
});

describe("slugifyStyleName", () => {
  test("kebabs nested style names with slashes", () => {
    expect(slugifyStyleName("Brand / Primary 50")).toBe("brand-primary-50");
  });

  test("collapses runs of separators and trims edges", () => {
    expect(slugifyStyleName("  Foo // Bar  ")).toBe("foo-bar");
  });

  test("strips non-alphanumeric runs", () => {
    expect(slugifyStyleName("Hover (active!)")).toBe("hover-active");
  });
});

describe("pickFirstFillHex", () => {
  test("converts the first visible solid SOLID paint to a 6-digit hex", () => {
    const hex = pickFirstFillHex([
      { type: "SOLID", color: { r: 1, g: 0, b: 0.5 } },
    ]);
    expect(hex).toBe("ff0080");
  });

  test("skips invisible fills", () => {
    const hex = pickFirstFillHex([
      { type: "SOLID", color: { r: 1, g: 0, b: 0 }, visible: false },
      { type: "SOLID", color: { r: 0, g: 1, b: 0 } },
    ]);
    expect(hex).toBe("00ff00");
  });

  test("ignores non-SOLID paints (gradients, images, etc.)", () => {
    const hex = pickFirstFillHex([
      { type: "GRADIENT_LINEAR" },
      { type: "IMAGE" },
    ]);
    expect(hex).toBeNull();
  });

  test("returns null on missing or empty fills", () => {
    expect(pickFirstFillHex(undefined)).toBeNull();
    expect(pickFirstFillHex([])).toBeNull();
  });
});

describe("figma REST transport", () => {
  test("Given the Figma REST client When it fetches file metadata Then the outbound request forbids redirect following", async () => {
    // Given
    const calls: RequestInit[] = [];
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (_input: unknown, init?: RequestInit) => {
      calls.push(init ?? {});
      return Response.json({ name: "Tokens", lastModified: "2026-01-01T00:00:00Z", version: "1" });
    }) as typeof fetch);
    try {
      // When
      await fetchFigmaFileMeta("abc123XYZ", "figd_secret");

      // Then
      expect(calls).toHaveLength(1);
      expect(calls[0]?.redirect).toBe("error");
      expect(new Headers(calls[0]?.headers).get("X-Figma-Token")).toBe("figd_secret");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("Given a blocked redirect When the fetch layer fails Then the typed error rejects without echoing runtime details", async () => {
    // Given
    const token = "figd_secret";
    const redirectTarget = "https://evil.example/steal";
    const redirectError = Object.assign(
      new TypeError(`UnexpectedRedirect fetching "https://api.figma.com/v1/files/abc123XYZ?depth=1" -> "${redirectTarget}"`),
      { code: "UnexpectedRedirect" },
    );
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => {
      throw redirectError;
    }) as unknown as typeof fetch);
    try {
      // When
      const failure = fetchFigmaFileMeta("abc123XYZ", token).catch((error: unknown) => error);

      // Then
      const error = await failure;
      expect(error).toBeInstanceOf(FigmaApiError);
      if (!(error instanceof FigmaApiError)) throw error;
      expect(error.code).toBe("fetch_failed");
      expect(error.message).not.toContain(token);
      expect(error.message).not.toContain(redirectTarget);
      expect(error.message).not.toContain("UnexpectedRedirect");
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("extractFigmaTokens", () => {
  test("Given Korean and colliding names When styles are extracted Then every stable style key retains its color", () => {
    const styles = ["주요 색상", "보조 색상", "A/B", "A B"].map((name, index) => ({ key: `key-${index}`, fileKey: "f", nodeId: String(index), name, description: "", styleType: "FILL" }));
    const nodes = Object.fromEntries(styles.map((style, index) => [style.nodeId, { id: style.nodeId, name: style.name, type: "RECTANGLE", fills: [{ type: "SOLID", color: { r: index / 3, g: 0, b: 0 } }] }]));
    const first = extractFigmaTokens(styles, nodes).colors;
    const reordered = extractFigmaTokens([...styles].reverse(), nodes).colors;
    expect(first.size).toBe(4);
    expect(new Set(first.values()).size).toBe(4);
    expect([...first].sort()).toEqual([...reordered].sort());
    expect([...first.keys()].every((key) => /^--color-[a-z0-9-]+$/.test(key))).toBe(true);
    const generatedName = [...first.keys()][0]!.replace(/^--color-/, "");
    const extra = { key: "extra", fileKey: "f", nodeId: "extra", name: generatedName, description: "", styleType: "FILL" };
    const extended = extractFigmaTokens([...styles, extra], { ...nodes, extra: { id: "extra", name: generatedName, type: "RECTANGLE", fills: [{ type: "SOLID", color: { r: 0, g: 1, b: 0 } }] } });
    expect(extended.colors.size).toBe(5);
  });

  test("turns FILL styles into --color-<slug> entries", () => {
    const styles = [
      {
        key: "k1",
        fileKey: "f",
        nodeId: "1:2",
        name: "Brand / Primary",
        description: "",
        styleType: "FILL",
      },
      {
        key: "k2",
        fileKey: "f",
        nodeId: "1:3",
        name: "Surface / Card",
        description: "",
        styleType: "FILL",
      },
    ];
    const nodes = {
      "1:2": {
        id: "1:2",
        name: "Brand / Primary",
        type: "RECTANGLE",
        fills: [{ type: "SOLID", color: { r: 0.1, g: 0.4, b: 0.9 } }],
      },
      "1:3": {
        id: "1:3",
        name: "Surface / Card",
        type: "RECTANGLE",
        fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
      },
    };
    const tokens = extractFigmaTokens(styles, nodes);
    expect(tokens.colors.get("--color-brand-primary")).toBe("1a66e6");
    expect(tokens.colors.get("--color-surface-card")).toBe("ffffff");
    expect(tokens.textStyles).toEqual([]);
  });

  test("turns TEXT styles into typography entries and unique font-family list", () => {
    const styles = [
      {
        key: "t1",
        fileKey: "f",
        nodeId: "2:1",
        name: "Heading / H1",
        description: "",
        styleType: "TEXT",
      },
      {
        key: "t2",
        fileKey: "f",
        nodeId: "2:2",
        name: "Body / Default",
        description: "",
        styleType: "TEXT",
      },
    ];
    const nodes = {
      "2:1": {
        id: "2:1",
        name: "Heading / H1",
        type: "TEXT",
        style: { fontFamily: "Inter", fontSize: 48, fontWeight: 700 },
      },
      "2:2": {
        id: "2:2",
        name: "Body / Default",
        type: "TEXT",
        style: { fontFamily: "Inter", fontSize: 16, fontWeight: 400 },
      },
    };
    const tokens = extractFigmaTokens(styles, nodes);
    expect(tokens.textStyles).toEqual([
      { name: "heading-h1", fontFamily: "Inter", fontSizePx: 48, fontWeight: 700 },
      { name: "body-default", fontFamily: "Inter", fontSizePx: 16, fontWeight: 400 },
    ]);
    expect(tokens.fontFamilies).toEqual(["Inter"]);
  });

  test("ignores EFFECT / GRID style types at MVP", () => {
    const tokens = extractFigmaTokens(
      [
        {
          key: "e1",
          fileKey: "f",
          nodeId: "3:1",
          name: "Shadow / Card",
          description: "",
          styleType: "EFFECT",
        },
        {
          key: "g1",
          fileKey: "f",
          nodeId: "3:2",
          name: "Layout / 12-col",
          description: "",
          styleType: "GRID",
        },
      ],
      {
        "3:1": { id: "3:1", name: "Shadow / Card", type: "RECTANGLE" },
        "3:2": { id: "3:2", name: "Layout / 12-col", type: "FRAME" },
      },
    );
    expect(tokens.colors.size).toBe(0);
    expect(tokens.textStyles).toEqual([]);
  });

  test("skips styles whose node was not resolved (defensive)", () => {
    const tokens = extractFigmaTokens(
      [
        {
          key: "missing",
          fileKey: "f",
          nodeId: "9:9",
          name: "Ghost",
          description: "",
          styleType: "FILL",
        },
      ],
      {},
    );
    expect(tokens.colors.size).toBe(0);
  });
});
