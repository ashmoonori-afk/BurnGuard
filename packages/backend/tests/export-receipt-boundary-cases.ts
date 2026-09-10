import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { canonicalJson, parseExportReceipt, sha256 } from "../src/services/export-receipt";

const digest = "a".repeat(64);
const statistics = { pixels: 1_938_816, visible_pixels: 10_000, painted_pixels: 4_800, differing_pixels: 4_800, color_count: 2, dominant_ratio: 0.52, luminance_variance: 12.5, entropy: 0.3 };
const validations = {
  html_zip: { entries: 4 },
  pdf: { pages: 1, title: "Deck", observations: [{ page: 1, width_points: 792, height_points: 612, operators: 9, raster_width: 1584, raster_height: 1224, statistics, content_bounds: { left: 40, top: 60, right: 119, bottom: 119 } }] },
  png: { width: 320, height: 240, statistics: { pixels: 76_800, visible_pixels: 76_800, differing_pixels: 100, dominant_ratio: 0.9, luminance_variance: 10, entropy: 0.2 } },
  pptx: { slides: 3, editable_text_nodes: 8 },
  handoff: { source_files: 3, nodes: 9 },
  cafe24_package: { entries: 8 },
  imweb_package: { entries: 6 },
  png_zip: {
    transformation_version: 1,
    outputs: [
      { rel_path: "01.png", width: 1080, height: 1080, image_format: "png", bytes: 100, sha256: digest, sequence: 1, source_region: { top: 0, bottom: 1080 } },
      { rel_path: "02.png", width: 1080, height: 1080, image_format: "png", bytes: 120, sha256: digest, sequence: 2, source_region: { top: 1080, bottom: 2160 } },
    ],
    aggregate: { frames: 2, dpr: 1 },
  },
} as const;
const options = {
  html_zip: {},
  pdf: { pdf_paper: "letter" },
  png: { png_width: 320, png_height: 240, png_dpr: 1 },
  pptx: { pptx_size: "16x9" },
  handoff: {},
  cafe24_package: {},
  imweb_package: { asset_base_url: "https://cdn.example.com/assets/" },
  png_zip: { slice_height: 5000, slice_format: "png" },
} as const;
type Format = keyof typeof validations;
type MutablePdf = { pages: number; observations: Array<{ page: number; raster_width: number; raster_height: number; statistics: Record<string, number>; content_bounds: null | Record<string, number> }> };
function receipt(format: Format): Record<string, unknown> { return { schema_version: 1, job_id: "job", attempt_id: "attempt", parent_attempt_id: null, format, project: { id: "p", revision: 7, digest }, options: options[format], output_file: format === "pdf" ? "artifact.pdf" : format === "png" ? "artifact.png" : format === "pptx" ? "artifact.pptx" : "artifact.zip", output_size: 3, digests: { input_closure: digest, design_system: null, options: sha256(canonicalJson(options[format])), renderer: digest, capture: digest, output: digest }, validation: validations[format] }; }
function forgedPdf(mutate: (validation: MutablePdf) => void): Record<string, unknown> { const value = receipt("pdf"); const validation = structuredClone(validations.pdf) as MutablePdf; mutate(validation); value.validation = validation; return value; }

