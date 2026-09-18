import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { crc32, inflateSync } from "node:zlib";
import { parse } from "node-html-parser";
import {
  LOGO_FILES,
  LOGO_MAX_ROUNDS,
  parseLogoAction,
  parseLogoManifestV1,
  resolveLogoPhase,
  UpgradeContractError,
  type LogoActionV1,
  type LogoCandidateV1,
  type LogoManifestV1,
  type LogoPhase,
  type LogoRoundV1,
  type NormalizedEvent,
} from "@bg/shared";
import { LOGO_STARTER_NODE_ID, LOGO_STARTER_SENTENCE } from "../db/templates/logo";
import { PathBoundaryError, resolveWithin } from "../security/path-boundary";

/**
 * Hard completion gate for a logo turn (doc/23-logo-design-deliverable-2026-09-18.md, D6).
 *
 * The phase is never trusted from the model: the caller derives it from the manifest on disk and
 * the action sentinel the user sent, and every artefact this module inspects is re-read from the
 * staged directory. A failure fails the turn with `logo_deliverables_missing`; the `detail` names
 * the missing contract without ever naming a filesystem path.
 */
export class LogoDeliverableError extends Error {
  readonly name = "LogoDeliverableError";
  readonly code = "logo_deliverables_missing";
  readonly detail: string;

  constructor(detail: string) {
    super("logo_deliverables_missing");
    this.detail = detail;
  }
}

const MAX_SVG_BYTES = 1024 * 1024;
const MAX_GUIDELINES_BYTES = 16 * 1024 * 1024;
export const REQUIRED_GUIDELINE_PAGES = 8;
/**
 * A guidelines page is 1920 x 1080 CSS px = 1440 x 810 pt, rasterised at PDF_RASTER_SCALE 2 into
 * 4.67 megapixels; PDF_MAX_EXPECTED_PIXELS (64 MP) therefore admits 13 such pages. A document the
 * artboard PDF export would refuse is rejected here, at the turn, instead of at download time.
 */
export const MAX_GUIDELINE_PAGES = 13;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_CANDIDATE_BYTES = 8 * 1024 * 1024;
/** A candidate is a square mark; the image tool renders 1024 px, but a decoded square in this window counts. */
const CANDIDATE_MIN_PX = 256;
const CANDIDATE_MAX_PX = 4096;
/** Tool names the Codex adapter emits for its built-in image tool (adapters/codex/event-mapping.ts). */
export const LOGO_IMAGE_TOOLS: ReadonlySet<string> = new Set(["image_generation", "image_generation_call"]);

/** A successful image-tool finish, the only provenance the gate trusts for a new candidate round. */
export function isLogoImageGeneration(event: NormalizedEvent): boolean {
  return event.type === "tool.finished" && event.ok && LOGO_IMAGE_TOOLS.has(event.tool);
}

export type LogoSelectedCandidate = {
  readonly round: number;
  readonly candidate_id: string;
  readonly file: string;
  readonly sha256: string;
};

/**
 * What the turn is expected to produce, captured from the staged tree BEFORE the agent runs. The
 * phase, the round to append and the selected candidate's bytes are all fixed here, so nothing the
 * model writes during the turn can downgrade a finalize into an explore, pass off an old round as a
 * regenerate, or swap the selected PNG under the same name.
 */
export type LogoTurnExpectation = {
  readonly phase: LogoPhase;
  readonly action: LogoActionV1 | null;
  readonly priorManifest: LogoManifestV1 | null;
  /** Every candidate file present before the turn, keyed "<round>:<candidate id>". */
  readonly priorCandidates: ReadonlyMap<string, { readonly file: string; readonly sha256: string }>;
  readonly priorGuidelines: string | null;
  readonly nextRound: number;
  readonly selected: LogoSelectedCandidate | null;
};

export type LogoTurnEvidence = {
  /** Successful image-tool calls observed on this turn's event stream. */
  readonly imageGenerations: number;
  /** sha256 of every image the image tool reported or wrote during its calls this turn. */
  readonly imageOutputs: ReadonlySet<string>;
};

