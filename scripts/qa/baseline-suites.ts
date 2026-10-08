/**
 * Which suites of scripts/qa/os-matrix-baseline.txt the Ubuntu Security job runs, and which it leaves out on purpose.
 * Side-effect free so the coverage guard can import it; the runner is run-baseline-suites.ts.
 */

/**
 * Baseline suites the plain-Ubuntu step does NOT run, each with the reason. Add an entry only for a missing tool or
 * a real failure; a slow suite is not a reason. Every entry must also be in the baseline (the guard rejects stale
 * ones), so the gap stays visible and shrinks together with the baseline.
 */
const NEEDS_CHROMIUM = "needs a real Chromium, which the Ubuntu step does not install";
const NEEDS_CHROMIUM_AUDIT = "runs a real design audit, which needs a real Chromium that the Ubuntu step does not install";

const REAL_FAILURE = "real failure, see PR body";

export const BASELINE_EXCLUSIONS: Readonly<Record<string, string>> = {
  "packages/backend/tests/canonical-preview-render.test.ts": NEEDS_CHROMIUM,
  "packages/backend/tests/cancelled-audit-process.test.ts": NEEDS_CHROMIUM_AUDIT,
  "packages/backend/tests/design-audit-artboards.test.ts": NEEDS_CHROMIUM,
  "packages/backend/tests/design-audit-measurement.test.ts": NEEDS_CHROMIUM,
  "packages/backend/tests/design-audit-render.test.ts": NEEDS_CHROMIUM,
  "packages/backend/tests/design-audit-routes.test.ts": NEEDS_CHROMIUM_AUDIT,
  "packages/backend/tests/export-pdf-artboard.test.ts": NEEDS_CHROMIUM,
  "packages/backend/tests/export-pdf-inline-pages.test.ts": NEEDS_CHROMIUM,
  "packages/backend/tests/graphic-export.test.ts": NEEDS_CHROMIUM,
  "packages/backend/tests/png-zip-chromium.test.ts": NEEDS_CHROMIUM,
  "packages/backend/tests/three-scene.test.ts": REAL_FAILURE,
  "packages/frontend/tests/canvas-css-imports.browser.test.ts": NEEDS_CHROMIUM,
  "packages/frontend/tests/deck-fit.browser.test.ts": NEEDS_CHROMIUM,
  "packages/frontend/tests/graphic-project-creation.test.ts": NEEDS_CHROMIUM,
  "packages/frontend/tests/user-message-revert.browser.test.ts": NEEDS_CHROMIUM,
};

export type BaselinePlan = {
  /** Run by the baseline step, one `bun test` process per file. */
  readonly run: readonly string[];
  /** Already named by an explicit step of security.yml, so the baseline step skips them. */
  readonly listed: readonly string[];
  /** Left out on purpose; see BASELINE_EXCLUSIONS. */
  readonly excluded: readonly string[];
};

export function planBaselineSuites(baseline: readonly string[], ubuntuListed: readonly string[], exclusions: Readonly<Record<string, string>> = BASELINE_EXCLUSIONS): BaselinePlan {
  const listed = new Set(ubuntuListed);
  const run: string[] = [];
  const alreadyListed: string[] = [];
  const excluded: string[] = [];
  for (const file of baseline) {
    if (Object.hasOwn(exclusions, file)) excluded.push(file);
    else if (listed.has(file)) alreadyListed.push(file);
    else run.push(file);
  }
  return { run, listed: alreadyListed, excluded };
}
