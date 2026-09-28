import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrationsFrom } from "../src/db/migrate";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { VisualAlternativeService } from "../src/services/visual-alternatives";
import { admitUserTurn, releaseUserTurnReservation } from "../src/services/turns";

const roots: string[] = [];
let db: Database;
let root: string;

beforeEach(async () => {
  db = new Database(":memory:");
  await runMigrationsFrom(db, path.join(import.meta.dir, "../src/db/migrations"));
  root = await mkdtemp(path.join(tmpdir(), "burnguard-alternatives-"));
  roots.push(root);
  await writeFile(path.join(root, "index.html"), "<main>Original</main>");
  db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES ('p','P','prototype',?,'index.html','codex',1,1)").run(root);
  db.exec("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES ('s','p','codex','idle',1,1,1)");
});

afterEach(async () => {
  db.close();
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("visual alternative service", () => {
  test("Given three names When generation runs Then turns are sequential and the original stays active", async () => {
    // Given
    const coordinator = new ArtifactCoordinator(db);
    await coordinator.initialize("p", root);
    let activeTurns = 0;
    let maximumActiveTurns = 0;
    const service = new VisualAlternativeService(db, {
      runTurn: async ({ operationId, ordinal }) => {
        activeTurns += 1;
        maximumActiveTurns = Math.max(maximumActiveTurns, activeTurns);
        const project = db.query<{ readonly current_revision: number; readonly current_digest: string }, []>(
          "SELECT current_revision,current_digest FROM projects WHERE id='p'",
        ).get();
        if (project === null) throw new Error("project_fixture_missing");
        await coordinator.run({
          projectId: "p",
          projectDir: root,
          kind: "turn",
          operationId,
          expectedRevision: project.current_revision,
          expectedArtifactDigest: project.current_digest,
          mutate: async (stage) => {
            await writeFile(path.join(stage, "index.html"), `<main>Alternative ${ordinal + 1}</main>`);
          },
        });
        activeTurns -= 1;
      },
    });

    // When
    const started = await service.generate({
      projectId: "p",
      sessionId: "s",
      projectDir: root,
      entrypoint: "index.html",
      request: {
        count: 3,
        prompt: "Explore calmer layouts.",
        names: ["Quiet", "Editorial", "Dense"],
      },
    });
    const competingAdmission = admitUserTurn("s", 4);
    const completed = await started.completion;

    // Then
    expect(competingAdmission.kind).toBe("session_busy");
    expect(maximumActiveTurns).toBe(1);
    expect(completed.status).toBe("ready");
    expect(completed.alternatives.map((item) => [item.name, item.status])).toEqual([
      ["Quiet", "ready"],
      ["Editorial", "ready"],
      ["Dense", "ready"],
    ]);
    expect(new Set(completed.alternatives.map((item) => item.result_digest)).size).toBe(3);
    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe("<main>Original</main>");
    const next = await service.generate({
      projectId: "p",
      sessionId: "s",
      projectDir: root,
      entrypoint: "index.html",
      request: {
        count: 2,
        prompt: "Explore two more directions.",
        names: ["Soft", "Bold"],
      },
    });
    const retained = await next.completion;
    expect(retained.alternatives.map((item) => item.name)).toEqual([
      "Soft",
      "Bold",
      "Quiet",
      "Editorial",
      "Dense",
    ]);
  });

  test("Given one failed turn When generation continues Then successful alternatives remain retained", async () => {
    // Given
    const coordinator = new ArtifactCoordinator(db);
    await coordinator.initialize("p", root);
    const service = new VisualAlternativeService(db, {
      runTurn: async ({ operationId, ordinal }) => {
        if (ordinal === 1) throw new Error("provider_failed");
        const project = db.query<{ readonly current_revision: number; readonly current_digest: string }, []>(
          "SELECT current_revision,current_digest FROM projects WHERE id='p'",
        ).get();
        if (project === null) throw new Error("project_fixture_missing");
        await coordinator.run({
          projectId: "p",
          projectDir: root,
          kind: "turn",
          operationId,
          expectedRevision: project.current_revision,
          expectedArtifactDigest: project.current_digest,
          mutate: async (stage) => {
            await writeFile(path.join(stage, "index.html"), `<main>Alternative ${ordinal + 1}</main>`);
          },
        });
      },
    });

    // When
    const started = await service.generate({
      projectId: "p",
      sessionId: "s",
      projectDir: root,
      entrypoint: "index.html",
      request: {
        count: 3,
        prompt: "Explore distinct layouts.",
        names: ["First", "Broken", "Third"],
      },
    });
    const completed = await started.completion;

    // Then
    expect(completed.status).toBe("partial");
    expect(completed.alternatives.map((item) => item.status)).toEqual(["ready", "failed", "ready"]);
    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe("<main>Original</main>");
  });

  test("Given generation setup fails When another turn is admitted Then the session lock was released", async () => {
    // Given
    const service = new VisualAlternativeService(db);

    // When
    await expect(service.generate({
      projectId: "missing",
      sessionId: "failed-setup-session",
      projectDir: root,
      entrypoint: "index.html",
      request: { count: 2, prompt: "Explore.", names: ["A", "B"] },
    })).rejects.toThrow();
    const admission = admitUserTurn("failed-setup-session", 4);

    // Then
    expect(admission.kind).toBe("reserved");
    if (admission.kind === "reserved") {
      releaseUserTurnReservation(admission.reservation);
    }
  });

  test("Given a user turn already owns the session When alternatives start Then generation rejects without rows", async () => {
    // Given
    const admission = admitUserTurn("s", 4);
    if (admission.kind !== "reserved") throw new Error("turn_reservation_missing");
    const service = new VisualAlternativeService(db);

    try {
      // When / Then
      await expect(service.generate({
        projectId: "p",
        sessionId: "s",
        projectDir: root,
        entrypoint: "index.html",
        request: { count: 2, prompt: "Explore.", names: ["A", "B"] },
      })).rejects.toMatchObject({ code: "generation_active" });
      expect(db.query("SELECT COUNT(*) AS count FROM visual_alternative_generations").get()).toEqual({ count: 0 });
    } finally {
      releaseUserTurnReservation(admission.reservation);
    }
  });

  test("Given retained successes and a fully failed new batch When generation finishes Then only the current batch determines status", async () => {
    // Given
    const coordinator = new ArtifactCoordinator(db);
    await coordinator.initialize("p", root);
    let fail = false;
    const service = new VisualAlternativeService(db, {
      runTurn: async ({ operationId, ordinal }) => {
        if (fail) throw new Error("provider_failed");
        const identity = db.query<{ readonly current_revision: number; readonly current_digest: string }, []>(
          "SELECT current_revision,current_digest FROM projects WHERE id='p'",
        ).get();
        if (identity === null) throw new Error("project_fixture_missing");
        await coordinator.run({
          projectId: "p",
          projectDir: root,
          kind: "turn",
          operationId,
          expectedRevision: identity.current_revision,
          expectedArtifactDigest: identity.current_digest,
          mutate: async (stage) => {
            await writeFile(path.join(stage, "index.html"), `<main>Retained ${ordinal}</main>`);
          },
        });
      },
    });
    const retained = await service.generate({
      projectId: "p",
      sessionId: "s",
      projectDir: root,
      entrypoint: "index.html",
      request: { count: 2, prompt: "First batch.", names: ["Old A", "Old B"] },
    });
    await retained.completion;
    fail = true;

    // When
    const failed = await service.generate({
      projectId: "p",
      sessionId: "s",
      projectDir: root,
      entrypoint: "index.html",
      request: { count: 2, prompt: "Second batch.", names: ["New A", "New B"] },
    });
    const completed = await failed.completion;

    // Then
    expect(completed.status).toBe("failed");
    expect(completed.alternatives.filter((item) => item.generation_id === completed.generation_id).map((item) => item.status)).toEqual(["failed", "failed"]);
    expect(completed.alternatives.filter((item) => item.generation_id !== completed.generation_id).map((item) => item.status)).toEqual(["ready", "ready"]);
  });
});
