#!/usr/bin/env bun
/**
 * Runs every suite of scripts/qa/os-matrix-baseline.txt on this host (the Ubuntu Security job), except the ones
 * named in BASELINE_EXCLUSIONS (baseline-suites.ts) and the ones an explicit security.yml step already runs.
 *
 * One `bun test` process per file: in a shared process the suites leak module mocks and global state into each
 * other (a 30-file batch failed 29 cases that pass file by file), and a failing file is named directly.
 *
 *   bun scripts/qa/run-baseline-suites.ts [--list]   --list prints the plan without running anything
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BASELINE_PATH, listedTestPaths, parseBaseline, UBUNTU_WORKFLOW } from "./check-os-matrix-coverage";
import { BASELINE_EXCLUSIONS, planBaselineSuites } from "./baseline-suites";

/** A hung suite fails after this long instead of holding the job until its timeout-minutes. The slowest suite takes about 30 s. */
const FILE_TIMEOUT_MS = 5 * 60 * 1000;

const root = path.resolve(import.meta.dir, "..", "..");
const baseline = parseBaseline(await readFile(path.join(root, BASELINE_PATH), "utf8"));
const ubuntuListed = listedTestPaths(await readFile(path.join(root, UBUNTU_WORKFLOW), "utf8"));
const plan = planBaselineSuites(baseline, ubuntuListed);

console.log(`baseline suites: ${plan.run.length} to run, ${plan.listed.length} run by explicit security.yml steps, ${plan.excluded.length} excluded`);
for (const file of plan.excluded) console.log(`excluded ${file}: ${BASELINE_EXCLUSIONS[file]}`);
if (process.argv.includes("--list")) {
  for (const file of plan.run) console.log(file);
  process.exit(0);
}

const failed: string[] = [];
for (const file of plan.run) {
  const started = performance.now();
  const child = Bun.spawn({ cmd: [process.execPath, "test", "--timeout", "30000", file], cwd: root, stdout: "inherit", stderr: "inherit", timeout: FILE_TIMEOUT_MS, killSignal: "SIGKILL" });
  const code = await child.exited;
  if (child.signalCode === "SIGKILL") console.error(`baseline suite ${file} exceeded ${FILE_TIMEOUT_MS / 1000} s and was killed`);
  console.log(`baseline suite ${code === 0 ? "ok" : "FAILED"} ${file} (${Math.round(performance.now() - started)} ms)`);
  if (code !== 0) failed.push(file);
}
if (failed.length > 0) {
  console.error(`${failed.length} baseline suite(s) failed:\n${failed.join("\n")}`);
  process.exit(1);
}
console.log(`baseline suites: all ${plan.run.length} passed`);
