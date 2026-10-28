import { expect, test } from "bun:test";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compareBound, measureCalibration, measureConversion, measureScales, MeasurementError,
  parseCalibration, parseCaptured, parseMaximum, parseRgbRows, TOLERANCE,
  type Calibration, type Captured, type MaximumBinding, type MaximumRow } from "./theme-engine-a-measurement";
import { parseMeasureArgs, verifyMeasurementCorpus } from "./theme-engine-measure";
import { CORPUS_ROOT } from "./theme-engine-fixtures";
import type { OracleCase, OracleReceipt } from "./theme-engine-oracle";

test("Given a positive sub-tolerance excess When compared Then strict safety still fails", () => {
  // Given: Number(lower) rounds to the very same binary value as production.
  const bracket = { lo: "0.199999999999999999999999999999", hi: "0.200000000000000000000000000001" };
  // When
  const result = compareBound(0.2, bracket);
  // Then
  expect(Number(bracket.lo)).toBe(0.2);
  expect(result).toMatchObject({ strict_safe_bound: false, within_chroma_tolerance: true });
});

test("Given a safe but excessive deficit When compared Then tolerance fails independently", () => {
  const bracket = { lo: "0.2", hi: "0.200000000000000000001" };
  const result = compareBound(0.1999998, bracket);
  expect(result).toMatchObject({ strict_safe_bound: true, within_chroma_tolerance: false });
});

test.each([
  { lo: "0.2", hi: "0.2" }, { lo: "0.2", hi: "0.1" }, { lo: "0.2", hi: "0.2000001" },
  { lo: "-0.1", hi: "0" }, { lo: "NaN", hi: "1" }, { lo: "0", hi: "1e999999" },
])("Given an invalid maximum bracket %# When compared Then no safety result is emitted", bracket => {
  expect(() => compareBound(0.2, bracket)).toThrow(MeasurementError);
});

const calibration: Calibration = { id: "synthetic", gamut: "srgb", comparison: true,
  requested: { l: 0.7, c: 0.4, h: 30 }, delivered: { l: 0.7, c: 0.2000001, h: 30 } };
// Synthetic arithmetic/structure fixtures are not independent oracle execution evidence.
const maximum: MaximumRow = { id: "synthetic", gamut: "srgb", captured_c: "0.2000001",
  independent_max_c: "0.199999999999999999999999999999",
  bracket: { lo: "0.199999999999999999999999999999", hi: "0.200000000000000000000000000001" },
  production_c: "0.2", delta_c: "0.000000000000000000000000000001",
  captured_member: false, production_member: true };
const binding: MaximumBinding = { input_sha256: "a".repeat(64), production_sha256: "b".repeat(64),
  cases: [calibration], production: [{ id: "synthetic", color: { l: 0.7, c: 0.2, h: 30 } }] };

test("Given an escaped capture and tiny bound excess When joined Then neither strict acceptance nor raw parity passes", () => {
  const rows = measureCalibration(binding, [maximum]);
  expect(rows[0]).toMatchObject({ rawParity: "FAILED", within_chroma_tolerance: true,
    strict_safe_bound: false, status: "FAIL", comparison: "independent-maximum" });
});

test("Given a gray comparison When joined Then neither ratio nor hue drift divides by zero", () => {
  const gray = { ...calibration, requested: { l: 0.5, c: 0, h: 0 }, delivered: { l: 0.5, c: 0, h: 0 } };
  const input = { ...binding, cases: [gray], production: [{ id: "synthetic", color: gray.requested }] };
  const rows = measureCalibration(input, [{ ...maximum, production_c: "0", captured_c: "0", captured_member: true }]);
  expect(rows[0]).toMatchObject({ reference_retention: null, production_retention: null,
    reference_hue_drift: null, production_hue_drift: null, comparison: "ordinary-parity", status: "PASS" });
});

