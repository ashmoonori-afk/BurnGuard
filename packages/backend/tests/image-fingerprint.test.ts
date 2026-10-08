import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCanvas, loadImage } from "../src/services/export-native-modules";
import { imageFingerprint } from "../src/services/image-fingerprint";
import {
  hammingDistance,
  isolatedImageFingerprint,
  LOGO_ORIGINALITY_MAX_DISTANCE,
} from "../src/services/image-fingerprint-process";

function canvas(size: number) {
  const c = createCanvas(size, size);
  const context = c.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  return { c, context };
}

function markAlpha(size: number): Buffer {
  const { c, context } = canvas(size);
  const scale = size / 256;
  context.fillStyle = "#111111";
  context.beginPath();
  context.arc(96 * scale, 96 * scale, 56 * scale, 0, Math.PI * 2);
  context.fill();
  context.fillRect(170 * scale, 150 * scale, 60 * scale, 20 * scale);
  return c.toBuffer("image/png");
}

function markBeta(size: number): Buffer {
  const { c, context } = canvas(size);
  context.fillStyle = "#111111";
  context.fillRect(size / 2, 0, size / 2, size);
  return c.toBuffer("image/png");
}

async function downscaledJpeg(bytes: Buffer, to: number, quality: number): Promise<Buffer> {
  const { c, context } = canvas(to);
  context.drawImage(await loadImage(bytes), 0, 0, to, to);
  return c.toBuffer("image/jpeg", quality);
}

const SAFE_SVG_SKETCH = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" fill="#ffffff"/><circle cx="32" cy="32" r="20" fill="#111111"/></svg>',
);

test("Given a mark resized, recompressed and a genuinely different mark When fingerprinted Then same-mark distance stays within the calibrated bound and distinct marks fall outside it", async () => {
  expect(LOGO_ORIGINALITY_MAX_DISTANCE).toBe(10);
  const reference = await isolatedImageFingerprint(markAlpha(256));
  const resized = await isolatedImageFingerprint(markAlpha(64));
  const recompressed = await isolatedImageFingerprint(await downscaledJpeg(markAlpha(256), 128, 60));
  const distinct = await isolatedImageFingerprint(markBeta(256));

  expect(hammingDistance(reference, resized)).toBeLessThanOrEqual(LOGO_ORIGINALITY_MAX_DISTANCE);
  expect(hammingDistance(reference, recompressed)).toBeLessThanOrEqual(LOGO_ORIGINALITY_MAX_DISTANCE);
  expect(hammingDistance(reference, distinct)).toBeGreaterThan(LOGO_ORIGINALITY_MAX_DISTANCE);
});

function flatBoard(size: number): Buffer {
  const c = createCanvas(size, size);
  const context = c.getContext("2d");
  const scale = size / 256;
  context.fillStyle = "#edf4f4";
  context.fillRect(0, 0, size, size);
  context.fillStyle = "#267d7b";
  context.fillRect(24 * scale, 30 * scale, 56 * scale, 170 * scale);
  context.fillStyle = "#cc844c";
  context.fillRect(105 * scale, 90 * scale, 120 * scale, 40 * scale);
  context.fillStyle = "#183747";
  context.beginPath();
  context.arc(173 * scale, 190 * scale, 30 * scale, 0, Math.PI * 2);
  context.fill();
  return c.toBuffer("image/png");
}

const FLAT_DISTINCT_SKETCH = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">' +
  '<path fill="#98542D" fill-rule="evenodd" d="M36 24H144V72H192Q204 72 204 84V108H144V168H192Q204 168 204 180V204H108V156H48Q36 156 36 144V120H108V60H48Q36 60 36 48Z"/></svg>',
);

test("Given a flat-colour reference When small re-encoded copies and an unrelated flat sketch are fingerprinted Then copies stay within the bound and the unrelated sketch falls outside it", async () => {
  const reference = await isolatedImageFingerprint(flatBoard(512));
  const copies = [await downscaledJpeg(flatBoard(512), 96, 80), await downscaledJpeg(flatBoard(512), 48, 70)];
  for (const copy of copies) expect(hammingDistance(reference, await isolatedImageFingerprint(copy))).toBeLessThanOrEqual(LOGO_ORIGINALITY_MAX_DISTANCE);
  expect(hammingDistance(reference, await isolatedImageFingerprint(FLAT_DISTINCT_SKETCH))).toBeGreaterThan(LOGO_ORIGINALITY_MAX_DISTANCE);
});

test("Given the same image bytes When fingerprinted twice Then the isolated decoder returns the identical 64-bit hex dHash", async () => {
  const bytes = markAlpha(192);
  const first = await isolatedImageFingerprint(bytes);
  const second = await isolatedImageFingerprint(bytes);
  expect(first).toMatch(/^[0-9a-f]{16}$/);
  expect(second).toBe(first);
});

test("Given PNG, JPEG and WebP encodings of one mark When fingerprinted Then each is accepted and their hashes agree within the calibrated bound", async () => {
  const source = markAlpha(256);
  const png = source;
  const { c, context } = canvas(256);
  context.drawImage(await loadImage(png), 0, 0, 256, 256);
  const jpeg = c.toBuffer("image/jpeg", 70);
  const webp = c.toBuffer("image/webp");
  for (const bytes of [png, jpeg, webp]) expect(await imageFingerprint(bytes)).toMatch(/^[0-9a-f]{16}$/);
  expect(hammingDistance(await imageFingerprint(png), await imageFingerprint(webp))).toBeLessThanOrEqual(LOGO_ORIGINALITY_MAX_DISTANCE);
  expect(hammingDistance(await imageFingerprint(png), await imageFingerprint(jpeg))).toBeLessThanOrEqual(LOGO_ORIGINALITY_MAX_DISTANCE);
});

