import path from "node:path";
import { APP_VERSION } from "@bg/shared";
import { appRootDir, resolveRepoRoot } from "../lib/paths";
import { runMigrationsFrom } from "./migrate";

export async function runMigrations(): Promise<void> {
  const { getSqlite } = await import("./sqlite-client");
  await runMigrationsFrom(getSqlite(), path.join(resolveRepoRoot(), "packages/backend/src/db/migrations"), {
    directory: path.join(appRootDir, "backups"),
    appVersion: APP_VERSION,
  });
}
