import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrationsFrom } from "../src/db/migrate";
import { reconcileArtifactState } from "../src/services/artifact-recovery";

describe("artifact startup recovery", () => {
  test("Given a project whose managed tree disappeared When startup reconciles Then the stale row is archived", async () => {
    const db = new Database(":memory:");
    const missing = await mkdtemp(path.join(tmpdir(), "burnguard-missing-project-"));
    await rm(missing, { recursive: true, force: true });
    try {
      await runMigrationsFrom(
        db,
        path.join(import.meta.dir, "../src/db/migrations"),
      );
      db.prepare(
        "INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,current_revision,current_digest,created_at,updated_at) VALUES ('missing','Missing','prototype',?,'index.html','codex',1,?,1,1)",
      ).run(missing, "a".repeat(64));

      await expect(reconcileArtifactState(db)).resolves.toMatchObject({
        projects: 1,
      });
      expect(
        db.query<{ readonly archived_at: number | null }, []>(
          "SELECT archived_at FROM projects WHERE id='missing'",
        ).get()?.archived_at,
      ).toBeNumber();
    } finally {
      db.close();
    }
  });
});
