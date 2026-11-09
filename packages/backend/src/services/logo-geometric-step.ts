import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import {
  LOGO_FILES,
  LOGO_GEOMETRIC_ANSWERS_FILE,
  LOGO_GEOMETRIC_FINDING_KINDS,
  LOGO_GEOMETRIC_STEPS,
  LOGO_GEOMETRY_FILE,
  LogoGeometryCompileError,
  LogoGeometryError,
  LogoWordmarkError,
  UpgradeContractError,
  compileLogoGeometry,
  composeLogoLockup,
  logoLockupSvg,
  parseLogoWordmarkV1,
  reviewLogoWordmark,
  logoGeometrySvg,
  parseLogoGeometricAnswersV1,
  parseLogoGeometryV1,
  renderLogoConstruction,
  reviewLogoGeometry,
  type LogoGeometricFilesState,
  type LogoGeometricFindingKind,
  type LogoGeometricStep,
  type LogoGeometricStepFiles,
  type LogoGeometryCompiled,
  type LogoGeometryFinding,
  type LogoGeometryV1,
  type LogoLockupLayout,
  type LogoWordmarkCompiled,
  type LogoWordmarkFinding,
} from "@bg/shared";
import { PathBoundaryError, resolveWithin } from "../security/path-boundary";
import { compileLogoWordmark } from "./logo-wordmark-compile";

/**
 * Server side of one step of the geometric logo flow (doc/29). The model writes a geometry record
 * and nothing else; this module reads the flow's state from disk, turns the record into the mark
 * (`logo.svg`), runs the measured review and draws the renders the model then looks at.
 *
 * Every model-authored file is read with the same containment and size rules as the rest of the
 * logo pipeline, and a malformed file is absent state, never a throw. Backend-authored files
 * (approvals, reviews) are canonical bytes so their hashes are stable.
 */

export const LOGO_GEOMETRIC_APPROVALS_FILE = "geometric/approvals.json";
export const LOGO_GEOMETRIC_RECORD_FILES: Readonly<Record<LogoGeometricStep, string>> = {
  symbol: LOGO_GEOMETRY_FILE,
  wordmark: "geometric/wordmark.json",
  lockup: "geometric/lockup.json",
};
export const LOGO_GEOMETRIC_SYMBOL_REVIEW_FILE = "geometric/symbol-review.json";
/** Server-written outputs of the wordmark and lockup steps (doc/33). */
export const LOGO_GEOMETRIC_WORDMARK_FILES = { svg: "geometric/wordmark.svg", review: "geometric/wordmark-review.json" } as const;
export const LOGO_GEOMETRIC_LOCKUP_SVG_FILE = "geometric/lockup.svg";
/** What the model looks at in its review pass: the mark large and at favicon size, and its construction. */
export const LOGO_GEOMETRIC_SYMBOL_RENDERS = {
  mark: { file: "geometric/review/symbol-1024.png", size: 1024 },
  small: { file: "geometric/review/symbol-16.png", size: 16 },
  construction: { file: "geometric/review/symbol-construction.png", size: 1024 },
} as const;

const RECORD_MAX_BYTES = 64 * 1024;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export type LogoGeometricApprovals = Readonly<Partial<Record<LogoGeometricStep, string>>>;

export type LogoGeometricSymbolReviewV1 = {
  readonly schema_version: 1;
  /** The record bytes this review describes; a review for other bytes is stale. */
  readonly record_sha256: string;
  readonly passed: boolean;
  readonly findings: readonly LogoGeometryFinding[];
  /** JSON paths the parser moved onto the half-unit grid. */
  readonly snapped: readonly string[];
};

export type LogoGeometricSymbolOutcome =
  | {
    readonly kind: "compiled";
    readonly geometry: LogoGeometryV1;
    readonly compiled: LogoGeometryCompiled;
    readonly review: LogoGeometricSymbolReviewV1;
  }
  /** The record is missing, unreadable or refused; `code` and `path` are safe to hand back to the model. */
  | { readonly kind: "refused"; readonly code: string; readonly path: string };

