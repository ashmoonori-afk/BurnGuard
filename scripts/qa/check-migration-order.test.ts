import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  baseMigrations,
  checkMigrationOrder,
  checkRepository,
  MIGRATIONS_DIR,
  migrationNameOf,
  normalizeMigrationPath,
  parseMigrationName,
  type GitRunner,
  type MigrationFile,
  type MigrationOrderInput,
  type MigrationOrderProblem,
} from "./check-migration-order";

const migration = (name: string, content = "-- migration\n"): MigrationFile => ({ path: `${MIGRATIONS_DIR}/${name}`, name, content });

function input(overrides: Partial<MigrationOrderInput> = {}): MigrationOrderInput {
  const base = overrides.base ?? [migration("0001_initial.sql"), migration("0021_visual_alternatives.sql")];
  return { head: [...base], base, ...overrides };
}

const codes = (problems: readonly MigrationOrderProblem[]): string[] => problems.map((problem) => `${problem.code} ${migrationNameOf(problem.path)}`).sort();

describe("migration file names", () => {
  test.each([
    ["0021_visual_alternatives.sql", 21],
    ["0001_initial.sql", 1],
    ["0100_add_pins.sql", 100],
  ] as const)("Given %s When parsed Then the numeric prefix is read", (name, expected) => {
    expect(parseMigrationName(name)?.number).toBe(expected);
  });

  test.each([
    ["22_short.sql"],
    ["00221_long.sql"],
    ["0021.sql"],
    ["0021-no-underscore.sql"],
    ["visual_alternatives.sql"],
    ["0021_visual_alternatives.txt"],
  ] as const)("Given the malformed name %s When parsed Then it is refused", (name) => {
    expect(parseMigrationName(name)).toBeNull();
  });

  test.each([
    ["packages\\backend\\src\\db\\migrations\\0021_visual_alternatives.sql", "packages/backend/src/db/migrations/0021_visual_alternatives.sql"],
    ["./packages/backend/src/db/migrations/0021_visual_alternatives.sql", "packages/backend/src/db/migrations/0021_visual_alternatives.sql"],
    ["\"packages/backend/src/db/migrations//0021_visual_alternatives.sql\"", "packages/backend/src/db/migrations/0021_visual_alternatives.sql"],
  ] as const)("Given the spelling %p When normalized Then it names the POSIX repository path", (spelling, expected) => {
    expect(normalizeMigrationPath(spelling)).toBe(expected);
  });
});

describe("migration order", () => {
  test("Given one new migration above the highest base number When checked Then there is no problem", () => {
    expect(checkMigrationOrder(input({ head: [migration("0001_initial.sql"), migration("0021_visual_alternatives.sql"), migration("0022_export_shares.sql")] }))).toEqual([]);
  });

  test("Given several new migrations in increasing order When checked Then there is no problem", () => {
    expect(checkMigrationOrder(input({ head: [migration("0001_initial.sql"), migration("0021_visual_alternatives.sql"), migration("0022_a.sql"), migration("0023_b.sql"), migration("0024_c.sql")] }))).toEqual([]);
  });

  test("Given no new migration When checked Then there is no problem", () => {
    expect(checkMigrationOrder(input())).toEqual([]);
  });

  test("Given a new migration that fills an earlier gap When checked Then it is rejected", () => {
    expect(codes(checkMigrationOrder(input({ head: [migration("0001_initial.sql"), migration("0019_fill_gap.sql"), migration("0021_visual_alternatives.sql")] })))).toEqual(["new_not_after_base 0019_fill_gap.sql"]);
  });

  test("Given a new migration reusing the highest base number with a lexically later name When checked Then it is rejected", () => {
    expect(codes(checkMigrationOrder(input({ head: [migration("0001_initial.sql"), migration("0021_visual_alternatives.sql"), migration("0021_zzz_reuse.sql")] })))).toEqual(["duplicate_number 0021_visual_alternatives.sql", "duplicate_number 0021_zzz_reuse.sql", "new_not_after_base 0021_zzz_reuse.sql"]);
  });

  test("Given a base with no migrations When checked Then any new migration is accepted", () => {
    expect(checkMigrationOrder(input({ head: [migration("0001_initial.sql")], base: [] }))).toEqual([]);
  });

  test("Given no base inventory When checked Then the order check is skipped", () => {
    expect(checkMigrationOrder(input({ head: [migration("0001_initial.sql")], base: null }))).toEqual([]);
  });

  test("Given malformed names When checked Then each is reported", () => {
    expect(codes(checkMigrationOrder(input({ head: [migration("0001_initial.sql"), migration("0021_visual_alternatives.sql"), migration("22_short.sql"), migration("0021.sql")], base: null })))).toEqual(["malformed_name 0021.sql", "malformed_name 22_short.sql"]);
  });

  test("Given two new migrations sharing a number When checked Then both are reported", () => {
    expect(codes(checkMigrationOrder(input({ head: [migration("0001_initial.sql"), migration("0021_visual_alternatives.sql"), migration("0022_a.sql"), migration("0022_b.sql")] })))).toEqual(["duplicate_number 0022_a.sql", "duplicate_number 0022_b.sql"]);
  });

  test("Given a base migration that no longer exists When checked Then the deletion is reported", () => {
    expect(codes(checkMigrationOrder(input({ head: [migration("0001_initial.sql")] })))).toEqual(["existing_deleted 0021_visual_alternatives.sql"]);
  });

  test("Given a base migration whose contents changed When checked Then the rewrite is reported", () => {
    expect(codes(checkMigrationOrder(input({ head: [migration("0001_initial.sql"), migration("0021_visual_alternatives.sql", "-- changed\n")] })))).toEqual(["existing_rewritten 0021_visual_alternatives.sql"]);
  });

  test("Given a base entry spelled with Windows separators When checked Then it names the same migration as the POSIX head", () => {
    const windowsBase: MigrationFile = { path: "packages\\backend\\src\\db\\migrations\\0021_visual_alternatives.sql", name: "0021_visual_alternatives.sql", content: "-- migration\n" };

    expect(checkMigrationOrder({ head: [migration("0001_initial.sql"), migration("0021_visual_alternatives.sql")], base: [windowsBase, migration("0001_initial.sql")] })).toEqual([]);
  });
});

