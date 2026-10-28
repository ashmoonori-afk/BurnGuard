import type { Browser } from "../../packages/backend/node_modules/playwright-core";

export const ORACLE_MAX_CASES = 8192;
export const ORACLE_MAX_BYTES = 4 * 1024 * 1024;
export type OracleGamut = "srgb" | "display-p3";
export type OracleRgb = readonly [number, number, number];
export type OracleCase = {
  readonly id: string;
  readonly gamut: OracleGamut;
  readonly l: number;
  readonly c: number;
  /** Degrees; null is accepted only for zero chroma. */
  readonly h: number | null;
  readonly expectedRgb: OracleRgb;
};
export type OracleRow = {
  readonly id: string;
  readonly gamut: OracleGamut;
  readonly oklchRgba: readonly number[];
  readonly controlRgba: readonly number[];
};
export type OracleReceipt = {
  readonly schema_version: 1;
  readonly code: "OK";
  readonly channel_denominator: 255;
  readonly rows: readonly OracleRow[];
};
export type OracleCode = "ORACLE_INPUT" | "ORACLE_LIMIT" | "ORACLE_TIMEOUT"
  | "ORACLE_RUNTIME" | "ORACLE_CANVAS_UNSUPPORTED" | "ORACLE_CSS_UNSUPPORTED"
  | "ORACLE_READBACK_UNSUPPORTED" | "ORACLE_ALPHA" | "ORACLE_CLEANUP";

export class OracleError extends Error {
  constructor(readonly code: OracleCode) { super(code); this.name = "OracleError"; }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function unit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** No engine dependency. Unknown fields (including alpha) are refused. */
export function parseOracleCases(value: unknown): readonly OracleCase[] {
  if (!Array.isArray(value) || value.length === 0) throw new OracleError("ORACLE_INPUT");
  if (value.length > ORACLE_MAX_CASES) throw new OracleError("ORACLE_LIMIT");
  const ids = new Set<string>();
  return value.map((row: unknown): OracleCase => {
    if (!record(row) || Object.keys(row).length !== 6
      || !["id", "gamut", "l", "c", "h", "expectedRgb"].every(key => key in row)) {
      throw new OracleError("ORACLE_INPUT");
    }
    const { id, gamut, l, c, h, expectedRgb } = row;
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,96}$/.test(id) || ids.has(id)
      || (gamut !== "srgb" && gamut !== "display-p3") || !unit(l) || !unit(c)
      || !(h === null || typeof h === "number" && Number.isFinite(h))
      || (h === null && c !== 0)
      || !Array.isArray(expectedRgb) || expectedRgb.length !== 3) throw new OracleError("ORACLE_INPUT");
    const [r, g, b] = expectedRgb;
    if (!unit(r) || !unit(g) || !unit(b)) throw new OracleError("ORACLE_INPUT");
    ids.add(id);
    return { id, gamut, l, c, h, expectedRgb: [r, g, b] };
  });
}