/** The image tool's start, which opens the window in which files it writes count as its outputs. */
export function isLogoImageToolStart(event: NormalizedEvent): boolean {
  return event.type === "tool.started" && LOGO_IMAGE_TOOLS.has(event.tool);
}

/** Hashes the adapter attached to an image tool's finish (`output.image_sha256`), if any. */
export function imageOutputHashes(event: NormalizedEvent): readonly string[] {
  if (event.type !== "tool.finished" || typeof event.output !== "object" || event.output === null) return [];
  const list = (event.output as { readonly image_sha256?: unknown }).image_sha256;
  return Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === "string" && /^[0-9a-f]{64}$/.test(entry)) : [];
}

/** sha256 of every candidate PNG under each explorations round directory, keyed by its project-relative path. */
export async function scanExplorationHashes(dir: string): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  const rounds = await readdir(resolveWithin(dir, LOGO_FILES.explorations), { withFileTypes: true }).catch((error: unknown) => {
    if (isMissing(error) || error instanceof PathBoundaryError) return null;
    throw error;
  });
  for (const round of rounds ?? []) {
    if (!round.isDirectory() || !/^round-\d{1,2}$/.test(round.name)) continue;
    const files = await readdir(resolveWithin(dir, LOGO_FILES.explorations, round.name), { withFileTypes: true }).catch((error: unknown) => {
      if (isMissing(error)) return null;
      throw error;
    });
    for (const entry of files ?? []) {
      if (!entry.isFile() || !/^candidate-[1-4]\.png$/.test(entry.name)) continue;
      const file = `${LOGO_FILES.explorations}/${round.name}/${entry.name}`;
      const sha256 = await candidateHash(dir, { file });
      if (sha256 !== null) hashes.set(file, sha256);
    }
  }
  return hashes;
}

export async function readLogoManifest(dir: string): Promise<LogoManifestV1 | null> {
  const file = safePath(dir, LOGO_FILES.manifest, "manifest_path_unsafe");
  const text = await readFile(file, "utf8").catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) throw new LogoDeliverableError("manifest_invalid:json");
    throw error;
  }
  try {
    return parseLogoManifestV1(parsed);
  } catch (error) {
    if (error instanceof UpgradeContractError) throw new LogoDeliverableError(`manifest_invalid:${error.path}`);
    throw error;
  }
}

export async function captureLogoTurnExpectation(dir: string, requestText: string): Promise<LogoTurnExpectation> {
  const action = parseLogoAction(requestText);
  // A manifest that no longer parses is treated as absent, exactly as the prompt treats it, so the
  // turn starts over at round 1 rather than letting the agent "repair" history on its own terms.
  const priorManifest = await readLogoManifest(dir).catch((error: unknown) => {
    if (error instanceof LogoDeliverableError) return null;
    throw error;
  });
  const phase = resolveLogoPhase(priorManifest, action);
  if (action?.action === "select" && phase !== "finalize") throw new LogoDeliverableError("selection_unknown");
  const rounds = priorManifest?.rounds ?? [];
  if (phase === "explore" && rounds.length >= LOGO_MAX_ROUNDS) throw new LogoDeliverableError("rounds_exhausted");
  const priorCandidates = new Map<string, { readonly file: string; readonly sha256: string }>();
  for (const round of rounds) {
    for (const candidate of round.candidates) {
      const sha256 = await candidateHash(dir, candidate);
      if (sha256 !== null) priorCandidates.set(`${round.round}:${candidate.id}`, { file: candidate.file, sha256 });
    }
  }
  let selected: LogoSelectedCandidate | null = null;
  if (phase === "finalize" && action?.action === "select") {
    const candidate = rounds.find((round) => round.round === action.round)?.candidates.find((entry) => entry.id === action.candidate_id);
    if (candidate === undefined) throw new LogoDeliverableError("selection_unknown");
    const prior = priorCandidates.get(`${action.round}:${candidate.id}`);
    if (prior === undefined) throw new LogoDeliverableError(`candidate_missing:${candidate.id}`);
    selected = { round: action.round, candidate_id: candidate.id, file: candidate.file, sha256: prior.sha256 };
  }
  const priorGuidelines = await readGuidelines(dir).catch((error: unknown) => {
    if (error instanceof LogoDeliverableError) return null;
    throw error;
  });
  return { phase, action, priorManifest, priorCandidates, priorGuidelines, nextRound: rounds.length + 1, selected };
}

