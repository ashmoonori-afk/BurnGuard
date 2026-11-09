/**
 * Construction draw-in MP4 export for geometric logo projects (doc/38-logo-construction-mp4-2026-11-09.md).
 *
 * The frames are the GIF's frames (`forEachConstructionFrame`), encoded with WebCodecs H.264 in the
 * bundled Chromium and muxed here by `writeMp4`. A codec probe runs before any frame is sent: a Chromium
 * without an H.264 encoder fails the export as `construction_mp4_unsupported`, and the app offers the GIF.
 * The MP4 plays once and stops on the finished drawing, which is held for the GIF's hold time.
 */
import { writeFile } from "node:fs/promises";
import { LogoConstructionExportError } from "./export-construction";
import { forEachConstructionFrame, LOGO_CONSTRUCTION_GIF, readConstructionRecord } from "./export-construction-gif";
import { registerExportBrowser } from "./export-browser-registry";
import type { GifValidation } from "./export-receipt-validation";
import { launchChromium } from "./export-render-session";
import { writeMp4 } from "./mp4-writer";

/** Constrained baseline, level 3.0: no B-frames, so samples come out in display order, and every player decodes it. */
export const LOGO_CONSTRUCTION_MP4_CODEC = "avc1.42001e";
/** WebCodecs exists only in a secure context; the encoder page is served from this origin by a route, never the network. */
const ENCODER_ORIGIN = "https://construction-encoder.burnguard.invalid";

type EncoderConfig = { readonly codec: string; readonly width: number; readonly height: number; readonly bitrate: number; readonly framerate: number };
type EncoderOutput = { readonly chunks: readonly { readonly data: string; readonly key: boolean }[]; readonly description: string | null; readonly error: string | null };

// The functions below run in the encoder page; they share state through one global.
async function probeEncoder(config: EncoderConfig): Promise<boolean> {
  if (typeof VideoEncoder === "undefined") return false;
  try { return (await VideoEncoder.isConfigSupported({ ...config, avc: { format: "avc" } })).supported === true; }
  catch { return false; }
}

function startEncoder(config: EncoderConfig): void {
  const base64 = (bytes: Uint8Array): string => {
    let text = "";
    for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(text);
  };
  const state: { chunks: { data: string; key: boolean }[]; description: string | null; error: string | null } = { chunks: [], description: null, error: null };
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      state.chunks.push({ data: base64(bytes), key: chunk.type === "key" });
      const description = metadata?.decoderConfig?.description;
      if (description !== undefined && state.description === null) {
        state.description = base64(ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description));
      }
    },
    error: (error) => { state.error = String(error); },
  });
  encoder.configure({ ...config, avc: { format: "avc" }, latencyMode: "quality" });
  Reflect.set(globalThis, "__bgConstructionEncoder", { encoder, state });
}

async function encodeFrame(input: { readonly png: string; readonly timestamp: number; readonly duration: number; readonly key: boolean }): Promise<void> {
  const { encoder } = Reflect.get(globalThis, "__bgConstructionEncoder") as { encoder: VideoEncoder };
  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(input.png), (char) => char.charCodeAt(0))], { type: "image/png" }));
  const frame = new VideoFrame(bitmap, { timestamp: input.timestamp, duration: input.duration });
  encoder.encode(frame, { keyFrame: input.key });
  frame.close();
  bitmap.close();
}

async function finishEncoder(): Promise<EncoderOutput> {
  const { encoder, state } = Reflect.get(globalThis, "__bgConstructionEncoder") as { encoder: VideoEncoder; state: EncoderOutput };
  try { await encoder.flush(); } catch { /* the error callback has the reason */ }
  if (encoder.state !== "closed") encoder.close();
  return state;
}

export async function renderLogoConstructionMp4(input: {
  readonly stagedDir: string;
  readonly entrypointDir: string;
  readonly outputPath: string;
  readonly label: string;
  readonly signal: AbortSignal;
  /** The H.264 codec string to probe and encode; tests pass one no encoder has to reach the fallback. */
  readonly codec?: string;
}): Promise<GifValidation> {
  const record = await readConstructionRecord(input.stagedDir, input.entrypointDir);
  const { size, maxBytes } = LOGO_CONSTRUCTION_GIF;
  const frames: { readonly png: Uint8Array; readonly durationMs: number }[] = [];
  await forEachConstructionFrame(record, input.label, ({ png, delayCs }) => { frames.push({ png: png(), durationMs: delayCs * 10 }); });
  const config: EncoderConfig = { codec: input.codec ?? LOGO_CONSTRUCTION_MP4_CODEC, width: size, height: size, bitrate: 1_500_000, framerate: 10 };
  const browser = await launchChromium(input.signal);
  const owner = registerExportBrowser(() => browser.close());
  let output: EncoderOutput;
  try {
    const context = await browser.newContext();
    await context.route(`${ENCODER_ORIGIN}/**`, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset=\"utf-8\"><title>encoder</title>" }));
    const page = await context.newPage();
    await page.goto(`${ENCODER_ORIGIN}/`);
    if (!await page.evaluate(probeEncoder, config)) throw new LogoConstructionExportError("construction_mp4_unsupported", config.codec);
    await page.evaluate(startEncoder, config);
    let timestamp = 0;
    for (const [index, frame] of frames.entries()) {
      input.signal.throwIfAborted();
      await page.evaluate(encodeFrame, { png: Buffer.from(frame.png).toString("base64"), timestamp, duration: frame.durationMs * 1000, key: index === 0 });
      timestamp += frame.durationMs * 1000;
    }
    output = await page.evaluate(finishEncoder);
  } finally { await owner.close(); }
  if (output.error !== null) throw new Error(`construction_mp4_encoder_failed: ${output.error}`);
  if (output.description === null || output.chunks.length !== frames.length) throw new Error(`construction_mp4_encoder_failed: ${output.chunks.length} of ${frames.length} frames`);
  const bytes = writeMp4({
    width: size, height: size, timescale: 1000,
    avcC: new Uint8Array(Buffer.from(output.description, "base64")),
    samples: output.chunks.map((chunk, index) => ({ data: new Uint8Array(Buffer.from(chunk.data, "base64")), duration: frames[index]!.durationMs, key: chunk.key })),
  });
  if (bytes.byteLength > maxBytes) throw new LogoConstructionExportError("construction_too_large", String(bytes.byteLength));
  await writeFile(input.outputPath, bytes);
  return { frames: frames.length, width: size, height: size, bytes: bytes.byteLength };
}
