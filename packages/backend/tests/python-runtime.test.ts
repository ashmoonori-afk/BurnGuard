import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { managedPythonExecutable, pythonVenvDir } from "../src/services/python-runtime";
import { PYPDF_REQUIRED_VERSION } from "../src/services/pypdf-version";

const services = path.resolve(import.meta.dir, "../src/services");

test("Given each supported host When locating the managed interpreter Then its venv layout is platform-specific", () => {
  expect(managedPythonExecutable("darwin")).toBe(path.join(pythonVenvDir, "bin", "python3"));
  expect(managedPythonExecutable("linux")).toBe(path.join(pythonVenvDir, "bin", "python3"));
  expect(managedPythonExecutable("win32")).toBe(path.join(pythonVenvDir, "Scripts", "python.exe"));
});

type Mode = "success" | "venv_failure" | "pip_failure" | "venv_partial";
type Command = { args: string[]; managed: boolean };

/** Runs health, install and (after success) extraction plus a reinstall in a worker whose PATH holds only the fixture python3. */
async function installInFixture(root: string, mode: Mode, seed: (venv: string, fixture: string) => Promise<void> = async () => undefined) {
  const bin = path.join(root, "bin");
  const appRoot = path.join(root, "app root");
  const venv = path.join(appRoot, "runtime/python");
  const log = path.join(root, "commands.jsonl");
  await mkdir(bin);
  const executable = path.join(bin, "python3");
  const fixture = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const venv = ${JSON.stringify(venv)};
const managed = process.argv[1] === path.join(venv, "bin/python3");
const mode = ${JSON.stringify(mode)};
const marker = ${JSON.stringify(path.join(root, "installed"))};
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, managed }) + "\\n");
if (args[0] === "--version") { console.log("Python 3.14.4"); }
else if (args[0] === "-c") {
  if (!managed || !fs.existsSync(marker)) process.exit(1);
  console.log(${JSON.stringify(PYPDF_REQUIRED_VERSION)});
} else if (args[0] === "-m" && args[1] === "venv") {
  if (mode === "venv_failure") { console.error("fixture_venv_failed"); process.exit(7); }
  const directory = args[args.length - 1];
  if (args.includes("--clear")) fs.rmSync(directory, { recursive: true, force: true });
  const target = path.join(directory, "bin", "python3");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(process.argv[1], target);
  fs.chmodSync(target, 0o700);
  if (mode === "venv_partial") { console.error("fixture_venv_partial"); process.exit(7); }
} else if (args[0] === "-m" && args[1] === "pip") {
  if (!managed || args.includes("--user")) { console.error("externally-managed-environment"); process.exit(9); }
  if (fs.existsSync(path.join(venv, "no-pip"))) { console.error("No module named pip"); process.exit(1); }
  if (args[2] === "--version") { console.log("pip 25.1"); process.exit(0); }
  if (mode === "pip_failure") { console.error("fixture_pip_failed"); process.exit(8); }
  fs.writeFileSync(marker, "installed");
} else {
  if (!managed || !fs.existsSync(marker)) process.exit(10);
  fs.writeFileSync(args[args.indexOf("--output") + 1], JSON.stringify({ managed, source: args[args.indexOf("--input") + 1] }));
}
`;
  await writeFile(executable, fixture);
  await chmod(executable, 0o700);
  await seed(venv, fixture);
  const worker = path.join(root, "verify.ts");
  await writeFile(worker, `