test("Given a safe SVG sketch When fingerprinted Then it renders and hashes, while sketches with a script or external reference are refused", async () => {
  expect(await imageFingerprint(SAFE_SVG_SKETCH)).toMatch(/^[0-9a-f]{16}$/);
  const unsafe = [
    SAFE_SVG_SKETCH.toString("utf8").replace("</svg>", "<script>alert(1)</script></svg>"),
    SAFE_SVG_SKETCH.toString("utf8").replace("</svg>", '<image href="https://example.com/track.png"/></svg>'),
    SAFE_SVG_SKETCH.toString("utf8").replace("</svg>", '<use xlink:href="https://example.com/x.svg"/></svg>'),
    SAFE_SVG_SKETCH.toString("utf8").replace("</svg>", "<!DOCTYPE svg [<!ENTITY x SYSTEM 'file:///etc/passwd'>]></svg>"),
  ];
  for (const svg of unsafe) {
    expect(() => imageFingerprint(Buffer.from(svg))).toThrow();
    await expect(isolatedImageFingerprint(Buffer.from(svg))).rejects.toMatchObject({ code: "image_fingerprint_failed", message: "unsafe_svg_sketch" });
  }
});

test("Given SVG CSS that references a relative file When validated for fingerprinting Then it is rejected before decoding", async () => {
  const unsafe = SAFE_SVG_SKETCH.toString("utf8").replace("</svg>", '<style>circle { fill: url(../../private.svg); }</style></svg>');
  await expect(isolatedImageFingerprint(Buffer.from(unsafe))).rejects.toMatchObject({ code: "image_fingerprint_failed" });
});

test("Given corrupt, truncated and over-large inputs When fingerprinted Then they are refused with a typed error and this process keeps working", async () => {
  const truncatedPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const oversizedPng = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(oversizedPng, 0);
  oversizedPng.writeUInt32BE(13, 8);
  oversizedPng.write("IHDR", 12, "latin1");
  oversizedPng.writeUInt32BE(60000, 16);
  oversizedPng.writeUInt32BE(60000, 20);
  for (const bytes of [Buffer.from("not an image at all"), truncatedPng, oversizedPng]) {
    await expect(isolatedImageFingerprint(bytes)).rejects.toMatchObject({ code: "image_fingerprint_failed" });
  }
  expect(await isolatedImageFingerprint(markAlpha(128))).toMatch(/^[0-9a-f]{16}$/);
});

test("Given a decoder child that crashes or answers garbage When a fingerprint is requested Then a typed error is returned and this process keeps working", async () => {
  const bytes = markAlpha(128);
  // SIGKILL ends the child by signal exactly like a native crash but without a core dump: a real SIGSEGV
  // makes the host crash handler stream the multi-GB Bun address space before the child is reaped.
  for (const script of ["process.kill(process.pid, 'SIGKILL')", "process.stdout.write('not a hash')"]) {
    await expect(isolatedImageFingerprint(bytes, undefined, { command: [process.execPath, "-e", script] })).rejects.toMatchObject({ code: "image_fingerprint_failed" });
  }
  expect(await isolatedImageFingerprint(bytes)).toMatch(/^[0-9a-f]{16}$/);
});

test("Given a decoder child that exits while a descendant still holds its reply pipe When a fingerprint is requested Then the deadline returns a typed error and the descendant is stopped", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-fingerprint-descendant-"));
  try {
    const pidFile = path.join(root, "descendant.pid");
    const script = `const held = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], { stdin: "ignore", stdout: "inherit", stderr: "ignore" }); require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(held.pid)); process.exit(0)`;
    await expect(isolatedImageFingerprint(markAlpha(128), undefined, { command: [process.execPath, "-e", script], timeoutMs: 2_000 })).rejects.toMatchObject({ code: "image_fingerprint_failed" });
    expect(isProcessAlive(Number(await readFile(pidFile, "utf8")))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test("Given a secret in the backend environment When the decoder child runs Then the child does not receive it", async () => {
  process.env.BG_TEST_FINGERPRINT_SENTINEL = "sentinel-secret";
  try {
    const probe = "process.stdout.write(process.env.BG_TEST_FINGERPRINT_SENTINEL === undefined ? '0000000000000000' : 'ffffffffffffffff')";
    expect(await isolatedImageFingerprint(markAlpha(128), undefined, { command: [process.execPath, "-e", probe] })).toBe("0000000000000000");
  } finally {
    delete process.env.BG_TEST_FINGERPRINT_SENTINEL;
  }
});

test("Given the backend entry started as a fingerprint worker When it hashes Then it answers on stdout without touching the application profile", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-fingerprint-worker-"));
  try {
    const worker = Bun.spawn([process.execPath, path.resolve(import.meta.dir, "../src/index.ts"), "--bg-image-fingerprint"], {
      env: { PATH: process.env.PATH, BG_APP_ROOT: root },
      stdin: new Blob([new Uint8Array(markAlpha(128))]),
      stdout: "pipe",
      stderr: "ignore",
    });
    expect(await worker.exited).toBe(0);
    expect(await new Response(worker.stdout).text()).toMatch(/^[0-9a-f]{16}$/);
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Given a distance helper When handed anything other than two 64-bit hex dHashes Then it throws", () => {
  expect(() => hammingDistance("00", "0000000000000000")).toThrow();
  expect(() => hammingDistance("0000000000000000", "zzzzzzzzzzzzzzzz")).toThrow();
  expect(hammingDistance("0000000000000000", "0000000000000000")).toBe(0);
  expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
});
