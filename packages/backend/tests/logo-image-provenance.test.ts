import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import type { NormalizedEvent } from "@bg/shared";
import { collectGeneratedImageHashes } from "../src/adapters/codex/image-outputs";
import { parseCodexLine, type CodexParserContext } from "../src/adapters/codex/parser";
import {
  assertLogoDeliverables,
  captureLogoTurnExpectation,
  LogoDeliverableError,
  LogoEvidenceCollector,
  type LogoTurnExpectation,
} from "../src/services/logo-deliverables";
import { LOGO_STARTER_NODE_ID, LOGO_STARTER_SENTENCE } from "../src/db/templates/logo";
import { canCreateSymlink, SYMLINK_SKIP_REASON } from "./helpers/platform";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const THREAD_ID = "01a0bd75-12bd-75a3-8193-127dd61ddb33";
const STARTER = `<!doctype html><html><body><section data-graphic-artboard id="frame-1" style="width:1920px;height:1080px"><h1 data-bg-node-id="${LOGO_STARTER_NODE_ID}">Brand</h1><p>${LOGO_STARTER_SENTENCE}</p></section></body></html>`;

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function temp(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

/** A real, decodable 256 px square 8-bit grayscale PNG; `seed` changes the pixels so fixtures never share bytes. */
function png(seed: number, size = 256): Buffer {
  const raw = Buffer.alloc((size + 1) * size);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) raw[y * (size + 1) + 1 + x] = (x * 7 + y * 3 + seed) & 0xff;
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed) >>> 0, 0);
    return Buffer.concat([length, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

async function writeRoundOne(stage: string, candidates: readonly Buffer[]): Promise<void> {
  await mkdir(path.join(stage, "explorations", "round-1"), { recursive: true });
  for (const [index, bytes] of candidates.entries()) await writeFile(path.join(stage, "explorations", "round-1", `candidate-${index + 1}.png`), bytes);
  await writeFile(path.join(stage, "explorations", "manifest.json"), JSON.stringify({
    schema_version: 1,
    selected: null,
    rounds: [{
      round: 1,
      candidates: candidates.map((_, index) => ({ id: `candidate-${index + 1}`, file: `explorations/round-1/candidate-${index + 1}.png`, logo_type: "abstract", prompt: "flat mark", rationale: "counterform" })),
    }],
  }));
  await writeFile(path.join(stage, "index.html"), '<!doctype html><html><body><section data-graphic-artboard id="frame-1-candidates" style="width:1920px;height:1080px"><img src="explorations/round-1/candidate-1.png"></section></body></html>');
}

/** Feeds the adapter's JSON lines through the parser and every resulting event through the collector, as turns.ts does. */
async function runTurn(stage: string, expectation: LogoTurnExpectation, codexHome: string | undefined, threadId: string | null, lines: readonly unknown[]): Promise<LogoEvidenceCollector> {
  const collector = new LogoEvidenceCollector(stage, expectation);
  const ctx: CodexParserContext = { turnId: "turn-1", projectDir: stage, toolNames: new Map(), ...(codexHome === undefined ? {} : { codexHome }) };
  const events: NormalizedEvent[] = [];
  if (threadId !== null) events.push(...parseCodexLine(JSON.stringify({ type: "thread.started", thread_id: threadId }), ctx));
  for (const line of lines) events.push(...parseCodexLine(JSON.stringify(line), ctx));
  for (const event of events) await collector.observe(event);
  return collector;
}

describe("logo provenance from the Codex generated_images directory", () => {
  test("Given four tool-saved PNGs copied byte-for-byte into round 1 When the turn completes Then the explore gate accepts the round", async () => {
    const stage = await temp("bg-logo-stage-");
    const codexHome = await temp("bg-codex-home-");
    await writeFile(path.join(stage, "index.html"), STARTER);
    const expectation = await captureLogoTurnExpectation(stage, "로고세트");
    const collector = new LogoEvidenceCollector(stage, expectation);
    const candidates = [png(1), png(2), png(3), png(4)];
    const threadDir = path.join(codexHome, "generated_images", THREAD_ID);
    await mkdir(threadDir, { recursive: true });
    for (const [index, bytes] of candidates.entries()) await writeFile(path.join(threadDir, `exec-${index}.png`), bytes);
    // The model's `cp` lands before turn.completed, exactly as in the recorded real trace.
    await writeRoundOne(stage, candidates);
    const ctx: CodexParserContext = { turnId: "turn-1", projectDir: stage, toolNames: new Map(), codexHome };
    const events = [
      ...parseCodexLine(JSON.stringify({ type: "thread.started", thread_id: THREAD_ID }), ctx),
      ...parseCodexLine(JSON.stringify({ type: "item.completed", item: { id: "item_3", type: "command_execution", command: "cp", status: "completed", aggregated_output: "", exit_code: 0 } }), ctx),
      ...parseCodexLine(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }), ctx),
    ];
    for (const event of events) await collector.observe(event);
    expect(collector.evidence.imageGenerations).toBe(4);
    expect([...collector.evidence.imageOutputs].sort()).toEqual(candidates.map(sha256).sort());
    await expect(assertLogoDeliverables(stage, expectation, collector.evidence)).resolves.toBeUndefined();
  });

  test("Given a candidate whose bytes the tool never saved When the turn completes Then that candidate is refused as unprovenanced", async () => {
    const stage = await temp("bg-logo-stage-");
    const codexHome = await temp("bg-codex-home-");
    await writeFile(path.join(stage, "index.html"), STARTER);
    const threadDir = path.join(codexHome, "generated_images", THREAD_ID);
    await mkdir(threadDir, { recursive: true });
    for (const seed of [1, 2, 3]) await writeFile(path.join(threadDir, `exec-${seed}.png`), png(seed));
    const expectation = await captureLogoTurnExpectation(stage, "로고세트");
    await writeRoundOne(stage, [png(1), png(2), png(3), png(99)]);
    const collector = await runTurn(stage, expectation, codexHome, THREAD_ID, [{ type: "turn.completed", usage: {} }]);
    expect(collector.evidence.imageGenerations).toBe(3);
    const failure = await assertLogoDeliverables(stage, expectation, collector.evidence).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LogoDeliverableError);
    expect((failure as LogoDeliverableError).detail).toBe("candidate_unprovenanced:candidate-4");
  });

  test("Given no thread.started or no codexHome When the turn completes Then no image generation is observed and the gate refuses the round", async () => {
    const stage = await temp("bg-logo-stage-");
    const codexHome = await temp("bg-codex-home-");
    await writeFile(path.join(stage, "index.html"), STARTER);
    await mkdir(path.join(codexHome, "generated_images", THREAD_ID), { recursive: true });
    await writeFile(path.join(codexHome, "generated_images", THREAD_ID, "exec-1.png"), png(1));
    const expectation = await captureLogoTurnExpectation(stage, "로고세트");
    await writeRoundOne(stage, [png(1), png(2), png(3), png(4)]);
    for (const collector of [
      await runTurn(stage, expectation, codexHome, null, [{ type: "turn.completed", usage: {} }]),
      await runTurn(stage, expectation, undefined, THREAD_ID, [{ type: "turn.completed", usage: {} }]),
    ]) {
      expect(collector.evidence.imageGenerations).toBe(0);
      const failure = await assertLogoDeliverables(stage, expectation, collector.evidence).catch((error: unknown) => error);
      expect((failure as LogoDeliverableError).detail).toBe("image_generation_missing");
    }
  });
});