import { checkPythonRuntime, startPypdfInstall, getPypdfInstallStatus, getCachedPythonHealth } from ${JSON.stringify(path.join(services, "python-health.ts"))};
import { runPythonUploadExtractor } from ${JSON.stringify(path.join(services, "design-system-extract.ts"))};
const before = await checkPythonRuntime();
const install = startPypdfInstall();
if (!install.started) throw new Error(install.reason);
const duplicate = startPypdfInstall();
await install.completion;
const first = getPypdfInstallStatus();
const after = getCachedPythonHealth();
if (first.state === "success") {
  await runPythonUploadExtractor({ sourcePath: ${JSON.stringify(path.join(root, "한국어 sample.pdf"))}, manifestPath: ${JSON.stringify(path.join(root, "manifest.json"))} });
  const reinstall = startPypdfInstall();
  if (!reinstall.started) throw new Error(reinstall.reason);
  await reinstall.completion;
}
console.log(JSON.stringify({ before, duplicate, first, after, final: getPypdfInstallStatus() }));
`);
  const child = Bun.spawn([process.execPath, worker], {
    env: { ...process.env, HOME: root, USERPROFILE: root, BG_APP_ROOT: appRoot, PATH: bin, CODEX_HOME: path.join(root, "codex"), CLAUDE_CONFIG_DIR: path.join(root, "claude") },
    stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 10000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
  const commands = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line) as Command);
  return { result: JSON.parse(stdout), commands, appRoot, venv };
}

// These fixtures are POSIX executable scripts, not Windows .exe interpreters.
for (const mode of ["success", "venv_failure", "pip_failure"] as const) {
  test.skipIf(process.platform === "win32")(`Given an externally managed Python (${mode}) When installing uploads support Then only the owned environment is used and completion is observed`, async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "bg python 한글 ")));
    try {
      const { result, commands, appRoot } = await installInFixture(root, mode);
      expect(result.before.python.executable).toEqual(["python3"]);
      expect(result.before.pypdf.found).toBe(false);
      expect(result.duplicate).toEqual({ started: false, reason: "install_in_progress" });
      expect(commands.filter(command => command.args[1] === "venv")).toHaveLength(1);
      const pip = commands.filter(command => command.args[1] === "pip" && command.args[2] === "install");
      expect(commands.filter(command => command.args[1] === "pip").every(command => command.managed && !command.args.includes("--user"))).toBe(true);
      if (mode === "success") {
        expect(pip).toHaveLength(2);
        expect(result.first).toMatchObject({ state: "success", exit_code: 0, error: null });
        expect(result.final.state).toBe("success");
        expect(result.after.python.executable).toEqual([path.join(appRoot, "runtime/python/bin/python3")]);
        expect(result.after.pypdf).toMatchObject({ found: true, supported: true, version: PYPDF_REQUIRED_VERSION });
        expect(JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"))).toEqual({ managed: true, source: path.join(root, "한국어 sample.pdf") });
      } else {
        expect(pip).toHaveLength(mode === "venv_failure" ? 0 : 1);
        expect(result.first).toMatchObject({ state: "error", exit_code: mode === "venv_failure" ? 7 : 8 });
        expect(result.first.tail).toContain(mode === "venv_failure" ? "fixture_venv_failed" : "fixture_pip_failed");
        expect(result.after.pypdf.found).toBe(false);
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 15000);
}

const brokenEnvironments: ReadonlyArray<readonly [string, (venv: string, fixture: string, root: string) => Promise<void>]> = [
  // A Homebrew or distro upgrade removed the base interpreter the venv links to.
  ["whose interpreter is a dangling symlink", async (venv, _fixture, root) => { await mkdir(path.join(venv, "bin"), { recursive: true }); await symlink(path.join(root, "removed-python", "bin", "python3"), path.join(venv, "bin", "python3")); }],
  // The Windows venv redirector prints "No Python at ..." and exits 103 once its base Python is uninstalled.
  ["whose interpreter exits 103", async (venv) => { await mkdir(path.join(venv, "bin"), { recursive: true }); await writeFile(path.join(venv, "bin", "python3"), `#!${process.execPath}\nprocess.exit(103);\n`); await chmod(path.join(venv, "bin", "python3"), 0o700); }],
  // Debian without python3-venv leaves a venv whose ensurepip never ran.
  ["that has no pip", async (venv, fixture) => { await mkdir(path.join(venv, "bin"), { recursive: true }); await writeFile(path.join(venv, "bin", "python3"), fixture); await chmod(path.join(venv, "bin", "python3"), 0o700); await writeFile(path.join(venv, "no-pip"), ""); }],
];

for (const [label, seed] of brokenEnvironments) {
  test.skipIf(process.platform === "win32")(`Given a managed venv ${label} When uploads support is installed Then the environment is rebuilt with --clear from PATH python3 and health becomes supported`, async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "bg python repair ")));
    try {
      const { result, commands, venv } = await installInFixture(root, "success", (target, fixture) => seed(target, fixture, root));
      expect(result.before.python.executable).toEqual(["python3"]);
      expect(result.before.pypdf.found).toBe(false);
      expect(commands.filter(command => command.args[1] === "venv")).toEqual([{ args: ["-m", "venv", "--clear", venv], managed: false }]);
      expect(result.first).toMatchObject({ state: "success", exit_code: 0, error: null });
      expect(result.after.python.executable).toEqual([path.join(venv, "bin/python3")]);
      expect(result.after.pypdf).toMatchObject({ found: true, supported: true, version: PYPDF_REQUIRED_VERSION });
      expect(result.final.state).toBe("success");
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 15000);
}

test.skipIf(process.platform === "win32")("Given venv creation fails after writing bin/python3 When install completes Then the half-created environment is removed", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "bg python partial ")));
  try {
    const { result, venv } = await installInFixture(root, "venv_partial");
    expect(result.first).toMatchObject({ state: "error", exit_code: 7 });
    expect(result.first.tail).toContain("fixture_venv_partial");
    expect(existsSync(venv)).toBe(false);
    expect(result.after.python.executable).toEqual(["python3"]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 15000);
