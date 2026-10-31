import { expect, test } from "bun:test";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compareBound, measureCalibration, measureConversion, measureScales, MeasurementError,
  parseCalibration, parseCaptured, parseMaximum, parseRgbRows, TOLERANCE,
  type Calibration, type Captured, type MaximumBinding, type MaximumRow } from "./theme-engine-a-measurement";
import { parseMeasureArgs, verifyMeasurementCorpus } from "./theme-engine-measure";
import { CORPUS_ROOT } from "./theme-engine-fixtures";
import type { OracleCase, OracleReceipt } from "./theme-engine-oracle";
import { bundledCanonicalPaths, generateThemeCanonical } from "../build-theme-canonical";
import { emitAppThemeCss, THEME_CONTRAST_PAIRS, THEME_TOKEN_REGISTRY,
  type SemanticTheme } from "../../packages/shared/src/theme";
import { emittedContrast, measureInstalledCanonical, measureTailwindBindings,
  measureThemeCss } from "./theme-engine-b-measurement";

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

test.each(["c", "d"])("Given unsupported section %s When arguments are parsed Then it is rejected", section => {
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
test("Given the C001 section B command When parsed Then existing options and evidence confinement survive", () => {
  const options = parseMeasureArgs(["--section", "b", "--corpus", "packages/backend/tests/fixtures/theme-engine",
    "--output", ".omo/evidence/bg-themes-1028/b/metrics.json", "--python", "unused-python"]);
  expect(options).toMatchObject({ section: "b", corpus: CORPUS_ROOT,
    output: ".omo/evidence/bg-themes-1028/b/metrics.json", python: ["unused-python"] });
  expect(() => parseMeasureArgs(["--section", "b", "--output", "metrics.json"])).toThrow("OUTPUT_PATH");
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

test.each(["a", "b"])("Given missing corpus evidence for section %s When the real CLI runs Then it exits nonzero with sanitized unmeasured schema", async section => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bg-measure-cli-"));
  try {
    const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "theme-engine-measure.ts"),
      "--section", section, "--corpus", root, "--output", "-"],
    { stdout: "pipe", stderr: "pipe", timeout: 10_000, killSignal: "SIGKILL" });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(exit).toBe(1);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ schema_version: 1, section,
      scope: section === "a" ? "A_NUMERICAL_ONLY" : "B_CANONICAL_ROLES_AND_INSTALLED_READBACK",
      status: "FAIL", code: "MEASUREMENT_FAILED", metrics: null, measurement: "UNMEASURED" });
    expect(stdout.includes(root)).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function semanticSample() {
  const repository = path.resolve(import.meta.dir, "../..");
  const files = bundledCanonicalPaths(repository, "light");
  return generateThemeCanonical("light", await readFile(files.palette, "utf8"), await readFile(files.source, "utf8"));
}

test("Given integer black and white When independently measured Then contrast is 21 without production validation", () => {
  expect(emittedContrast([0, 0, 0], [255, 255, 255])).toBe(21);
  expect(emittedContrast([128, 128, 128], [128, 128, 128])).toBe(1);
  expect(() => emittedContrast([0.5, 0, 0], [255, 255, 255])).toThrow("B_CHANNEL_FORMAT");
});

test("Given production semantic output When independently read Then both modes cover every typed role and declared pair", async () => {
  const sample = await semanticSample();
  const modes = measureThemeCss(sample.theme, sample.css, emitAppThemeCss(sample.theme));
  expect(modes.map(mode => mode.mode)).toEqual(["light", "dark"]);
  for (const mode of modes) {
    expect(mode).toMatchObject({ status: "PASS", coverage: 1,
      typed_roles: Object.keys(THEME_TOKEN_REGISTRY).length,
      declared_pairs: THEME_CONTRAST_PAIRS.length, passed_pairs: THEME_CONTRAST_PAIRS.length });
    expect(mode.pairs.every(pair => pair.artifact_ratio === pair.app_ratio)).toBe(true);
    expect(mode.pairs.filter(pair => pair.usage === "body").every(pair => pair.minimum === 4.5)).toBe(true);
    expect(mode.pairs.filter(pair => pair.usage !== "body").every(pair => pair.minimum === 3)).toBe(true);
  }
});

test("Given consistent but low contrast emitted colours When measured Then readback equality cannot hide failed pairs", async () => {
  const sample = await semanticSample();
  const white = { type: "color", space: "srgb", channels: [255, 255, 255] } as const;
  const theme: SemanticTheme = { ...sample.theme, modes: { ...sample.theme.modes,
    light: { ...sample.theme.modes.light, background: white, foreground: white } } };
  const artifact = sample.css.replace(/--background: #[0-9a-f]{6};/, "--background: #ffffff;")
    .replace(/--foreground: #[0-9a-f]{6};/, "--foreground: #ffffff;");
  const app = emitAppThemeCss(sample.theme).replace(/--background: \d+ \d+ \d+;/, "--background: 255 255 255;")
    .replace(/--foreground: \d+ \d+ \d+;/, "--foreground: 255 255 255;");
  const modes = measureThemeCss(theme, artifact, app);
  expect(modes[0]).toMatchObject({ status: "FAIL" });
  expect(modes[0]?.pairs[0]).toMatchObject({ minimum: 4.5, artifact_ratio: 1, app_ratio: 1, status: "FAIL" });
  expect(modes[0]?.pairs.find(pair => pair.usage === "large")).toMatchObject({ minimum: 3, status: "FAIL" });
  expect(modes[1]).toMatchObject({ status: "PASS" });
});

test.each(["#ffffff", "rgb(255 255 255)", "255, 255, 255", "256 0 0", "0.5 0 0"])(
  "Given invalid app colour channels %s When read Then Tailwind-incompatible values fail", async value => {
    const sample = await semanticSample();
    const app = emitAppThemeCss(sample.theme).replace(/--foreground: \d+ \d+ \d+;/, `--foreground: ${value};`);
    expect(() => measureThemeCss(sample.theme, sample.css, app)).toThrow("B_CHANNEL_FORMAT");
  });

test.each(["info", "font-sans", "motion-fast"])(
  "Given a missing %s role When emitted CSS is read Then incomplete coverage fails", async role => {
    const sample = await semanticSample();
    const artifact = sample.css.replace(new RegExp(`  --${role}: [^;]+;\\n`), "");
    expect(() => measureThemeCss(sample.theme, artifact, emitAppThemeCss(sample.theme))).toThrow("B_MISSING_ROLE");
  });

test("Given valid but inconsistent channel readback When measured Then matching CSS syntax is insufficient", async () => {
  const sample = await semanticSample();
  const app = emitAppThemeCss(sample.theme).replace(/--foreground: \d+ \d+ \d+;/, "--foreground: 1 2 3;");
  expect(() => measureThemeCss(sample.theme, sample.css, app)).toThrow("B_COLOR_READBACK");
});

test.each(["json", "css", "skill"] as const)(
  "Given missing or stale installed %s When bound Then generated candidates cannot pass for installed evidence", async member => {
    const sample = await semanticSample();
    const installed = { json: sample.json, css: sample.css, skill: sample.skill };
    const missing = measureInstalledCanonical(sample, { ...installed, [member]: null });
    const changed = measureInstalledCanonical(sample, { ...installed, [member]: `${installed[member]}\n` });
    expect(missing.status).toBe("FAIL");
    expect(missing.members.find(row => row.member === member)?.installed_sha256).toBeNull();
    expect(changed.status).toBe("FAIL");
    expect(changed.members.find(row => row.member === member)?.installed_sha256)
      .not.toBe(changed.members.find(row => row.member === member)?.expected_sha256);
  });

test("Given byte-identical installed canonical files When bound Then all three actual readback hashes match", async () => {
  const sample = await semanticSample();
  const readback = measureInstalledCanonical(sample, { json: sample.json, css: sample.css, skill: sample.skill });
  expect(readback.status).toBe("PASS");
  expect(readback.members.every(member => member.installed_sha256 === member.expected_sha256)).toBe(true);
});

test("Given the real Tailwind configuration When inspected Then its semantic bindings accept integer channels", async () => {
  const config = await readFile(path.resolve(import.meta.dir, "../../packages/frontend/tailwind.config.ts"), "utf8");
  const measured = measureTailwindBindings(config);
  expect(measured.status).toBe("PASS");
  expect(measured.bound_roles).toContain("background");
  expect(measured.bound_roles).toContain("primary-foreground");
});

test("Given a full-colour Tailwind semantic binding When inspected Then alpha-compatible readback fails", async () => {
  const config = await readFile(path.resolve(import.meta.dir, "../../packages/frontend/tailwind.config.ts"), "utf8");
  const invalid = config.replace('border: "rgb(var(--border) / <alpha-value>)"', 'border: "var(--border)"');
  expect(() => measureTailwindBindings(invalid)).toThrow("B_TAILWIND_BINDING");
});
