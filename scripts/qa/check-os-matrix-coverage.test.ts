import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BASELINE_PATH,
  baselineAtMergeBase,
  checkCoverage,
  checkRepository,
  formatBaseline,
  listedTestPaths,
  normalizeTestPath,
  OS_WORKFLOW,
  parseBaseline,
  runsBaselineSuites,
  UBUNTU_WORKFLOW,
  writeBaseline,
  type CoverageInput,
  type GitRunner,
} from "./check-os-matrix-coverage";
import { BASELINE_EXCLUSIONS, planBaselineSuites } from "./baseline-suites";

const LISTED = "packages/backend/tests/listed.test.ts";
const BASELINED = "packages/frontend/tests/baselined.test.ts";
const NEW = "packages/backend/tests/new-suite.test.ts";

const workflow = (lines: readonly string[]): string => [
  "name: OS tests",
  "jobs:",
  "  os-tests:",
  "    runs-on: ${{ matrix.os }}",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "      - name: Platform-sensitive suites",
  "        run: >-",
  "          bun test --timeout 30000",
  ...lines.map((line) => `          ${line}`),
  "      - name: One suite on one line",
  "        run: bun test --timeout 60000 scripts/qa/inline.test.js",
  "",
].join("\n");

function input(overrides: Partial<CoverageInput> = {}): CoverageInput {
  const testFiles = overrides.testFiles ?? [LISTED, BASELINED];
  return { testFiles, osListed: [LISTED], ubuntuListed: [LISTED], baseline: [BASELINED], previousBaseline: null, exists: (repoPath) => testFiles.includes(repoPath), ...overrides };
}

const codes = (problems: ReturnType<typeof checkCoverage>): string[] => problems.map((problem) => `${problem.code} ${problem.path}`);

describe("test path spelling", () => {
  test.each([
    ["packages\\backend\\tests\\listed.test.ts", LISTED],
    ["./packages/backend/tests/listed.test.ts", LISTED],
    [".\\packages\\backend\\tests\\listed.test.ts", LISTED],
    ["\"packages/backend/tests/listed.test.ts\"", LISTED],
    ["  packages//backend/tests/listed.test.ts\r", LISTED],
  ] as const)("Given the spelling %p When normalized Then it names the POSIX repository path", (spelling, expected) => {
    expect(normalizeTestPath(spelling)).toBe(expected);
  });
});

describe("workflow suite lists", () => {
  test("Given a folded list and a one-line step When the workflow is parsed Then every test file is returned in order and other arguments are left out", () => {
    const yaml = workflow(["packages/backend/tests/listed.test.ts", "packages\\backend\\tests\\windows-spelled.test.ts", "./packages/frontend/tests/dotted.test.tsx"]);

    expect(listedTestPaths(yaml)).toEqual([LISTED, "packages/backend/tests/windows-spelled.test.ts", "packages/frontend/tests/dotted.test.tsx", "scripts/qa/inline.test.js"]);
  });

  test("Given CRLF line endings When the workflow is parsed Then the same files are returned", () => {
    expect(listedTestPaths(workflow([LISTED]).replaceAll("\n", "\r\n"))).toEqual([LISTED, "scripts/qa/inline.test.js"]);
  });

  test("Given a document without jobs When the workflow is parsed Then it is refused instead of read as an empty list", () => {
    expect(() => listedTestPaths("name: nothing\n")).toThrow(TypeError);
  });
});

describe("baseline file", () => {
  test("Given unsorted paths in mixed spellings When the baseline is formatted Then it is sorted, deduplicated and led by the removal-only header", () => {
    const text = formatBaseline(["packages/frontend/tests/b.test.ts", "packages\\backend\\tests\\a.test.ts", "packages/frontend/tests/b.test.ts"]);
    const lines = text.split("\n");

    expect(lines.filter((line) => line.startsWith("#")).length).toBeGreaterThan(0);
    expect(lines[0]?.startsWith("#")).toBe(true);
    expect(parseBaseline(text)).toEqual(["packages/backend/tests/a.test.ts", "packages/frontend/tests/b.test.ts"]);
    expect(parseBaseline(text.replaceAll("\n", "\r\n"))).toEqual(parseBaseline(text));
  });
});

