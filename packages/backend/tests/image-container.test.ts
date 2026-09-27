import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractAttachmentUpload } from "../src/services/attachment-extraction";
import { createCanvas } from "../src/services/export-native-modules";
import { assertDecodableImageContainer } from "../src/services/image-container";
import { imagePalette } from "../src/services/image-palette";
import { isolatedImagePalette, queuedPaletteWorkers } from "../src/services/image-palette-process";

type Chunk = { readonly type: string; readonly data: Buffer; readonly pad?: number };

function redWebp(): Buffer {
  const canvas = createCanvas(4, 4);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ff0000";
  context.fillRect(0, 0, 4, 4);
  return canvas.toBuffer("image/webp");
}

function chunksOf(webp: Buffer): Chunk[] {
  const chunks: Chunk[] = [];
  for (let offset = 12; offset < webp.length;) {
    const size = webp.readUInt32LE(offset + 4);
    chunks.push({ type: webp.toString("latin1", offset, offset + 4), data: Buffer.from(webp.subarray(offset + 8, offset + 8 + size)) });
    offset += 8 + size + (size & 1);
  }
  return chunks;
}

function encodeChunk({ type, data, pad = 0 }: Chunk): Buffer {
  const header = Buffer.alloc(8);
  header.write(type, 0, "latin1");
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, data.length & 1 ? Buffer.from([pad]) : Buffer.alloc(0)]);
}

function webpOf(chunks: readonly Chunk[]): Buffer {
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), ...chunks.map(encodeChunk)]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function extendedHeader(flags: number, reserved = 0, side = 4): Chunk {
  const data = Buffer.alloc(10);
  data.writeUInt8(flags, 0);
  data.writeUIntLE(reserved, 1, 3);
  data.writeUIntLE(side - 1, 4, 3);
  data.writeUIntLE(side - 1, 7, 3);
  return { type: "VP8X", data };
}

function frame(chunks: readonly Chunk[], x = 0, frameFlags = 0, side = 4): Chunk {
  const header = Buffer.alloc(16);
  header.writeUIntLE(x, 0, 3);
  header.writeUIntLE(side - 1, 6, 3);
  header.writeUIntLE(side - 1, 9, 3);
  header.writeUIntLE(100, 12, 3);
  header.writeUInt8(frameFlags, 15);
  return { type: "ANMF", data: Buffer.concat([header, ...chunks.map(encodeChunk)]) };
}

function alphaChunk(headerByte: number, dataBytes = 16): Chunk {
  return { type: "ALPH", data: Buffer.concat([Buffer.from([headerByte]), Buffer.alloc(dataBytes)]) };
}

