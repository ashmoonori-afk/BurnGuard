#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { LOGO_SOURCE_ATTRIBUTE } from "../packages/shared/src/logo";
import { createCanvas, loadImage } from "../packages/backend/src/services/export-native-modules";
import { decodeLogoPng, traceLogoPng } from "../packages/backend/src/services/logo-trace-finalize";
import { LogoDeliverableError } from "../packages/backend/src/services/logo-deliverables";
import { validateLogoSvg } from "../packages/backend/src/services/logo-svg-validation";
import { freezeTraceFixtures } from "./logo-tracer-fixtures";
import fixtureLock from "./logo-tracer-fixtures.json";
import supplementalLock from "./logo-tracer-supplemental.json";

const [dori, sisyphus, output, reference, frozenSynthetic] = process.argv.slice(2);
if (!dori || !sisyphus || !output || !reference) throw new Error("Expected dori, sisyphus, output directories and reference CLI");
const source = "explorations/round-1/candidate-1.png";
const fixtures = await freezeTraceFixtures(dori, sisyphus, output, frozenSynthetic);
const identities = [...fixtureLock, ...supplementalLock];
if (fixtures.length !== identities.length || fixtures.some((f, i) => f.name !== identities[i].name || f.sha256 !== identities[i].sha256)) throw new Error("Fixed fixture identity changed");

type Measurement = {
  readonly fixture: string;
  readonly engine: string;
  readonly iou: number;
  readonly mae: number;
  readonly bytes: number;
  readonly paths: number;
  readonly ms: number;
  readonly validation: string;
};
const rows: Measurement[] = [];
const median = (values: readonly number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const sheets = [
  { name: "dori", fixtures: fixtures.slice(0, 8) },
  { name: "sisyphus", fixtures: fixtures.slice(8, 12) },
  { name: "synthetic", fixtures: fixtures.slice(12, 18) },
  { name: "supplemental", fixtures: fixtures.slice(18) },
];
const captures = new Map<string, Buffer[]>();

function composite(data: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) out[i + c] = Math.round((data[i + c] * data[i + 3] + 255 * (255 - data[i + 3])) / 255);
    out[i + 3] = 255;
  }
  return out;
}
function compare(a: Uint8ClampedArray, b: Uint8ClampedArray): { iou: number; mae: number } {
  let intersection = 0, union = 0, difference = 0;
  for (let i = 0; i < a.length; i += 4) {
    let foregroundA = false, foregroundB = false;
    for (let c = 0; c < 3; c++) {
      foregroundA ||= a[i + c] < 231; foregroundB ||= b[i + c] < 231;
      difference += Math.abs(a[i + c] - b[i + c]);
    }
    if (foregroundA && foregroundB) intersection++;
    if (foregroundA || foregroundB) union++;
  }
  return { iou: union ? intersection / union : 1, mae: difference / (a.length / 4 * 3) };
}

for (const fixture of fixtures) {
  console.log(`MEASURE ${fixture.name}`);
  const png = await readFile(fixture.file);
  if (createHash("sha256").update(png).digest("hex") !== fixture.sha256) throw new Error("Fixture moved");
  const original = await decodeLogoPng(png), originalComposite = composite(original.data);
  const originalCanvas = createCanvas(fixture.width, fixture.height), originalContext = originalCanvas.getContext("2d");
  const originalImageData = originalContext.createImageData(fixture.width, fixture.height);
  originalImageData.data.set(originalComposite); originalContext.putImageData(originalImageData, 0, 0);
  captures.set(fixture.name, [originalCanvas.toBuffer("image/png")]);
  for (const engine of ["ours", "vtracer-polygon", "vtracer-spline"]) {
    const times: number[] = [];
    let svg = "";
    for (let run = 0; run < 4; run++) {
      const start = performance.now();
      if (engine === "ours") svg = await traceLogoPng(png, { source });
      else {
        const target = path.join(output, `${fixture.name}-${engine}.svg`);
        const child = Bun.spawn([reference, "--input", fixture.file, "--output", target, "--max-colors", "8", "--mode", engine === "vtracer-polygon" ? "polygon" : "spline"], {
          stdout: "ignore", stderr: "pipe",
        });
        const timeout = setTimeout(() => child.kill(), 60_000);
        const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]).finally(() => clearTimeout(timeout));
        if (exit !== 0) throw new Error(`Reference failed (${exit}): ${stderr.slice(0, 200)}`);
        svg = await readFile(target, "utf8");
      }
      if (run > 0) times.push(performance.now() - start);
    }
    const bytes = Buffer.byteLength(svg);
    // A required provenance field is the only reference modification, not a sanitizer.
    const validated = engine === "ours" ? svg : svg.replace(/<svg\b/, `<svg ${LOGO_SOURCE_ATTRIBUTE}="${source}"`);
    let validation = "pass";
    try { validateLogoSvg(validated); }
    catch (error) {
      if (error instanceof LogoDeliverableError) validation = error.detail;
      else throw error;
    }
    const canvas = createCanvas(fixture.width, fixture.height), context = canvas.getContext("2d");
    context.fillStyle = "white"; context.fillRect(0, 0, fixture.width, fixture.height);
    context.drawImage(await loadImage(Buffer.from(svg)), 0, 0, fixture.width, fixture.height);
    const metrics = compare(originalComposite, context.getImageData(0, 0, fixture.width, fixture.height).data);
    rows.push({ fixture: fixture.name, engine, ...metrics, bytes, paths: (svg.match(/<path\b/g) ?? []).length, ms: median(times), validation });
    await writeFile(path.join(output, `${fixture.name}-${engine}.svg`), svg);
    if (engine !== "vtracer-spline") captures.get(fixture.name)?.push(canvas.toBuffer("image/png"));
  }
  await writeFile(path.join(output, "measurements.json"), JSON.stringify(rows, null, 2) + "\n");
}
for (const sheet of sheets) {
  const canvas = createCanvas(960, sheet.fixtures.length * 344), context = canvas.getContext("2d");
  context.fillStyle = "#eee"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = "16px sans-serif"; context.fillStyle = "#111";
  for (let row = 0; row < sheet.fixtures.length; row++) {
    const fixture = sheet.fixtures[row], images = captures.get(fixture.name) ?? [];
    for (let column = 0; column < images.length; column++) {
      context.fillText(`${fixture.name} ${["original", "ours", "vtracer polygon"][column]}`, column * 320 + 8, row * 344 + 20);
      context.drawImage(await loadImage(images[column]), column * 320, row * 344 + 24, 320, 320);
    }
  }
  await writeFile(path.join(output, `${sheet.name}-comparison.png`), canvas.toBuffer("image/png"));
}
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "measurements.json"), JSON.stringify(rows, null, 2) + "\n");
const table = [
  "| Fixture | Engine | IoU | MAE /255 | Bytes | Paths | Median ms | Validation |",
  "|---|---|---:|---:|---:|---:|---:|---|",
  ...rows.map(r => `| ${r.fixture} | ${r.engine} | ${r.iou.toFixed(4)} | ${r.mae.toFixed(3)} | ${r.bytes} | ${r.paths} | ${r.ms.toFixed(1)} | ${r.validation} |`),
].join("\n");
await writeFile(path.join(output, "table.md"), table + "\n");
console.log(table);
console.log("MEASUREMENT_COMPLETE");
