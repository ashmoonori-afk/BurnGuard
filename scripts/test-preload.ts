import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Bun exposes no system languages; pin the frontend's first-run locale detection to a Korean system,
// the language the UI suites were written against.
Object.defineProperty(globalThis.navigator, "languages", { value: Object.freeze(["ko-KR"]), configurable: true });

// Every test process owns a new profile, even when the caller supplied a real one.
const temporaryParent = realpathSync(tmpdir());
const fixtureRoot = mkdtempSync(path.join(temporaryParent, "burnguard-tests-"));
process.env.BG_APP_ROOT = fixtureRoot;
process.env.CODEX_HOME = path.join(fixtureRoot, ".codex");
process.env.CLAUDE_CONFIG_DIR = path.join(fixtureRoot, ".claude");
mkdirSync(process.env.CODEX_HOME);
mkdirSync(process.env.CLAUDE_CONFIG_DIR);
const { closeSqlite } = await import("../packages/backend/src/db/sqlite-client");
const { runMigrations } = await import("../packages/backend/src/db/migrate-local");
await runMigrations();

process.on("exit", () => {
  closeSqlite();
  if (path.dirname(fixtureRoot) !== temporaryParent || !path.basename(fixtureRoot).startsWith("burnguard-tests-")) {
    throw new Error("Refusing to remove an unowned test profile");
  }
  try {
    rmSync(fixtureRoot, { recursive: true, force: true });
  } catch {
    process.stderr.write("test_fixture_cleanup_failed\n");
  }
});