test("Given ordinary in-gamut parity with lost chroma When joined Then a large geometric bound does not excuse it", () => {
  const ordinary = { ...calibration, delivered: { l: 0.7, c: 0.12, h: 30 } };
  const input = { ...binding, cases: [ordinary], production: [{ id: "synthetic", color: { l: 0.7, c: 0.1, h: 30 } }] };
  const rows = measureCalibration(input, [{ ...maximum, captured_member: true, production_c: "0.1" }]);
  expect(rows[0]).toMatchObject({ rawParity: "FAILED", status: "FAIL", comparison: "ordinary-parity" });
});

const receiptShape = { schema_version: 1, method: "decimal-outward-90-six-face-v1",
  input_sha256: binding.input_sha256, production_sha256: binding.production_sha256,
  controls: { srgb: 9, "display-p3": 9 }, rows: [maximum] };
test("Given synthetic bound receipt structure When parsed Then decimal precision is preserved", () => {
  // This checks decoding, not the truth of an external oracle result.
  const rows = parseMaximum(receiptShape, binding);
  expect(rows.map(r => ({ lo: r.bracket.lo, delta: r.delta_c, captured: r.captured_member }))).toEqual([
    { lo: "0.199999999999999999999999999999", delta: "0.000000000000000000000000000001", captured: false },
  ]);
});
test.each([
  { ...receiptShape, rows: [] }, { ...receiptShape, input_sha256: "c".repeat(64) },
  { ...receiptShape, production_sha256: "c".repeat(64) }, { ...receiptShape, controls: { srgb: 9 } },
  { ...receiptShape, rows: [{ ...maximum, id: "other" }] },
  { ...receiptShape, rows: [{ ...maximum, production_c: "0.1" }] },
  { ...receiptShape, rows: [{ ...maximum, delta_c: "0" }] },
  { ...receiptShape, rows: [{ ...maximum, captured_member: "true" }] },
  { ...receiptShape, private: "/private/path" },
])("Given altered or incomplete maximum evidence %# When parsed Then its binding fails", value => {
  expect(() => parseMaximum(value, binding)).toThrow(MeasurementError);
});

test("Given frozen inputs with altered tolerance When parsed Then acceptance cannot be relaxed", () => {
  expect(() => parseCalibration({ tolerance: { ...TOLERANCE, chroma: 1e-6 }, cases: [] })).toThrow(MeasurementError);
});

test.each([
  { rows: [] }, { rows: [{ id: "one", gamut: "srgb", rgb: [0, 0] }] },
  { rows: [{ id: "one", gamut: "srgb", rgb: [0, NaN, 0] }] },
  { rows: [{ id: "one", gamut: "p3", rgb: [0, 0, 0] }] },
])("Given partial or invalid RGB evidence %# When parsed Then it is rejected", value => {
  expect(() => parseRgbRows(value, 1)).toThrow(MeasurementError);
});

test("Given a missing captured row When parsed Then no partial scale comparison is possible", () => {
  expect(() => parseCaptured({ rows: [] })).toThrow(MeasurementError);
});

test("Given nonuniform reference scales When measured Then actual reference spreads and monotonicity survive", () => {
  // Given: the fixture deliberately differs by hue and reverses one final lightness.
  const rows: readonly Captured[] = (["srgb", "display-p3"] as const).flatMap(gamut =>
    ["Violet", "Blue", "Green", "Amber", "Red", "Neutral"].flatMap((scale, hue) =>
      Array.from({ length: 12 }, (_, step) => ({ id: `${gamut}-${scale}-${step}`, gamut, scale, hue: hue * 60,
        position: (step + 1) / 14, color: { l: step === 11 ? 0.99 : 0.9 - step / 20,
          c: scale === "Neutral" ? 0 : hue / 100, h: hue * 60 } }))));
  // When
  const result = measureScales(rows);
  // Then
  for (const row of result) {
    expect(row.reference.chroma_spread).toBe(0.04);
    expect(row.reference.monotonic_failures).toHaveLength(6);
    expect(row.production.lightness_spread).toBe(0);
    expect(row.production.chroma_spread).toBe(0);
    expect(row.production.monotonic_failures).toEqual([]);
  }
});