const mutations: ReadonlyArray<readonly [string, (validation: MutablePdf) => void]> = [
  ["pixel total", (v) => { v.observations[0]!.statistics.pixels = 79_999; }],
  ["zero visible", (v) => { v.observations[0]!.statistics.visible_pixels = 0; }],
  ["visible above total", (v) => { v.observations[0]!.statistics.visible_pixels = 80_001; }],
  ["visible threshold", (v) => { const s = v.observations[0]!.statistics; s.visible_pixels = 79; s.painted_pixels = 79; s.differing_pixels = 1; s.color_count = 2; s.dominant_ratio = 78 / 79; }],
  ["zero painted", (v) => { v.observations[0]!.statistics.painted_pixels = 0; v.observations[0]!.content_bounds = null; }],
  ["bounds without paint", (v) => { v.observations[0]!.statistics.painted_pixels = 0; }],
  ["painted threshold", (v) => { v.observations[0]!.statistics.painted_pixels = 79; }],
  ["painted above visible", (v) => { v.observations[0]!.statistics.painted_pixels = 80_001; }],
  ["negative differing", (v) => { v.observations[0]!.statistics.differing_pixels = -1; }],
  ["no dominant pixels", (v) => { v.observations[0]!.statistics.differing_pixels = 80_000; }],
  ["differing threshold", (v) => { v.observations[0]!.statistics.differing_pixels = 79; v.observations[0]!.statistics.dominant_ratio = 79_921 / 80_000; }],
  ["zero colors", (v) => { v.observations[0]!.statistics.color_count = 0; }],
  ["colors above visible", (v) => { v.observations[0]!.statistics.color_count = 80_001; }],
  ["one color with differences", (v) => { v.observations[0]!.statistics.color_count = 1; }],
  ["multiple colors without differences", (v) => { v.observations[0]!.statistics.differing_pixels = 0; v.observations[0]!.statistics.color_count = 2; v.observations[0]!.statistics.dominant_ratio = 1; }],
  ["dominant ratio mismatch", (v) => { v.observations[0]!.statistics.dominant_ratio += 0.000_000_01; }],
  ["impossible variance", (v) => { v.observations[0]!.statistics.luminance_variance = 16_256.26; }],
  ["zero validated variance", (v) => { v.observations[0]!.statistics.luminance_variance = 0; }],
  ["impossible entropy", (v) => { v.observations[0]!.statistics.entropy = 8.01; }],
  ["zero validated entropy", (v) => { v.observations[0]!.statistics.entropy = 0; }],
  ["missing painted bounds", (v) => { v.observations[0]!.content_bounds = null; }],
  ["fractional bound", (v) => { v.observations[0]!.content_bounds!.left = 1.5; }],
  ["reversed bounds", (v) => { v.observations[0]!.content_bounds!.right = 39; }],
  ["outside bounds", (v) => { v.observations[0]!.content_bounds!.right = 1_584; }],
  ["bounds area below painted", (v) => { v.observations[0]!.content_bounds = { left: 0, top: 0, right: 1, bottom: 1 }; }],
  ["observation count", (v) => { v.pages = 2; }],
  ["page sequence", (v) => { v.observations[0]!.page = 2; }],
  ["raster dimensions", (v) => { v.observations[0]!.raster_width = 399; }],
];