describe("base migrations from git", () => {
  const FORK_POINT = "1111111111111111111111111111111111111111";
  const HELLO = "packages/backend/src/db/migrations/0021_visual_alternatives.sql";
  const HELLO_BLOB = "-- migration\n";

  function fakeGit(listing: string, asked: string[] = []): GitRunner {
    return (args) => {
      asked.push(args.join(" "));
      if (args[0] === "merge-base") return args[2] === "origin/main" ? { exitCode: 0, stdout: `${FORK_POINT}\n` } : { exitCode: 1, stdout: "" };
      if (args[0] === "ls-tree") return { exitCode: 0, stdout: listing };
      if (args[0] === "cat-file") return { exitCode: 0, stdout: args[2]?.includes("0021_visual_alternatives.sql") ? HELLO_BLOB : "-- other\n" };
      return { exitCode: 0, stdout: "" };
    };
  }

  test("Given a merge base When read Then the migrations are the fork point's, normalized from the listed spelling", async () => {
    const asked: string[] = [];

    const base = await baseMigrations("origin/main", fakeGit("packages\\backend\\src\\db\\migrations\\0001_initial.sql\npackages/backend/src/db/migrations/0021_visual_alternatives.sql\n", asked));

    expect(base.map((file) => `${file.path} ${file.content.trim()}`)).toEqual([
      `${MIGRATIONS_DIR}/0001_initial.sql -- other`,
      `${MIGRATIONS_DIR}/0021_visual_alternatives.sql -- migration`,
    ]);
    expect(asked).toEqual(["merge-base HEAD origin/main", `ls-tree -r --name-only ${FORK_POINT} -- ${MIGRATIONS_DIR}`, `cat-file blob ${FORK_POINT}:packages/backend/src/db/migrations/0001_initial.sql`, `cat-file blob ${FORK_POINT}:${HELLO}`]);
  });

  test("Given a base commit with no migrations directory When read Then the inventory is empty, not a failure", async () => {
    expect(await baseMigrations("origin/main", fakeGit(""))).toEqual([]);
  });

  test("Given a ref that shares no history with HEAD When read Then the check is refused instead of passing unchecked", async () => {
    await expect(baseMigrations("origin/unknown", fakeGit(""))).rejects.toThrow(TypeError);
  });
});

describe("repository check against a real git repository", () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

  function run(repo: string, ...args: readonly string[]): string {
    const result = Bun.spawnSync({ cmd: ["git", "-C", repo, ...args], stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`);
    return new TextDecoder().decode(result.stdout);
  }

  async function writeMigration(repo: string, name: string, content = "-- migration\n"): Promise<void> {
    const dir = path.join(repo, ...MIGRATIONS_DIR.split("/"));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), content);
  }

  function commit(repo: string, message: string): void {
    run(repo, "add", "-A");
    run(repo, "-c", "user.email=qa@example.test", "-c", "user.name=qa", "commit", "-q", "-m", message);
  }

  async function repository(): Promise<string> {
    const repo = await mkdtemp(path.join(tmpdir(), "bg-migration-order-"));
    roots.push(repo);
    run(repo, "init", "-q", "--initial-branch=main");
    await writeMigration(repo, "0001_initial.sql");
    await writeMigration(repo, "0021_visual_alternatives.sql");
    commit(repo, "base migrations");
    run(repo, "checkout", "-q", "-b", "feature");
    return repo;
  }

  test("Given a branch whose new migration is above the base When checked Then there is no problem", async () => {
    const repo = await repository();
    await writeMigration(repo, "0022_export_shares.sql");
    commit(repo, "add 0022");

    const report = await checkRepository(repo, "main");

    expect(report.problems).toEqual([]);
    expect(report.head.length).toBe(3);
  });

  test("Given a branch that fills an earlier gap When checked Then the new migration is rejected", async () => {
    const repo = await repository();
    await writeMigration(repo, "0019_fill_gap.sql");
    commit(repo, "add 0019");

    expect(codes((await checkRepository(repo, "main")).problems)).toEqual(["new_not_after_base 0019_fill_gap.sql"]);
  });

  test("Given a branch that rewrites or deletes a base migration When checked Then each is rejected", async () => {
    const repo = await repository();
    await writeMigration(repo, "0021_visual_alternatives.sql", "-- edited\n");
    commit(repo, "rewrite 0021");
    expect(codes((await checkRepository(repo, "main")).problems)).toEqual(["existing_rewritten 0021_visual_alternatives.sql"]);

    const deleted = await repository();
    await rm(path.join(deleted, ...MIGRATIONS_DIR.split("/"), "0021_visual_alternatives.sql"));
    commit(deleted, "delete 0021");
    expect(codes((await checkRepository(deleted, "main")).problems)).toEqual(["existing_deleted 0021_visual_alternatives.sql"]);
  });

  test("Given a base ref equal to HEAD When checked Then there is no new migration and no problem", async () => {
    const repo = await repository();
    await writeMigration(repo, "0022_export_shares.sql");
    commit(repo, "add 0022");

    expect((await checkRepository(repo, "HEAD")).problems).toEqual([]);
  });
});
