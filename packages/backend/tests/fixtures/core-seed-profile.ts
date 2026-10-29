import { runMigrations } from "../../src/db/migrate-local";
import { seedCoreData } from "../../src/db/seed";
import { closeSqlite, getSqlite } from "../../src/db/sqlite-client";

const scenario = process.argv[2];
if (scenario !== "newer-version" && scenario !== "fixture-thumbnails") {
  throw new TypeError("Invalid core seed scenario");
}
try {
  await runMigrations();
  const sqlite = getSqlite();
  switch (scenario) {
    case "newer-version":
      sqlite.query("INSERT INTO meta_schema (key, value) VALUES ('app_version', '999.0.0') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
      break;
    case "fixture-thumbnails":
      await seedCoreData();
      sqlite.query("UPDATE design_systems SET thumbnail_path='/fixtures/thumbnails/' || id || '.png' WHERE id IN ('northvale-capital','splash')").run();
      break;
    default: {
      const unexpected: never = scenario;
      throw new TypeError(`Unexpected core seed scenario: ${unexpected}`);
    }
  }
  await seedCoreData();
} finally {
  closeSqlite();
}
