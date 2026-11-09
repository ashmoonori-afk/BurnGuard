import { mkdir, rm, writeFile } from "node:fs/promises";
import {
  LOGO_FILES,
  LOGO_GEOMETRIC_ANSWERS_FILE,
  LOGO_GEOMETRY_FILE,
  logoGeometricPlan,
  logoMethodFor,
  parseLogoGeometricAction,
  resolveLogoGeometricTurn,
  serializeLogoGeometricAnswers,
  type LogoGeometricAnswersV1,
  type LogoGeometricStatusV1,
  type LogoGeometricStep,
  type LogoSetV1,
} from "@bg/shared";
import { resolveWithin } from "../security/path-boundary";
import { inspectCanonicalTree, type CanonicalTreeManifest } from "./canonical-tree-manifest";
import { LogoDeliverableError } from "./logo-deliverables";
import {
  LOGO_GEOMETRIC_APPROVALS_FILE,
  LOGO_GEOMETRIC_RECORD_FILES,
  LOGO_GEOMETRIC_SYMBOL_RENDERS,
  LOGO_GEOMETRIC_SYMBOL_REVIEW_FILE,
  LOGO_GEOMETRIC_WORDMARK_FILES,
  composeLogoGeometricLockup,
  finishLogoGeometricSymbol,
  finishLogoGeometricWordmark,
  readLogoGeometricState,
  readLogoGeometricSymbolReview,
  recordLogoGeometricApproval,
  renderLogoGeometricSymbol,
  type LogoGeometricSymbolReviewV1,
  type LogoGeometricWordmarkOutcome,
  type LogoGeometricWordmarkReviewV1,
} from "./logo-geometric-step";
import { listLogoWordmarkFamilies } from "./logo-wordmark-compile";

/**
 * One turn of the geometric logo method (doc/30). Before the agent runs, `captureLogoGeometricTurn`
 * decides from the files on disk and the message sentinel what the turn does, and records the
 * backend's own writes (answers, approvals). After the agent wrote its geometry record,
 * `completeLogoGeometricTurn` compiles it, measures it, draws the renders and runs one review pass
 * in which the model looks at them and may rewrite the record once; the record is then compiled
 * again and anything still wrong stays in the review file for the person to see.
 *
 * The method is off unless `BG_LOGO_GEOMETRIC=1`: the design keeps the raster method as the default
 * until the frozen-brief measurement says the geometric one is better.
 */

export const LOGO_GEOMETRIC_ENV = "BG_LOGO_GEOMETRIC";
export const LOGO_GEOMETRIC_STEP_TAG = "burnguard-logo-geometric-step-v1";
export const LOGO_GEOMETRIC_REVIEW_TAG = "burnguard-logo-geometric-review-v1";

export function logoGeometricEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env[LOGO_GEOMETRIC_ENV] === "1";
}

export type LogoGeometricCapture =
  | {
    readonly kind: "make";
    readonly step: LogoGeometricStep;
    readonly answers: LogoGeometricAnswersV1;
    readonly note: string | null;
    /** The only file the model may write this turn. */
    readonly record_file: string;
    /** The bundled families the wordmark may be set in; only on the wordmark step. */
    readonly families?: readonly string[];
  }
  /** The last step was approved: the model only replies, and writes nothing. */
  | { readonly kind: "complete" };

/**
 * The steps the app offers. A turn can make the wordmark and compose the lockup (doc/33), but the
 * panel offers them only once it can show a wordmark for review, so the questions keep to the symbol.
 */
const OFFERED_STEPS: readonly LogoGeometricStep[] = ["symbol"];

/**
 * What the app shows for this project (doc/31), read from the same files and with the same method
 * decision as a turn, so the screen and the next turn cannot disagree.
 */
export async function readLogoGeometricStatus(dir: string, logoSet: LogoSetV1 | null, enabled: boolean): Promise<LogoGeometricStatusV1> {
  if (!enabled || logoSet === null || logoMethodFor(logoSet.logo_type) !== "geometric") return { schema_version: 1, method: "raster" };
  const state = await readLogoGeometricState(dir);
  const symbol = state.steps.symbol.record_sha256;
  return {
    schema_version: 1,
    method: "geometric",
    answers: state.answers,
    plan: logoGeometricPlan(state),
    available_steps: OFFERED_STEPS,
    records: { symbol, wordmark: state.steps.wordmark.record_sha256, lockup: state.steps.lockup.record_sha256 },
    symbol_review: symbol === null ? null : await readLogoGeometricSymbolReview(dir, symbol),
  };
}

/**
 * Returns null when the turn stays on the raster method: the switch is off, the brief asks for a
 * drawn mark, or the person has neither answered the questions nor sent a geometric sentinel.
 * A refused turn throws a `LogoDeliverableError` whose detail starts with `geometric_`.
 */