describe("coverage check", () => {
  test("Given a listed file and a baselined file When checked Then there is no problem", () => {
    expect(checkCoverage(input())).toEqual([]);
  });

  test("Given a new test file in neither an OS list nor the baseline When checked Then it is reported", () => {
    expect(codes(checkCoverage(input({ testFiles: [LISTED, BASELINED, NEW] })))).toEqual([`not_in_os_matrix ${NEW}`]);
  });

  test("Given a test file listed only in the Ubuntu workflow When checked Then it is still missing from the OS matrix", () => {
    const testFiles = [LISTED, BASELINED, NEW];

    expect(codes(checkCoverage(input({ testFiles, ubuntuListed: [LISTED, NEW] })))).toEqual([`not_in_os_matrix ${NEW}`]);
  });

  test("Given a baseline entry whose file is gone When checked Then the stale entry is reported", () => {
    expect(codes(checkCoverage(input({ testFiles: [LISTED] })))).toEqual([`baseline_file_missing ${BASELINED}`]);
  });

  test("Given a baseline entry that an OS list now runs When checked Then the stale entry is reported", () => {
    expect(codes(checkCoverage(input({ osListed: [LISTED, BASELINED] })))).toEqual([`baseline_entry_covered ${BASELINED}`]);
  });

  test("Given a workflow naming a file that does not exist When checked Then each workflow's entry is reported", () => {
    const problems = checkCoverage(input({ osListed: [LISTED, "packages/backend/tests/gone.test.ts"], ubuntuListed: [LISTED, "packages/backend/tests/renamed.test.ts"] }));

    expect(problems).toEqual([
      { code: "listed_file_missing", path: "packages/backend/tests/gone.test.ts", source: OS_WORKFLOW },
      { code: "listed_file_missing", path: "packages/backend/tests/renamed.test.ts", source: UBUNTU_WORKFLOW },
    ]);
  });

  test("Given Windows-style spellings in the list and the baseline When checked Then they match the POSIX test paths", () => {
    const problems = checkCoverage(input({ osListed: ["packages\\backend\\tests\\listed.test.ts"], ubuntuListed: [".\\packages\\backend\\tests\\listed.test.ts"], baseline: ["packages\\frontend\\tests\\baselined.test.ts"] }));

    expect(problems).toEqual([]);
  });

  test("Given a baseline that gained an entry since the base commit When checked Then the growth is reported, and a removal is not", () => {
    const testFiles = [LISTED, BASELINED, NEW];

    expect(codes(checkCoverage(input({ testFiles, baseline: [BASELINED, NEW].sort(), previousBaseline: [BASELINED] })))).toEqual([`baseline_grew ${NEW}`]);
    expect(checkCoverage(input({ previousBaseline: [BASELINED, "packages/backend/tests/moved-into-the-matrix.test.ts"] }))).toEqual([]);
  });

  test("Given a baseline out of order or with a duplicate When checked Then it is reported", () => {
    const other = "packages/backend/tests/another.test.ts";
    const testFiles = [LISTED, BASELINED, other];

    expect(codes(checkCoverage(input({ testFiles, baseline: [BASELINED, other] })))).toEqual([`baseline_not_sorted ${BASELINE_PATH}`]);
    expect(codes(checkCoverage(input({ baseline: [BASELINED, BASELINED] })))).toEqual([`baseline_not_sorted ${BASELINE_PATH}`]);
  });
});

describe("baseline suites on Ubuntu", () => {
  const CHROMIUM_ONLY = "packages/backend/tests/chromium-only.test.ts";
  const withBaseline = (overrides: Partial<CoverageInput> = {}): CoverageInput => input({
    testFiles: [LISTED, BASELINED, CHROMIUM_ONLY], baseline: [CHROMIUM_ONLY, BASELINED].sort(), exclusions: { [CHROMIUM_ONLY]: "needs Chromium" }, ubuntuRunsBaseline: true, ...overrides,
  });

  test("Given a runner step and an excluded suite with a reason When checked Then there is no problem", () => {
    expect(checkCoverage(withBaseline())).toEqual([]);
  });

  test("Given a workflow without the runner step When checked Then every baseline suite that is not excluded or listed is reported", () => {
    expect(codes(checkCoverage(withBaseline({ ubuntuRunsBaseline: false })))).toEqual([`baseline_not_run ${BASELINED}`]);
    expect(checkCoverage(withBaseline({ ubuntuRunsBaseline: false, ubuntuListed: [LISTED, BASELINED] }))).toEqual([]);
  });

  test("Given an exclusion that is not in the baseline or has no reason When checked Then each is reported", () => {
    const stale = "packages/backend/tests/stale.test.ts";

    expect(codes(checkCoverage(withBaseline({ exclusions: { [CHROMIUM_ONLY]: " ", [stale]: "needs Chromium" } }))).sort()).toEqual([`exclusion_not_in_baseline ${stale}`, `exclusion_without_reason ${CHROMIUM_ONLY}`]);
  });

  test("Given a baseline, a listed suite and an exclusion When planned Then each suite lands in exactly one bucket", () => {
    const plan = planBaselineSuites([BASELINED, CHROMIUM_ONLY, LISTED], [LISTED], { [CHROMIUM_ONLY]: "needs Chromium" });

    expect(plan).toEqual({ run: [BASELINED], listed: [LISTED], excluded: [CHROMIUM_ONLY] });
  });

  test("Given the shipped baseline exclusions When read Then no suite is excluded", () => {
    expect(BASELINE_EXCLUSIONS).toEqual({});
  });

  test("Given workflows When scanned Then only a step that runs the runner script counts", () => {
    const withRunner = workflow([LISTED]).replace("scripts/qa/inline.test.js", "scripts/qa/inline.test.js\n      - run: bun scripts/qa/run-baseline-suites.ts");

    expect(runsBaselineSuites(withRunner)).toBe(true);
    expect(runsBaselineSuites(workflow([LISTED]))).toBe(false);
  });
});