export async function assertLogoDeliverables(
  dir: string,
  expectation: LogoTurnExpectation,
  evidence: LogoTurnEvidence,
): Promise<void> {
  const manifest = await readLogoManifest(dir);
  if (manifest === null) throw new LogoDeliverableError("manifest_missing");
  const prior = expectation.priorManifest?.rounds ?? [];

  if (expectation.phase === "explore") {
    // Exactly one round is appended; history and its files are immutable; every new candidate is a
    // decodable square PNG whose bytes are new to the project; the image tool actually ran.
    if (manifest.rounds.length !== prior.length + 1) throw new LogoDeliverableError("round_count");
    assertRoundsUnchanged(prior, manifest.rounds.slice(0, prior.length));
    await assertPriorCandidatesUnchanged(dir, expectation);
    if (evidence.imageGenerations < 1) throw new LogoDeliverableError("image_generation_missing");
    const round = manifest.rounds[prior.length];
    if (round === undefined) throw new LogoDeliverableError("round_count");
    const priorHashes = new Set([...expectation.priorCandidates.values()].map((entry) => entry.sha256));
    const roundHashes = new Set<string>();
    for (const candidate of round.candidates) {
      const sha256 = await assertCandidatePng(dir, candidate);
      if (priorHashes.has(sha256)) throw new LogoDeliverableError(`candidate_reused:${candidate.id}`);
      if (roundHashes.has(sha256)) throw new LogoDeliverableError(`candidate_duplicate:${candidate.id}`);
      // Bytes the image tool neither reported nor wrote during a call this turn were made some other way.
      if (!evidence.imageOutputs.has(sha256)) throw new LogoDeliverableError(`candidate_unprovenanced:${candidate.id}`);
      roundHashes.add(sha256);
    }
    const html = await readGuidelines(dir);
    if (expectation.priorGuidelines !== null && html === expectation.priorGuidelines) {
      throw new LogoDeliverableError(isStarter(html) ? "starter_unchanged" : "guidelines_unchanged");
    }
    return;
  }

  const selected = expectation.selected;
  if (selected === null || expectation.action?.action !== "select") throw new LogoDeliverableError("selection_missing");
  if (manifest.rounds.length !== prior.length) throw new LogoDeliverableError("rounds_changed");
  assertRoundsUnchanged(prior, manifest.rounds);
  if (
    manifest.selected === null
    || manifest.selected.round !== selected.round
    || manifest.selected.candidate_id !== selected.candidate_id
  ) throw new LogoDeliverableError("selection_not_recorded");
  const candidate = manifest.rounds
    .find((round) => round.round === selected.round)
    ?.candidates.find((entry) => entry.id === selected.candidate_id);
  if (candidate === undefined) throw new LogoDeliverableError("selection_unknown");
  if (await assertCandidatePng(dir, candidate) !== selected.sha256) throw new LogoDeliverableError("selected_candidate_changed");
  await assertPriorCandidatesUnchanged(dir, expectation);
  await assertLogoSvgFile(dir, candidate.file);
  const html = await readGuidelines(dir);
  const pages = parse(html).querySelectorAll("[data-graphic-artboard]").length;
  if (pages < REQUIRED_GUIDELINE_PAGES) throw new LogoDeliverableError("guidelines_pages");
  if (pages > MAX_GUIDELINE_PAGES) throw new LogoDeliverableError("guidelines_pages_over");
}

