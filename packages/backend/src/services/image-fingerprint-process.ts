import { fileURLToPath } from "node:url";
import { spawnOwnedProcess } from "../adapters/owned-process";
import { awaitChildWithAbort } from "./extraction-acquisition";
import { assertDecodableImageContainer, ImageContainerError } from "./image-container";
import { LogoDeliverableError } from "./logo-deliverables";
import { validateLogoSvg } from "./logo-svg-validation";

export class ImageFingerprintError extends Error {
  readonly code = "image_fingerprint_failed";
  constructor(detail = "image_fingerprint_failed") { super(detail); }
}

/** 64-bit dHash at 9x8 grayscale: 8 horizontal comparisons across each of 8 rows. */
export const FINGERPRINT_HEX_LENGTH = 16;

/**
 * Distance between two 64-bit dHashes at or below which two images are treated as the same mark for
 * bounded similarity screening. Calibrated in `image-fingerprint.test.ts` against same-mark
 * resized/recompressed fixtures (expected well under this) and distinct marks (expected above it).
 * This is screening for near-copies, not a legal originality guarantee; the gate also checks exact
 * copies by SHA-256 independently.
 */
export const LOGO_ORIGINALITY_MAX_DISTANCE = 10;

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_SVG_BYTES = 2 * 1024 * 1024;
export const MAX_SVG_PIXELS = 20_000_000;
const MAX_REPLY_BYTES = 64;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT_WORKERS = 2;
const MAX_QUEUED_WORKERS = 16;
/** The decoder child gets only what the runtime and native loader need, never credentials or app configuration. */
const WORKER_ENVIRONMENT = ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SystemRoot", "SYSTEMROOT", "WINDIR", "LANG"] as const;

let activeWorkers = 0;
const waitingWorkers: (() => void)[] = [];

export function queuedFingerprintWorkers(): number {
  return waitingWorkers.length;
}