export async function captureLogoGeometricTurn(dir: string, requestText: string, logoSet: LogoSetV1 | null, enabled: boolean): Promise<LogoGeometricCapture | null> {
  if (!enabled || logoSet === null || logoMethodFor(logoSet.logo_type) !== "geometric") return null;
  const action = parseLogoGeometricAction(requestText);
  const state = await readLogoGeometricState(dir);
  if (action === null && state.answers === null) return null;
  const turn = resolveLogoGeometricTurn(state, action);
  if (turn.kind === "refused") throw new LogoDeliverableError(`geometric_${turn.code}`);
  if (action?.action === "answer" && turn.kind === "make") {
    // New answers start the flow over: earlier approvals no longer describe what the person asked for.
    await rm(resolveWithin(dir, ...LOGO_GEOMETRIC_APPROVALS_FILE.split("/")), { force: true });
    await mkdir(resolveWithin(dir, "geometric"), { recursive: true });
    await writeFile(resolveWithin(dir, ...LOGO_GEOMETRIC_ANSWERS_FILE.split("/")), serializeLogoGeometricAnswers(turn.answers), "utf8");
  }
  // The lockup is computed, not authored: the server composes it before the approval that leads to
  // it is recorded, so a lockup that cannot be composed refuses the turn with nothing recorded.
  if (turn.kind === "make" && turn.step === "lockup" && await composeLogoGeometricLockup(dir, logoSet.brand_name) === null) {
    throw new LogoDeliverableError("geometric_lockup_unavailable");
  }
  if (turn.approve !== null) await recordLogoGeometricApproval(dir, turn.approve.step, turn.approve.record_sha256);
  // With the lockup composed the flow is done; the model only replies.
  if (turn.kind === "complete" || turn.step === "lockup") return { kind: "complete" };
  const record_file = LOGO_GEOMETRIC_RECORD_FILES[turn.step];
  const base = { kind: "make", step: turn.step, answers: turn.answers, note: turn.note, record_file } as const;
  return turn.step === "wordmark" ? { ...base, families: await listLogoWordmarkFamilies() } : base;
}

/** The files the model's own writes may touch this turn. */
export function logoGeometricWritableFiles(capture: LogoGeometricCapture): readonly string[] {
  return capture.kind === "make" ? [capture.record_file] : [];
}

/** Refuses a turn that wrote anything beyond the record it was asked for. */
export function assertLogoGeometricScope(capture: LogoGeometricCapture, changedPaths: readonly string[]): void {
  const writable = logoGeometricWritableFiles(capture);
  if (changedPaths.some((changed) => !writable.includes(changed))) throw new LogoDeliverableError("geometry_scope");
}

export type LogoGeometricCompletion = {
  readonly review: LogoGeometricSymbolReviewV1 | LogoGeometricWordmarkReviewV1;
  /** Whether the review pass rewrote the record. */
  readonly revised: boolean;
};

/**
 * Runs after the agent's first pass. `review` runs the model once with the given prompt and
 * resolves when it finished cleanly; it throws on its own failure. A record that still does not
 * compile after the review pass refuses the turn with `geometry_<code>`.
 */
export async function completeLogoGeometricTurn(input: {
  readonly dir: string;
  readonly capture: Extract<LogoGeometricCapture, { kind: "make" }>;
  readonly label: string;
  readonly review: (prompt: string) => Promise<void>;
  readonly signal: AbortSignal;
}): Promise<LogoGeometricCompletion> {
  if (input.capture.step === "wordmark") return await completeWordmark(input);
  const first = await finishLogoGeometricSymbol(input.dir, input.label);
  if (first.kind === "compiled") await renderLogoGeometricSymbol(input.dir, first.geometry, first.compiled, input.label);
  const revised = await reviewPass(input, logoGeometricReviewPrompt(first.kind === "compiled"
    ? { kind: "compiled", review: first.review }
    : { kind: "refused", code: first.code, path: first.path }));
  const final = revised || first.kind !== "compiled" ? await finishLogoGeometricSymbol(input.dir, input.label) : first;
  if (final.kind === "refused") throw new LogoDeliverableError(`geometry_${final.code}`);
  if (final !== first) await renderLogoGeometricSymbol(input.dir, final.geometry, final.compiled, input.label);
  return { review: final.review, revised };
}

type CompletionInput = Parameters<typeof completeLogoGeometricTurn>[0];

/** Runs the review pass and returns whether it rewrote the record; any other write refuses the turn. */
async function reviewPass(input: CompletionInput, prompt: string): Promise<boolean> {
  input.signal.throwIfAborted();
  const before = await inspectCanonicalTree(input.dir);
  await input.review(prompt);
  input.signal.throwIfAborted();
  const changed = changedPaths(before, await inspectCanonicalTree(input.dir));
  if (changed.some((path) => path !== input.capture.record_file)) throw new LogoDeliverableError("geometry_scope");
  return changed.includes(input.capture.record_file);
}

