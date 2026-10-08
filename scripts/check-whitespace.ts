#!/usr/bin/env bun
/**
 * Whitespace gate behind `bun run check:whitespace` (and its `lint` alias).
 * Runs `git diff --check` over every commit the branch adds to origin/main, so it can fail on a clean CI checkout
 * where the working tree equals the index; then rejects CRLF in tracked `.sh`/`.command` files.
 * Range: merge-base(origin/main, HEAD)..HEAD; without origin/main (local run, shallow release checkout) it uses
 * HEAD~1..HEAD, or the empty tree for a root commit, then also checks uncommitted changes against HEAD.
 */
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

function git(...args: string[]): { code: number; out: string } {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() };
}

function baseRevision(): string {
  const mergeBase = git("merge-base", "origin/main", "HEAD");
  if (mergeBase.code === 0 && mergeBase.out.trim()) return mergeBase.out.trim();
  const parent = git("rev-parse", "--verify", "--quiet", "HEAD~1");
  if (parent.code === 0) return parent.out.trim();
  return git("hash-object", "-t", "tree", "/dev/null").out.trim();
}

let failed = false;
const checks: string[][] = [
  ["diff", "--check", `${baseRevision()}..HEAD`],
  ["diff", "--check", "HEAD"],
];
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
