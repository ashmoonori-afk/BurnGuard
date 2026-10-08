#!/usr/bin/env bun
/**
 * Whitespace gate behind `bun run check:whitespace` (and its `lint` alias).
 * Runs `git diff --check` over every commit the branch adds to origin/main, so it can fail on a clean CI checkout
 * where the working tree equals the index; then rejects CRLF in tracked `.sh`/`.command` files.
 * Range: merge-base(origin/main, HEAD)..HEAD; without origin/main it uses HEAD~1..HEAD, or the empty tree for a real
 * (non-shallow) root commit. A shallow clone with neither prints a notice and skips the range check, because the empty
 * tree would scan every tracked file. Uncommitted changes (`diff --check HEAD`) and the CRLF check always run.
 */
import { resolve } from "node:path";
import { selectBase } from "./whitespace-base";

const root = resolve(import.meta.dir, "..");

function git(...args: string[]): { code: number; out: string } {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() };
}

function optional(...args: string[]): string | null {
  const result = git(...args);
  return result.code === 0 && result.out.trim() ? result.out.trim() : null;
}

const head = optional("rev-parse", "HEAD") ?? "";
const base = selectBase({
  mergeBase: optional("merge-base", "origin/main", "HEAD"),
  parent: optional("rev-parse", "--verify", "--quiet", "HEAD~1"),
  head,
  rootCommits: (optional("rev-list", "--max-parents=0", "HEAD") ?? "").split("\n").filter(Boolean),
  shallow: optional("rev-parse", "--is-shallow-repository") === "true",
});

let failed = false;
const checks: string[][] = [["diff", "--check", "HEAD"]];
if (base.kind === "range") checks.unshift(["diff", "--check", `${base.base}..HEAD`]);
else process.stdout.write(`${base.notice}\n`);
for (const args of checks) {
  const result = git(...args);
  if (result.code !== 0) {
    failed = true;
    process.stderr.write(`git ${args.join(" ")}\n${result.out}`);
  }
}

const eol = git("ls-files", "--eol", "--", "*.sh", "*.command");
const crlf = eol.out.split("\n").filter((line) => /^i\/(crlf|mixed)\b/.test(line));
if (crlf.length > 0) {
  failed = true;
  process.stderr.write(`CRLF in shell scripts (must be LF):\n${crlf.join("\n")}\n`);
}

process.exit(failed ? 1 : 0);
