import {
  LOGO_GEOMETRIC_STEPS,
  parseLogoGeometricAnswersV1,
  type LogoGeometricAnswersV1,
  type LogoGeometricPlanItem,
  type LogoGeometricStep,
} from "./logo-geometric-flow";
import type { LogoGeometryFinding } from "./logo-geometry-review";

/**
 * What the app shows for a geometric logo project (doc/31): the method the next turn takes, the
 * answers, the plan, each step's record hash (an approval names it) and the measured review of the
 * current symbol record. Derived from the project files on every read, so a reload shows the same
 * state. `raster` means the geometric method is off for this project and the raster flow applies.
 */
export type LogoGeometricStatusV1 =
  | { readonly schema_version: 1; readonly method: "raster" }
  | {
    readonly schema_version: 1;
    readonly method: "geometric";
    readonly answers: LogoGeometricAnswersV1 | null;
    readonly plan: readonly LogoGeometricPlanItem[];
    /** The steps this build can make; the others are offered but disabled until they ship. */
    readonly available_steps: readonly LogoGeometricStep[];
    readonly records: Readonly<Record<LogoGeometricStep, string | null>>;
    /** The measured review of the symbol record now on disk; null when there is none for these bytes. */
    readonly symbol_review: { readonly passed: boolean; readonly findings: readonly LogoGeometricFindingKind[] } | null;
  };

export type LogoGeometricFindingKind = LogoGeometryFinding["kind"];
export const LOGO_GEOMETRIC_FINDING_KINDS = ["sliver", "near_touch", "duplicate_guide", "closed_counter"] as const satisfies readonly LogoGeometricFindingKind[];

const PLAN_STATUSES = ["done", "awaiting_review", "next", "pending"] as const;
const SHA256 = /^[0-9a-f]{64}$/;

export class LogoGeometricStatusError extends Error {
  constructor(readonly path: string) {
    super(`Invalid logo geometric status at ${path}`);
    this.name = "LogoGeometricStatusError";
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(values: readonly T[], value: unknown, path: string): T {
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) throw new LogoGeometricStatusError(path);
  return value as T;
}

/** The one trust boundary for a status response: exact keys, known values, nothing else. */
export function parseLogoGeometricStatusV1(input: unknown): LogoGeometricStatusV1 {
  if (!isRecord(input) || input["schema_version"] !== 1) throw new LogoGeometricStatusError("schema_version");
  if (input["method"] === "raster") {
    if (Object.keys(input).length !== 2) throw new LogoGeometricStatusError("method");
    return { schema_version: 1, method: "raster" };
  }
  if (input["method"] !== "geometric" || Object.keys(input).length !== 7) throw new LogoGeometricStatusError("method");
  const answers = input["answers"] === null ? null : (() => {
    try { return parseLogoGeometricAnswersV1(input["answers"]); }
    catch { throw new LogoGeometricStatusError("answers"); }
  })();
  const plan = input["plan"];
  if (!Array.isArray(plan) || plan.length > LOGO_GEOMETRIC_STEPS.length) throw new LogoGeometricStatusError("plan");
  const items = plan.map((item: unknown, index): LogoGeometricPlanItem => {
    if (!isRecord(item) || Object.keys(item).length !== 2) throw new LogoGeometricStatusError(`plan.${index}`);
    return { step: oneOf(LOGO_GEOMETRIC_STEPS, item["step"], `plan.${index}.step`), status: oneOf(PLAN_STATUSES, item["status"], `plan.${index}.status`) };
  });
  if (new Set(items.map((item) => item.step)).size !== items.length) throw new LogoGeometricStatusError("plan");
  const available = input["available_steps"];
  if (!Array.isArray(available) || available.length > LOGO_GEOMETRIC_STEPS.length) throw new LogoGeometricStatusError("available_steps");
  const availableSteps = available.map((step: unknown, index) => oneOf(LOGO_GEOMETRIC_STEPS, step, `available_steps.${index}`));
  if (new Set(availableSteps).size !== availableSteps.length) throw new LogoGeometricStatusError("available_steps");
  const records = input["records"];
  if (!isRecord(records) || Object.keys(records).length !== LOGO_GEOMETRIC_STEPS.length) throw new LogoGeometricStatusError("records");
  const hashes = Object.fromEntries(LOGO_GEOMETRIC_STEPS.map((step) => {
    const value = records[step];
    if (value !== null && (typeof value !== "string" || !SHA256.test(value))) throw new LogoGeometricStatusError(`records.${step}`);
    return [step, value];
  })) as Record<LogoGeometricStep, string | null>;
  const review = input["symbol_review"];
  let symbolReview: { passed: boolean; findings: LogoGeometricFindingKind[] } | null = null;
  if (review !== null) {
    if (!isRecord(review) || Object.keys(review).length !== 2 || typeof review["passed"] !== "boolean" || !Array.isArray(review["findings"])) {
      throw new LogoGeometricStatusError("symbol_review");
    }
    const findings = review["findings"].map((kind: unknown, index) => oneOf(LOGO_GEOMETRIC_FINDING_KINDS, kind, `symbol_review.findings.${index}`));
    if (new Set(findings).size !== findings.length) throw new LogoGeometricStatusError("symbol_review.findings");
    symbolReview = { passed: review["passed"], findings };
  }
  return { schema_version: 1, method: "geometric", answers, plan: items, available_steps: availableSteps, records: hashes, symbol_review: symbolReview };
}