describe("collectGeneratedImageHashes bounds", () => {
  test("Given many unrelated entries before the PNGs When scanned Then every PNG within the file allowance is still hashed", async () => {
    const codexHome = await temp("bg-codex-home-");
    const threadDir = path.join(codexHome, "generated_images", THREAD_ID);
    await mkdir(threadDir, { recursive: true });
    for (let index = 0; index < 100; index += 1) await writeFile(path.join(threadDir, `a-${String(index).padStart(3, "0")}.txt`), "noise");
    const images = [png(10), png(11), png(12)];
    for (const [index, bytes] of images.entries()) await writeFile(path.join(threadDir, `z-${index}.png`), bytes);
    expect(collectGeneratedImageHashes(codexHome, THREAD_ID).sort()).toEqual(images.map(sha256).sort());
  });

  test("Given more PNGs than the allowance When scanned Then at most 64 are hashed", async () => {
    const codexHome = await temp("bg-codex-home-");
    const threadDir = path.join(codexHome, "generated_images", THREAD_ID);
    await mkdir(threadDir, { recursive: true });
    for (let index = 0; index < 70; index += 1) await writeFile(path.join(threadDir, `exec-${String(index).padStart(3, "0")}.png`), png(100 + index, 8));
    expect(collectGeneratedImageHashes(codexHome, THREAD_ID)).toHaveLength(64);
  });

  test.skipIf(!canCreateSymlink())(`Given a symlink escaping the thread directory When scanned Then it is not followed (${SYMLINK_SKIP_REASON})`, async () => {
    const codexHome = await temp("bg-codex-home-");
    const outside = await temp("bg-outside-");
    await writeFile(path.join(outside, "secret.png"), png(5));
    const threadDir = path.join(codexHome, "generated_images", THREAD_ID);
    await mkdir(threadDir, { recursive: true });
    await symlink(path.join(outside, "secret.png"), path.join(threadDir, "link.png"));
    expect(collectGeneratedImageHashes(codexHome, THREAD_ID)).toEqual([]);
  });

  test("Given a foreign, missing or traversal thread id When scanned Then nothing is hashed", async () => {
    const codexHome = await temp("bg-codex-home-");
    const threadDir = path.join(codexHome, "generated_images", THREAD_ID);
    await mkdir(threadDir, { recursive: true });
    await writeFile(path.join(threadDir, "exec-1.png"), png(6));
    expect(collectGeneratedImageHashes(codexHome, "01a0bd75-12bd-75a3-8193-000000000000")).toEqual([]);
    expect(collectGeneratedImageHashes(codexHome, "../generated_images")).toEqual([]);
    expect(collectGeneratedImageHashes(codexHome, `${THREAD_ID}/..`)).toEqual([]);
  });
});
