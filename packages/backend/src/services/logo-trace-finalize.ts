import { lstat, writeFile } from "node:fs/promises";
import { LOGO_FILES } from "@bg/shared";
import { resolveWithin } from "../security/path-boundary";
import { assertCandidatePng, LogoDeliverableError, type LogoTurnExpectation } from "./logo-deliverables";
import { LogoTraceError, traceLogoPixels, type LogoTraceOptions } from "./logo-tracer";

/** Decode pinned pixels without letting non-rendering metadata trigger the native SVG sniffer. */
export async function decodeLogoPng(bytes: Buffer): Promise<{ readonly data: Uint8ClampedArray; readonly width: number; readonly height: number }> {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new LogoTraceError("input");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width * height > 4 * 1024 * 1024) throw new LogoTraceError("budget");
  const chunks: Buffer[] = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const end = offset + 12 + bytes.readUInt32BE(offset), type = bytes.toString("ascii", offset + 4, offset + 8);
    if (end > bytes.length) throw new LogoTraceError("input");
    // Retain pixel, transparency and color-management chunks, not text/EXIF/C2PA metadata.
    if (["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "cHRM", "gAMA", "iCCP", "sBIT", "sRGB", "bKGD", "cICP", "mDCV", "cLLI"].includes(type)) chunks.push(bytes.subarray(offset, end));
    offset = end;
  }
  if (offset !== bytes.length) throw new LogoTraceError("input");
  const { createCanvas, loadImage } = await import("./export-native-modules");
  let image: Awaited<ReturnType<typeof loadImage>>;
  try { image = await loadImage(Buffer.concat(chunks)); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "InvalidArg") throw new LogoTraceError("input");
    throw error;
  }
  const canvas = createCanvas(width, height), context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  return { data: context.getImageData(0, 0, width, height).data, width, height };
}

export async function traceLogoPng(bytes: Buffer, options: LogoTraceOptions): Promise<string> {
  options.signal?.throwIfAborted();
  const { data, width, height } = await decodeLogoPng(bytes);
  return traceLogoPixels(data, width, height, options);
}

/** Stage server-owned output before AI work; the existing completion gate still owns publication. */
export async function prepareLogoTrace(dir: string, expectation: LogoTurnExpectation, signal?: AbortSignal): Promise<"ready" | "fallback" | null> {
  if (expectation.phase !== "finalize" || expectation.selected === null) return null;
  signal?.throwIfAborted();
  const selected = expectation.selected;
  const candidate = expectation.priorManifest?.rounds.find(round => round.round === selected.round)
    ?.candidates.find(entry => entry.id === selected.candidate_id);
  if (!candidate) throw new LogoDeliverableError("selection_unknown");
  const { bytes, sha256 } = await assertCandidatePng(dir, candidate);
  if (sha256 !== selected.sha256) throw new LogoDeliverableError("selected_candidate_changed");
  let svg: string;
  try { svg = await traceLogoPng(bytes, { source: selected.file, signal }); }
  catch (error) {
    signal?.throwIfAborted();
    if (error instanceof LogoTraceError) return "fallback";
    throw error;
  }
  const logo = resolveWithin(dir, LOGO_FILES.logo);
  const info = await lstat(logo).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  });
  if (info !== null && (!info.isFile() || info.nlink !== 1)) throw new LogoDeliverableError("svg_not_file");
  signal?.throwIfAborted();
  await writeFile(logo, svg, { flag: info === null ? "wx" : "w" });
  await writeFile(resolveWithin(dir, ...LOGO_FILES.manifest.split("/")), JSON.stringify({
    ...expectation.priorManifest, selected: { round: selected.round, candidate_id: selected.candidate_id },
  }));
  return "ready";
}
