import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import * as zlib from "node:zlib";
import { LOGO_MAX_ROUNDS, LOGO_PAGE, LOGO_SOURCE_ATTRIBUTE, type LogoManifestV1 } from "@bg/shared";
import {
  assertLogoDeliverables,
  captureLogoTurnExpectation,
  isLogoImageGeneration,
  LogoDeliverableError,
  MAX_GUIDELINE_PAGES,
  REQUIRED_GUIDELINE_PAGES,
  readLogoManifest,
  scanExplorationHashes,
  validateLogoSvg,
} from "../src/services/logo-deliverables";
import { pdfRasterBudgetFitsPages } from "../src/services/export-pdf-contract";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** The old positive fixture: a signature and two bytes, no IHDR, no image data. Must be refused. */
const HEADER_ONLY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x0d]);
const STARTER = [
  "<!doctype html><html><body>",
  '<section data-graphic-artboard id="frame-1-logo-brief" style="width:1920px;height:1080px">',
  '<h1 data-bg-node-id="logo-brief">누림</h1>',
  "<p>Four logo candidates will appear here after the first turn.</p>",
  "</section></body></html>",
].join("");
const SELECT_2 = '<burnguard-logo-action-v1>{"action":"select","round":1,"candidate_id":"candidate-2"}</burnguard-logo-action-v1>';
const REGENERATE = '<burnguard-logo-action-v1>{"action":"regenerate"}</burnguard-logo-action-v1>';
/** Evidence as turns.ts would collect it: every candidate on disk was an output of this turn's image tool. */
async function evidence(dir: string, imageGenerations = 1): Promise<{ imageGenerations: number; imageOutputs: ReadonlySet<string> }> {
  return { imageGenerations, imageOutputs: new Set((await scanExplorationHashes(dir)).values()) };
}

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function stage(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "burnguard-logo-deliverables-"));
  directories.push(directory);
  return directory;
}

