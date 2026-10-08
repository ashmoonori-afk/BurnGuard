import { fileURLToPath } from "node:url";
import { spawnOwnedProcess } from "../adapters/owned-process";
import { awaitChildReply, awaitChildWithAbort } from "./extraction-acquisition";
import { assertDecodableImageContainer, ImageContainerError } from "./image-container";

export class ImageDecodeError extends Error {
  readonly code = "image_decode_failed";
  constructor() { super("image_decode_failed"); }
}

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_REPLY_BYTES = 4_096;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT_WORKERS = 2;
const MAX_QUEUED_WORKERS = 16;
/** The decoder child gets only what the runtime and native loader need, never credentials or app configuration. */
const WORKER_ENVIRONMENT = ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SystemRoot", "SYSTEMROOT", "WINDIR", "LANG"] as const;

let activeWorkers = 0;
const waitingWorkers: (() => void)[] = [];

export function queuedPaletteWorkers(): number {
  return waitingWorkers.length;
}

async function acquireWorkerSlot(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (activeWorkers < MAX_CONCURRENT_WORKERS) { activeWorkers++; return; }
  if (waitingWorkers.length >= MAX_QUEUED_WORKERS) throw new ImageDecodeError();
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

/**
 * Samples the palette of untrusted image bytes in a child process, so a crash inside the native
 * decoder ends only that child and surfaces here as a typed error instead of stopping the backend.
 */
export async function isolatedImagePalette(
  bytes: Buffer,
  options: { readonly signal?: AbortSignal; readonly command?: readonly string[]; readonly timeoutMs?: number } = {},
): Promise<string[]> {
  assertDecodableImageContainer(bytes);
  if (bytes.length > MAX_IMAGE_BYTES) throw new ImageDecodeError();
  const overflow = new AbortController();
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), timeout, overflow.signal]);
  try {
    await acquireWorkerSlot(AbortSignal.any([...(options.signal ? [options.signal] : []), timeout]));
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof ImageDecodeError) throw error;
    throw new ImageDecodeError();
  }
  try {
    const compiled = /\$bunfs|~BUN/i.test(import.meta.url);
    const owned = spawnOwnedProcess({
      cmd: options.command ?? (compiled ? [process.execPath, "--bg-image-palette"] : [process.execPath, fileURLToPath(import.meta.url)]),
      env: workerEnvironment(),
      stdin: new Blob([new Uint8Array(bytes)]),
      stdout: "pipe",
      stderr: "ignore",
    });
    const reply = readBounded(owned.proc.stdout, MAX_REPLY_BYTES, () => overflow.abort()).catch(() => null);
    const { exitCode } = await awaitChildWithAbort(owned, signal);
    const text = await awaitChildReply(owned, reply, signal);
    if (exitCode !== 0 || text === null) throw new ImageDecodeError();
    return parsePaletteReply(text.toString("utf8"));
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof ImageDecodeError || error instanceof ImageContainerError) throw error;
    throw new ImageDecodeError();
  } finally {
    releaseWorkerSlot();
  }
}

function parsePaletteReply(text: string): string[] {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ImageDecodeError(); }
  if (!Array.isArray(value) || value.length > 64 || !value.every((color): color is string => typeof color === "string" && /^#[0-9a-f]{6}$/.test(color))) throw new ImageDecodeError();
  return value;
}

/** Child entry: image bytes on stdin, a JSON array of hex colours on stdout, exit 1 on any failure. */
export async function runImagePaletteProcess(): Promise<never> {
  try {
    const bytes = await readBounded(Bun.stdin.stream(), MAX_IMAGE_BYTES, () => undefined);
    if (bytes === null) process.exit(1);
    const { imagePalette } = await import("./image-palette");
    await Bun.write(Bun.stdout, JSON.stringify(await imagePalette(bytes)));
    process.exit(0);
  } catch {
    process.exit(1);
  }
}

if (import.meta.main) await runImagePaletteProcess();
