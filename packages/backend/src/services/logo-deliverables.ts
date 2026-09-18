import { lstat, open, readFile } from "node:fs/promises";
import { parse } from "node-html-parser";
import {
  LOGO_CANDIDATE_COUNT,
  LOGO_FILES,
  LOGO_SOURCE_ATTRIBUTE,
  parseLogoManifestV1,
  UpgradeContractError,
  type LogoActionV1,
  type LogoCandidateV1,
  type LogoManifestV1,
  type LogoPhase,
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
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const FORBIDDEN_SVG_ELEMENTS = ["image", "script", "foreignObject", "text"] as const;
const SOURCE_ATTRIBUTE = new RegExp(`\\s${LOGO_SOURCE_ATTRIBUTE}\\s*=\\s*["']([^"']*)["']`);

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

export async function assertLogoDeliverables(
  dir: string,
  phase: LogoPhase,
  action: LogoActionV1 | null,
  starterHtml?: string,
): Promise<void> {
  const manifest = await readLogoManifest(dir);
  if (manifest === null) throw new LogoDeliverableError("manifest_missing");

  if (phase === "explore") {
    // Only the newest round is gated: an earlier round the user already rejected may have been
    // pruned, but the round this turn produced has to be complete and openable.
    const round = manifest.rounds[manifest.rounds.length - 1];
    if (round === undefined || round.candidates.length !== LOGO_CANDIDATE_COUNT) throw new LogoDeliverableError("candidate_count");
    for (const candidate of round.candidates) await assertCandidatePng(dir, candidate);
    const html = await readGuidelines(dir);
    if (starterHtml !== undefined && isUntouchedStarter(starterHtml, html)) throw new LogoDeliverableError("starter_unchanged");
    return;
  }

  if (action === null || action.action !== "select") throw new LogoDeliverableError("selection_missing");
  const candidate = manifest.rounds
    .find((round) => round.round === action.round)
    ?.candidates.find((entry) => entry.id === action.candidate_id);
  if (candidate === undefined) throw new LogoDeliverableError("selection_unknown");
  if (
    manifest.selected === null
    || manifest.selected.round !== action.round
    || manifest.selected.candidate_id !== action.candidate_id
  ) throw new LogoDeliverableError("selection_not_recorded");
  await assertCandidatePng(dir, candidate);
  await assertLogoSvgFile(dir, candidate.file);
  const html = await readGuidelines(dir);
  const pages = parse(html).querySelectorAll("[data-graphic-artboard]").length;
  if (pages < REQUIRED_GUIDELINE_PAGES) throw new LogoDeliverableError("guidelines_pages");
  if (pages > MAX_GUIDELINE_PAGES) throw new LogoDeliverableError("guidelines_pages_over");
}

/**
 * The master vector contract. It lives here rather than in the export lane so the turn gate and the
 * SVG export validate exactly the same bytes against exactly the same rules.
 */
export function validateLogoSvg(text: string): void {
  if (Buffer.byteLength(text, "utf8") > MAX_SVG_BYTES) throw new LogoDeliverableError("svg_too_large");
  const body = text.replace(/<!--[\s\S]*?-->/g, "");
  // A DTD can declare entities the scan below never expands; a flat mark has no use for one.
  if (/<!DOCTYPE/i.test(body)) throw new LogoDeliverableError("svg_doctype");
  const root = rootSvgTag(body);
  if (root === null) throw new LogoDeliverableError("svg_root_invalid");
  if (!/\sviewBox\s*=/.test(root)) throw new LogoDeliverableError("svg_viewbox_missing");
  for (const element of FORBIDDEN_SVG_ELEMENTS) {
    if (new RegExp(`<\\s*${element}[\\s/>]`, "i").test(body)) throw new LogoDeliverableError(`svg_forbidden_element:${element}`);
  }
  if (/\s(?:xlink:)?href\s*=\s*["']?\s*(?:https?:|data:)/i.test(body)) throw new LogoDeliverableError("svg_external_reference");
  for (const tag of body.matchAll(/<\s*use\b[^>]*>/gi)) {
    const href = /\s(?:xlink:)?href\s*=\s*["']?([^"'\s>]*)/i.exec(tag[0])?.[1];
    // A `<use>` may only reassemble this document; anything that is not a same-document fragment
    // reference pulls bytes the validator never saw.
    if (href !== undefined && !href.startsWith("#")) throw new LogoDeliverableError("svg_external_reference");
  }
  if (/url\s*\(/i.test(body)) throw new LogoDeliverableError("svg_url_reference");
  if (/\son[a-zA-Z]+\s*=/.test(body)) throw new LogoDeliverableError("svg_event_handler");
}

/** The generated candidate the vector claims to reproduce, or null when the root does not say. */
export function logoSvgSource(text: string): string | null {
  const root = rootSvgTag(text.replace(/<!--[\s\S]*?-->/g, ""));
  if (root === null) return null;
  return SOURCE_ATTRIBUTE.exec(root)?.[1] ?? null;
}

async function assertCandidatePng(dir: string, candidate: LogoCandidateV1): Promise<void> {
  const file = safePath(dir, candidate.file, `candidate_path_unsafe:${candidate.id}`);
  const info = await lstat(file).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (info === null) throw new LogoDeliverableError(`candidate_missing:${candidate.id}`);
  if (!info.isFile() || info.nlink !== 1) throw new LogoDeliverableError(`candidate_not_file:${candidate.id}`);
  if (info.size === 0) throw new LogoDeliverableError(`candidate_empty:${candidate.id}`);
  const header = Buffer.alloc(PNG_MAGIC.length);
  const handle = await open(file, "r");
  try {
    const { bytesRead } = await handle.read(header, 0, PNG_MAGIC.length, 0);
    if (bytesRead !== PNG_MAGIC.length || !header.equals(PNG_MAGIC)) throw new LogoDeliverableError(`candidate_not_png:${candidate.id}`);
  } finally {
    await handle.close();
  }
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

function isUntouchedStarter(starter: string, current: string): boolean {
  return starter.includes(`data-bg-node-id="${LOGO_STARTER_NODE_ID}"`)
    && starter.includes(LOGO_STARTER_SENTENCE)
    && starter === current;
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
function rootSvgTag(body: string): string | null {
  let cursor = 0;
  while (cursor < body.length) {
    const start = body.indexOf("<", cursor);
    if (start === -1) return null;
    const marker = body[start + 1];
    if (marker === "?" || marker === "!") {
      const close = body.indexOf(">", start);
      if (close === -1) return null;
      cursor = close + 1;
      continue;
    }
    const name = /^<\s*([A-Za-z][\w.:-]*)/.exec(body.slice(start))?.[1];
    if (name === undefined || name.toLowerCase() !== "svg") return null;
    const end = tagEnd(body, start);
    return end === -1 ? null : body.slice(start, end + 1);
  }
  return null;
}

function tagEnd(body: string, start: number): number {
  let quote: string | null = null;
  for (let cursor = start; cursor < body.length; cursor += 1) {
    const character = body[cursor];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return cursor;
  }
  return -1;
}

function isMissing(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error) || typeof error.code !== "string") return false;
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}
