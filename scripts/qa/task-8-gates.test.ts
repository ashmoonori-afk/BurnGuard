import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const script = path.join(import.meta.dir, "task-8-gates.sh");
const bash = Bun.which("bash");
if (bash === null) throw new Error("task-8 fixtures require Bash on PATH");
const roots: string[] = [];

function shellPath(value: string): string {
  return process.platform === "win32" ? value.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_match, drive: string) => `/${drive.toLowerCase()}`) : value;
}

async function fixture(): Promise<{ readonly root: string; readonly env: Record<string, string> }> {
  const root = await mkdtemp(path.join(tmpdir(), "bg-task8-gates-"));
  roots.push(root);
  const bin = path.join(root, "bin");
  const log = path.join(root, "commands.log");
  await mkdir(bin);
  const commands = {
    bash: `#!/bin/bash\nprintf 'bash\\t%s\\n' "$*" >> "$TASK8_TEST_LOG"\nexec /bin/bash "$@"\n`,
    bun: `#!/bin/bash\nprintf 'bun\\t%s\\t%s\\t%s\\n' "$PWD" "$(umask)" "$*" >> "$TASK8_TEST_LOG"\n`,
    git: `#!/bin/bash\nprintf 'git\\t%s\\t%s\\n' "$PWD" "$*" >> "$TASK8_TEST_LOG"\n`,
    rg: "#!/bin/bash\nexit 1\n",
    wc: "#!/bin/bash\nprintf '0 placeholder\\n'\n",
  } as const;
  for (const [name, contents] of Object.entries(commands)) {
    const command = path.join(bin, name);
    await writeFile(command, contents);
    await chmod(command, 0o755);
  }
  const bashEnv = path.join(root, "bash-env.sh");
  const jq = Bun.which("jq");
  if (jq === null) throw new Error("task-8 fixtures require jq on PATH");
  await writeFile(bashEnv, `export PATH='${shellPath(bin)}':'${shellPath(path.dirname(jq))}':/opt/homebrew/bin:/usr/bin:/bin\n`);
  return {
    root,
    env: {
      ...process.env,
      BASH_ENV: shellPath(bashEnv),
      REPO_ROOT: shellPath(root),
      TASK8_TEST_LOG: shellPath(log),
    },
  };
}

function run(command: string[], cwd: string, env: Record<string, string>) {
  return Bun.spawnSync({ cmd: command, cwd, env, stdout: "pipe", stderr: "pipe" });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("task-8 gate entrypoint", () => {
  test("Given direct invocation When the script runs Then it executes all gates in owned ignored evidence", async () => {
    const setup = await fixture();

    const result = run([bash, shellPath(script)], setup.root, setup.env);

    expect(result.exitCode).toBe(0);
    const output = new TextDecoder().decode(result.stdout);
    const evidence = /^TASK8_EVIDENCE=(.+)$/m.exec(output)?.[1];
    expect(evidence).toBeDefined();
    if (evidence === undefined) throw new TypeError("missing task8 evidence path");
    expect(path.posix.dirname(evidence)).toBe(`${shellPath(setup.root)}/.omo/evidence`);
    const nativeEvidence = path.join(setup.root, ".omo/evidence", path.posix.basename(evidence));
    for (const gate of ["exact-seven", "chromium", "affected", "typecheck", "build", "full-suite", "diff-check", "static-audit", "loc-audit"] as const) {
      expect(JSON.parse(await readFile(path.join(nativeEvidence, "gates", `${gate}.exit.json`), "utf8"))).toMatchObject({ name: gate, exit: 0, authoritative: true });
    }
    const bunRuns = (await readFile(path.join(setup.root, "commands.log"), "utf8")).split("\n").filter((line) => line.startsWith("bun\t"));
    expect(bunRuns).toHaveLength(setup.env.OS === "Windows_NT" ? 7 : 6);
    const testRuns = bunRuns.filter((line) => line.includes("\ttest "));
    expect(testRuns).toHaveLength(4);
    expect(testRuns.every((line) => line.includes(`\t${shellPath(setup.root)}\t0022\t`))).toBe(true);
    const shellRuns = (await readFile(path.join(setup.root, "commands.log"), "utf8")).split("\n").filter((line) => line.startsWith("bash\t"));
    expect(shellRuns).toHaveLength(9);
    expect(shellRuns.every((line) => line.startsWith("bash\t-c "))).toBe(true);
  });

  test("Given a caller-owned evidence directory When sourced Then the function remains explicitly callable", async () => {
    const setup = await fixture();
    const evidence = path.join(setup.root, "caller-evidence");
    await mkdir(evidence);
    const env = { ...setup.env, E: shellPath(evidence), TASK8_GATE_SCRIPT: shellPath(script) };

    const result = run([bash, "-c", 'set -e; umask 077; source "$TASK8_GATE_SCRIPT"; test ! -e "$E/gates"; run_task8_gates'], setup.root, env);

    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(result.stderr)).toBe("");
    expect(JSON.parse(await readFile(path.join(evidence, "gates", "full-suite.exit.json"), "utf8"))).toMatchObject({ name: "full-suite", exit: 0, authoritative: true });
    const bunRuns = (await readFile(path.join(setup.root, "commands.log"), "utf8")).split("\n").filter((line) => line.startsWith("bun\t"));
    const testRuns = bunRuns.filter((line) => line.includes("\ttest "));
    expect(testRuns).toHaveLength(4);
    expect(testRuns.every((line) => line.includes(`\t${shellPath(setup.root)}\t0022\t`))).toBe(true);
    const shellRuns = (await readFile(path.join(setup.root, "commands.log"), "utf8")).split("\n").filter((line) => line.startsWith("bash\t"));
    expect(shellRuns).toHaveLength(9);
    expect(shellRuns.every((line) => line.startsWith("bash\t-c "))).toBe(true);
  });

  test.each([
    { host: "a non-Windows host", os: undefined, builds: ["run build:frontend"] },
    { host: "a Windows host", os: "Windows_NT", builds: ["run build:frontend", "run build:backend"] },
  ] as const)("Given $host When the build gate runs Then it builds only what that host can build", async ({ os, builds }) => {
    // Given
    const setup = await fixture();
    const env = Object.fromEntries(Object.entries(setup.env).filter(([key]) => key !== "OS"));

    // When
    const result = run([bash, shellPath(script)], setup.root, os === undefined ? env : { ...env, OS: os });

    // Then
    expect(result.exitCode).toBe(0);
    const bunArgs = (await readFile(path.join(setup.root, "commands.log"), "utf8")).split("\n").filter((line) => line.startsWith("bun\t")).map((line) => line.split("\t")[3]);
    expect(bunArgs.filter((args) => args?.startsWith("run build"))).toEqual([...builds]);
  });
});
