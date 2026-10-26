#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { closeOwnedProcess, settleOwnedProcess, spawnOwnedProcess } from "../../../packages/backend/src/adapters/owned-process";
import { captureOutput, sealEvidence } from "../frontend-failure-evidence";

const kind = process.env.BG_COMPARE_KIND;
const before = process.env.BG_COMPARE_BEFORE;
const after = process.env.BG_COMPARE_AFTER;
const destination = process.env.BG_COMPARE_OUTPUT;
const recipient = process.env.BG_FRONTEND_EVIDENCE_PUBLIC_KEY;
if (Bun.version !== "1.3.14" || !before || !after || !destination || !recipient
  || ![before, after, destination].every(value => path.isAbsolute(value))
  || (kind !== "logo" && kind !== "escape" && kind !== "probe")) {
  throw new Error("native_comparison_configuration_invalid");
}
sealEvidence("", recipient);
await mkdir(destination, { recursive: true, mode: 0o700 });
const file = kind === "logo"
  ? "packages/backend/tests/logo-completion-gate.test.ts"
  : "packages/frontend/tests/deck-sandbox.browser.test.ts";
const pattern = kind === "logo"
  ? "history-appended|candidate-mutated"
  : "presentation fullscreen fallback preserves authored input";
const command = kind === "probe"
  ? [process.execPath, "-e", "console.log('capture_stdout');console.error('capture_stderr');process.exit(7)"]
  : [process.execPath, "test", file, "--test-name-pattern", pattern, "--timeout", "30000"];
const expected = kind === "logo" ? 2 : 1;
const environment: NodeJS.ProcessEnv = { CI: "1", TZ: "Asia/Seoul", NO_COLOR: "1", FORCE_COLOR: "0", BG_BROWSER_SMOKE: "1" };
for (const key of ["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "LOCALAPPDATA", "APPDATA", "COMSPEC", "PATHEXT", "PROGRAMFILES", "PROGRAMFILES(X86)"]) {
  if (process.env[key] !== undefined) environment[key] = process.env[key];
}
const sources = [];
for (const [phase, cwd] of [["before", before], ["after", after]] as const) {
  const revision = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd, stdout: "pipe", stderr: "pipe" });
  const [sha, errors, exit] = await Promise.all([new Response(revision.stdout).text(), new Response(revision.stderr).text(), revision.exited]);
  if (exit !== 0 || errors.trim()) throw new Error("native_comparison_revision_failed");
  sources.push({
    phase, cwd, sha: sha.trim(),
    lock_sha256: createHash("sha256").update(await readFile(path.join(cwd, "bun.lock"))).digest("hex"),
  });
}
const rounds = kind === "probe" ? 1 : 10;
let unsuccessful = false;
for (let iteration = 1; iteration <= rounds; iteration++) {
  // Alternate first position so startup/cache order is not always assigned to one source.
  for (const source of iteration % 2 === 1 ? sources : [...sources].reverse()) {
    const owned = spawnOwnedProcess({ cmd: command, cwd: source.cwd, env: environment, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const deadline = new AbortController();
    let forcedClose: Promise<void> | undefined;
    const timer = setTimeout(() => {
      deadline.abort();
      forcedClose = closeOwnedProcess(owned, { timeoutMs: 3000 });
      void forcedClose.catch(() => undefined);
    }, 90_000);
    const started = performance.now();
    try {
      const [stdout, stderr, exit] = await Promise.all([
        captureOutput(owned.proc.stdout, deadline.signal),
        captureOutput(owned.proc.stderr, deadline.signal),
        owned.proc.exited,
      ]);
      const text = `${stdout.text}\n${stderr.text}`;
      const count = (status: string) => Number(new RegExp(`^\\s*(\\d+) ${status}\\s*$`, "m").exec(text)?.[1] ?? 0);
      const passed = count("pass"), failed = count("fail"), skipped = count("skip");
      const complete = stdout.complete && stderr.complete && !stdout.truncated && !stderr.truncated && !deadline.signal.aborted;
      const valid = kind === "probe"
        ? exit === 7 && stdout.text.includes("capture_stdout") && stderr.text.includes("capture_stderr") && complete
        : exit === 0 && passed === expected && failed === 0 && skipped === 0 && complete;
      const summary = {
        event: "native_comparison_attempt", kind, phase: source.phase, iteration,
        sha: source.sha, platform: process.platform, bun: Bun.version,
        exit, passed, failed, skipped, complete, valid, elapsed_ms: Math.round(performance.now() - started),
      };
      await writeFile(path.join(destination, `${kind}-${source.phase}-${iteration}.encrypted.json`),
        sealEvidence(JSON.stringify({ summary, source, command, stdout, stderr }), recipient),
        { mode: 0o600, flag: "wx" });
      unsuccessful ||= !valid;
      console.log(JSON.stringify(summary));
    } finally {
      clearTimeout(timer);
      await (forcedClose ?? closeOwnedProcess(owned, { timeoutMs: 3000 }));
      await settleOwnedProcess(owned, await owned.proc.exited);
    }
    if (createHash("sha256").update(await readFile(path.join(source.cwd, "bun.lock"))).digest("hex") !== source.lock_sha256) {
      throw new Error("native_comparison_lock_changed");
    }
  }
}
console.log(JSON.stringify({ event: "native_comparison_finished", kind, rounds_per_source: rounds, unsuccessful }));
process.exitCode = unsuccessful ? 1 : 0;