function assertRoundsUnchanged(prior: readonly LogoRoundV1[], current: readonly LogoRoundV1[]): void {
  if (JSON.stringify(prior) !== JSON.stringify(current)) throw new LogoDeliverableError("rounds_changed");
}

async function assertPriorCandidatesUnchanged(dir: string, expectation: LogoTurnExpectation): Promise<void> {
  for (const [key, entry] of expectation.priorCandidates) {
    const sha256 = await candidateHash(dir, { file: entry.file });
    if (sha256 !== entry.sha256) throw new LogoDeliverableError(`prior_candidate_changed:${key}`);
  }
}

/**
 * The master vector contract lives in logo-svg-validation.ts (an allowlist parser) and is re-exported
 * here so the turn gate and the SVG export validate exactly the same bytes against the same rules.
 */
export { logoSvgSource, validateLogoSvg } from "./logo-svg-validation";
import { logoSvgSource, validateLogoSvg } from "./logo-svg-validation";

/** Verifies a candidate is a complete, decodable, square PNG and returns its sha256. */
async function assertCandidatePng(dir: string, candidate: LogoCandidateV1): Promise<string> {
  const file = safePath(dir, candidate.file, `candidate_path_unsafe:${candidate.id}`);
  const info = await lstat(file).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (info === null) throw new LogoDeliverableError(`candidate_missing:${candidate.id}`);
  if (!info.isFile() || info.nlink !== 1) throw new LogoDeliverableError(`candidate_not_file:${candidate.id}`);
  if (info.size === 0) throw new LogoDeliverableError(`candidate_empty:${candidate.id}`);
  if (info.size > MAX_CANDIDATE_BYTES) throw new LogoDeliverableError(`candidate_too_large:${candidate.id}`);
  const bytes = await readFile(file);
  const png = inspectPng(bytes);
  if (typeof png === "string") throw new LogoDeliverableError(`candidate_${png}:${candidate.id}`);
  if (png.width !== png.height || png.width < CANDIDATE_MIN_PX || png.width > CANDIDATE_MAX_PX) {
    throw new LogoDeliverableError(`candidate_geometry:${candidate.id}`);
  }
  return sha256(bytes);
}

/** Pre-turn hash of a candidate file; null when it is absent or not a plain file, which is not an error yet. */
async function candidateHash(dir: string, candidate: Pick<LogoCandidateV1, "file">): Promise<string | null> {
  let file: string;
  try {
    file = resolveWithin(dir, ...candidate.file.split("/"));
  } catch (error) {
    if (error instanceof PathBoundaryError) return null;
    throw error;
  }
  const info = await lstat(file).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (info === null || !info.isFile() || info.nlink !== 1 || info.size === 0 || info.size > MAX_CANDIDATE_BYTES) return null;
  return sha256(await readFile(file));
}

const PNG_CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const PNG_BIT_DEPTHS: Readonly<Record<number, readonly number[]>> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
type PngHeader = { readonly width: number; readonly height: number; readonly bitDepth: number; readonly colourType: number };

/**
 * PNG decode without a pixel buffer: signature; IHDR first with a legal bit depth / colour type pair
 * and the only defined compression, filter and interlace methods; every chunk's CRC; PLTE before
 * IDAT for a palette image; IEND exactly at the last byte; then the IDAT stream inflated to exactly
 * height x (1 + row bytes) with a legal filter byte on every row. A file that frames correctly but
 * cannot be decoded is "undecodable"; a bare signature or a file cut off before IEND is "truncated";
 * anything else is "not_png". Interlaced images are refused: the image tool never writes them and
 * Adam7 would need a second geometry model.
 */
