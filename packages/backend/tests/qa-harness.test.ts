import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { browserOpenCommand, openBrowser } from "../src/lib/browser";
import {
  parseUlwStatus,
  ULW_SESSION_ID,
} from "../../../scripts/qa/ulw-status";

const repoRoot = path.resolve(import.meta.dir, "../../..");

async function runScript(
  script: string,
  args: readonly string[],
  environment: Readonly<Record<string, string>> = {},
) {
  const child = Bun.spawn([process.execPath, "run", script, ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...processEnv(), ...environment },
  });
  const deadline = setTimeout(() => child.kill(), 55_000);
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]).finally(() => clearTimeout(deadline));
  return { exitCode, stdout, stderr };
}

function processEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

// scripts/qa/*.ts assume macOS-only tooling (e.g. `open`, `jq`, Quick Look,
// chrome-headless-shell paths) that isn't available on Windows CI/dev boxes,
// so the CLI-driving cases below are skipped there; the pure-logic cases
// stay platform-independent and keep running everywhere.
describe("QA harness CLI", () => {
  test("Given the current nested toolkit status When parsed Then the attempt directory is derived", () => {
    const status = parseUlwStatus(JSON.stringify({
      ok: true,
      plan: {
        goals: [{
          id: "G001-current",
          attempt: 2,
          status: "complete",
        }],
      },
    }));

    expect(status.currentAttemptDir).toBe(
      `.omo/evidence/ulw/${ULW_SESSION_ID}/G001-current/a2`,
    );
  });

  test("Given legacy or malformed toolkit status When parsed Then each boundary is explicit", () => {
    expect(parseUlwStatus('{"currentAttemptDir":".omo/evidence/legacy"}')).toEqual({
      currentAttemptDir: ".omo/evidence/legacy",
    });
    expect(() => parseUlwStatus("{")).toThrow(SyntaxError);
    expect(() => parseUlwStatus("{}")).toThrow(TypeError);
    expect(() => parseUlwStatus('{"plan":{"goals":[]}}')).toThrow(TypeError);
  });

  test.skipIf(process.platform === "win32")("Given repository state When preflight emits JSON Then it returns a sanitized manifest", async () => {
    // Given: this worktree and its locally ignored evidence directory.
    // When: preflight runs through its public CLI.
    const result = await runScript("scripts/qa/preflight.ts", ["--json"]);

    // Then: the command succeeds and exposes booleans rather than provider details.
    expect(result.exitCode).toBe(0);
    const manifest = JSON.parse(result.stdout);
    expect(manifest.ok).toBe(true);
    expect(manifest.checks.authenticatedBackend).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain("binary_path");
    expect(JSON.stringify(manifest)).not.toContain(repoRoot);
  }, 60_000);

  test("Given malformed port When preflight parses it Then it fails with a typed result", async () => {
    // Given: a port outside the accepted boundary.
    // When: preflight parses its environment.
    const result = await runScript("scripts/qa/preflight.ts", ["--json"], {
      BG_PORT: "credential-looking-but-invalid",
    });

    // Then: no environment value is reflected in the machine error.
    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stderr)).toEqual({ ok: false, code: "invalid_port" });
    expect(result.stderr).not.toContain("credential-looking");
  }, 20_000);

  test.skipIf(process.platform === "win32")("Given owned runtime resources When readiness and cleanup run Then exact proofs pass", async () => {
    // Given / When: the runtime smoke drives only worker-owned processes and ports.
    const result = await runScript("scripts/qa/runtime-smoke.ts", ["--json"]);

    // Then: readiness, adversarial rejection, and repeated cleanup are all machine true.
    expect(result.exitCode).toBe(0);
    const receipt = JSON.parse(result.stdout);
    expect(receipt.ok).toBe(true);
    expect(receipt.misleadingSuccessRejected).toBe(true);
    expect(receipt.timeoutRejected).toBe(true);
    expect(receipt.cleanup.repeatedCleanupSafe).toBe(true);
  }, 20_000);

  test.skipIf(process.platform === "win32")("Given transient cleanup failures When cleanup repeats Then failure history remains latched", async () => {
    // Given / When: injected owned-resource failures are retried through the real aggregate.
    const result = await runScript("scripts/qa/cleanup-smoke.ts", ["--json"]);

    // Then: every failure remains false and the hung child is bounded and signalled.
    expect(result.exitCode).toBe(0);
    expect(Object.values(JSON.parse(result.stdout))).not.toContain(false);
  });

  test.skipIf(process.platform === "win32")("Given stale or incomplete evidence When manifest verification runs Then every case is rejected", async () => {
    // Given / When: serialized evidence is mutated across every authoritative field.
    const result = await runScript("scripts/qa/manifest-smoke.ts", ["--json"]);

    // Then: no stale, truncated, incomplete, or false-success manifest validates.
    expect(result.exitCode).toBe(0);
    expect(Object.values(JSON.parse(result.stdout))).not.toContain(false);
  }, 20_000);

  test.skipIf(process.platform === "win32")("Given stale and malformed state When adversarial probes run Then typed rejection has no residue", async () => {
    // Given / When: worker-owned sentinels and malformed machine inputs are exercised.
    const result = await runScript("scripts/qa/adversarial-smoke.ts", ["--json"]);

    // Then: every probe rejects and the script removes only its own sentinel.
    expect(result.exitCode).toBe(0);
    expect(Object.values(JSON.parse(result.stdout))).not.toContain(false);
  }, 60_000);

  test.skipIf(process.platform === "win32")("Given malformed scenario When runner parses it Then it fails without evidence", async () => {
    // Given: an invalid scenario and a fresh output path.
    const evidence = await mkdtemp(path.join(tmpdir(), "burnguard-qa-red-"));
    await rm(evidence, { recursive: true, force: true });

    // When: the runner parses its arguments.
    const result = await runScript("scripts/qa/burnguard-upgrade-e2e.ts", [
      "--scenario",
      "task-x",
      "--evidence-dir",
      evidence,
    ]);

    // Then: it rejects the boundary input before creating output.
    expect(result.exitCode).not.toBe(0);
    expect(await Bun.file(evidence).exists()).toBe(false);
  });
});

