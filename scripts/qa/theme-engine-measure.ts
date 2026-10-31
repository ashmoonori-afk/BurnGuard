#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { gamutMapOklch } from "../../packages/shared/src/color";
import { CORPUS_ROOT, CorpusError, runCorpus } from "./theme-engine-fixtures";
import { OracleError, runOracle } from "./theme-engine-oracle";
import { MeasurementError, measureCalibration, measureConversion, measureRgbInputs,
  measureScales, oracleInputs, parseCalibration, parseCaptured, parseMaximum, parseRgbRows,
  record, requireMeasurement, TOLERANCE } from "./theme-engine-a-measurement";

const ROOT = path.resolve(import.meta.dir, "../..");
const FROZEN_MANIFEST = "833901ca97c6d006b3ec645001007b60e71abe7a54a66ac8b278cc5ba70b6fef";
const SOURCE_FILES = ["packages/shared/src/color.ts", "packages/shared/src/color-gamut.ts",
  "packages/shared/src/palette.ts",
  "scripts/qa/theme-engine-oracle.ts", "scripts/qa/theme-engine-max-chroma.py",
  "scripts/qa/theme-engine-measure.ts", "scripts/qa/theme-engine-a-measurement.ts"] as const;
export type MeasureOptions = {
  readonly corpus: string; readonly output: string; readonly python: readonly string[];
  readonly section?: "a" | "b";
};
export function parseMeasureArgs(args: readonly string[]): MeasureOptions {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    requireMeasurement(key !== undefined && ["--section", "--corpus", "--output", "--python"].includes(key)
      && value !== undefined && value.length > 0 && !value.startsWith("--") && !values.has(key), "USAGE");
    values.set(key, value);
  }
  const section = values.get("--section");
  requireMeasurement(section === "a" || section === "b", "UNSUPPORTED_SECTION");
  const output = values.get("--output") ?? "-";
  if (output !== "-") {
    const relative = path.relative(path.join(ROOT, ".omo/evidence"), path.resolve(ROOT, output));
    requireMeasurement(relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)
      && relative.endsWith(".json"), "OUTPUT_PATH");
  }
  return { section, corpus: path.resolve(ROOT, values.get("--corpus") ?? CORPUS_ROOT), output,
    python: values.has("--python") ? [values.get("--python") ?? ""]
      : process.platform === "win32" ? ["py", "-3"] : ["python3"] };
}
function digest(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export async function verifyMeasurementCorpus(root: string): Promise<string> {
  const bytes = await readFile(path.join(root, "manifest.json"));
  requireMeasurement(digest(bytes) === FROZEN_MANIFEST, "MANIFEST_IDENTITY");
  await runCorpus("verify", root);
  return digest(bytes);
}
async function sourceHashes(files: readonly string[] = SOURCE_FILES): Promise<Readonly<Record<string, string>>> {
  return Object.fromEntries(await Promise.all(files.map(async name =>
    [name, digest(await readFile(path.join(ROOT, name)))])));
}
async function pythonProcess(command: readonly string[], input: string): Promise<string> {
  requireMeasurement(command[0] !== undefined && Bun.which(command[0]) !== null, "PYTHON_PREREQUISITE");
  const child = Bun.spawn([...command], { cwd: ROOT, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => {
    child.stdin.write(input);
    await child.stdin.end();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = child.stdout.getReader();
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.byteLength;
        requireMeasurement(size <= 1024 * 1024, "MAXIMUM_RECEIPT_LIMIT");
        chunks.push(chunk);
      }
    } finally { reader.releaseLock(); }
    requireMeasurement(await child.exited === 0, "PYTHON_FAILED");
    return Buffer.concat(chunks).toString("utf8");
  })();
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new MeasurementError("PYTHON_TIMEOUT")), 120_000);
    })]);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill("SIGKILL");
    await child.exited;
    // Observe the reader even on a deadline/limit failure; it cannot escape its owner.
    await work.then(() => undefined, () => undefined);
  }
}
async function independentMaximum(options: MeasureOptions, production: string) {
  const probe = JSON.parse(await pythonProcess([...options.python, "-c",
    "import json,sys; print(json.dumps({'supported':sys.version_info >= (3,12)})); sys.exit(0 if sys.version_info >= (3,12) else 1)"], ""));
  requireMeasurement(record(probe).supported === true, "PYTHON_PREREQUISITE");
  const raw = await pythonProcess([...options.python, path.join(import.meta.dir, "theme-engine-max-chroma.py"),
    path.join(options.corpus, "baseline/calibration.json")], production);
  return { value: JSON.parse(raw), sha256: digest(raw) };
}
export async function measureSectionA(options: MeasureOptions) {
  const manifest = await verifyMeasurementCorpus(options.corpus);
  const hashes = await sourceHashes();
  const load = async (name: string): Promise<unknown> =>
    JSON.parse(await readFile(path.join(options.corpus, "baseline", name), "utf8"));
  const captured = parseCaptured(await load("captured-reference.json"));
  const calibrationBytes = await readFile(path.join(options.corpus, "baseline/calibration.json"), "utf8");
  const calibration = parseCalibration(JSON.parse(calibrationBytes));
  const cases = calibration.filter(c => c.comparison);
  const production = cases.map(c => ({ id: c.id, color: gamutMapOklch(c.requested, c.gamut) }));
  const productionBytes = JSON.stringify(production);
  const binding = { cases, production, input_sha256: digest(calibrationBytes), production_sha256: digest(productionBytes) };
  const maximum = await independentMaximum(options, productionBytes);
  const maxima = parseMaximum(maximum.value, binding);
  const mapping = measureCalibration(binding, maxima);
  const scales = measureScales(captured);
  const brands = measureRgbInputs(parseRgbRows(await load("brand-anchors.json"), 43));
  const edges = measureRgbInputs(parseRgbRows(await load("boundary-colors.json"), 54));
  const rgb = [...parseRgbRows(await load("oracle-srgb.json"), 4096, "srgb"),
    ...parseRgbRows(await load("oracle-display-p3.json"), 4096, "display-p3")];
  const inputs = oracleInputs(rgb);
  const receipt = await runOracle(inputs);
  const conversion = measureConversion(inputs, receipt);
  requireMeasurement(await verifyMeasurementCorpus(options.corpus) === manifest
    && isDeepStrictEqual(hashes, await sourceHashes()), "INPUT_CHANGED_DURING_MEASUREMENT");
  const rawFailures = mapping.filter(r => !r.captured_strict_membership).map(r => r.id);
  // The exception applies to these original observations only, never a newly failed row.
  const expectedFailures = ["brand-outside-srgb", "brand-outside-p3", "brand-blue-outside-srgb",
    "brand-blue-outside-p3", "brand-near-white-srgb", "brand-near-white-p3",
    "brand-near-black-srgb", "brand-near-black-p3"];
  const exceptionMatches = isDeepStrictEqual([...rawFailures].sort(), [...expectedFailures].sort());
  const passed = exceptionMatches && [...mapping, ...scales, ...brands, ...edges, ...conversion].every(r => r.status === "PASS");
  return { schema_version: 1, section: "a", scope: "A_NUMERICAL_ONLY", status: passed ? "PASS" : "FAIL",
    excluded_acceptance: ["feature-controls", "UI", "persistence", "43-installed-output", "legacy-preservation"],
    identity: { manifest_sha256: manifest, source_sha256: hashes },
    tolerance: TOLERANCE,
    default_sampling: { method: "production-default-curve-at-frozen-positions-and-scale-hues",
      neutral_excluded_from_chromatic_spread: true, mapping_drift_source: "calibration-exact-anchors",
      intentional_default_hue_variation: "reported-as-absolute-delta-not-mapping-drift" },
    scales, calibration: { rows: mapping, rawParity: rawFailures.length ? "FAILED" : "PASS",
      captured_out_of_gamut_ids: rawFailures, captured_out_of_gamut_count: rawFailures.length,
      approved_exception_matches: exceptionMatches,
      excluded_observations: calibration.filter(c => !c.comparison).map(c => ({ id: c.id, reason: "gamut-switch-not-fresh-request" })) },
    brands: { input_count: 43, rows: brands }, edges: { input_count: 54, rows: edges },
    conversion: { method: "independent-chromium-css-canvas-native-gamut", input_count: inputs.length,
      input_sha256: digest(JSON.stringify(inputs)), receipt_sha256: digest(JSON.stringify(receipt)), rows: conversion, receipt },
    maximum_oracle: { method: "decimal-outward-90-six-face-v1", receipt_sha256: maximum.sha256, receipt: maximum.value } };
}
export async function measureSectionB(options: MeasureOptions) {
  const manifest = await verifyMeasurementCorpus(options.corpus);
  const { B_SOURCE_FILES, measureBundledThemes } = await import("./theme-engine-b-measurement");
  const hashes = await sourceHashes(B_SOURCE_FILES);
  try {
    const result = await measureBundledThemes(ROOT);
    return { schema_version: 1, section: "b", scope: "B_CANONICAL_ROLES_AND_INSTALLED_READBACK",
      ...result, identity: { manifest_sha256: manifest, source_sha256: hashes },
      excluded_acceptance: ["A-conversion-oracle", "runtime-UI", "canonical-authority-history"] };
  } finally {
    requireMeasurement(await verifyMeasurementCorpus(options.corpus) === manifest
      && isDeepStrictEqual(hashes, await sourceHashes(B_SOURCE_FILES)), "INPUT_CHANGED_DURING_MEASUREMENT");
  }
}
async function emit(output: string, report: unknown): Promise<void> {
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (output === "-") { process.stdout.write(json); return; }
  const target = path.resolve(ROOT, output), parent = path.dirname(target);
  // Only the requested ignored evidence tree may be written, with no symlink hops.
  let cursor = ROOT;
  for (const segment of path.relative(ROOT, parent).split(path.sep)) {
    cursor = path.join(cursor, segment);
    await mkdir(cursor, { recursive: true });
    const stat = await lstat(cursor);
    requireMeasurement(stat.isDirectory() && !stat.isSymbolicLink(), "OUTPUT_PATH");
  }
  try {
    const stat = await lstat(target);
    requireMeasurement(stat.isFile() && !stat.isSymbolicLink(), "OUTPUT_PATH");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  await writeFile(target, json);
}
export async function main(args: readonly string[]): Promise<number> {
  let options: MeasureOptions | undefined;
  try {
    options = parseMeasureArgs(args);
    const report = options.section === "b" ? await measureSectionB(options) : await measureSectionA(options);
    await emit(options.output, report);
    return report.status === "PASS" ? 0 : 1;
  } catch (error) {
    const code = error instanceof MeasurementError ? error.code : error instanceof CorpusError ? "CORPUS_MISMATCH"
      : error instanceof OracleError ? error.code : error instanceof SyntaxError ? "EVIDENCE_JSON" : "MEASUREMENT_FAILED";
    const section = options?.section ?? "a";
    const failure = { schema_version: 1, section,
      scope: section === "b" ? "B_CANONICAL_ROLES_AND_INSTALLED_READBACK" : "A_NUMERICAL_ONLY", status: "FAIL",
      code, metrics: null, measurement: "UNMEASURED" };
    try { await emit(options?.output ?? "-", failure); }
    catch (writeError) {
      process.stdout.write(`${JSON.stringify({ ...failure,
        code: writeError instanceof MeasurementError ? writeError.code : "OUTPUT_FAILED" })}\n`);
    }
    return 1;
  }
}
if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
