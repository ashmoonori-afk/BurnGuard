import { describe, expect, test } from "bun:test";
import {
  EXPORT_PARITY_SIMILARITY_THRESHOLD,
  parseExportParitySummary,
} from "@bg/shared";
import {
  buildStructuralParity,
  compareParityPages,
  type ParityPixelPage,
} from "../src/services/export-parity";
import { createParitySourceCollector } from "../src/services/export-parity-artifacts";

function solidPage(
  width: number,
  height: number,
  color: readonly [number, number, number, number],
): ParityPixelPage {
  const rgba = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba.set(color, offset);
  }
  return {
    width,
    height,
    raster_width: width,
    raster_height: height,
    rgba,
  };
}

describe("pure export parity comparison", () => {
  test("Given identical relative pixels at different resolutions When compared Then similarity passes without a dimension warning", () => {
    // Given
    const source = solidPage(2, 2, [32, 96, 224, 255]);
    const output = solidPage(4, 4, [32, 96, 224, 255]);

    // When
    const summary = compareParityPages({ source: [source], output: [output] });

    // Then
    expect(summary.status).toBe("pass");
    expect(summary.threshold).toBe(EXPORT_PARITY_SIMILARITY_THRESHOLD);
    expect(summary.pages[0]).toMatchObject({
      page: 1,
      source_dimensions: { width: 2, height: 2 },
      output_dimensions: { width: 4, height: 4 },
      similarity_score: 100,
      warnings: [],
      thumbnail_available: false,
      thumbnail_sha256: null,
    });
  });

  test("Given different page counts and aspect ratios When compared Then parsed fields carry both warnings", () => {
    // Given
    const source = [
      solidPage(4, 2, [255, 255, 255, 255]),
      solidPage(4, 2, [255, 255, 255, 255]),
    ];
    const output = [solidPage(2, 4, [255, 255, 255, 255])];

    // When
    const summary = parseExportParitySummary(compareParityPages({ source, output }));

    // Then
    expect(summary.status).toBe("warn");
    expect(summary.source_page_count).toBe(2);
    expect(summary.output_page_count).toBe(1);
    expect(summary.warnings).toEqual(["page_count_mismatch"]);
    expect(summary.pages[0]?.warnings).toEqual(["dimension_mismatch"]);
  });

  test("Given visibly different pixels When compared Then the page score falls below the threshold", () => {
    // Given
    const source = solidPage(3, 3, [255, 0, 0, 255]);
    const output = solidPage(3, 3, [0, 0, 255, 255]);

    // When
    const summary = compareParityPages({ source: [source], output: [output] });

    // Then
    expect(summary.pages[0]?.similarity_score).toBeLessThan(
      EXPORT_PARITY_SIMILARITY_THRESHOLD,
    );
    expect(summary.pages[0]?.warnings).toEqual([
      "similarity_below_threshold",
    ]);
    expect(summary.status).toBe("warn");
  });

  test("Given a structurally validated format When summarized Then it passes without pretending pixel evidence exists", () => {
    // Given / When
    const summary = buildStructuralParity({
      sourcePageCount: null,
      outputPageCount: null,
    });

    // Then
    expect(summary).toEqual({
      schema_version: 1,
      status: "pass",
      comparison: "structural",
      threshold: EXPORT_PARITY_SIMILARITY_THRESHOLD,
      source_page_count: null,
      output_page_count: null,
      pages: [],
      warnings: [],
    });
  });

  test("Given an unavailable comparison When summarized Then it warns without blocking the export", () => {
    // Given / When
    const summary = buildStructuralParity({
      sourcePageCount: null,
      outputPageCount: null,
      comparisonUnavailable: true,
    });

    // Then
    expect(summary.status).toBe("warn");
    expect(summary.warnings).toEqual(["comparison_unavailable"]);
  });

  test("Given inconsistent persisted parity fields When parsed Then the boundary rejects them", () => {
    // Given
    const structuralWithPage = {
      schema_version: 1,
      status: "pass",
      comparison: "structural",
      threshold: EXPORT_PARITY_SIMILARITY_THRESHOLD,
      source_page_count: 1,
      output_page_count: 1,
      pages: [
        {
          page: 1,
          source_dimensions: { width: 1, height: 1 },
          output_dimensions: { width: 1, height: 1 },
          similarity_score: 100,
          warnings: [],
          thumbnail_available: false,
          thumbnail_sha256: null,
        },
      ],
      warnings: [],
    };
    const pixelWithoutScore = {
      ...structuralWithPage,
      comparison: "pixel",
      pages: [{ ...structuralWithPage.pages[0], similarity_score: null }],
    };

    // When / Then
    expect(() => parseExportParitySummary(structuralWithPage)).toThrow(
      "invalid_field at pages",
    );
    expect(() => parseExportParitySummary(pixelWithoutScore)).toThrow(
      "invalid_field at pages.0.similarity_score",
    );
  });

  test("Given parity-only decode failure When source evidence is collected Then the export path stays available and evidence becomes unavailable", async () => {
    // Given
    const collector = createParitySourceCollector(
      new AbortController().signal,
      async () => {
        throw new TypeError("invalid parity capture");
      },
    );

    // When
    await collector.add(Uint8Array.from([1, 2, 3]));

    // Then
    expect(collector.pages()).toEqual([]);
  });
});