/** A real, decodable 8-bit grayscale PNG; `seed` changes the pixels so two fixtures never share bytes. */
function png(width: number, height: number, seed: number): Buffer {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) raw[y * (width + 1) + 1 + x] = (x * 7 + y * 3 + seed) & 0xff;
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed) >>> 0, 0);
    return Buffer.concat([length, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * A PNG whose chunks are all CRC-valid but whose image content may be illegal. Every value defaults
 * to the legal grayscale 8-bit image from png(); each override is one way a decoder must refuse it.
 */
function pngRaw(options: { readonly width?: number; readonly height?: number; readonly bitDepth?: number; readonly colourType?: number; readonly idat?: Buffer; readonly filterByte?: number; readonly rows?: number } = {}): Buffer {
  const width = 256;
  const height = options.rows ?? 256;
  const raw = Buffer.alloc((width + 1) * height, 1);
  for (let y = 0; y < height; y += 1) raw[y * (width + 1)] = options.filterByte ?? 0;
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed) >>> 0, 0);
    return Buffer.concat([length, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(options.width ?? width, 0);
  ihdr.writeUInt32BE(options.height ?? 256, 4);
  ihdr[8] = options.bitDepth ?? 8;
  ihdr[9] = options.colourType ?? 0;
  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", options.idat ?? deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function candidateBytes(round: number, index: number): Buffer {
  return png(256, 256, round * 16 + index);
}

function manifestOf(rounds: number, selected: LogoManifestV1["selected"] = null): LogoManifestV1 {
  return {
    schema_version: 1,
    rounds: Array.from({ length: rounds }, (_, index) => ({
      round: index + 1,
      candidates: Array.from({ length: 4 }, (_, position) => ({
        id: `candidate-${position + 1}`,
        file: `explorations/round-${index + 1}/candidate-${position + 1}.png`,
        logo_type: "combination" as const,
        prompt: "flat vector mark on a plain ground",
        rationale: "balanced counterform",
      })),
    })),
    selected,
  };
}

async function writeManifest(dir: string, value: unknown): Promise<void> {
  await mkdir(path.join(dir, "explorations"), { recursive: true });
  await writeFile(
    path.join(dir, "explorations", "manifest.json"),
    typeof value === "string" ? value : JSON.stringify(value),
  );
}

async function writeCandidates(
  dir: string,
  round: number,
  overrides: Readonly<Record<string, Buffer | null>> = {},
): Promise<void> {
  const roundDir = path.join(dir, "explorations", `round-${round}`);
  await mkdir(roundDir, { recursive: true });
  for (let index = 1; index <= 4; index += 1) {
    const id = `candidate-${index}`;
    const bytes = id in overrides ? overrides[id] : candidateBytes(round, index);
    if (bytes === null || bytes === undefined) continue;
    await writeFile(path.join(roundDir, `${id}.png`), bytes);
  }
}

function guidelines(pages: number, stamp = ""): string {
  const sections = Array.from(
    { length: pages },
    (_, index) => `<section data-graphic-artboard id="page-${index + 1}" style="width:1920px;height:1080px"><h1>Page ${index + 1}${stamp}</h1></section>`,
  ).join("");
  return `<!doctype html><html lang="ko"><body>${sections}</body></html>`;
}

function logoSvg(source: string, body = '<path d="M0 0H512V512H0Z"/>', attributes = 'viewBox="0 0 512 512"'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${attributes} ${LOGO_SOURCE_ATTRIBUTE}="${source}">${body}</svg>`;
}

function svgDetail(text: string): string {
  try {
    validateLogoSvg(text);
  } catch (error) {
    if (error instanceof LogoDeliverableError) return error.detail;
    throw error;
  }
  return "ok";
}

/** A project as it stands before the turn: `rounds` explored rounds and their candidate sheet. */
async function priorProject(rounds: number, selected: LogoManifestV1["selected"] = null): Promise<string> {
  const dir = await stage();
  if (rounds === 0) {
    await writeFile(path.join(dir, "index.html"), STARTER);
    return dir;
  }
  await writeManifest(dir, manifestOf(rounds, selected));
  for (let round = 1; round <= rounds; round += 1) await writeCandidates(dir, round);
  await writeFile(path.join(dir, "index.html"), guidelines(1, ` round ${rounds}`));
  return dir;
}

/** What a compliant explore turn leaves behind on top of `rounds - 1` prior rounds. */
async function exploreResult(dir: string, rounds: number): Promise<void> {
  await writeManifest(dir, manifestOf(rounds));
  await writeCandidates(dir, rounds);
  await writeFile(path.join(dir, "index.html"), guidelines(1, ` round ${rounds}`));
}

/** What a compliant finalize turn leaves behind after selecting round 1 candidate 2. */
async function finalizeResult(dir: string, options: { readonly svg?: string | null; readonly pages?: number; readonly selected?: LogoManifestV1["selected"] } = {}): Promise<void> {
  const selected = options.selected === undefined ? { round: 1, candidate_id: "candidate-2" } : options.selected;
  await writeManifest(dir, manifestOf(1, selected));
  await writeFile(path.join(dir, "index.html"), guidelines(options.pages ?? 8));
  const svg = options.svg === undefined ? logoSvg("explorations/round-1/candidate-2.png") : options.svg;
  if (svg !== null) await writeFile(path.join(dir, "logo.svg"), svg);
}

describe("logo manifest reader", () => {
  test("Given no manifest When read Then null is returned", async () => {
    expect(await readLogoManifest(await stage())).toBeNull();
  });

  test("Given a manifest When read Then it is parsed", async () => {
    const dir = await stage();
    await writeManifest(dir, manifestOf(1));
    expect(await readLogoManifest(dir)).toEqual(manifestOf(1));
  });

  test("Given unparseable JSON When read Then a typed deliverable error is thrown", async () => {
    const dir = await stage();
    await writeManifest(dir, "{ not json");
    await expect(readLogoManifest(dir)).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "manifest_invalid:json",
    });
  });

  test("Given a manifest that breaks the contract When read Then the field path is reported", async () => {
    const dir = await stage();
    await writeManifest(dir, { schema_version: 1, rounds: [{ round: 1, candidates: [] }], selected: null });
    await expect(readLogoManifest(dir)).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "manifest_invalid:rounds.0.candidates",
    });
  });
});

describe("logo turn expectation (captured before the agent runs)", () => {
  test("Given a fresh project When captured Then the phase is explore for round 1", async () => {
    const expectation = await captureLogoTurnExpectation(await priorProject(0), "로고 만들어줘");
    expect(expectation).toMatchObject({ phase: "explore", nextRound: 1, selected: null });
    expect(expectation.priorGuidelines).toBe(STARTER);
  });

  test("Given one explored round and a regenerate action When captured Then the next round is 2 and every prior candidate is hashed", async () => {
    const expectation = await captureLogoTurnExpectation(await priorProject(1), REGENERATE);
    expect(expectation).toMatchObject({ phase: "explore", nextRound: 2 });
    expect(expectation.priorCandidates.size).toBe(4);
  });

  test("Given a corrupt manifest When captured Then the turn starts over at round 1 instead of trusting it", async () => {
    const dir = await priorProject(1);
    await writeManifest(dir, "{ not json");
    expect(await captureLogoTurnExpectation(dir, REGENERATE)).toMatchObject({ phase: "explore", nextRound: 1 });
  });

  test("Given the round cap is reached When a regenerate is requested Then it is refused before the turn", async () => {
    await expect(captureLogoTurnExpectation(await priorProject(LOGO_MAX_ROUNDS), REGENERATE)).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "rounds_exhausted",
    });
  });

  test("Given a select action When captured Then the phase is finalize and the selected bytes are pinned", async () => {
    const expectation = await captureLogoTurnExpectation(await priorProject(1), SELECT_2);
    expect(expectation.phase).toBe("finalize");
    expect(expectation.selected).toMatchObject({ round: 1, candidate_id: "candidate-2", file: "explorations/round-1/candidate-2.png" });
    expect(expectation.selected?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("Given a select action naming a candidate the project does not have When captured Then it is refused before the turn", async () => {
    const stray = '<burnguard-logo-action-v1>{"action":"select","round":2,"candidate_id":"candidate-1"}</burnguard-logo-action-v1>';
    await expect(captureLogoTurnExpectation(await priorProject(1), stray)).rejects.toMatchObject({ detail: "selection_unknown" });
    const dir = await priorProject(1);
    await rm(path.join(dir, "explorations", "round-1", "candidate-2.png"));
    await expect(captureLogoTurnExpectation(dir, SELECT_2)).rejects.toMatchObject({ detail: "candidate_missing:candidate-2" });
  });
});

describe("logo explore deliverables", () => {
  test("Given a first round of four generated candidates When asserted Then it passes", async () => {
    const dir = await priorProject(0);
    const expectation = await captureLogoTurnExpectation(dir, "로고 만들어줘");
    await exploreResult(dir, 1);
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).resolves.toBeUndefined();
  });

  test("Given a regenerate that appends round 2 When asserted Then it passes", async () => {
    const dir = await priorProject(1);
    const expectation = await captureLogoTurnExpectation(dir, REGENERATE);
    await exploreResult(dir, 2);
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).resolves.toBeUndefined();
  });

  test("Given no successful image-generation tool call in the turn When asserted Then the round is refused", async () => {
    const dir = await priorProject(0);
    const expectation = await captureLogoTurnExpectation(dir, "로고 만들어줘");
    await exploreResult(dir, 1);
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir, 0))).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "image_generation_missing",
    });
  });

  test("Given four decodable candidates that are not outputs of this turn's image tool When asserted Then the round is refused", async () => {
    const dir = await priorProject(0);
    const expectation = await captureLogoTurnExpectation(dir, "로고 만들어줘");
    await exploreResult(dir, 1);
    await expect(assertLogoDeliverables(dir, expectation, { imageGenerations: 1, imageOutputs: new Set(["0".repeat(64)]) })).rejects.toMatchObject({ detail: "candidate_unprovenanced:candidate-1" });
  });

  test("Given the exploration scan Then it hashes every candidate PNG under explorations and nothing else", async () => {
    const dir = await priorProject(2);
    await writeFile(path.join(dir, "explorations", "notes.txt"), "x");
    const hashes = await scanExplorationHashes(dir);
    expect(hashes.size).toBe(8);
    expect(hashes.get("explorations/round-2/candidate-3.png")).toMatch(/^[0-9a-f]{64}$/);
    expect(await scanExplorationHashes(await stage())).toEqual(new Map());
  });

  test("Given no manifest after the turn When asserted Then it is refused", async () => {
    const dir = await priorProject(0);
    const expectation = await captureLogoTurnExpectation(dir, "로고 만들어줘");
    await writeFile(path.join(dir, "index.html"), guidelines(1));
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).rejects.toMatchObject({ detail: "manifest_missing" });
  });

  test("Given a regenerate that left the old manifest and sheet in place When asserted Then the no-op is refused", async () => {
    const dir = await priorProject(1);
    const expectation = await captureLogoTurnExpectation(dir, REGENERATE);
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).rejects.toMatchObject({ detail: "round_count" });
  });

  test("Given a regenerate that rewrote round 1 instead of appending round 2 When asserted Then it is refused", async () => {
    const dir = await priorProject(1);
    const expectation = await captureLogoTurnExpectation(dir, REGENERATE);
    const rewritten = manifestOf(2);
    await writeManifest(dir, { ...rewritten, rounds: [{ ...rewritten.rounds[0]!, candidates: rewritten.rounds[0]!.candidates.map((c) => ({ ...c, rationale: "rewritten" })) }, rewritten.rounds[1]] });
    await writeCandidates(dir, 2);
    await writeFile(path.join(dir, "index.html"), guidelines(1, " round 2"));
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).rejects.toMatchObject({ detail: "rounds_changed" });
  });

  test("Given a prior candidate file was overwritten during a regenerate When asserted Then it is refused", async () => {
    const dir = await priorProject(1);
    const expectation = await captureLogoTurnExpectation(dir, REGENERATE);
    await exploreResult(dir, 2);
    await writeFile(path.join(dir, "explorations", "round-1", "candidate-3.png"), png(256, 256, 99));
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).rejects.toMatchObject({ detail: "prior_candidate_changed:1:candidate-3" });
  });

  test("Given a new round that reuses an earlier candidate's bytes When asserted Then it is refused", async () => {
    const dir = await priorProject(1);
    const expectation = await captureLogoTurnExpectation(dir, REGENERATE);
    await writeManifest(dir, manifestOf(2));
    await writeCandidates(dir, 2, { "candidate-1": candidateBytes(1, 4) });
    await writeFile(path.join(dir, "index.html"), guidelines(1, " round 2"));
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).rejects.toMatchObject({ detail: "candidate_reused:candidate-1" });
  });

  test("Given two candidates in one round with identical bytes When asserted Then it is refused", async () => {
    const dir = await priorProject(0);
    const expectation = await captureLogoTurnExpectation(dir, "로고 만들어줘");
    await writeManifest(dir, manifestOf(1));
    await writeCandidates(dir, 1, { "candidate-2": candidateBytes(1, 1) });
    await writeFile(path.join(dir, "index.html"), guidelines(1));
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).rejects.toMatchObject({ detail: "candidate_duplicate:candidate-2" });
  });

  test("Given the last round missing a candidate file When asserted Then that candidate is named", async () => {
    const dir = await priorProject(1);
    const expectation = await captureLogoTurnExpectation(dir, REGENERATE);
    await writeManifest(dir, manifestOf(2));
    await writeCandidates(dir, 2, { "candidate-3": null });
    await writeFile(path.join(dir, "index.html"), guidelines(1, " round 2"));
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).rejects.toMatchObject({ detail: "candidate_missing:candidate-3" });
  });

  test.each([
    ["an empty file", Buffer.alloc(0), "candidate_empty:candidate-2"],
    ["a non-PNG", Buffer.from("<svg xmlns='x'/>", "utf8"), "candidate_not_png:candidate-2"],
    ["a signature with no image data", HEADER_ONLY, "candidate_truncated:candidate-2"],
    ["a PNG cut off before IEND", png(256, 256, 5).subarray(0, 200), "candidate_truncated:candidate-2"],
    ["a 100 px thumbnail", png(100, 100, 5), "candidate_geometry:candidate-2"],
    ["a non-square image", png(256, 128, 5), "candidate_geometry:candidate-2"],
    ["a CRC-valid PNG with an illegal bit depth", pngRaw({ bitDepth: 3 }), "candidate_undecodable:candidate-2"],
    ["a CRC-valid PNG whose IDAT is not a zlib stream", pngRaw({ idat: Buffer.from("not a zlib stream") }), "candidate_undecodable:candidate-2"],
    ["a PNG whose pixel stream is shorter than its geometry", pngRaw({ rows: 100 }), "candidate_undecodable:candidate-2"],
    ["a PNG whose pixel stream exceeds its geometry", pngRaw({ rows: 257 }), "candidate_undecodable:candidate-2"],
    ["a PNG with an illegal row filter byte", pngRaw({ filterByte: 9 }), "candidate_undecodable:candidate-2"],
    ["a palette PNG with no PLTE", pngRaw({ colourType: 3 }), "candidate_undecodable:candidate-2"],
  ])("Given %s as a candidate When asserted Then it is refused", async (_label, bytes, detail) => {
    const dir = await priorProject(0);
    const expectation = await captureLogoTurnExpectation(dir, "로고 만들어줘");
    await writeManifest(dir, manifestOf(1));
    await writeCandidates(dir, 1, { "candidate-2": bytes });
    await writeFile(path.join(dir, "index.html"), guidelines(1));
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).rejects.toMatchObject({ code: "logo_deliverables_missing", detail });
  });

  test.each([
    ["8192-square RGBA", 8192, 8192, 8, "geometry"],
    ["below the minimum", 255, 255, 8, "geometry"],
    ["above the maximum", 4097, 4097, 8, "geometry"],
    ["non-square", 256, 257, 8, "geometry"],
    ["uint32 maximum dimensions", 0xffffffff, 0xffffffff, 16, "geometry"],
    ["4096-square 16-bit RGBA over the decoded budget", 4096, 4096, 16, "too_large"],
  ] as const)("Given %s IHDR When asserted Then it is rejected before inflate", async (_label, width, height, bitDepth, reason) => {
    const dir = await priorProject(0);
    const expectation = await captureLogoTurnExpectation(dir, "로고 만들어줘");
    // Highly compressed, CRC-valid PNG with a deliberately short stream: even RED cannot expand
    // hundreds of MiB. The spy observes the real inflater, not a replacement decoder.
    const bytes = pngRaw({ width, height, bitDepth, colourType: 6 });
    expect(bytes.length).toBeLessThan(1024);
    await writeManifest(dir, manifestOf(1));
    await writeCandidates(dir, 1, { "candidate-1": bytes });
    const turnEvidence = await evidence(dir);
    const inflate = spyOn(zlib, "inflateSync");
    try {
      const result = assertLogoDeliverables(dir, expectation, turnEvidence);
      await expect(result).rejects.toBeInstanceOf(LogoDeliverableError);
      expect(inflate).not.toHaveBeenCalled();
      await expect(result).rejects.toMatchObject({
        code: "logo_deliverables_missing",
        detail: `candidate_${reason}:candidate-1`,
      });
    } finally {
      inflate.mockRestore();
    }
  });

  test.each([[256, 8], [1024, 16], [4096, 8]] as const)(
    "Given %i-square %i-bit RGBA within the decoded budget When asserted Then bounded inflation passes",
    async (width, bitDepth) => {
      const dir = await priorProject(0);
      const expectation = await captureLogoTurnExpectation(dir, "로고 만들어줘");
      const decodedBytes = (width * 4 * bitDepth / 8 + 1) * width;
      const bytes = pngRaw({ width, height: width, bitDepth, colourType: 6, idat: deflateSync(Buffer.alloc(decodedBytes)) });
      await exploreResult(dir, 1);
      await writeFile(path.join(dir, "explorations", "round-1", "candidate-1.png"), bytes);
      const turnEvidence = await evidence(dir);
      const inflate = spyOn(zlib, "inflateSync");
      try {
        await expect(assertLogoDeliverables(dir, expectation, turnEvidence)).resolves.toBeUndefined();
        expect(inflate).toHaveBeenCalledTimes(4);
        expect(inflate.mock.calls[0]?.[1]).toEqual({ maxOutputLength: decodedBytes + 1 });
      } finally {
        inflate.mockRestore();
      }
    },
  );

  test("Given a directory in place of a candidate file When asserted Then it is refused", async () => {
    const dir = await priorProject(0);
    const expectation = await captureLogoTurnExpectation(dir, "로고 만들어줘");
    await writeManifest(dir, manifestOf(1));
    await writeCandidates(dir, 1, { "candidate-4": null });
    await mkdir(path.join(dir, "explorations", "round-1", "candidate-4.png"), { recursive: true });
    await writeFile(path.join(dir, "index.html"), guidelines(1));
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).rejects.toMatchObject({ detail: "candidate_not_file:candidate-4" });
  });

  test("Given no guidelines entrypoint When asserted Then it is refused", async () => {
    const dir = await priorProject(0);
    const expectation = await captureLogoTurnExpectation(dir, "로고 만들어줘");
    await writeManifest(dir, manifestOf(1));
    await writeCandidates(dir, 1);
    await rm(path.join(dir, "index.html"));
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).rejects.toMatchObject({ detail: "guidelines_missing" });
  });

  test("Given an untouched starter sheet When asserted Then the turn is refused", async () => {
    const dir = await priorProject(0);
    const expectation = await captureLogoTurnExpectation(dir, "로고 만들어줘");
    await writeManifest(dir, manifestOf(1));
    await writeCandidates(dir, 1);
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).rejects.toMatchObject({ detail: "starter_unchanged" });
  });

  test("Given a regenerate that appended a round but left last round's sheet When asserted Then it is refused", async () => {
    const dir = await priorProject(1);
    const expectation = await captureLogoTurnExpectation(dir, REGENERATE);
    await writeManifest(dir, manifestOf(2));
    await writeCandidates(dir, 2);
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).rejects.toMatchObject({ detail: "guidelines_unchanged" });
  });
});

describe("logo finalize deliverables", () => {
  async function finalized(options: Parameters<typeof finalizeResult>[1] = {}) {
    const dir = await priorProject(1);
    const expectation = await captureLogoTurnExpectation(dir, SELECT_2);
    await finalizeResult(dir, options);
    return { dir, expectation };
  }

  test("Given a complete finalize turn When asserted Then it passes without needing an image-tool call", async () => {
    const { dir, expectation } = await finalized();
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir, 0))).resolves.toBeUndefined();
  });

  test("Given the agent dropped the selected round to look like an explore turn When asserted Then the finalize gate still applies", async () => {
    const dir = await priorProject(2);
    const select = '<burnguard-logo-action-v1>{"action":"select","round":2,"candidate_id":"candidate-1"}</burnguard-logo-action-v1>';
    const expectation = await captureLogoTurnExpectation(dir, select);
    expect(expectation.phase).toBe("finalize");
    await writeManifest(dir, manifestOf(1));
    await writeFile(path.join(dir, "index.html"), guidelines(1, " sheet"));
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).rejects.toMatchObject({ detail: "rounds_changed" });
  });

  test("Given the manifest gained or changed a round during finalize When asserted Then it is refused", async () => {
    const { dir, expectation } = await finalized();
    await writeManifest(dir, manifestOf(2, { round: 1, candidate_id: "candidate-2" }));
    await writeCandidates(dir, 2);
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).rejects.toMatchObject({ detail: "rounds_changed" });
  });

  test("Given the manifest did not record the selection When asserted Then it is refused", async () => {
    const unrecorded = await finalized({ selected: null });
    await expect(assertLogoDeliverables(unrecorded.dir, unrecorded.expectation, await evidence(unrecorded.dir))).rejects.toMatchObject({ detail: "selection_not_recorded" });
    const mismatched = await finalized({ selected: { round: 1, candidate_id: "candidate-4" } });
    await expect(assertLogoDeliverables(mismatched.dir, mismatched.expectation, await evidence(mismatched.dir))).rejects.toMatchObject({ detail: "selection_not_recorded" });
  });

  test("Given the selected candidate PNG was replaced under the same name When asserted Then it is refused", async () => {
    const { dir, expectation } = await finalized();
    await writeFile(path.join(dir, "explorations", "round-1", "candidate-2.png"), png(256, 256, 77));
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).rejects.toMatchObject({ detail: "selected_candidate_changed" });
  });

  test("Given the selected candidate PNG is gone When asserted Then it is refused", async () => {
    const { dir, expectation } = await finalized();
    await rm(path.join(dir, "explorations", "round-1", "candidate-2.png"));
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).rejects.toMatchObject({ detail: "candidate_missing:candidate-2" });
  });

  test("Given no master SVG When asserted Then it is refused", async () => {
    const { dir, expectation } = await finalized({ svg: null });
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).rejects.toMatchObject({ detail: "svg_missing" });
  });

  test("Given an SVG built from another candidate When asserted Then the source attribute must match", async () => {
    const mismatched = await finalized({ svg: logoSvg("explorations/round-1/candidate-3.png") });
    await expect(assertLogoDeliverables(mismatched.dir, mismatched.expectation, await evidence(mismatched.dir))).rejects.toMatchObject({ detail: "svg_source_mismatch" });
    const missing = await finalized({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path d="M0 0H8V8H0Z"/></svg>' });
    await expect(assertLogoDeliverables(missing.dir, missing.expectation, await evidence(missing.dir))).rejects.toMatchObject({ detail: "svg_source_missing" });
  });

  test("Given fewer than eight guideline artboards When asserted Then it is refused", async () => {
    const { dir, expectation } = await finalized({ pages: 7 });
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).rejects.toMatchObject({ detail: "guidelines_pages" });
  });

  test("Given an unsafe SVG on disk When asserted Then the validator detail surfaces", async () => {
    const { dir, expectation } = await finalized({ svg: logoSvg("explorations/round-1/candidate-2.png", "<script>alert(1)</script>") });
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).rejects.toMatchObject({ detail: "svg_forbidden_element:script" });
  });
});

describe("logo image-generation evidence", () => {
  const base = { id: "e", ts: 1, turnId: "t", toolCallId: "c" };
  test("Given the adapter's image tool events Then only a successful finish counts", () => {
    expect(isLogoImageGeneration({ ...base, type: "tool.finished", tool: "image_generation", ok: true })).toBe(true);
    expect(isLogoImageGeneration({ ...base, type: "tool.finished", tool: "image_generation_call", ok: true })).toBe(true);
    expect(isLogoImageGeneration({ ...base, type: "tool.finished", tool: "image_generation", ok: false })).toBe(false);
    expect(isLogoImageGeneration({ ...base, type: "tool.started", tool: "image_generation", input: {} })).toBe(false);
    expect(isLogoImageGeneration({ ...base, type: "tool.finished", tool: "command_execution", ok: true })).toBe(false);
  });
});

describe("logo svg validator", () => {
  test("Given a clean vector mark Then it validates", () => {
    expect(svgDetail(logoSvg("explorations/round-1/candidate-2.png"))).toBe("ok");
    expect(svgDetail(`<?xml version="1.0" encoding="UTF-8"?>\n<!-- generated -->\n${logoSvg("explorations/round-1/candidate-1.png")}`)).toBe("ok");
  });

  test.each([
    ["<html><body><svg viewBox=\"0 0 8 8\"></svg></body></html>", "svg_root_invalid"],
    ['<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H8V8H0Z"/></svg>', "svg_viewbox_missing"],
    ['<svg viewBox="0 0 8 8"><image href="mark.png"/></svg>', "svg_forbidden_element:image"],
    ['<svg viewBox="0 0 8 8"><script>x</script></svg>', "svg_forbidden_element:script"],
    ['<svg viewBox="0 0 8 8"><foreignObject><p>x</p></foreignObject></svg>', "svg_forbidden_element:foreignObject"],
    ['<svg viewBox="0 0 8 8"><text x="0">누림</text></svg>', "svg_forbidden_element:text"],
    ['<svg viewBox="0 0 8 8"><use href="https://evil.test/a.svg#m"/></svg>', "svg_external_reference"],
    ['<svg viewBox="0 0 8 8"><path xlink:href="data:image/png;base64,AAA" d="M0 0"/></svg>', "svg_external_reference"],
    ['<svg viewBox="0 0 8 8"><path fill="url(#grad)" d="M0 0"/></svg>', "svg_url_reference"],
    ['<svg viewBox="0 0 8 8" onload="x()"><path d="M0 0"/></svg>', "svg_event_handler"],
    ['<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 8 8"><path d="M0 0"/></svg>', "svg_doctype"],
  ])("Given %p Then the violation is %p", (text, detail) => {
    expect(svgDetail(text)).toBe(detail);
  });

  test("Given an internal use reference Then it is allowed", () => {
    expect(svgDetail('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><defs><path id="m" d="M0 0"/></defs><use href="#m"/></svg>')).toBe("ok");
  });

  test("Given an SVG above one mebibyte Then it is refused", () => {
    const filler = "0".repeat(1024 * 1024);
    expect(svgDetail(`<svg viewBox="0 0 8 8"><path d="M${filler}"/></svg>`)).toBe("svg_too_large");
  });
});

describe("logo guideline page cap", () => {
  test("Given the page bounds Then they are the exportable window of the artboard PDF raster budget", () => {
    const points = { width: LOGO_PAGE.width * 0.75, height: LOGO_PAGE.height * 0.75 };
    expect(REQUIRED_GUIDELINE_PAGES).toBe(8);
    expect(pdfRasterBudgetFitsPages(Array.from({ length: MAX_GUIDELINE_PAGES }, () => points))).toBe(true);
    expect(pdfRasterBudgetFitsPages(Array.from({ length: MAX_GUIDELINE_PAGES + 1 }, () => points))).toBe(false);
  });

  test("Given exactly the maximum page count When asserted Then it passes", async () => {
    const dir = await priorProject(1);
    const expectation = await captureLogoTurnExpectation(dir, SELECT_2);
    await finalizeResult(dir, { pages: MAX_GUIDELINE_PAGES });
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).resolves.toBeUndefined();
  });

  test("Given one page more than the PDF budget allows When asserted Then it is refused before export", async () => {
    const dir = await priorProject(1);
    const expectation = await captureLogoTurnExpectation(dir, SELECT_2);
    await finalizeResult(dir, { pages: MAX_GUIDELINE_PAGES + 1 });
    await expect(assertLogoDeliverables(dir, expectation, await evidence(dir))).rejects.toMatchObject({ detail: "guidelines_pages_over" });
  });
});