function sha256Hex(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

/** A contained, regular, single-link file of bounded size, or null. Escapes count as absent. */
async function readBounded(dir: string, relative: string, max: number): Promise<Buffer | null> {
  let target: string;
  try {
    target = resolveWithin(dir, ...relative.split("/"));
  } catch (error) {
    if (error instanceof PathBoundaryError) return null;
    throw error;
  }
  const info = await lstat(target).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (info === null || !info.isFile() || info.nlink !== 1 || info.size === 0 || info.size > max) return null;
  return await readFile(target);
}

async function writeOwned(dir: string, relative: string, bytes: string | Uint8Array): Promise<void> {
  const parts = relative.split("/");
  await mkdir(resolveWithin(dir, ...parts.slice(0, -1)), { recursive: true });
  await writeFile(resolveWithin(dir, ...parts), bytes);
}

function jsonOf(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export function parseLogoGeometricApprovals(input: unknown): LogoGeometricApprovals | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || record.schema_version !== 1 || typeof record.approvals !== "object" || record.approvals === null || Array.isArray(record.approvals)) return null;
  const approvals: Partial<Record<LogoGeometricStep, string>> = {};
  for (const [step, value] of Object.entries(record.approvals as Record<string, unknown>)) {
    const known = LOGO_GEOMETRIC_STEPS.find((candidate) => candidate === step);
    if (known === undefined || typeof value !== "string" || !SHA256_HEX.test(value)) return null;
    approvals[known] = value;
  }
  return approvals;
}

/** Canonical bytes: steps in flow order, one trailing newline. */
export function serializeLogoGeometricApprovals(approvals: LogoGeometricApprovals): string {
  const ordered: Record<string, string> = {};
  for (const step of LOGO_GEOMETRIC_STEPS) {
    const value = approvals[step];
    if (value !== undefined) ordered[step] = value;
  }
  return `${JSON.stringify({ schema_version: 1, approvals: ordered }, null, 2)}\n`;
}

async function readApprovals(dir: string): Promise<LogoGeometricApprovals> {
  const bytes = await readBounded(dir, LOGO_GEOMETRIC_APPROVALS_FILE, RECORD_MAX_BYTES);
  return (bytes === null ? null : parseLogoGeometricApprovals(jsonOf(bytes))) ?? {};
}

/** Reads what the flow's position is derived from. Missing or malformed files are absent. */
/**
 * The measured review of the symbol record whose bytes hash to `recordSha256`, reduced to the kinds
 * of finding the app explains. A missing, malformed or stale review (written for other bytes) is null.
 */
export async function readLogoGeometricSymbolReview(dir: string, recordSha256: string): Promise<{ passed: boolean; findings: LogoGeometricFindingKind[] } | null> {
  const bytes = await readBounded(dir, LOGO_GEOMETRIC_SYMBOL_REVIEW_FILE, RECORD_MAX_BYTES);
  if (bytes === null) return null;
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { return null; }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const review = value as Record<string, unknown>;
  if (review["record_sha256"] !== recordSha256 || typeof review["passed"] !== "boolean" || !Array.isArray(review["findings"])) return null;
  const kinds: LogoGeometricFindingKind[] = [];
  for (const finding of review["findings"]) {
    const kind: unknown = typeof finding === "object" && finding !== null ? (finding as Record<string, unknown>)["kind"] : undefined;
    if (!(LOGO_GEOMETRIC_FINDING_KINDS as readonly unknown[]).includes(kind)) return null;
    if (!kinds.includes(kind as LogoGeometricFindingKind)) kinds.push(kind as LogoGeometricFindingKind);
  }
  return { passed: review["passed"], findings: kinds };
}

export async function readLogoGeometricState(dir: string): Promise<LogoGeometricFilesState> {
  const answersBytes = await readBounded(dir, LOGO_GEOMETRIC_ANSWERS_FILE, RECORD_MAX_BYTES);
  let answers: LogoGeometricFilesState["answers"] = null;
  if (answersBytes !== null) {
    try {
      answers = parseLogoGeometricAnswersV1(jsonOf(answersBytes));
    } catch (error) {
      if (!(error instanceof UpgradeContractError)) throw error;
    }
  }
  const approvals = await readApprovals(dir);
  const steps = {} as Record<LogoGeometricStep, LogoGeometricStepFiles>;
  for (const step of LOGO_GEOMETRIC_STEPS) {
    const record = await readBounded(dir, LOGO_GEOMETRIC_RECORD_FILES[step], RECORD_MAX_BYTES);
    steps[step] = { record_sha256: record === null ? null : sha256Hex(record), approved_sha256: approvals[step] ?? null };
  }
  return { answers, steps };
}