function containers() {
  const source = chunksOf(redWebp());
  const icc = source.find((chunk) => chunk.type === "ICCP")!;
  const image = source.find((chunk) => chunk.type === "VP8 ")!;
  const animation: Chunk = { type: "ANIM", data: Buffer.alloc(6) };
  const unknown: Chunk = { type: "ZZZZ", data: Buffer.alloc(1) };
  const hidden: Chunk = { type: "VP8 ", data: Buffer.from(image.data) };
  hidden.data.writeUInt8(hidden.data.readUInt8(0) & ~0x10, 0);
  const repeatedHeader = webpOf([extendedHeader(0x20), extendedHeader(0x20), icc, image]);
  const overrunning = Buffer.from(webpOf([extendedHeader(0x20), icc, image]).subarray(0, -2));
  overrunning.writeUInt32LE(overrunning.length - 8, 4);
  const wrongRiffSize = webpOf([extendedHeader(0x20), icc, image]);
  wrongRiffSize.writeUInt32LE(wrongRiffSize.length, 4);
  return {
    valid: {
      still: webpOf([extendedHeader(0x20), icc, image]),
      animated: webpOf([extendedHeader(0x22), icc, animation, frame([image])]),
      animatedFrameWithTrailingUnknown: webpOf([extendedHeader(0x22), icc, animation, frame([image, unknown])]),
      trailingUnknown: webpOf([extendedHeader(0x20), icc, image, unknown]),
      metadataInEitherOrder: webpOf([extendedHeader(0x20 | 0x08 | 0x04), icc, image, { type: "XMP ", data: Buffer.alloc(4) }, unknown, { type: "EXIF", data: Buffer.alloc(4) }]),
      lossyWithAlpha: webpOf([extendedHeader(0x20 | 0x10), icc, alphaChunk(0x01), image]),
      lossyWithExactRawAlpha: webpOf([extendedHeader(0x20 | 0x10), icc, alphaChunk(0x00, 16), image]),
      animatedWithAlpha: webpOf([extendedHeader(0x22 | 0x10), icc, animation, frame([image]), frame([alphaChunk(0x01), image])]),
      frameInsideLargerCanvas: webpOf([extendedHeader(0x22, 0, 8), icc, animation, frame([image], 2)]),
    },
    malformed: {
      repeatedHeader,
      overrunning,
      wrongRiffSize,
      reservedFlag: webpOf([extendedHeader(0x21), icc, image]),
      reservedBytes: webpOf([extendedHeader(0x20, 1), icc, image]),
      flagWithoutChunk: webpOf([extendedHeader(0x20 | 0x08), icc, image]),
      chunkWithoutFlag: webpOf([extendedHeader(0x00), icc, image]),
      unknownBeforeImage: webpOf([extendedHeader(0x20), icc, unknown, image]),
      nonZeroPadding: webpOf([extendedHeader(0x20), icc, image, { ...unknown, pad: 1 }]),
      frameBeforeAnimation: webpOf([extendedHeader(0x22), icc, frame([image]), animation]),
      shortAnimation: webpOf([extendedHeader(0x22), icc, { type: "ANIM", data: Buffer.alloc(1) }, frame([image])]),
      frameOutsideCanvas: webpOf([extendedHeader(0x22), icc, animation, frame([image], 1)]),
      frameReservedBits: webpOf([extendedHeader(0x22), icc, animation, frame([image], 0, 0x04)]),
      frameWithTwoBitstreams: webpOf([extendedHeader(0x22), icc, animation, frame([image, image])]),
      canvasAreaOverflow: webpOf([extendedHeader(0x20, 0, 0x1000000), icc, image]),
      stillWithTwoImages: webpOf([extendedHeader(0x20), icc, image, image]),
      repeatedMetadata: webpOf([extendedHeader(0x20 | 0x04), icc, image, { type: "XMP ", data: Buffer.alloc(4) }, { type: "XMP ", data: Buffer.alloc(4) }]),
      alphaFlagWithoutAlphaChunk: webpOf([extendedHeader(0x20 | 0x10), icc, image]),
      alphaChunkWithoutData: webpOf([extendedHeader(0x20 | 0x10), icc, alphaChunk(0x01, 0), image]),
      emptyAlphaChunk: webpOf([extendedHeader(0x20 | 0x10), icc, { type: "ALPH", data: Buffer.alloc(0) }, image]),
      alphaReservedBits: webpOf([extendedHeader(0x20 | 0x10), icc, alphaChunk(0xc1), image]),
      alphaUnknownCompression: webpOf([extendedHeader(0x20 | 0x10), icc, alphaChunk(0x03), image]),
      shortRawAlpha: webpOf([extendedHeader(0x20 | 0x10), icc, alphaChunk(0x00, 1), image]),
      animatedAlphaFlagWithoutAlpha: webpOf([extendedHeader(0x22 | 0x10), icc, animation, frame([image]), frame([image])]),
      canvasSmallerThanImage: webpOf([extendedHeader(0x20, 0, 1), icc, image]),
      canvasLargerThanImage: webpOf([extendedHeader(0x20, 0, 8), icc, image]),
      frameSmallerThanImage: webpOf([extendedHeader(0x22, 0, 8), icc, animation, frame([image], 0, 0, 2)]),
      imageWithoutKeyFrameStartCode: webpOf([extendedHeader(0x20), icc, { type: "VP8 ", data: Buffer.concat([image.data.subarray(0, 3), Buffer.from([0, 0, 0]), image.data.subarray(6)]) }]),
      hiddenFrameSimple: webpOf([hidden]),
      hiddenFrameExtended: webpOf([extendedHeader(0x20), icc, hidden]),
      hiddenFrameWithAlpha: webpOf([extendedHeader(0x20 | 0x10), icc, alphaChunk(0x01), hidden]),
      hiddenFrameAnimated: webpOf([extendedHeader(0x22), icc, animation, frame([hidden])]),
    },
  };
}

test("Given a WebP whose format tag bytes carry a high-bit alias When its palette is read Then it is refused before native decoding", async () => {
  const extended = containers().valid.still;
  const simple = webpOf([chunksOf(redWebp()).find((chunk) => chunk.type === "VP8 ")!]);
  const cases = [[extended, [0, 1, 2, 3, 8, 9, 10, 11, 12, 13, 14, 15]], [simple, [12, 13, 14, 15]]] as const;
  for (const [bytes, offsets] of cases) {
    for (const offset of offsets) {
      const aliased = Buffer.from(bytes);
      aliased.writeUInt8(aliased.readUInt8(offset) | 0x80, offset);
      await expect(imagePalette(aliased), `offset ${offset}`).rejects.toThrow();
      await expect(isolatedImagePalette(aliased), `offset ${offset}`).rejects.toMatchObject({ code: expect.stringMatching(/^(invalid_image_container|image_decode_failed)$/) });
    }
  }
});

test("Given well-formed still, animated and trailing-extension WebP layouts When checked Then they are accepted and a still image decodes in the isolated worker", async () => {
  const { valid } = containers();
  for (const bytes of Object.values(valid)) expect(() => assertDecodableImageContainer(bytes)).not.toThrow();
  expect(await isolatedImagePalette(valid.still)).toEqual(["#ff0000"]);
});