describe("baseline at the merge base", () => {
  const FORK_POINT = "1111111111111111111111111111111111111111";
  function fakeGit(baselineAtForkPoint: string | null, asked: string[] = []): GitRunner {
    return (args) => {
      asked.push(args.join(" "));
      if (args[0] === "merge-base") return args[2] === "origin/main" ? { exitCode: 0, stdout: `${FORK_POINT}\n` } : { exitCode: 1, stdout: "" };
      if (baselineAtForkPoint === null) return { exitCode: 128, stdout: "" };
      return { exitCode: 0, stdout: args[0] === "show" ? baselineAtForkPoint : "" };
    };
  }

  test("Given a branch behind a main that already removed an entry When the previous baseline is read Then it is the fork point's, so the branch has not grown it", () => {
    const asked: string[] = [];

    const previous = baselineAtMergeBase("origin/main", fakeGit(formatBaseline([BASELINED]).replaceAll("\n", "\r\n"), asked));

    expect(previous).toEqual([BASELINED]);
    expect(asked).toEqual(["merge-base HEAD origin/main", `cat-file -e ${FORK_POINT}:${BASELINE_PATH}`, `show ${FORK_POINT}:${BASELINE_PATH}`]);
    expect(checkCoverage(input({ previousBaseline: previous }))).toEqual([]);
  });

  test("Given a fork point from before the baseline existed When the previous baseline is read Then there is nothing to compare with", () => {
    expect(baselineAtMergeBase("origin/main", fakeGit(null))).toBeNull();
  });

  test("Given a ref that shares no history with HEAD When the previous baseline is read Then the check is refused instead of passing unchecked", () => {
    expect(() => baselineAtMergeBase("origin/unknown", fakeGit(null))).toThrow(TypeError);
  });
});

describe("repository check on disk", () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

  async function repository(files: readonly string[], osLines: readonly string[]): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "bg-os-matrix-"));
    roots.push(root);
    const write = async (repoPath: string, contents: string): Promise<void> => {
      const target = path.join(root, ...repoPath.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, contents);
    };
    await write(OS_WORKFLOW, workflow(osLines));
    await write(UBUNTU_WORKFLOW, workflow(osLines));
    await write("scripts/qa/inline.test.js", "");
    await write("packages/backend/node_modules/dependency/ignored.test.ts", "");
    await write("packages/frontend/dist/ignored.test.js", "");
    await write("packages/backend/tests/helper-cases.ts", "");
    for (const file of files) await write(file, "");
    return root;
  }

  test("Given a repository with one uncovered suite When the baseline is written Then it holds exactly that suite and the check passes", async () => {
    const root = await repository([LISTED, BASELINED], [LISTED]);

    const before = await checkRepository(root, null, null);
    const written = await writeBaseline(root);
    const after = await checkRepository(root, null, null);

    expect(before.problems.map((problem) => `${problem.code} ${problem.path}`)).toEqual([`not_in_os_matrix ${BASELINED}`]);
    expect(written).toBe(1);
    expect(parseBaseline(await readFile(path.join(root, ...BASELINE_PATH.split("/")), "utf8"))).toEqual([BASELINED]);
    expect(after).toEqual({ problems: [], testFiles: 3, inOsMatrix: 2, baselined: 1 });
  });

  test("Given a written baseline When a new suite appears and a listed file is deleted Then both are reported", async () => {
    const root = await repository([LISTED, BASELINED], [LISTED]);
    await writeBaseline(root);
    await writeFile(path.join(root, ...NEW.split("/")), "");
    await rm(path.join(root, ...LISTED.split("/")));

    const report = await checkRepository(root, null, null);

    expect(report.problems.map((problem) => `${problem.code} ${problem.path} ${problem.source}`).sort()).toEqual([
      `listed_file_missing ${LISTED} ${OS_WORKFLOW}`,
      `listed_file_missing ${LISTED} ${UBUNTU_WORKFLOW}`,
      `not_in_os_matrix ${NEW} ${OS_WORKFLOW}`,
    ]);
  });
});