/**
 * The wordmark is set from the font, so its flaws are measured ones. The review pass runs only when
 * there is something to fix: a refused record or a stem the font does not meet.
 */
async function completeWordmark(input: CompletionInput): Promise<LogoGeometricCompletion> {
  const first = await finishLogoGeometricWordmark(input.dir, input.label);
  if (first.kind === "compiled" && first.review.passed) return { review: first.review, revised: false };
  const revised = await reviewPass(input, logoGeometricWordmarkReviewPrompt(first));
  const final = revised || first.kind !== "compiled" ? await finishLogoGeometricWordmark(input.dir, input.label) : first;
  if (final.kind === "refused") throw new LogoDeliverableError(`geometry_${final.code}`);
  return { review: final.review, revised };
}

/** The wordmark review pass's whole prompt, a bounded context like the symbol's. */
export function logoGeometricWordmarkReviewPrompt(first: LogoGeometricWordmarkOutcome): string {
  const record_file = LOGO_GEOMETRIC_RECORD_FILES.wordmark;
  const payload = first.kind === "compiled"
    ? { schema_version: 1, step: "wordmark", record_file, wordmark_file: LOGO_GEOMETRIC_WORDMARK_FILES.svg, review_file: LOGO_GEOMETRIC_WORDMARK_FILES.review, measured: { passed: first.review.passed, findings: first.review.findings, snapped: first.review.snapped } }
    : { schema_version: 1, step: "wordmark", record_file, refused: { code: first.code, path: first.path } };
  return [
    `<${LOGO_GEOMETRIC_REVIEW_TAG}>`,
    JSON.stringify(payload).replace(/</g, "\\u003c"),
    `</${LOGO_GEOMETRIC_REVIEW_TAG}>`,
    "",
    first.kind === "compiled"
      ? "The server set your wordmark, and the font's measured stem is too far from the stem you asked for (stem_off gives both). Pick a family whose weight is closer, or change cap_height or stem so they agree, keeping the stem tied to the symbol."
      : "The server could not set your wordmark record; the refusal names the rule and the JSON path. Fix the record so it can be set.",
    `Rewrite ${record_file} once with the fix. Write no other file: the server sets the wordmark and writes its review from the record.`,
    "End with one short sentence that names what you changed.",
  ].join("\n");
}

function changedPaths(before: CanonicalTreeManifest, after: CanonicalTreeManifest): readonly string[] {
  const previous = new Map(before.files.map((file) => [file.path, file.sha256]));
  const current = new Map(after.files.map((file) => [file.path, file.sha256]));
  const changed = new Set<string>();
  for (const [path, sha256] of current) if (previous.get(path) !== sha256) changed.add(path);
  for (const path of previous.keys()) if (!current.has(path)) changed.add(path);
  return [...changed];
}

type FirstPass =
  | { readonly kind: "compiled"; readonly review: LogoGeometricSymbolReviewV1 }
  | { readonly kind: "refused"; readonly code: string; readonly path: string };

/**
 * The review pass's whole prompt: a bounded context of its own, never the generation request.
 * The machine block carries the measured findings or the compiler's refusal and the render files.
 */
export function logoGeometricReviewPrompt(first: FirstPass): string {
  const payload = first.kind === "compiled"
    ? {
      schema_version: 1,
      record_file: LOGO_GEOMETRY_FILE,
      mark_file: LOGO_FILES.logo,
      review_file: LOGO_GEOMETRIC_SYMBOL_REVIEW_FILE,
      renders: Object.values(LOGO_GEOMETRIC_SYMBOL_RENDERS).map((render) => render.file),
      measured: { passed: first.review.passed, findings: first.review.findings, snapped: first.review.snapped },
    }
    : { schema_version: 1, record_file: LOGO_GEOMETRY_FILE, refused: { code: first.code, path: first.path } };
  return [
    `<${LOGO_GEOMETRIC_REVIEW_TAG}>`,
    JSON.stringify(payload).replace(/</g, "\\u003c"),
    `</${LOGO_GEOMETRIC_REVIEW_TAG}>`,
    "",
    first.kind === "compiled"
      ? "Review the geometric mark you just built. Open the three render files and look at them: the mark at 1024 px, the mark at 16 px and the construction sheet. Check the measured findings first, then look for what measurement misses: a tiny nick or spur, a sliver, an uneven stroke weight, a counter that closes at 16 px, a shape that only nearly lines up, or a mark that reads as a stock icon."
      : "The server could not compile your geometry record; the refusal names the rule and the JSON path. Fix the record so it compiles.",
    `If the mark needs a fix, rewrite ${LOGO_GEOMETRY_FILE} once with the fix and keep everything the fix does not need to change. If it is right, leave the file exactly as it is.`,
    `Write no other file: the server rebuilds ${LOGO_FILES.logo}, the review and the renders from the record.`,
    "End with one short sentence that names the flaw you fixed, or says the mark was kept as it was.",
  ].join("\n");
}