async function acquireWorkerSlot(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (activeWorkers < MAX_CONCURRENT_WORKERS) { activeWorkers++; return; }
  if (waitingWorkers.length >= MAX_QUEUED_WORKERS) throw new ImageFingerprintError();
  await new Promise<void>((resolve, reject) => {
    const grant = (): void => { signal.removeEventListener("abort", cancel); activeWorkers++; resolve(); };
    const cancel = (): void => { waitingWorkers.splice(waitingWorkers.indexOf(grant), 1); reject(signal.reason); };
    waitingWorkers.push(grant);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

function releaseWorkerSlot(): void {
  activeWorkers--;
  waitingWorkers.shift()?.();
}

function workerEnvironment(): Record<string, string> {
  return Object.fromEntries(WORKER_ENVIRONMENT.flatMap((name) => { const value = process.env[name]; return value === undefined ? [] : [[name, value]]; }));
}

/** Reads at most `limit` bytes; beyond that it calls `onOverflow` and returns null without buffering the rest. */
async function readBounded(stream: ReadableStream<Uint8Array>, limit: number, onOverflow: () => void): Promise<Buffer | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    total += value.byteLength;
    if (total > limit) {
      onOverflow();
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
}

export function hammingDistance(a: string, b: string): number {
  if (!/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) throw new ImageFingerprintError("invalid_fingerprint");
  let distance = 0;
  for (let index = 0; index < FINGERPRINT_HEX_LENGTH; index++) {
    let bits = Number.parseInt(a[index]!, 16) ^ Number.parseInt(b[index]!, 16);
    while (bits !== 0) { distance += bits & 1; bits >>= 1; }
  }
  return distance;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function isRaster(bytes: Buffer): boolean {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return true;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return true;
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return true;
  return false;
}

/** True when the buffer is an SVG sketch document (not a raster whose metadata merely embeds `<svg`). */
export function isSvgSketch(bytes: Buffer): boolean {
  if (isRaster(bytes)) return false;
  const head = bytes.subarray(0, Math.min(bytes.length, 4096)).toString("utf8").replace(/^\uFEFF/u, "").trimStart();
  return /^(?:<\?xml[^>]*\?>\s*)?<svg[\s>]/iu.test(head);
}

function svgLength(value: string): number | null {
  if (!/^\s*\d+(?:\.\d+)?(?:px)?\s*$/iu.test(value)) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Validates an SVG sketch buffer before any native decoder sees it: bounded size, an `<svg>` root, no
 * construct that could pull in an external or executable resource, and a declared pixel area within
 * `MAX_SVG_PIXELS` (from width/height, else from the viewBox).
 */
export function assertSafeSvgSketch(bytes: Buffer): void {
  if (bytes.length > MAX_SVG_BYTES) throw new ImageFingerprintError("svg_too_large");
  const text = bytes.toString("utf8").replace(/^\uFEFF/u, "");
  if (!isSvgSketch(bytes)) throw new ImageFingerprintError("unsupported_image_format");
  try {
    validateLogoSvg(text);
  } catch (error) {
    if (error instanceof LogoDeliverableError) throw new ImageFingerprintError("unsafe_svg_sketch");
    throw error;
  }
  const root = /<svg\b[^>]*>/iu.exec(text)?.[0];
  if (root === undefined) throw new ImageFingerprintError("unsafe_svg_sketch");
  const width = /\bwidth\s*=\s*["']([^"']*)["']/iu.exec(root)?.[1];
  const height = /\bheight\s*=\s*["']([^"']*)["']/iu.exec(root)?.[1];
  let pixelWidth = width === undefined ? null : svgLength(width);
  let pixelHeight = height === undefined ? null : svgLength(height);
  if (pixelWidth === null || pixelHeight === null) {
    const viewBox = /\bviewBox\s*=\s*["']([^"']*)["']/iu.exec(root)?.[1];
    const numbers = viewBox?.trim().split(/[\s,]+/u).map(Number) ?? [];
    if (numbers.length !== 4 || numbers.some((value) => !Number.isFinite(value))) throw new ImageFingerprintError("unsafe_svg_sketch");
    pixelWidth = numbers[2]!;
    pixelHeight = numbers[3]!;
  }
  if (pixelWidth <= 0 || pixelHeight <= 0 || pixelWidth * pixelHeight > MAX_SVG_PIXELS) throw new ImageFingerprintError("unsafe_svg_sketch");
}

export function assertFingerprintableInput(bytes: Buffer): void {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new ImageFingerprintError("image_too_large");
  assertDecodableImageContainer(bytes);
  if (isSvgSketch(bytes)) { assertSafeSvgSketch(bytes); return; }
  if (!isRaster(bytes)) throw new ImageFingerprintError("unsupported_image_format");
}

/**
 * Hashes untrusted image bytes in a child process, so a crash inside the native decoder ends only that
 * child and surfaces here as a typed error instead of stopping the backend.
 */
export async function isolatedImageFingerprint(
  bytes: Buffer,
  signal?: AbortSignal,
  options: { readonly command?: readonly string[]; readonly timeoutMs?: number } = {},
): Promise<string> {
  assertFingerprintableInput(bytes);
  const overflow = new AbortController();
  const deadline = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const combined = AbortSignal.any([...(signal ? [signal] : []), deadline, overflow.signal]);
  try {
    await acquireWorkerSlot(AbortSignal.any([...(signal ? [signal] : []), deadline]));
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ImageFingerprintError) throw error;
    throw new ImageFingerprintError();
  }
  try {
    const compiled = /\$bunfs|~BUN/iu.test(import.meta.url);
    const owned = spawnOwnedProcess({
      cmd: options.command ?? (compiled ? [process.execPath, "--bg-image-fingerprint"] : [process.execPath, fileURLToPath(import.meta.url)]),
      env: workerEnvironment(),
      stdin: new Blob([new Uint8Array(bytes)]),
      stdout: "pipe",
      stderr: "ignore",
    });
    const reply = readBounded(owned.proc.stdout, MAX_REPLY_BYTES, () => overflow.abort()).catch(() => null);
    const { exitCode } = await awaitChildWithAbort(owned, combined);
    const text = await reply;
    if (exitCode !== 0 || text === null) throw new ImageFingerprintError();
    return parseFingerprintReply(text.toString("utf8"));
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ImageFingerprintError || error instanceof ImageContainerError) throw error;
    throw new ImageFingerprintError();
  } finally {
    releaseWorkerSlot();
  }
}

function parseFingerprintReply(text: string): string {
  const value = text.trim();
  if (!/^[0-9a-f]{16}$/u.test(value)) throw new ImageFingerprintError();
  return value;
}

/** Child entry: image bytes on stdin, a 16-hex dHash on stdout, exit 1 on any failure. */
export async function runImageFingerprintProcess(): Promise<never> {
  try {
    const bytes = await readBounded(Bun.stdin.stream(), MAX_IMAGE_BYTES, () => undefined);
    if (bytes === null) process.exit(1);
    const { imageFingerprint } = await import("./image-fingerprint");
    await Bun.write(Bun.stdout, await imageFingerprint(bytes));
    process.exit(0);
  } catch {
    process.exit(1);
  }
}

if (import.meta.main) await runImageFingerprintProcess();