describe("browser auto-open characterization", () => {
  test("Given each supported platform When command is selected Then the native opener is exact", () => {
    // Given: one URL shared across platform variants.
    const url = "http://127.0.0.1:14079";

    // When / Then: each platform selects only its native command.
    expect(browserOpenCommand("win32", url)).toEqual(["cmd", "/c", "start", "", url]);
    expect(browserOpenCommand("darwin", url)).toEqual(["open", url]);
    expect(browserOpenCommand("linux", url)).toEqual(["xdg-open", url]);
  });

  test("Given BG_NO_OPEN When openBrowser is called Then no platform opener starts", () => {
    // Given: an injected launcher that can never open a real browser.
    const previousNoOpen = process.env.BG_NO_OPEN;
    process.env.BG_NO_OPEN = "1";
    let launches = 0;

    // When: production auto-open is invoked.
    openBrowser("http://127.0.0.1:14079", () => { launches += 1; });

    // Then: launch remains untouched.
    expect(launches).toBe(0);
    if (previousNoOpen === undefined) delete process.env.BG_NO_OPEN;
    else process.env.BG_NO_OPEN = previousNoOpen;
  });

  test("Given desktop mode When openBrowser is called Then no external browser starts", () => {
    const previousDesktop = process.env.BG_DESKTOP;
    const previousNoOpen = process.env.BG_NO_OPEN;
    process.env.BG_DESKTOP = "1";
    delete process.env.BG_NO_OPEN;
    let launches = 0;
    try {
      openBrowser("http://127.0.0.1:14079", () => { launches += 1; });
      expect(launches).toBe(0);
    } finally {
      if (previousDesktop === undefined) delete process.env.BG_DESKTOP;
      else process.env.BG_DESKTOP = previousDesktop;
      if (previousNoOpen === undefined) delete process.env.BG_NO_OPEN;
      else process.env.BG_NO_OPEN = previousNoOpen;
    }
  });

  test("Given auto-open enabled When openBrowser is called Then the native opener is launched", () => {
    // Given: auto-open enabled and an injected launcher.
    const previousNoOpen = process.env.BG_NO_OPEN;
    delete process.env.BG_NO_OPEN;
    let command: readonly string[] = [];

    // When: production auto-open is invoked.
    openBrowser("http://127.0.0.1:14079", (selected) => { command = selected; });

    // Then: one exact native command is selected without opening a real browser.
    expect(command).toEqual(browserOpenCommand(process.platform, "http://127.0.0.1:14079"));
    if (previousNoOpen === undefined) delete process.env.BG_NO_OPEN;
    else process.env.BG_NO_OPEN = previousNoOpen;
  });
});