function syntheticConversion() {
  const cases: readonly OracleCase[] = Array.from({ length: 8192 }, (_, i) => ({
    id: `synthetic-${i}`, gamut: i < 4096 ? "srgb" : "display-p3", l: 0.5, c: 0, h: null,
    expectedRgb: [0, 0.5, 1],
  }));
  const receipt: OracleReceipt = { schema_version: 1, code: "OK", channel_denominator: 255,
    rows: cases.map(c => ({ id: c.id, gamut: c.gamut, oklchRgba: [0, 128, 255, 255], controlRgba: [0, 128, 255, 255] })) };
  return { cases, receipt };
}
test("Given a two-channel-unit conversion error When measured Then the affected gamut fails", () => {
  const { cases, receipt } = syntheticConversion();
  const changed = { ...receipt, rows: receipt.rows.map((r, i) => i === 0 ? { ...r, oklchRgba: [2, 128, 255, 255] } : r) };
  const result = measureConversion(cases, changed);
  expect(result[0]).toMatchObject({ samples: 4096, max_channel_error: 2 / 255, status: "FAIL" });
  expect(result[1]).toMatchObject({ samples: 4096, max_control_error: 0, status: "PASS" });
});
test("Given a partial Chromium receipt When measured Then no missing sample is counted as a pass", () => {
  const { cases, receipt } = syntheticConversion();
  expect(() => measureConversion(cases, { ...receipt, rows: receipt.rows.slice(1) })).toThrow(MeasurementError);
});
test("Given nonopaque Chromium output When measured Then receipt validation fails", () => {
  const { cases, receipt } = syntheticConversion();
  const changed = { ...receipt, rows: receipt.rows.map((r, i) => i === 0 ? { ...r, controlRgba: [0, 128, 255, 0] } : r) };
  expect(() => measureConversion(cases, changed)).toThrow(MeasurementError);
});

test.each(["b", "c", "d"])("Given unsupported section %s When arguments are parsed Then it is rejected", section => {
  expect(() => parseMeasureArgs(["--section", section])).toThrow("UNSUPPORTED_SECTION");
});
test.each([
  { args: ["--section", "a", "--output", "packages/metrics.json"] },
  { args: ["--section", "a", "--output", "../metrics.json"] },
  { args: ["--section", "a", "--output"] }, { args: ["--section", "a", "--section", "a"] },
  { args: ["--unknown", "a"] },
])("Given invalid CLI arguments %# When parsed Then no command starts", ({ args }) => {
  expect(() => parseMeasureArgs(args)).toThrow(MeasurementError);
});
test("Given the plain section A command When parsed Then the frozen corpus default is reproducible", () => {
  expect(parseMeasureArgs(["--section", "a"]).corpus).toBe(CORPUS_ROOT);
});

test("Given the original frozen corpus When verified Then its original byte digest is accepted", async () => {
  // Given
  const root = CORPUS_ROOT;
  // When
  const digest = await verifyMeasurementCorpus(root);
  // Then
  expect(digest).toBe("833901ca97c6d006b3ec645001007b60e71abe7a54a66ac8b278cc5ba70b6fef");
});

test("Given altered or partial manifest evidence When verified Then measurement cannot start", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bg-measure-manifest-"));
  try {
    await writeFile(path.join(root, "manifest.json"), "{}\n");
    await expect(verifyMeasurementCorpus(root)).rejects.toMatchObject({ code: "MANIFEST_IDENTITY" });
    await copyFile(path.join(CORPUS_ROOT, "manifest.json"), path.join(root, "manifest.json"));
    await expect(verifyMeasurementCorpus(root)).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Given missing corpus evidence When the real CLI runs Then it exits nonzero with sanitized unmeasured schema", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bg-measure-cli-"));
  try {
    const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "theme-engine-measure.ts"),
      "--section", "a", "--corpus", root, "--output", "-"],
    { stdout: "pipe", stderr: "pipe", timeout: 10_000, killSignal: "SIGKILL" });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(exit).toBe(1);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ schema_version: 1, section: "a", scope: "A_NUMERICAL_ONLY",
      status: "FAIL", code: "MEASUREMENT_FAILED", metrics: null, measurement: "UNMEASURED" });
    expect(stdout.includes(root)).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