test("Given each malformed WebP layout When decoded or attached Then it is refused before native decoding", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-image-container-"));
  try {
    for (const [name, bytes] of Object.entries(containers().malformed)) {
      expect(() => assertDecodableImageContainer(bytes), name).toThrow("invalid_image_container");
      await expect(imagePalette(bytes), name).rejects.toMatchObject({ code: "invalid_image_container" });
      await expect(isolatedImagePalette(bytes), name).rejects.toMatchObject({ code: "invalid_image_container" });
    }
    const input = { sourcePath: path.join(root, "crafted.webp"), manifestPath: path.join(root, "crafted.json"), extractedTextPath: path.join(root, "crafted.md"), originalName: "crafted.webp" };
    await writeFile(input.sourcePath, containers().malformed.repeatedHeader);
    await expect(extractAttachmentUpload(input)).rejects.toMatchObject({ code: "attachment_extract_failed" });
    expect(await Bun.file(input.sourcePath).exists()).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Given a decoder child that crashes, answers garbage or floods its reply When a palette is requested Then a typed error is returned and this process keeps working", async () => {
  const { still } = containers().valid;
  for (const script of ["process.kill(process.pid, 'SIGSEGV')", "process.stdout.write('not json')", "process.stdout.write('x'.repeat(1 << 20)); setInterval(() => {}, 1000)"]) {
    await expect(isolatedImagePalette(still, { command: [process.execPath, "-e", script] })).rejects.toMatchObject({ code: "image_decode_failed" });
  }
  expect(await isolatedImagePalette(still)).toEqual(["#ff0000"]);
});

test("Given a secret in the backend environment When the decoder child runs Then the child does not receive it", async () => {
  process.env.BG_TEST_DECODER_SENTINEL = "sentinel-secret";
  try {
    const probe = "process.stdout.write(JSON.stringify([process.env.BG_TEST_DECODER_SENTINEL === undefined ? '#000000' : '#ffffff']))";
    expect(await isolatedImagePalette(containers().valid.still, { command: [process.execPath, "-e", probe] })).toEqual(["#000000"]);
  } finally { delete process.env.BG_TEST_DECODER_SENTINEL; }
});

test("Given every decoder slot is busy When another palette is requested Then it queues until a slot is released", async () => {
  const { still } = containers().valid;
  const holders = [new AbortController(), new AbortController()];
  const busy = holders.map((holder) => isolatedImagePalette(still, { signal: holder.signal, command: [process.execPath, "-e", "setInterval(() => {}, 1000)"] }).catch((error: unknown) => error));
  const queued = isolatedImagePalette(still);
  expect(queuedPaletteWorkers()).toBe(1);
  holders[0]!.abort();
  expect(await queued).toEqual(["#ff0000"]);
  holders[1]!.abort();
  await Promise.all(busy);
  expect(queuedPaletteWorkers()).toBe(0);
});

test("Given a full decoder queue or a queued caller whose deadline passes When a palette is requested Then it is refused with a typed error", async () => {
  const { still } = containers().valid;
  const holders = [new AbortController(), new AbortController()];
  const busy = holders.map((holder) => isolatedImagePalette(still, { signal: holder.signal, command: [process.execPath, "-e", "setInterval(() => {}, 1000)"] }).catch((error: unknown) => error));
  const waiters = Array.from({ length: 16 }, () => new AbortController());
  const queued = waiters.map((waiter) => isolatedImagePalette(still, { signal: waiter.signal }).catch((error: unknown) => error));
  expect(queuedPaletteWorkers()).toBe(16);
  await expect(isolatedImagePalette(still)).rejects.toMatchObject({ code: "image_decode_failed" });
  for (const waiter of waiters) waiter.abort();
  await Promise.all(queued);
  expect(queuedPaletteWorkers()).toBe(0);
  await expect(isolatedImagePalette(still, { timeoutMs: 1 })).rejects.toMatchObject({ code: "image_decode_failed" });
  for (const holder of holders) holder.abort();
  await Promise.all(busy);
  expect(queuedPaletteWorkers()).toBe(0);
});

test("Given the backend entry started as a decoder worker When it decodes Then it answers without touching the application profile", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-palette-worker-"));
  try {
    const worker = Bun.spawn([process.execPath, path.resolve(import.meta.dir, "../src/index.ts"), "--bg-image-palette"], {
      env: { PATH: process.env.PATH, BG_APP_ROOT: root }, stdin: new Blob([new Uint8Array(containers().valid.still)]), stdout: "pipe", stderr: "ignore",
    });
    expect(await worker.exited).toBe(0);
    expect(JSON.parse(await new Response(worker.stdout).text())).toEqual(["#ff0000"]);
    expect(await readdir(root)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
