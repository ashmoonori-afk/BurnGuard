/**
 * The wordmark record of the geometric logo method (`geometric/wordmark.json`). The model picks the
 * text, one bundled OFL family and three metrics in symbol units; the server sets the glyph
 * outlines (`backend/src/services/logo-wordmark-compile.ts`). Every metric is a multiple of the
 * grid snap, so the wordmark and the symbol are drawn on one module.
 */
import { LOGO_GEOMETRY_SNAP } from "./logo-geometry";

export const LOGO_WORDMARK_MAX_TEXT = 24;
/** Every character a wordmark may use; each settable bundled family covers all of them (tested). */
export const LOGO_WORDMARK_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789&.'- ";
/** Inclusive ranges in symbol units (the symbol artboard is 64 units). */
export const LOGO_WORDMARK_RANGES = {
  cap_height: [6, 32],
  stem: [0.5, 8],
  tracking: [-2, 8],
} as const;
/** How far the set stem may sit from the asked stem before the review names it. */
export const LOGO_WORDMARK_STEM_TOLERANCE = 0.25;

export type LogoWordmarkMetric = keyof typeof LOGO_WORDMARK_RANGES;

export interface LogoWordmarkV1 {
  readonly schema_version: 1;
  readonly text: string;
  /** A family name from the bundled font manifest. */
  readonly font: string;
  /** Height of a flat capital, in symbol units. */
  readonly cap_height: number;
  /** Width of a vertical stem, in symbol units. A variable font is set at the weight that gives it. */
  readonly stem: number;
  /** Space added between letters, in symbol units. */
  readonly tracking: number;
}

export interface LogoWordmarkParseResult {
  readonly wordmark: LogoWordmarkV1;
  /** JSON paths of the metrics moved onto the grid, so the model is told what changed. */
  readonly snapped: readonly string[];
}

export type LogoWordmarkErrorCode =
  | "invalid_json"
  | "expected_object"
  | "unknown_field"
  | "missing_field"
  | "invalid_field"
  | "out_of_range"
  | "font_unknown";

/** A refusal with a stable code and the JSON path it concerns; both are safe to hand back to the model. */
export class LogoWordmarkError extends Error {
  readonly name = "LogoWordmarkError";

  constructor(
    readonly code: LogoWordmarkErrorCode,
    readonly path: string,
  ) {
    super(`${code} at ${path}`);
  }
}

/** The set wordmark, in symbol units: cap tops at y 0, the baseline at y = cap height, the first advance at x 0. */
export interface LogoWordmarkCompiled {
  /** One SVG path, `M`/`L`/`Q`/`C`/`Z`, filled nonzero. */
  readonly path: string;
  /** Advance width of the set line, tracking included between letters only. */
  readonly width: number;
  /** The ink box. */
  readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
  readonly metrics: {
    readonly cap_height: number;
    readonly baseline: number;
    /** Heights above the baseline. */
    readonly x_height: number;
    readonly ascender: number;
    /** Depth below the baseline. */
    readonly descender: number;
    readonly stem: number;
    readonly tracking: number;
  };
  readonly font: { readonly family: string; readonly file: string; readonly weight: number | null };
  /** The stem the set font really has, measured across a capital I at half its height. */
  readonly stem_measured: number;
  /** Each glyph's start and advance, for the construction view. */
  readonly glyphs: readonly { readonly x: number; readonly advance: number }[];
}

const TEXT = /^[A-Za-z0-9&.'-]+(?: [A-Za-z0-9&.'-]+)*$/;
const FAMILY = /^[A-Za-z0-9][A-Za-z0-9 ]{0,39}$/;
const KEYS = ["schema_version", "text", "font", "cap_height", "stem", "tracking"] as const;

/**
 * Strict parse of a wordmark record. Unknown keys, text outside the plain Latin set (letters,
 * digits, `& . ' -` and single inner spaces) and metrics outside their ranges are refused; metrics
 * off the grid are snapped and listed. Whether the font is in the bundle is the compiler's
 * check, since only the server holds it.
 */
export function parseLogoWordmarkV1(input: unknown): LogoWordmarkParseResult {
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new LogoWordmarkError("invalid_json", "$");
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new LogoWordmarkError("expected_object", "$");
  const record = value as Readonly<Record<string, unknown>>;
  for (const key of KEYS) if (!(key in record)) throw new LogoWordmarkError("missing_field", `$.${key}`);
  for (const key of Object.keys(record)) {
    if (!(KEYS as readonly string[]).includes(key)) throw new LogoWordmarkError("unknown_field", `$.${key}`);
  }
  if (record["schema_version"] !== 1) throw new LogoWordmarkError("invalid_field", "$.schema_version");
  const text = record["text"];
  if (typeof text !== "string" || !TEXT.test(text)) throw new LogoWordmarkError("invalid_field", "$.text");
  if (text.length > LOGO_WORDMARK_MAX_TEXT) throw new LogoWordmarkError("out_of_range", "$.text");
  const font = record["font"];
  if (typeof font !== "string" || !FAMILY.test(font) || font !== font.trim()) throw new LogoWordmarkError("invalid_field", "$.font");
  const snapped: string[] = [];
  const metric = (key: LogoWordmarkMetric): number => {
    const raw = record[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) throw new LogoWordmarkError("invalid_field", `$.${key}`);
    const [min, max] = LOGO_WORDMARK_RANGES[key];
    if (raw < min || raw > max) throw new LogoWordmarkError("out_of_range", `$.${key}`);
    const on = Math.round(raw / LOGO_GEOMETRY_SNAP) * LOGO_GEOMETRY_SNAP;
    if (on !== raw) snapped.push(`$.${key}`);
    return Object.is(on, -0) ? 0 : on;
  };
  const wordmark: LogoWordmarkV1 = {
    schema_version: 1,
    text,
    font,
    cap_height: metric("cap_height"),
    stem: metric("stem"),
    tracking: metric("tracking"),
  };
  return { wordmark, snapped };
}

export type LogoWordmarkFinding = { readonly kind: "stem_off"; readonly asked: number; readonly measured: number };

/** Measured checks on a set wordmark: the font's stem must sit within tolerance of the asked stem. */
export function reviewLogoWordmark(compiled: LogoWordmarkCompiled): { readonly passed: boolean; readonly findings: readonly LogoWordmarkFinding[] } {
  const findings: LogoWordmarkFinding[] = [];
  if (Math.abs(compiled.stem_measured - compiled.metrics.stem) > LOGO_WORDMARK_STEM_TOLERANCE) {
    findings.push({ kind: "stem_off", asked: compiled.metrics.stem, measured: compiled.stem_measured });
  }
  return { passed: findings.length === 0, findings };
}