describe("authoritative export receipt boundary", () => {
  test("accepts the exact canonical receipt result for every format", () => { for (const format of Object.keys(validations) as Format[]) expect(parseExportReceipt(receipt(format)).format).toBe(format); });
  test("rejects unknown fields at every nested authority level", () => {
    for (const [label, mutate] of [["root", (v: Record<string, unknown>) => { v.extra = true; }], ["project", (v: Record<string, unknown>) => { (v.project as Record<string, unknown>).extra = true; }], ["digests", (v: Record<string, unknown>) => { (v.digests as Record<string, unknown>).extra = true; }], ["options", (v: Record<string, unknown>) => { (v.options as Record<string, unknown>).extra = true; }], ["validation", (v: Record<string, unknown>) => { (v.validation as Record<string, unknown>).extra = true; }]] as const) { const value = structuredClone(receipt("png")); mutate(value); expect(() => parseExportReceipt(value), label).toThrow("invalid_receipt"); }
  });
  test("rejects cross-format noncanonical and out-of-range options", () => {
    for (const invalid of [{ png_width: -1 }, { png_width: 320.5, png_height: 240, png_dpr: 1 }, { png_width: 99_999, png_height: 240, png_dpr: 1 }, { pdf_paper: "letter" }]) { const value = receipt("png"); value.options = invalid; expect(() => parseExportReceipt(value)).toThrow("invalid_receipt"); }
    const pdf = receipt("pdf"); pdf.options = { png_width: 320 }; expect(() => parseExportReceipt(pdf)).toThrow("invalid_receipt");
  });
  test("rejects the verifier counterexample from a forged receipt file", async () => { const value = receipt("pdf"); value.validation = JSON.parse(await readFile(new URL("./fixtures/forged-pdf-receipt-validation.json", import.meta.url), "utf8")); expect(() => parseExportReceipt(value)).toThrow("invalid_receipt"); });
  test("rejects every PDF receipt cross-field mutation independently", () => { for (const [label, mutate] of mutations) expect(() => parseExportReceipt(forgedPdf(mutate)), label).toThrow("invalid_receipt"); });
  test("rejects Oracle producer-closure counterexamples and non-PDF authority forgeries", () => {
    const cases: Array<readonly [string, Record<string, unknown>]> = [];
    cases.push(["C5000/D4800", forgedPdf((v) => { v.observations[0]!.statistics.color_count = 5_000; })]);
    cases.push(["exact ratio", forgedPdf((v) => { v.observations[0]!.statistics.dominant_ratio = 0.52 + 0.5e-12; })]);
    cases.push(["V3/D2/C2", forgedPdf((v) => { const s = v.observations[0]!.statistics; s.visible_pixels = 3; s.painted_pixels = 2; s.differing_pixels = 2; s.color_count = 2; s.dominant_ratio = 1 / 3; s.luminance_variance = 1; s.entropy = 1; v.observations[0]!.content_bounds = { left: 40, top: 60, right: 40, bottom: 61 }; })]);
    cases.push(["V4/A1/D2", forgedPdf((v) => { const s = v.observations[0]!.statistics; s.visible_pixels = 4; s.painted_pixels = 1; s.differing_pixels = 2; s.color_count = 2; s.dominant_ratio = 0.5; s.luminance_variance = 1; s.entropy = 1; v.observations[0]!.content_bounds = { left: 40, top: 60, right: 40, bottom: 60 }; })]);
    cases.push(["painted capacity", forgedPdf((v) => { v.observations[0]!.statistics.painted_pixels = 6_000; v.observations[0]!.content_bounds = { left: 40, top: 60, right: 139, bottom: 119 }; })]); cases.push(["dominant occurrence", forgedPdf((v) => { v.observations[0]!.statistics.painted_pixels = 4_801; v.observations[0]!.content_bounds = { left: 40, top: 60, right: 120, bottom: 119 }; })]);
    cases.push(["A equals pixels", forgedPdf((v) => { const s = v.observations[0]!.statistics; s.visible_pixels = s.pixels; s.painted_pixels = s.pixels; s.dominant_ratio = (s.visible_pixels - s.differing_pixels) / s.visible_pixels; v.observations[0]!.content_bounds = { left: 0, top: 0, right: 1_583, bottom: 1_223 }; })]);
    cases.push(["single pixel loose bounds", forgedPdf((v) => { const s = v.observations[0]!.statistics; s.visible_pixels = 2; s.painted_pixels = 1; s.differing_pixels = 1; s.color_count = 2; s.dominant_ratio = 0.5; s.luminance_variance = 0.25; s.entropy = 1; v.observations[0]!.content_bounds = { left: 40, top: 60, right: 41, bottom: 60 }; })]);
    cases.push(["entropy support", forgedPdf((v) => { v.observations[0]!.statistics.entropy = 5; })]);
    cases.push(["entropy below one-outlier", forgedPdf((v) => { v.observations[0]!.statistics.entropy = 1e-10; })]);
    cases.push(["odd-V variance maximum", forgedPdf((v) => { const s = v.observations[0]!.statistics; s.visible_pixels = 3; s.painted_pixels = 2; s.differing_pixels = 1; s.color_count = 2; s.dominant_ratio = 2 / 3; s.luminance_variance = 15_000; s.entropy = 1; v.observations[0]!.content_bounds = { left: 40, top: 60, right: 40, bottom: 61 }; })]);
    cases.push(["one-edge clipping", forgedPdf((v) => { v.observations[0]!.content_bounds = { left: 0, top: 60, right: 79, bottom: 119 }; })]);
    cases.push(["paper mismatch", forgedPdf((v) => { v.observations[0]!.raster_width = 1_580; Reflect.set(v.observations[0]!, "width_points", 790); v.observations[0]!.statistics.pixels = 1_933_920; })]);
    cases.push(["incompatible page points", forgedPdf((v) => { v.pages = 2; const second = structuredClone(v.observations[0]!); second.page = 2; Reflect.set(second, "width_points", 841.89); Reflect.set(second, "height_points", 595.28); second.raster_width = 1_684; second.raster_height = 1_191; second.statistics.pixels = 2_005_644; v.observations.push(second); })]);
    const png = receipt("png"); png.validation = { width: 640, height: 240, statistics: { pixels: 153_600, visible_pixels: 153_600, differing_pixels: 100, dominant_ratio: 0.9, luminance_variance: 10, entropy: 0.2 } }; cases.push(["PNG option dimensions", png]);
    const digestForgery = receipt("pdf"); (digestForgery.digests as Record<string, unknown>).options = digest; cases.push(["options digest", digestForgery]);
    const filename = receipt("pdf"); filename.output_file = "nested/artifact.pdf"; cases.push(["output basename", filename]); const size = receipt("pdf"); size.output_size = 0; cases.push(["positive output size", size]); const uppercase = receipt("pdf"); (uppercase.digests as Record<string, unknown>).renderer = "A".repeat(64); cases.push(["lowercase digest", uppercase]);
    for (const [label, value] of cases) expect(() => parseExportReceipt(value), label).toThrow("invalid_receipt");
  });
  test("Given a PNG ZIP receipt When an output identity is forged Then the receipt is rejected", () => {
    // Given
    const value = receipt("png_zip");
    const validation = structuredClone(validations.png_zip);
    validation.outputs[1].sequence = 1;
    value.validation = validation;

    // When / Then
    expect(() => parseExportReceipt(value)).toThrow("invalid_receipt");
  });
  test("rejects non-finite PDF statistics", () => { for (const field of ["dominant_ratio", "luminance_variance", "entropy"] as const) expect(() => parseExportReceipt(forgedPdf((v) => { v.observations[0]!.statistics[field] = Number.POSITIVE_INFINITY; })), field).toThrow("invalid_receipt"); });
});