function inspectPng(bytes: Buffer): { readonly width: number; readonly height: number } | "not_png" | "truncated" | "undecodable" {
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return "not_png";
  let offset = PNG_SIGNATURE.length;
  let header: PngHeader | null = null;
  let sawPlte = false;
  const idat: Buffer[] = [];
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > bytes.length) return "truncated";
    if ((crc32(bytes.subarray(offset + 4, end - 4)) >>> 0) !== bytes.readUInt32BE(end - 4)) return "not_png";
    if (header === null) {
      if (type !== "IHDR" || length !== 13) return "not_png";
      const width = bytes.readUInt32BE(offset + 8);
      const height = bytes.readUInt32BE(offset + 12);
      if (width === 0 || height === 0) return "not_png";
      const bitDepth = bytes[offset + 16] ?? 0;
      const colourType = bytes[offset + 17] ?? 0;
      const methodsDefined = bytes[offset + 18] === 0 && bytes[offset + 19] === 0 && bytes[offset + 20] === 0;
      if (!methodsDefined || PNG_BIT_DEPTHS[colourType]?.includes(bitDepth) !== true) return "undecodable";
      header = { width, height, bitDepth, colourType };
    } else if (type === "PLTE") {
      if (idat.length > 0 || length === 0 || length % 3 !== 0) return "undecodable";
      sawPlte = true;
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(offset + 8, end - 4));
    } else if (type === "IEND") {
      if (idat.length === 0 || end !== bytes.length) return "truncated";
      if (header.colourType === 3 && !sawPlte) return "undecodable";
      return inflatesToGeometry(Buffer.concat(idat), header) ? { width: header.width, height: header.height } : "undecodable";
    }
    offset = end;
  }
  return "truncated";
}

/** The IDAT stream must inflate to exactly the filtered scanlines the header declares. */
function inflatesToGeometry(stream: Buffer, header: PngHeader): boolean {
  const rowBytes = Math.ceil((header.width * (PNG_CHANNELS[header.colourType] ?? 0) * header.bitDepth) / 8);
  const expected = header.height * (rowBytes + 1);
  let raw: Buffer;
  try {
    raw = inflateSync(stream, { maxOutputLength: expected + 1 });
  } catch (error) {
    if (error instanceof Error) return false;
    throw error;
  }
  if (raw.length !== expected) return false;
  for (let row = 0; row < header.height; row += 1) if ((raw[row * (rowBytes + 1)] ?? 5) > 4) return false;
  return true;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function assertLogoSvgFile(dir: string, expectedSource: string): Promise<void> {
  const file = safePath(dir, LOGO_FILES.logo, "svg_path_unsafe");
  const info = await lstat(file).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (info === null) throw new LogoDeliverableError("svg_missing");
  if (!info.isFile() || info.nlink !== 1) throw new LogoDeliverableError("svg_not_file");
  if (info.size === 0) throw new LogoDeliverableError("svg_empty");
  if (info.size > MAX_SVG_BYTES) throw new LogoDeliverableError("svg_too_large");
  const text = await readFile(file, "utf8");
  validateLogoSvg(text);
  const source = logoSvgSource(text);
  if (source === null) throw new LogoDeliverableError("svg_source_missing");
  if (source !== expectedSource) throw new LogoDeliverableError("svg_source_mismatch");
}

async function readGuidelines(dir: string): Promise<string> {
  const file = safePath(dir, LOGO_FILES.guidelines, "guidelines_path_unsafe");
  const info = await lstat(file).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (info === null) throw new LogoDeliverableError("guidelines_missing");
  if (!info.isFile() || info.nlink !== 1 || info.size > MAX_GUIDELINES_BYTES) throw new LogoDeliverableError("guidelines_not_file");
  return await readFile(file, "utf8");
}

function isStarter(html: string): boolean {
  return html.includes(`data-bg-node-id="${LOGO_STARTER_NODE_ID}"`) && html.includes(LOGO_STARTER_SENTENCE);
}

function safePath(dir: string, relative: string, detail: string): string {
  try {
    return resolveWithin(dir, ...relative.split("/"));
  } catch (error) {
    if (error instanceof PathBoundaryError) throw new LogoDeliverableError(detail);
    throw error;
  }
}

/** The opening tag of the document's root element, only when that element is an `<svg>`. */

function isMissing(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error) || typeof error.code !== "string") return false;
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}