/** Records the person's approval of a step's record. Other steps' approvals are kept. */
export async function recordLogoGeometricApproval(dir: string, step: LogoGeometricStep, recordSha256: string): Promise<void> {
  if (!SHA256_HEX.test(recordSha256)) throw new TypeError("approval needs a record hash");
  const approvals = { ...await readApprovals(dir), [step]: recordSha256 };
  await writeOwned(dir, LOGO_GEOMETRIC_APPROVALS_FILE, serializeLogoGeometricApprovals(approvals));
}

/**
 * Turns the symbol record into the mark. Writes `logo.svg` (the compiled path, nothing the model
 * drew) and the measured review bound to the record's hash. A refused record writes nothing.
 */
export async function finishLogoGeometricSymbol(dir: string, label: string): Promise<LogoGeometricSymbolOutcome> {
  const bytes = await readBounded(dir, LOGO_GEOMETRY_FILE, RECORD_MAX_BYTES);
  if (bytes === null) return { kind: "refused", code: "record_missing", path: "" };
  let parsed: ReturnType<typeof parseLogoGeometryV1>;
  let compiled: LogoGeometryCompiled;
  try {
    parsed = parseLogoGeometryV1(bytes.toString("utf8").replace(/^\uFEFF/, ""));
    compiled = compileLogoGeometry(parsed.geometry);
  } catch (error) {
    if (error instanceof LogoGeometryError) return { kind: "refused", code: error.code, path: error.path };
    if (error instanceof LogoGeometryCompileError) return { kind: "refused", code: error.code, path: "tree" };
    throw error;
  }
  const measured = reviewLogoGeometry(parsed.geometry, compiled);
  const review: LogoGeometricSymbolReviewV1 = {
    schema_version: 1,
    record_sha256: sha256Hex(bytes),
    passed: measured.passed,
    findings: measured.findings,
    snapped: parsed.snapped,
  };
  await writeOwned(dir, LOGO_FILES.logo, logoGeometrySvg(compiled, escapeAttribute(label)));
  await writeOwned(dir, LOGO_GEOMETRIC_SYMBOL_REVIEW_FILE, `${JSON.stringify(review, null, 2)}\n`);
  return { kind: "compiled", geometry: parsed.geometry, compiled, review };
}

export type LogoGeometricWordmarkReviewV1 = {
  readonly schema_version: 1;
  readonly record_sha256: string;
  readonly passed: boolean;
  readonly findings: readonly LogoWordmarkFinding[];
  readonly snapped: readonly string[];
};

export type LogoGeometricWordmarkOutcome =
  | { readonly kind: "compiled"; readonly compiled: LogoWordmarkCompiled; readonly review: LogoGeometricWordmarkReviewV1 }
  | { readonly kind: "refused"; readonly code: string; readonly path: string };

async function setWordmark(bytes: Buffer, repoRoot: string | undefined): Promise<{ compiled: LogoWordmarkCompiled; snapped: readonly string[] } | { code: string; path: string }> {
  try {
    const parsed = parseLogoWordmarkV1(bytes.toString("utf8").replace(/^\uFEFF/, ""));
    return { compiled: await compileLogoWordmark(parsed.wordmark, repoRoot), snapped: parsed.snapped };
  } catch (error) {
    if (error instanceof LogoWordmarkError) return { code: error.code, path: error.path };
    throw error;
  }
}

/**
 * Sets the wordmark record in its bundled font. Writes the wordmark alone as an SVG and the
 * measured review bound to the record's hash. A refused record writes nothing.
 */
