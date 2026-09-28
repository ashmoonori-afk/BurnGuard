import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrationsFrom } from "../src/db/migrate";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { VisualAlternativeService } from "../src/services/visual-alternatives";
import {
  admitUserTurn,
  holdSessionsForRecovery,
  interruptAllUserTurns,
  releaseUserTurnReservation,
} from "../src/services/turns";
import { beginDirectionOperation } from "../src/services/direction-operation-registry";
import { deleteProject } from "../src/services/project-deletion";
import { restoreVisualAlternativeBase } from "../src/services/visual-alternative-generation";
import { projectsDir } from "../src/lib/paths";

const roots: string[] = [];
let db: Database;
let root: string;

beforeEach(async () => {
  db = new Database(":memory:");
  await runMigrationsFrom(db, path.join(import.meta.dir, "../src/db/migrations"));
  await mkdir(projectsDir, { recursive: true });
  root = await mkdtemp(path.join(projectsDir, "burnguard-alternatives-"));
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
      maxConcurrentTurns: 4,
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
      maxConcurrentTurns: 4,
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
      maxConcurrentTurns: 4,
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
      maxConcurrentTurns: 4,
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
        maxConcurrentTurns: 4,
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
      maxConcurrentTurns: 4,
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
      maxConcurrentTurns: 4,
      request: { count: 2, prompt: "Second batch.", names: ["New A", "New B"] },
    });
    const completed = await failed.completion;

    // Then
    expect(completed.status).toBe("failed");
    expect(completed.alternatives.filter((item) => item.generation_id === completed.generation_id).map((item) => item.status)).toEqual(["failed", "failed"]);
    expect(completed.alternatives.filter((item) => item.generation_id !== completed.generation_id).map((item) => item.status)).toEqual(["ready", "ready"]);
  });

  test("Given a batch is cancelled after its first item When generation settles Then later items never run and the lease is released", async () => {
    // Given
    const coordinator = new ArtifactCoordinator(db);
    await coordinator.initialize("p", root);
    const ran: number[] = [];
    const service: VisualAlternativeService = new VisualAlternativeService(db, {
      runTurn: async ({ operationId, ordinal }) => {
        ran.push(ordinal);
        await commitAlternative(coordinator, operationId, ordinal);
        if (ordinal === 0) service.cancel("p");
      },
    });

    // When
    const started = await service.generate(generateInput(["A", "B", "C"]));
    const completed = await started.completion;
    const admission = admitUserTurn("s", 4);

    // Then
    expect(ran).toEqual([0]);
    expect(completed.status).toBe("failed");
    expect(completed.alternatives.map((item) => item.status)).toEqual(["failed", "failed", "failed"]);
    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe("<main>Original</main>");
    expect(admission.kind).toBe("reserved");
    if (admission.kind === "reserved") releaseUserTurnReservation(admission.reservation);
  });

  test("Given shutdown interrupts every turn When a batch is between items Then the batch stops", async () => {
    // Given
    const coordinator = new ArtifactCoordinator(db);
    await coordinator.initialize("p", root);
    const ran: number[] = [];
    const service = new VisualAlternativeService(db, {
      runTurn: async ({ operationId, ordinal }) => {
        ran.push(ordinal);
        await commitAlternative(coordinator, operationId, ordinal);
      },
      restoreBase: async (...args) => {
        await restoreVisualAlternativeBase(...args);
        await interruptAllUserTurns();
      },
    });

    // When
    const started = await service.generate(generateInput(["A", "B"]));
    const completed = await started.completion;

    // Then
    expect(ran).toEqual([0]);
    expect(completed.alternatives.map((item) => item.status)).toEqual(["ready", "failed"]);
    expect(completed.status).toBe("partial");
  });

  test("Given every turn slot is taken When alternatives start Then generation reports capacity without rows", async () => {
    // Given
    const other = admitUserTurn("other-session", 1);
    if (other.kind !== "reserved") throw new Error("turn_reservation_missing");
    const service = new VisualAlternativeService(db);

    try {
      // When / Then
      await expect(service.generate({ ...generateInput(["A", "B"]), maxConcurrentTurns: 1 }))
        .rejects.toMatchObject({ code: "capacity_exhausted" });
      expect(db.query("SELECT COUNT(*) AS count FROM visual_alternative_generations").get()).toEqual({ count: 0 });
    } finally {
      releaseUserTurnReservation(other.reservation);
    }
  });

  test("Given an active batch When turns, directions, recovery holds or deletion compete Then each is refused", async () => {
    // Given
    const coordinator = new ArtifactCoordinator(db);
    await coordinator.initialize("p", root);
    let observed: Record<string, unknown> = {};
    const service = new VisualAlternativeService(db, {
      runTurn: async ({ operationId, ordinal }) => {
        if (ordinal === 0) {
          observed = {
            turn: admitUserTurn("s", 4).kind,
            direction: beginDirectionOperation("s", "direction-generation"),
            hold: holdSessionsForRecovery(["s"]),
            deletion: await deleteProject(db, "p", { projectsRoot: path.dirname(root) }).then(() => "deleted", (error: unknown) => (error as { code?: string }).code),
          };
        }
        await commitAlternative(coordinator, operationId, ordinal);
      },
    });

    // When
    const started = await service.generate(generateInput(["A", "B"]));
    await started.completion;

    // Then
    expect(observed).toEqual({ turn: "session_busy", direction: null, hold: null, deletion: "project_in_use" });
  });

  test("Given an active batch When another session commits to the same project Then the foreign mutation is refused and the base is restored", async () => {
    // Given
    const coordinator = new ArtifactCoordinator(db);
    await coordinator.initialize("p", root);
    let foreign: unknown = null;
    const service = new VisualAlternativeService(db, {
      runTurn: async ({ operationId, ordinal }) => {
        if (ordinal === 0) {
          const project = db.query<{ readonly current_revision: number; readonly current_digest: string }, []>(
            "SELECT current_revision,current_digest FROM projects WHERE id='p'",
          ).get();
          if (project === null) throw new Error("project_fixture_missing");
          foreign = await coordinator.run({
            projectId: "p",
            projectDir: root,
            kind: "palette",
            expectedRevision: project.current_revision,
            expectedArtifactDigest: project.current_digest,
            mutate: async (stage) => { await writeFile(path.join(stage, "index.html"), "<main>Foreign</main>"); },
          }).then(() => "committed", (error: unknown) => (error as { code?: string }).code);
        }
        await commitAlternative(coordinator, operationId, ordinal);
      },
    });

    // When
    const started = await service.generate(generateInput(["A", "B"]));
    const completed = await started.completion;

    // Then
    expect(foreign).toBe("operation_conflict");
    expect(completed.status).toBe("ready");
    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe("<main>Original</main>");
  });

  test("Given the base cannot be restored When an item finishes Then the generation stays active and the session stays leased", async () => {
    // Given
    const coordinator = new ArtifactCoordinator(db);
    await coordinator.initialize("p", root);
    let restoreAttempts = 0;
    let restoreFails = true;
    const service = new VisualAlternativeService(db, {
      runTurn: async ({ operationId, ordinal }) => {
        await commitAlternative(coordinator, operationId, ordinal);
      },
      restoreBase: async (...args) => {
        restoreAttempts += 1;
        if (restoreFails) throw new Error("disk_unavailable");
        await restoreVisualAlternativeBase(...args);
      },
    });

    // When
    const started = await service.generate(generateInput(["A", "B"]));
    const completed = await started.completion;
    const admission = admitUserTurn("s", 4);
    const foreign = await paletteEdit(coordinator).then(() => "committed", (error: unknown) => (error as { code?: string }).code);
    const adoption = await coordinator.adoptExternal("p", root, () => undefined).then(() => "adopted", (error: unknown) => (error as { code?: string }).code);
    restoreFails = false;
    const recovered = await service.cancel("p");
    const afterRecovery = admitUserTurn("s", 4);

    // Then
    expect(restoreAttempts).toBe(3);
    expect(completed.status).toBe("generating");
    expect(completed.alternatives.map((item) => item.status)).toEqual(["ready", "pending"]);
    expect(admission.kind).toBe("session_busy");
    expect(foreign).toBe("operation_conflict");
    expect(adoption).toBe("operation_conflict");
    expect(recovered).toBe("recovered");
    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe("<main>Original</main>");
    expect(db.query("SELECT status FROM visual_alternative_generations").get()).toEqual({ status: "partial" });
    expect(afterRecovery.kind).toBe("reserved");
    if (afterRecovery.kind === "reserved") releaseUserTurnReservation(afterRecovery.reservation);
  });

  test("Given an operation admitted before the batch When alternatives start Then generation refuses before creating rows", async () => {
    // Given
    const coordinator = new ArtifactCoordinator(db);
    await coordinator.initialize("p", root);
    let releasePrepared: () => void = () => undefined;
    let prepared: () => void = () => undefined;
    const preparedSignal = new Promise<void>((resolve) => { prepared = resolve; });
    const held = new Promise<void>((resolve) => { releasePrepared = resolve; });
    const project = db.query<{ readonly current_revision: number; readonly current_digest: string }, []>(
      "SELECT current_revision,current_digest FROM projects WHERE id='p'",
    ).get();
    if (project === null) throw new Error("project_fixture_missing");
    const earlier = coordinator.run({
      projectId: "p",
      projectDir: root,
      kind: "palette",
      expectedRevision: project.current_revision,
      expectedArtifactDigest: project.current_digest,
      onPrepared: () => { prepared(); },
      mutate: async (stage) => {
        await held;
        await writeFile(path.join(stage, "index.html"), "<main>Earlier</main>");
      },
    });
    await preparedSignal;
    const service = new VisualAlternativeService(db);

    // When
    const generation = await service.generate(generateInput(["A", "B"])).then(() => "started", (error: unknown) => (error as { code?: string }).code);
    releasePrepared();
    await earlier;
    const admission = admitUserTurn("s", 4);

    // Then
    expect(generation).toBe("generation_active");
    expect(db.query("SELECT COUNT(*) AS count FROM visual_alternative_generations").get()).toEqual({ count: 0 });
    expect(admission.kind).toBe("reserved");
    if (admission.kind === "reserved") releaseUserTurnReservation(admission.reservation);
  });

  test("Given staging the base fails When generation starts Then the owner row fails, its tree is removed and the lease is released", async () => {
    // Given
    const service = new VisualAlternativeService(db, {
      materializeBase: async (_source, target) => {
        await mkdir(target, { recursive: true });
        await writeFile(path.join(target, "partial.html"), "partial");
        throw new Error("disk_full");
      },
    });

    // When
    await expect(service.generate(generateInput(["A", "B"]))).rejects.toThrow("disk_full");
    const admission = admitUserTurn("s", 4);

    // Then
    expect(db.query("SELECT status FROM visual_alternative_generations").all()).toEqual([{ status: "failed" }]);
    expect(existsSync(path.join(root, ".meta", "visual-alternatives"))).toBe(true);
    expect(await readdir(path.join(root, ".meta", "visual-alternatives"))).toEqual([]);
    expect(admission.kind).toBe("reserved");
    if (admission.kind === "reserved") releaseUserTurnReservation(admission.reservation);
  });
});

function generateInput(names: readonly string[]) {
  return {
    projectId: "p",
    sessionId: "s",
    projectDir: root,
    entrypoint: "index.html",
    maxConcurrentTurns: 4,
    request: { count: names.length, prompt: "Explore.", names: [...names] },
  };
}

async function paletteEdit(coordinator: ArtifactCoordinator) {
  const project = db.query<{ readonly current_revision: number; readonly current_digest: string }, []>(
    "SELECT current_revision,current_digest FROM projects WHERE id='p'",
  ).get();
  if (project === null) throw new Error("project_fixture_missing");
  return coordinator.run({
    projectId: "p",
    projectDir: root,
    kind: "palette",
    expectedRevision: project.current_revision,
    expectedArtifactDigest: project.current_digest,
    mutate: async (stage) => { await writeFile(path.join(stage, "index.html"), "<main>Foreign</main>"); },
  });
}

async function commitAlternative(coordinator: ArtifactCoordinator, operationId: string, ordinal: number): Promise<void> {
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
}
