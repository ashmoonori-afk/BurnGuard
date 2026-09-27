import { fileURLToPath } from "node:url";
import { spawnOwnedProcess } from "../adapters/owned-process";
import { awaitChildWithAbort } from "./extraction-acquisition";
import { assertDecodableImageContainer, ImageContainerError } from "./image-container";

export class ImageDecodeError extends Error {
  readonly code = "image_decode_failed";
  constructor() { super("image_decode_failed"); }
}

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_REPLY_BYTES = 4_096;
const DEFAULT_TIMEOUT_MS = 30_000;

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
  const compiled = /\$bunfs|~BUN/i.test(import.meta.url);
  const owned = spawnOwnedProcess({
    cmd: options.command ?? (compiled ? [process.execPath, "--bg-image-palette"] : [process.execPath, fileURLToPath(import.meta.url)]),
    env: process.env,
    stdin: new Blob([bytes]),
    stdout: "pipe",
    stderr: "ignore",
  });
  const reply = new Response(owned.proc.stdout).text().catch(() => "");
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const { exitCode } = await awaitChildWithAbort(owned, options.signal ? AbortSignal.any([options.signal, timeout]) : timeout);
    const text = await reply;
    if (exitCode !== 0 || text.length > MAX_REPLY_BYTES) throw new ImageDecodeError();
    return parsePaletteReply(text);
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof ImageDecodeError || error instanceof ImageContainerError) throw error;
    throw new ImageDecodeError();
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
    const bytes = Buffer.from(await Bun.stdin.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) process.exit(1);
    const { imagePalette } = await import("./pinterest-mood");
    await Bun.write(Bun.stdout, JSON.stringify(await imagePalette(bytes)));
    process.exit(0);
  } catch {
    process.exit(1);
  }
}

if (import.meta.main) await runImagePaletteProcess();
