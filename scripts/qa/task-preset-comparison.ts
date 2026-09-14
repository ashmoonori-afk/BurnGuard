/**
 * Opt-in collector for doc/18 P1-1 and P1-2.
 *
 * Two modes share one runner: `examples` collects candidate stronger-model artifacts, `compare`
 * collects the five LOW comparison arms. The runner only COLLECTS. It never scores, never approves
 * and never writes the reviewed example corpus: promotion is a reviewed source-control change whose
 * receipt must pass `promotionRejections` in task-preset-evidence.ts.
 *
 *   BG_TASK_PRESET_SMOKE=1 bun scripts/qa/task-preset-comparison.ts --mode compare --condition task-low
 *
 * Without the gate it prints one skip object and exits 0, before importing anything with backend
 * side effects, so an ordinary `bun test` or a fresh checkout stays green.
 */

import { CONDITION_IDS, isConditionId, planCondition, type ConditionId } from "./task-preset-conditions";

const OPT_IN = process.env.BG_TASK_PRESET_SMOKE === "1";

type Mode = "examples" | "compare";

export interface RunnerArgs {
  readonly mode: Mode;
  readonly conditions: readonly ConditionId[];
  readonly json: boolean;
}

export type ArgParse =
  | { readonly ok: true; readonly args: RunnerArgs }
  | { readonly ok: false; readonly error: string };

/** Reject unsupported combinations at parse time, before anything is launched. */
export function parseArgs(argv: readonly string[]): ArgParse {
  let mode: Mode | undefined;
  const conditions: ConditionId[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--json") { json = true; continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) return { ok: false, error: `missing value for ${flag}` };
    i++;
    if (flag === "--mode") {
      if (value !== "examples" && value !== "compare") return { ok: false, error: `unknown mode ${value}` };
      mode = value;
    } else if (flag === "--condition") {
      if (!isConditionId(value)) return { ok: false, error: `unknown condition ${value}` };
      if (conditions.includes(value)) return { ok: false, error: `duplicate condition ${value}` };
      conditions.push(value);
    } else {
      return { ok: false, error: `unknown flag ${flag}` };
    }
  }
  if (!mode) return { ok: false, error: "missing --mode" };
  if (mode === "examples" && conditions.length > 0) return { ok: false, error: "--condition applies to compare mode" };
  const selected = mode === "compare" && conditions.length === 0 ? [...CONDITION_IDS] : conditions;
  return { ok: true, args: { mode, conditions: selected, json } };
}

/** Exit codes: 0 collected or skipped, 1 run/export failure, 2 a prerequisite is missing. */
export const EXIT = { ok: 0, failure: 1, blocked: 2 } as const;

async function main(): Promise<number> {
  if (!OPT_IN) {
    process.stdout.write(`${JSON.stringify({ status: "skipped", reason: "opt_in_required" })}\n`);
    return EXIT.ok;
  }
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stdout.write(`${JSON.stringify({ status: "failed", reason: parsed.error })}\n`);
    return EXIT.failure;
  }
  const plans = parsed.args.conditions.map(planCondition);
  const blocked = plans.filter((plan) => plan.requiresArchive);
  if (blocked.length > 0) {
    // The pre-P0 control has to be recovered from history first. Refuse rather than present the
    // cleanup arm under the original label.
    process.stdout.write(`${JSON.stringify({
      status: "blocked",
      reason: "pre_p0_archive_required",
      conditions: blocked.map((plan) => plan.id),
    })}\n`);
    return EXIT.blocked;
  }
  process.stdout.write(`${JSON.stringify({
    status: "collected",
    mode: parsed.args.mode,
    review_status: "unreviewed",
    conditions: plans.map((plan) => ({ id: plan.id, effort: plan.effort, guidance: plan.guidance.mode, examples: plan.examples })),
  })}\n`);
  return EXIT.ok;
}

if (import.meta.main) process.exit(await main());
