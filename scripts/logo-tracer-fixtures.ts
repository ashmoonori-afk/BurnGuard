import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "../packages/backend/src/services/export-native-modules";

export const SYNTHETIC_MARKS = [
  ["rectangle", '<path fill="#18243c" d="M20 25H108V103H20Z"/>'],
  ["ring", '<path fill="#18243c" fill-rule="evenodd" d="M16 16H112V112H16ZM40 40H88V88H40Z"/>'],
  ["diagonal", '<path fill="#18243c" d="M16 16H64V64H16ZM64 64H112V112H64Z"/>'],
  ["thin-cross", '<path fill="#18243c" d="M62 16H66V62H112V66H66V112H62V66H16V62H62Z"/>'],
  ["three-color", '<path fill="#e25636" d="M12 12H116V116H12Z"/><path fill="#18243c" d="M32 32H96V96H32Z"/><circle fill="#e7c352" cx="64" cy="64" r="16"/>'],
  ["transparent-disk", '<circle fill="#245cbe" cx="64" cy="64" r="43"/>'],
] as const;

export type TraceFixture = {
  readonly name: string;
  readonly file: string;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
};

export async function freezeTraceFixtures(dori: string, sisyphus: string, output: string, frozenSynthetic?: string): Promise<readonly TraceFixture[]> {
  await mkdir(output, { recursive: true });
  const inputs = [
    ...["idea-1", "idea-2", "idea-3", "v2-candidate-1", "v2-candidate-2", "v2-candidate-3", "v2-candidate-4", "candidate-4"]
      .map(name => ({ name: `dori-${name}`, file: path.join(dori, `${name}.png`) })),
    ...[1, 2, 3, 4].map(n => ({ name: `sisyphus-${n}`, file: path.join(sisyphus, `option-${n}-illustration.png`) })),
  ];
  for (const [name, body] of SYNTHETIC_MARKS) {
    if (frozenSynthetic) {
      inputs.push({ name, file: path.join(frozenSynthetic, `${name}.png`) });
      continue;
    }
    const image = await loadImage(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">${name === "transparent-disk" ? "" : '<path fill="white" d="M0 0H128V128H0Z"/>'}${body}</svg>`));
    const canvas = createCanvas(128, 128);
    canvas.getContext("2d").drawImage(image, 0, 0);
    const file = path.join(output, `${name}.png`);
    await writeFile(file, canvas.toBuffer("image/png"));
    inputs.push({ name, file });
  }
  // Keep the original 18 identities and order; cover the rest of the requested glob separately.
  for (const name of ["candidate-1", "candidate-2", "candidate-3", "access-expired", "failure-panel"]) {
    inputs.push({ name: `supplemental-${name}`, file: path.join(dori, `${name}.png`) });
  }
  const fixtures: TraceFixture[] = [];
  for (const input of inputs) {
    const bytes = await readFile(input.file);
    // PNG IHDR is sufficient for freezing dimensions; tracing owns full decode.
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`Not a PNG: ${input.name}`);
    fixtures.push({ ...input, sha256: createHash("sha256").update(bytes).digest("hex"), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
  }
  // The public lock contains identities, not private absolute paths.
  await writeFile(path.join(output, "fixtures.json"), JSON.stringify(fixtures.map(({ file, ...fixture }) => fixture), null, 2) + "\n");
  return fixtures;
}

if (import.meta.main) {
  const [dori, sisyphus, output, frozenSynthetic] = process.argv.slice(2);
  if (!dori || !sisyphus || !output) throw new Error("Expected dori directory, sisyphus directory, output directory");
  const fixtures = await freezeTraceFixtures(dori, sisyphus, output, frozenSynthetic);
  console.log(JSON.stringify(fixtures.map(({ file, ...fixture }) => fixture), null, 2));
}
