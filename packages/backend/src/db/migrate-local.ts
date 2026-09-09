import path from "node:path";
import { resolveRuntimeRoot } from "../lib/paths";
import { runMigrationsFrom } from "./migrate";

export async function runMigrations(): Promise<void> {
  const { getSqlite } = await import("./sqlite-client");
  await runMigrationsFrom(
    getSqlite(),
    path.join(resolveRuntimeRoot(), "packages/backend/src/db/migrations"),
  );
}
