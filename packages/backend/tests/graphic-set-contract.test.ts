import { describe, expect, test } from "bun:test";
import {
  DEFAULT_GRAPHIC_SET,
  GRAPHIC_CANVAS_LIMITS,
  parseGraphicCanvasV1,
  parseGraphicSetV1,
  PLATFORM_PRESETS,
} from "@bg/shared";

describe("GraphicSetV1 contract", () => {
  test("Given a complete banner set When parsed Then per-frame geometry is preserved", () => {
    // Given
    const input = {
      schema_version: 1,
      kind: "banner_set",
      frame_count: 2,
      preset_id: "naver-gfa",
      frames: [
        { width: 1200, height: 628, label: "native" },
        { width: 1200, height: 1200, label: "square" },
      ],
    };

    // When
    const parsed = parseGraphicSetV1(input);

    // Then
    expect(parsed).toEqual(input);
  });

  test("Given unknown keys When parsed Then the boundary rejects the exact field", () => {
    // Given
    const input = { ...DEFAULT_GRAPHIC_SET, future: true };

    // When / Then
    expect(() => parseGraphicSetV1(input)).toThrow("invalid_field at future");
  });

  test.each([
    [{ schema_version: 1, kind: "card_news", frame_count: 41 }, "frame_count"],
    [{ schema_version: 1, kind: "banner_set", frame_count: 1, frames: [{ width: 1200.5, height: 628, label: "native" }] }, "frames.0.width"],
    [{ schema_version: 1, kind: "banner_set", frame_count: 2, frames: [{ width: 1200, height: 628, label: "native" }] }, "frames"],
    [{ schema_version: 1, kind: "card_news", frame_count: 1, frames: [{ width: 1080, height: 1080, label: "cover" }] }, "frames"],
    [{ schema_version: 1, kind: "single", frame_count: 1, detail_brief: { persona_pain: "pain" } }, "detail_brief"],
  ] as const)("Given an invalid graphic-set shape When parsed Then it rejects %s", (input, path) => {
    // When / Then
    expect(() => parseGraphicSetV1(input)).toThrow(`invalid_field at ${path}`);
  });

  test("Given a product-detail brief When parsed Then all bounded fields are preserved", () => {
    // Given
    const detail_brief = {
      persona_pain: "A",
      arrival_scene: "B",
      mechanism: "C",
      evidence: "D",
      journey: "E",
      risk_reducers: "F",
      urgency: "G",
    };

    // When
    const parsed = parseGraphicSetV1({ schema_version: 1, kind: "product_detail", frame_count: 1, detail_brief });

    // Then
    expect(parsed.detail_brief).toEqual(detail_brief);
  });

  test("Given shared platform presets When serialized Then source confidence and Facebook safe zones remain data-only", () => {
    // Given / When
    const serialized = JSON.parse(JSON.stringify(PLATFORM_PRESETS));
    const story = PLATFORM_PRESETS.find((preset) => preset.id === "facebook-stories-carousel");

    // Then
    expect(serialized).toHaveLength(PLATFORM_PRESETS.length);
    expect(story).toMatchObject({ confidence: "verified", verified_on: "2026-09-09", source_ref: 26, rule_source: "platform", safe_zone: { top: 250, bottom: 250 } });
    expect(PLATFORM_PRESETS.find((preset) => preset.id === "youtube-thumbnail")?.rule_source).toBe("burnguard_default");
  });

  test("Given a tall integer canvas within the pixel budget When parsed Then the new height ceiling is accepted", () => {
    // Given / When
    const parsed = parseGraphicCanvasV1({ schema_version: 1, width: 860, height: 16_000 });

    // Then
    expect(GRAPHIC_CANVAS_LIMITS.maxHeight).toBe(16_384);
    expect(parsed.height).toBe(16_000);
    expect(() => parseGraphicCanvasV1({ schema_version: 1, width: 860.5, height: 1000 })).toThrow("invalid_field at width");
  });
});
