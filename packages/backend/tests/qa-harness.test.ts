import { describe, expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { EXPECTED_BRANCH, EXPECTED_ORIGIN } from "../../../scripts/qa/repository";
import {
  parseUlwStatus,
  ULW_SESSION_ID,
} from "../../../scripts/qa/ulw-status";
import { browserOpenCommand, openBrowser } from "../src/lib/browser";

const repoRoot = path.resolve(import.meta.dir, "../../..");

async function runScript(
  script: string,
  args: readonly string[],
  environment: Readonly<Record<string, string>> = {},
  root = repoRoot,
  preload?: string,
) {
  const child = Bun.spawn([process.execPath, "run", ...(preload ? ["--preload", preload] : []), script, ...args], {
    cwd: root,
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

async function withQaFixture(action: (fixture: {
  root: string;
  bin: string;
  git: (...args: string[]) => void;
  run: (script: string, environment?: Readonly<Record<string, string>>) => ReturnType<typeof runScript>;
}) => Promise<void>): Promise<void> {
  const gitExecutable = Bun.which("git");
  if (gitExecutable === null) throw new Error("Git is required for the QA repository fixture");
  const directory = await mkdtemp(path.join(await realpath(tmpdir()), "burnguard-qa-fixture-"));
  const root = path.join(directory, "repo");
  const bin = path.join(directory, "bin");
  const home = path.join(directory, "home");
  const git = (...args: string[]) => {
    const result = Bun.spawnSync([gitExecutable, ...args], {
      cwd: directory,
      env: { ...processEnv(), HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
      timeout: 15_000,
    });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  };
  try {
    await mkdir(bin);
    await mkdir(home);
    // Real Git objects retain the historical base; only the owned clone's branch/origin change.
    git("clone", "--shared", "--sparse", "--no-checkout", "--quiet", repoRoot, root);
    git("-C", root, "sparse-checkout", "set", "scripts/qa");
    git("-C", root, "checkout", "--quiet", "-B", EXPECTED_BRANCH, "HEAD");
    git("-C", root, "remote", "set-url", "origin", EXPECTED_ORIGIN);
    await cp(path.join(repoRoot, "scripts/qa"), path.join(root, "scripts/qa"), { recursive: true });
    await mkdir(path.join(root, "packages/backend"), { recursive: true });
    await symlink(path.join(repoRoot, "packages/backend/node_modules"), path.join(root, "packages/backend/node_modules"));
    await symlink(gitExecutable, path.join(bin, "git"));
    const executable = async (name: string, args: readonly string[], output: string) => {
      const file = path.join(bin, name);
      await writeFile(file, `#!${process.execPath}\nif (JSON.stringify(process.argv.slice(2)) !== ${JSON.stringify(JSON.stringify(args))}) process.exit(64);\nprocess.stdout.write(${JSON.stringify(output)});\n`);
      await chmod(file, 0o755);
    };
    await executable("omo-agent-toolkit", ["ulw-loop", "status", "--session-id", ULW_SESSION_ID, "--json"], JSON.stringify({
      ok: true, plan: { goals: [{ id: "G001-fixture", attempt: 1, status: "in_progress" }] },
    }));
    await executable("jq", ["--version"], "jq-1.7\n");
    await executable("codex", ["login", "status"], "");
    await executable("claude", ["auth", "status", "--json"], '{"authenticated":true}\n');
    const preload = path.join(directory, "prerequisites.ts");
    // Only machine prerequisites are substituted. Repository, toolkit protocol,
    // evidence publication/parsing and all authority assertions remain production code.
    await writeFile(preload, `
import { mock } from "bun:test";
import * as fs from "node:fs/promises";
import * as runtime from ${JSON.stringify(path.join(root, "scripts/qa/runtime.ts"))};
const access = fs.access;
mock.module("node:fs/promises", () => ({ ...fs, access: (file, ...args) =>
  access(file === "/usr/bin/qlmanage" ? ${JSON.stringify(path.join(bin, "quicklook"))} : file, ...args) }));
mock.module(${JSON.stringify(path.join(root, "scripts/qa/chromium.ts"))}, () => ({
  findChromiumExecutable: async () => { await access(${JSON.stringify(path.join(bin, "chromium"))}); return ${JSON.stringify(path.join(bin, "chromium"))}; }
}));
mock.module(${JSON.stringify(path.join(root, "scripts/qa/runtime.ts"))}, () => ({ ...runtime, isPortFree: async () => true }));
`);
    await writeFile(path.join(bin, "quicklook"), "fixture");
    await writeFile(path.join(bin, "chromium"), "fixture");
    const environment = {
      PATH: bin, HOME: home, CODEX_HOME: path.join(home, ".codex"),
      CLAUDE_CONFIG_DIR: path.join(home, ".claude"), BG_APP_ROOT: path.join(home, ".burnguard"),
      BG_PORT: "14079", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    };
    await action({ root, bin, git: (...args) => git("-C", root, ...args),
      run: (script, overrides = {}) => runScript(`scripts/qa/${script}.ts`, ["--json"], { ...environment, ...overrides }, root, preload),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
    await withQaFixture(async ({ root, run }) => {
      const result = await run("preflight");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      const manifest = JSON.parse(result.stdout);
      expect(manifest.ok).toBe(true);
      expect(Object.values(manifest.checks)).not.toContain(false);
      expect(manifest.repository.branch).toBe(EXPECTED_BRANCH);
      expect(manifest.repository.origin).toBe(EXPECTED_ORIGIN);
      expect(manifest.attemptId).toBe(`.omo/evidence/ulw/${ULW_SESSION_ID}/G001-fixture/a1`);
      expect(JSON.stringify(manifest)).not.toContain("binary_path");
      expect(JSON.stringify(manifest)).not.toContain(root);
    });
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
    await withQaFixture(async ({ root, run }) => {
      const result = await run("manifest-smoke");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(Object.values(JSON.parse(result.stdout))).not.toContain(false);
      expect(await readdir(path.join(root, `.omo/evidence/ulw/${ULW_SESSION_ID}/G001-fixture/a1`))).toEqual([]);
    });
  }, 20_000);

  test.skipIf(process.platform === "win32")("Given an unavailable toolkit When either CLI runs Then the prerequisite failure is typed", async () => {
    await withQaFixture(async ({ bin, run }) => {
      await rm(path.join(bin, "omo-agent-toolkit"));
      const results = await Promise.all([run("preflight"), run("manifest-smoke")]);
      expect(results.map((result) => ({ exitCode: result.exitCode, stdout: result.stdout, error: JSON.parse(result.stderr) }))).toEqual(
        ["preflight", "manifest-smoke"].map(() => ({ exitCode: 1, stdout: "", error: { ok: false, code: "ulw_toolkit_missing" } })),
      );
    });
  });

  test.skipIf(process.platform === "win32")("Given an absent provider CLI When another is authenticated Then preflight still succeeds", async () => {
    await withQaFixture(async ({ bin, run }) => {
      await rm(path.join(bin, "codex"));
      const result = await run("preflight");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).checks.authenticatedBackend).toBe(true);
      await rm(path.join(bin, "claude"));
      const unavailable = await run("preflight");
      expect(unavailable.exitCode).toBe(1);
      expect(JSON.parse(unavailable.stderr)).toEqual({ ok: false, code: "preflight_authenticatedBackend" });
    });
  });

  test.skipIf(process.platform === "win32")("Given a missing required tool When preflight runs Then it identifies the prerequisite", async () => {
    await withQaFixture(async ({ bin, run }) => {
      await rm(path.join(bin, "jq"));
      const result = await run("preflight");
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr)).toEqual({ ok: false, code: "preflight_jq" });
    });
  });

  test.skipIf(process.platform === "win32")("Given missing Quick Look When preflight runs Then it identifies the prerequisite", async () => {
    await withQaFixture(async ({ bin, run }) => {
      await rm(path.join(bin, "quicklook"));
      const result = await run("preflight");
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr)).toEqual({ ok: false, code: "preflight_quickLook" });
    });
  });

  test.skipIf(process.platform === "win32")("Given missing repository authority When manifest smoke runs Then no temporary evidence remains", async () => {
    await withQaFixture(async ({ root, git, run }) => {
      git("remote", "remove", "origin");
      const result = await run("manifest-smoke");
      expect(result.exitCode).toBe(1);
      expect({ error: JSON.parse(result.stderr), entries: await readdir(path.join(root, `.omo/evidence/ulw/${ULW_SESSION_ID}/G001-fixture/a1`)) }).toEqual({
        error: { ok: false, code: "git_failed" }, entries: [],
      });
    });
  });

  test.skipIf(process.platform === "win32")("Given a failed manifest smoke assertion When the CLI exits Then temporary evidence is removed", async () => {
    await withQaFixture(async ({ root, run }) => {
      // A redaction sentinel as HOME deliberately makes the serialized privacy check fail.
      const result = await run("manifest-smoke", { HOME: "<repo>" });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).serializedEvidenceSanitized).toBe(false);
      expect(await readdir(path.join(root, `.omo/evidence/ulw/${ULW_SESSION_ID}/G001-fixture/a1`))).toEqual([]);
    });
  });

  test.skipIf(process.platform === "win32")("Given a different branch or origin When preflight runs Then repository authority stays pinned", async () => {
    await withQaFixture(async ({ git, run }) => {
      git("branch", "-m", "not-main");
      const wrongBranch = await run("preflight");
      expect(wrongBranch.exitCode).toBe(1);
      expect(JSON.parse(wrongBranch.stderr)).toEqual({ ok: false, code: "wrong_branch" });
      git("branch", "-m", EXPECTED_BRANCH);
      git("remote", "set-url", "origin", "https://invalid.example/repo.git");
      const wrongOrigin = await run("preflight");
      expect(wrongOrigin.exitCode).toBe(1);
      expect(JSON.parse(wrongOrigin.stderr)).toEqual({ ok: false, code: "wrong_origin" });
    });
  });

  test.skipIf(process.platform === "win32")("Given stale and malformed state When adversarial probes run Then typed rejection has no residue", async () => {
    await withQaFixture(async ({ run }) => {
      // Product mutations and control-plane sentinels belong only to the clone.
      const result = await run("adversarial-smoke");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(Object.values(JSON.parse(result.stdout))).not.toContain(false);
    });
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