/** Stream limit applies before concatenation/JSON parsing, including unterminated stdin. */
export async function readOracleCases(source: AsyncIterable<Uint8Array>): Promise<readonly OracleCase[]> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of source) {
    size += chunk.byteLength;
    if (size > ORACLE_MAX_BYTES) throw new OracleError("ORACLE_LIMIT");
    chunks.push(chunk);
  }
  try {
    return parseOracleCases(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch (error) {
    if (error instanceof OracleError) throw error;
    if (error instanceof SyntaxError) throw new OracleError("ORACLE_INPUT");
    throw error;
  }
}

/** Serialized by Playwright; all colour parsing/conversion below happens in Chromium. */
function paintCases(cases: readonly OracleCase[]):
  { readonly code: "OK"; readonly rows: readonly OracleRow[] }
  | { readonly code: OracleCode } {
  const rows: OracleRow[] = [];
  for (const gamut of ["srgb", "display-p3"] as const) {
    const group = cases.filter(row => row.gamut === gamut);
    if (group.length === 0) continue;
    const canvas = document.createElement("canvas");
    canvas.width = group.length;
    canvas.height = 2;
    const context = canvas.getContext("2d", { colorSpace: gamut, alpha: true, willReadFrequently: true });
    if (!context || context.getContextAttributes().colorSpace !== gamut) {
      return { code: "ORACLE_CANVAS_UNSUPPORTED" };
    }
    for (const [x, row] of group.entries()) {
      // No rounding, endpoint snapping, or engine-derived chroma/hue adjustments.
      const oklch = `oklch(${row.l} ${row.c} ${row.h ?? "none"} / 1)`;
      const rgb = `color(${gamut} ${row.expectedRgb.join(" ")} / 1)`;
      if (!CSS.supports("color", oklch) || !CSS.supports("color", rgb)) {
        return { code: "ORACLE_CSS_UNSUPPORTED" };
      }
      context.fillStyle = oklch;
      context.fillRect(x, 0, 1, 1);
      context.fillStyle = rgb;
      context.fillRect(x, 1, 1, 1);
    }
    let pixels: ImageData;
    try { pixels = context.getImageData(0, 0, group.length, 2, { colorSpace: gamut }); }
    catch (error) {
      if (error instanceof DOMException || error instanceof TypeError) return { code: "ORACLE_READBACK_UNSUPPORTED" };
      throw error;
    }
    if (pixels.colorSpace !== gamut || !(pixels.data instanceof Uint8ClampedArray)) {
      return { code: "ORACLE_READBACK_UNSUPPORTED" };
    }
    for (const [x, row] of group.entries()) {
      const oklchRgba = Array.from(pixels.data.slice(x * 4, x * 4 + 4));
      const offset = (group.length + x) * 4;
      const controlRgba = Array.from(pixels.data.slice(offset, offset + 4));
      if (oklchRgba[3] !== 255 || controlRgba[3] !== 255) return { code: "ORACLE_ALPHA" };
      rows.push({ id: row.id, gamut, oklchRgba, controlRgba });
    }
  }
  return { code: "OK", rows };
}

/** A single owned deadline covers launch, context creation, evaluation and graceful close. */
export async function runOracle(input: unknown): Promise<OracleReceipt> {
  const cases = parseOracleCases(input);
  const controller = new AbortController();
  let browser: Browser | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new OracleError("ORACLE_TIMEOUT"));
    }, 90_000);
  });
  const work = (async (): Promise<OracleReceipt> => {
    // Lazy import keeps pure validation independent of backend initialization.
    // A URL import preserves the QA composite project's boundary; this signature
    // is the existing backend launch contract, not a new engine API.
    const bridge: {
      readonly launchChromiumViaNode: (options: { readonly channel?: string }, signal: AbortSignal) => Promise<Browser>;
    } = await import(new URL("../../packages/backend/src/services/chromium-node-launch.ts", import.meta.url).href);
    try {
      browser = await bridge.launchChromiumViaNode({}, controller.signal);
      controller.signal.throwIfAborted();
      const context = await browser.newContext();
      await context.route("**/*", route => route.abort());
      const page = await context.newPage();
      const result = await page.evaluate(paintCases, cases);
      if (result.code !== "OK") throw new OracleError(result.code);
      const byId = new Map(result.rows.map(row => [row.id, row]));
      const rows = cases.map(row => {
        const resultRow = byId.get(row.id);
        if (!resultRow) throw new OracleError("ORACLE_RUNTIME");
        return resultRow;
      });
      return { schema_version: 1, code: "OK", channel_denominator: 255, rows };
    } finally { await browser?.close(); }
  })();
  try { return await Promise.race([work, expired]); }
  catch (error) {
    if (error instanceof OracleError) throw error;
    throw new OracleError("ORACLE_RUNTIME");
  } finally {
    controller.abort();
    clearTimeout(timer);
    // The existing bridge closes its owned process tree on abort (5 s + 3 s).
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        work.then(() => undefined, () => undefined),
        new Promise<never>((_resolve, reject) => {
          cleanupTimer = setTimeout(() => reject(new OracleError("ORACLE_CLEANUP")), 10_000);
        }),
      ]);
    } finally { clearTimeout(cleanupTimer); }
  }
}

if (import.meta.main) {
  try {
    const cases = await readOracleCases(process.stdin);
    process.stdout.write(`${JSON.stringify(await runOracle(cases))}\n`);
  } catch (error) {
    // The CLI is the sanitization boundary: never print child diagnostics.
    const code = error instanceof OracleError ? error.code : "ORACLE_RUNTIME";
    process.stdout.write(`${JSON.stringify({ schema_version: 1, code })}\n`);
    process.exitCode = 1;
  }
}