export async function finishLogoGeometricWordmark(dir: string, label: string, repoRoot?: string): Promise<LogoGeometricWordmarkOutcome> {
  const bytes = await readBounded(dir, LOGO_GEOMETRIC_RECORD_FILES.wordmark, RECORD_MAX_BYTES);
  if (bytes === null) return { kind: "refused", code: "record_missing", path: "" };
  const set = await setWordmark(bytes, repoRoot);
  if ("code" in set) return { kind: "refused", code: set.code, path: set.path };
  const measured = reviewLogoWordmark(set.compiled);
  const review: LogoGeometricWordmarkReviewV1 = {
    schema_version: 1,
    record_sha256: sha256Hex(bytes),
    passed: measured.passed,
    findings: measured.findings,
    snapped: set.snapped,
  };
  const { minX, minY, maxX, maxY } = set.compiled.bounds;
  const box = [minX, minY, maxX - minX, maxY - minY].map((value) => Math.round(value * 1000) / 1000).join(" ");
  await writeOwned(dir, LOGO_GEOMETRIC_WORDMARK_FILES.svg, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" role="img" aria-label="${escapeAttribute(label)}"><path d="${set.compiled.path}" fill="#000000" fill-rule="nonzero"/></svg>`);
  await writeOwned(dir, LOGO_GEOMETRIC_WORDMARK_FILES.review, `${JSON.stringify(review, null, 2)}\n`);
  return { kind: "compiled", compiled: set.compiled, review };
}

export type LogoGeometricLockupRecordV1 = LogoLockupLayout & {
  /** The record bytes the lockup was composed from; it is stale once either changes. */
  readonly records: { readonly symbol: string; readonly wordmark: string };
};

/**
 * Composes the lockup from the symbol and wordmark records on disk, with no model. Writes the
 * layout (the lockup step's record) and the lockup SVG. Returns null, writing nothing, when either
 * record is missing or no longer compiles.
 */
export async function composeLogoGeometricLockup(dir: string, label: string, repoRoot?: string): Promise<LogoGeometricLockupRecordV1 | null> {
  const symbolBytes = await readBounded(dir, LOGO_GEOMETRY_FILE, RECORD_MAX_BYTES);
  const wordmarkBytes = await readBounded(dir, LOGO_GEOMETRIC_RECORD_FILES.wordmark, RECORD_MAX_BYTES);
  if (symbolBytes === null || wordmarkBytes === null) return null;
  let symbol: LogoGeometryCompiled;
  try {
    symbol = compileLogoGeometry(parseLogoGeometryV1(symbolBytes.toString("utf8").replace(/^\uFEFF/, "")).geometry);
  } catch (error) {
    if (error instanceof LogoGeometryError || error instanceof LogoGeometryCompileError) return null;
    throw error;
  }
  const set = await setWordmark(wordmarkBytes, repoRoot);
  if ("code" in set) return null;
  const layout = composeLogoLockup(symbol, set.compiled);
  const record: LogoGeometricLockupRecordV1 = { ...layout, records: { symbol: sha256Hex(symbolBytes), wordmark: sha256Hex(wordmarkBytes) } };
  await writeOwned(dir, LOGO_GEOMETRIC_LOCKUP_SVG_FILE, logoLockupSvg(symbol, set.compiled, layout, escapeAttribute(label)));
  await writeOwned(dir, LOGO_GEOMETRIC_RECORD_FILES.lockup, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/**
 * Draws the review renders: the mark at 1024 and at 16 px on white, and the finished
 * construction sheet. The canvas module is loaded on first use so a server that never makes a
 * geometric mark never loads it.
 */
export async function renderLogoGeometricSymbol(dir: string, geometry: LogoGeometryV1, compiled: LogoGeometryCompiled, label: string): Promise<void> {
  const { createCanvas, loadImage } = await import("./export-native-modules");
  const safeLabel = escapeAttribute(label);
  const sources = {
    mark: logoGeometrySvg(compiled, safeLabel),
    small: logoGeometrySvg(compiled, safeLabel),
    // The construction renderer escapes its own label.
    construction: renderLogoConstruction(geometry, compiled, 1, { theme: "light", label }),
  };
  for (const key of ["mark", "small", "construction"] as const) {
    const { file, size } = LOGO_GEOMETRIC_SYMBOL_RENDERS[key];
    const canvas = createCanvas(size, size);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    // A viewBox-only SVG rasterizes at its 64-unit intrinsic size and would be stretched, so the
    // copy handed to the rasterizer carries the target pixel size.
    const sized = sources[key].replace("<svg ", `<svg width="${size}" height="${size}" `);
    context.drawImage(await loadImage(Buffer.from(sized)), 0, 0, size, size);
    await writeOwned(dir, file, await canvas.encode("png"));
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
