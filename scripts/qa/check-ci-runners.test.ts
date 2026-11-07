import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkPlaywrightPin, checkRepositoryRunners, checkRunnerHost, checkWorkflowRunners } from "./check-ci-runners";

const guard = "bun scripts/qa/check-ci-runners.ts";
const manifest = { dependencies: { "playwright-core": "1.59.1" } };
const bootstrap = [{ uses: "actions/checkout@v4" }, { uses: "oven-sh/setup-bun@v2" }] as const;
const workflow = (runner: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({
  jobs: { browser: { "runs-on": runner, steps: [...bootstrap, { run: guard }, { uses: "actions/setup-node@v4" }, { run: "node playwright install chromium" }], ...extra } },
});

test("Given supported explicit runners When inspected Then browser jobs retain the early guard", () => {
  for (const runner of ["ubuntu-24.04", "macos-15", "windows-latest"]) {
    expect(checkWorkflowRunners(workflow(runner))).toEqual([]);
  }
});

test.each([
  { runner: "ubuntu-latest", count: 1 }, { runner: "ubuntu-26.04", count: 1 },
  { runner: ["self-hosted", "linux"], count: 2 }, { runner: "${{ inputs.runner }}", count: 1 },
  { runner: "macos-13", count: 1 }, { runner: "macos-14", count: 1 }, { runner: "windows-2016", count: 1 },
])(
  "Given an unreviewed runner %# When inspected Then the workflow cannot pass",
  ({ runner, count }) => {
    expect(checkWorkflowRunners(workflow(runner))).toHaveLength(count);
  },
);

test("Given a mixed runner matrix When an include adds Ubuntu 26 Then the unsupported job is detected", () => {
  const matrix = { os: ["macos-15", "ubuntu-24.04"], include: [{ os: "ubuntu-26.04" }] };
  expect(checkWorkflowRunners(workflow("${{ matrix.os }}", { strategy: { matrix } })))
    .toEqual([expect.stringMatching(/^browser: unsupported_runner \(ubuntu-26\.04\);/)]);
});

test("Given the native include-only matrix When inspected Then every supported runner is resolved", () => {
  expect(checkWorkflowRunners(workflow("${{ matrix.os }}", {
    strategy: { matrix: { include: [{ os: "macos-15" }, { os: "windows-latest" }] } },
  }))).toEqual([]);
});

test.each([
  { steps: [...bootstrap, { run: "bun test" }] },
  { steps: [...bootstrap, { run: "bun install" }, { run: guard }] },
  { steps: [...bootstrap, { run: guard, if: "false" }] },
  { steps: [...bootstrap, { run: guard, "continue-on-error": true }] },
  { "continue-on-error": true },
  { steps: [{ uses: "actions/setup-node@v4" }, ...bootstrap, { run: guard }] },
  { steps: [bootstrap[0], { uses: "actions/setup-node@v4" }, bootstrap[1], { run: guard }] },
  { steps: [...bootstrap, { uses: "./.github/actions/install-browser" }, { run: guard }] },
])("Given a missing late or suppressible guard %# When inspected Then CI rejects the bypass", extra => {
  const problems = checkWorkflowRunners(workflow("ubuntu-24.04", extra));
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("missing_early_guard");
});

test("Given explicitly fatal guard settings When inspected Then safe defaults remain accepted", () => {
  expect(checkWorkflowRunners(workflow("ubuntu-24.04", {
    "continue-on-error": false, steps: [...bootstrap, { run: guard, "continue-on-error": false }],
  }))).toEqual([]);
});

test("Given a conditional evidence job on floating Ubuntu When inspected Then its condition does not exempt it", () => {
  expect(checkWorkflowRunners(workflow("ubuntu-latest", { if: "vars.OPT_IN != ''" })))
    .toEqual([expect.stringMatching(/^browser: unsupported_runner \(ubuntu-latest\);/)]);
});

test.each(["x64", "arm64"])("Given Ubuntu 24.04 %s When host metadata is checked Then the pinned Linux contract passes", arch => {
  expect(checkRunnerHost("linux", arch, 'ID=ubuntu\nVERSION_ID="24.04"\n')).toEqual([]);
});

test.each([
  'ID=ubuntu\nVERSION_ID="26.04"\n',
  'ID=debian\nVERSION_ID="13"\n',
  "ID_LIKE=ubuntu\n",
])("Given unsupported or incomplete Linux metadata %# When checked Then the diagnostic names the supported OS", release => {
  const problems = checkRunnerHost("linux", "x64", release);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("unsupported_linux_host");
  expect(problems[0]).toContain("ubuntu-24.04");
});

test("Given native Windows and macOS When checked Then Linux metadata is not required", () => {
  expect(checkRunnerHost("win32", "x64", "")).toEqual([]);
  expect(checkRunnerHost("darwin", "arm64", "")).toEqual([]);
  expect(checkRunnerHost("linux", "ia32", "")).toEqual([expect.stringMatching(/^unsupported_host;/)]);
});

test("Given a changed browser dependency When checked Then its support policy must be reviewed", () => {
  expect(checkPlaywrightPin(manifest)).toEqual([]);
  expect(checkPlaywrightPin({ dependencies: { "playwright-core": "^1.59.1" } })).toHaveLength(1);
  expect(checkPlaywrightPin({ dependencies: { "playwright-core": "1.60.0" } })).toHaveLength(1);
});

const owned: string[] = [];
afterEach(async () => {
  for (const root of owned.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ci runner guard "));
  owned.push(root);
  await mkdir(path.join(root, ".github/workflows"), { recursive: true });
  await mkdir(path.join(root, "packages/backend"), { recursive: true });
  await writeFile(path.join(root, "packages/backend/package.json"), JSON.stringify(manifest));
  await writeFile(path.join(root, ".github/workflows/browser.yml"), workflow("ubuntu-24.04"));
  return root;
}

test("Given an additional workflow When the repository is checked Then it cannot hide outside a copied workflow list", async () => {
  const root = await fixture();
  await writeFile(path.join(root, ".github/workflows/new-browser.yaml"), workflow("ubuntu-latest"));
  expect(await checkRepositoryRunners(root))
    .toEqual([expect.stringMatching(/^new-browser\.yaml: browser: unsupported_runner \(ubuntu-latest\);/)]);
});

test("Given unsupported workflow metadata When the shipped CLI runs Then it exits nonzero with a specific runner diagnostic", async () => {
  const root = await fixture();
  await writeFile(path.join(root, ".github/workflows/browser.yml"), workflow("ubuntu-26.04"));
  await mkdir(path.join(root, "scripts/qa"), { recursive: true });
  const script = path.join(root, "scripts/qa/check-ci-runners.ts");
  await writeFile(script, await readFile(path.join(import.meta.dir, "check-ci-runners.ts")));
  const child = Bun.spawn([process.execPath, script], {
    cwd: root, env: process.env, stdout: "pipe", stderr: "pipe", timeout: 10_000, killSignal: "SIGKILL",
  });
  const [exit, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  expect(exit).toBe(1);
  expect(stdout).toBe("");
  expect(stderr).toContain("unsupported_runner (ubuntu-26.04)");
});

test("Given the actual checked-in workflows When inspected Then every job has the supported runner contract", async () => {
  expect(await checkRepositoryRunners(path.resolve(import.meta.dir, "../.."))).toEqual([]);
});
