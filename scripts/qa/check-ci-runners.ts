#!/usr/bin/env bun
/** Check the pinned browser/runner contract before installing dependencies or running tests. */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const RUNNER = "ubuntu-24.04";
const PLAYWRIGHT = "1.59.1";
const COMMAND = "bun scripts/qa/check-ci-runners.ts";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function runnerLabels(job: Record<string, unknown>): readonly string[] | null {
  const runner = job["runs-on"];
  if (Array.isArray(runner)) return runner.every(label => typeof label === "string") ? runner : null;
  if (typeof runner !== "string") return null;
  if (!runner.includes("${{")) return [runner];
  const key = /^\$\{\{\s*matrix\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}$/.exec(runner)?.[1];
  const matrix = isRecord(job.strategy) ? job.strategy.matrix : undefined;
  if (key === undefined || !isRecord(matrix)) return null;
  const axis = matrix[key];
  const labels: string[] = [];
  if (axis !== undefined) {
    if (!Array.isArray(axis) || !axis.every(label => typeof label === "string")) return null;
    labels.push(...axis);
  }
  if (matrix.include !== undefined) {
    if (!Array.isArray(matrix.include)) return null;
    for (const entry of matrix.include) {
      if (!isRecord(entry)) return null;
      const label = entry[key];
      if (typeof label === "string") labels.push(label);
      else if (label !== undefined) return null;
    }
  }
  return labels.length === 0 ? null : labels;
}

/** Inspect every job, including conditional jobs and every statically declared matrix runner. */
export function checkWorkflowRunners(source: string): readonly string[] {
  const workflow: unknown = Bun.YAML.parse(source);
  if (!isRecord(workflow) || !isRecord(workflow.jobs) || Object.keys(workflow.jobs).length === 0) return ["missing_jobs"];
  const problems: string[] = [];
  for (const [name, value] of Object.entries(workflow.jobs)) {
    if (!isRecord(value)) { problems.push(`${name}: invalid_job`); continue; }
    const labels = runnerLabels(value);
    if (labels === null) problems.push(`${name}: unresolved_runner`);
    else for (const label of labels) {
      const native = /^(macos|windows)-(latest|[0-9]+)(?:-large|-xlarge)?$/.exec(label);
      const nativeSupported = native !== null && (native[2] === "latest" ||
        Number(native[2]) >= (native[1] === "macos" ? 14 : 2019));
      if (label !== RUNNER && !nativeSupported) {
        problems.push(`${name}: unsupported_runner (${label}); Linux jobs must use ${RUNNER}`);
      }
    }
    const steps: readonly unknown[] = Array.isArray(value.steps) ? value.steps : [];
    const [checkout, setupBun, firstCommand] = steps;
    if (!isRecord(checkout) || typeof checkout.uses !== "string" || !checkout.uses.startsWith("actions/checkout@") ||
      !isRecord(setupBun) || typeof setupBun.uses !== "string" || !setupBun.uses.startsWith("oven-sh/setup-bun@") ||
      !isRecord(firstCommand) || typeof firstCommand.run !== "string" || firstCommand.run.trim() !== COMMAND ||
      firstCommand.if !== undefined ||
      firstCommand["continue-on-error"] !== undefined && firstCommand["continue-on-error"] !== false ||
      value["continue-on-error"] !== undefined && value["continue-on-error"] !== false) {
      problems.push(`${name}: missing_early_guard; checkout and Bun setup must be followed immediately by ${COMMAND} without conditions or ignored errors`);
    }
  }
  return problems;
}

export function checkRunnerHost(platform: string, arch: string, osRelease: string): readonly string[] {
  if (!["linux", "darwin", "win32"].includes(platform) || !["x64", "arm64"].includes(arch)) {
    return ["unsupported_host; CI requires Linux, macOS or Windows on x64/arm64"];
  }
  if (platform !== "linux") return [];
  const value = (key: string) => new RegExp(`^${key}="?([a-z0-9._-]{1,32})"?$`, "m")
    .exec(osRelease.replaceAll("\r", ""))?.[1] ?? "unknown";
  const id = value("ID"), version = value("VERSION_ID");
  return id === "ubuntu" && version === "24.04" ? []
    : [`unsupported_linux_host (${id} ${version}); Playwright ${PLAYWRIGHT} CI requires Ubuntu 24.04. Pin the job to ${RUNNER}; do not override Playwright's host detection.`];
}

export function checkPlaywrightPin(manifest: unknown): readonly string[] {
  return isRecord(manifest) && isRecord(manifest.dependencies) && manifest.dependencies["playwright-core"] === PLAYWRIGHT
    ? [] : [`unreviewed_playwright_pin; update the runner compatibility contract when changing Playwright ${PLAYWRIGHT}`];
}

export async function checkRepositoryRunners(root: string): Promise<readonly string[]> {
  const directory = path.join(root, ".github", "workflows");
  const names = (await readdir(directory)).filter(name => /\.ya?ml$/.test(name)).sort();
  if (names.length === 0) return ["missing_workflows"];
  const problems: string[] = [];
  for (const name of names) {
    for (const problem of checkWorkflowRunners(await readFile(path.join(directory, name), "utf8"))) {
      problems.push(`${name}: ${problem}`);
    }
  }
  problems.push(...checkPlaywrightPin(JSON.parse(await readFile(path.join(root, "packages/backend/package.json"), "utf8"))));
  return problems;
}

if (import.meta.main) {
  try {
    const problems = [
      ...checkRunnerHost(process.platform, process.arch, process.platform === "linux" ? await readFile("/etc/os-release", "utf8") : ""),
      ...await checkRepositoryRunners(path.resolve(import.meta.dir, "../..")),
    ];
    for (const problem of problems) console.error(`CI runner compatibility: ${problem}`);
    if (problems.length === 0) console.log("CI runner compatibility: supported host, pinned Linux jobs, and early guards verified");
    process.exitCode = problems.length === 0 ? 0 : 1;
  } catch {
    console.error("CI runner compatibility: metadata_unreadable; check workflow YAML, backend package metadata, and host OS metadata");
    process.exitCode = 1;
  }
}
