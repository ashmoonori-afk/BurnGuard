import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseDesignDirectionState, type DesignDirectionState } from "@bg/shared";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { listSessionEvents } from "../src/db/events";
import type { DesignDirectionRenderer, DirectionRenderInput } from "../src/services/design-direction-renderer";
import { DIRECTION_INTERRUPTION_ERROR, DIRECTION_RENDER_ERROR, DesignDirectionWorkflow, DesignDirectionWorkflowError } from "../src/services/design-direction-workflow";
import { isDirectionOperationActive } from "../src/services/direction-operation-registry";
import { getLatestDirectionState, publishDirectionState } from "../src/services/design-direction-state";
import { startUserTurn } from "../src/services/turns";
import { buildSessionContext } from "../src/services/context";

const projectId = `direction-workflow-${process.pid}`;
const root = await mkdtemp(path.join(tmpdir(), "burnguard-directions-"));
const sessionIds: string[] = [];

beforeAll(async () => {
  await runMigrations();
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, "방향 테스트", root);
});
afterAll(async () => { getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId); await rm(root, { recursive: true, force: true }); });

function session(label: string): { readonly projectId: string; readonly sessionId: string; readonly projectDir: string; readonly projectName: string; readonly projectType: "prototype"; readonly designBrief: null } {
  const sessionId = `${projectId}-${label}`;
  sessionIds.push(sessionId);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
  return { projectId, sessionId, projectDir: root, projectName: "방향 테스트", projectType: "prototype", designBrief: null };
}

class FailOnceRenderer implements DesignDirectionRenderer {
  readonly calls: string[] = [];
  private failed = false;
  async render(input: DirectionRenderInput): Promise<void> {
    this.calls.push(input.layout);
    if (input.layout === "modular" && !this.failed) { this.failed = true; throw new TypeError("modular render failed"); }
    await mkdir(path.dirname(input.outputPath), { recursive: true });
    await writeFile(input.outputPath, `<svg data-layout="${input.layout}"/>`, { signal: input.signal });
  }
}

class ProgressGateRenderer implements DesignDirectionRenderer {
  private renderCount = 0;
  private blockedWaiter: (() => void) | null = null;
  nextBlockedCall(): Promise<void> { return new Promise((resolve) => { this.blockedWaiter = resolve; }); }
  async render(input: DirectionRenderInput): Promise<void> {
    this.renderCount += 1;
    if (this.renderCount === 1) {
      await mkdir(path.dirname(input.outputPath), { recursive: true });
      await writeFile(input.outputPath, "<svg/>", { signal: input.signal });
      return;
    }
    const waiter = this.blockedWaiter;
    if (waiter === null) throw new TypeError("blocked renderer subscriber missing");
    this.blockedWaiter = null;
    waiter();
    await new Promise<void>((resolve, reject) => input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true }));
  }
}

class GateRenderer implements DesignDirectionRenderer {
  private waiter: ((input: DirectionRenderInput) => void) | null = null;
  private queued: DirectionRenderInput | null = null;
  nextCall(): Promise<DirectionRenderInput> {
    if (this.queued !== null) { const value = this.queued; this.queued = null; return Promise.resolve(value); }
    return new Promise((resolve) => { this.waiter = resolve; });
  }
  async render(input: DirectionRenderInput): Promise<void> {
    const waiter = this.waiter;
    if (waiter === null) this.queued = input; else { this.waiter = null; waiter(input); }
    await new Promise<void>((resolve, reject) => {
      input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true });
    });
  }
}

describe("design direction workflow", () => {
  test("Given initial persistence failure When generation is retried Then the session reservation is released", async () => {
    const input = session("initial-failure");
    const workflow = new DesignDirectionWorkflow(undefined, () => 10, () => "generation-initial-failure");
    const db = getSqlite();
    db.exec(`CREATE TEMP TRIGGER fail_direction_start BEFORE INSERT ON events WHEN NEW.session_id='${input.sessionId}' BEGIN SELECT RAISE(ABORT,'injected event failure'); END`);
    try {
      await expect(workflow.generate(input)).rejects.toThrow("injected event failure");
      expect(isDirectionOperationActive(input.sessionId)).toBe(false);
    } finally { db.exec("DROP TRIGGER fail_direction_start"); }
    expect((await (await workflow.generate(input)).completion).status).toBe("ready");
  });

  test("Given rendering in progress When another window selects or undoes Then the server rejects without changing selection", async () => {
    const input = session("active-selection");
    const renderer = new ProgressGateRenderer();
    const workflow = new DesignDirectionWorkflow(renderer, () => 10, () => "generation-active-selection");
    const blocked = renderer.nextBlockedCall();
    const started = await workflow.generate(input);
    await blocked;
    try {
      await expect(workflow.select(input.sessionId, started.state.generation_id, 0, "editorial")).rejects.toMatchObject({ code: "operation_active" });
      await expect(workflow.undo(input.sessionId, started.state.generation_id, 0)).rejects.toMatchObject({ code: "operation_active" });
      expect((await getLatestDirectionState(input.sessionId))?.selection_revision).toBe(0);
    } finally { await workflow.cancel(input.sessionId); }
  });

  test("Given two windows with one revision When both select Then only one durable selection succeeds", async () => {
    const input = session("concurrent-selection");
    const workflow = new DesignDirectionWorkflow(undefined, () => 10, () => "generation-concurrent-selection");
    const ready = await (await workflow.generate(input)).completion;
    const outcomes = await Promise.allSettled([
      workflow.select(input.sessionId, ready.generation_id, 0, "editorial"),
      new DesignDirectionWorkflow().select(input.sessionId, ready.generation_id, 0, "modular"),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "revision_conflict" } });
    expect((await getLatestDirectionState(input.sessionId))?.selection_revision).toBe(1);
  });

  test("Given a renderer error containing a private path When failure is published Then persisted and returned snapshots contain only a public message", async () => {
    const input = session("private-render-error");
    const renderer: DesignDirectionRenderer = { render: async () => { throw new Error("EACCES C:/private/SECRET_RENDER_PATH/output.svg"); } };
    const result = await (await new DesignDirectionWorkflow(renderer).generate(input)).completion;
    expect(result.error).toBe(DIRECTION_RENDER_ERROR);
    expect(JSON.stringify(result)).not.toContain("SECRET_RENDER_PATH");
    expect(JSON.stringify(await listSessionEvents(input.sessionId))).not.toContain("SECRET_RENDER_PATH");
  });

  test("persists exactly three structurally distinct production SVG previews", async () => {
    const input = session("svg");
    const completed = await (await new DesignDirectionWorkflow(undefined, () => 10, () => "generation-svg").generate(input)).completion;
    expect(completed.status).toBe("ready");
    expect(completed.directions).toHaveLength(3);
    expect(completed.content_outline[0]).toContain("방향 테스트");
    const svgs = await Promise.all(completed.directions.map((slot) => readFile(path.join(root, ".meta", "directions", completed.generation_id, `${slot.id}.svg`), "utf8")));
    expect(new Set(svgs).size).toBe(3);
    expect(svgs.every((svg) => svg.includes('width="640"') && svg.includes('height="360"'))).toBeTrue();
    expect((await getLatestDirectionState(input.sessionId))?.status).toBe("ready");
  });

  test("retries only failed slots after a partial result", async () => {
    const input = session("retry");
    const renderer = new FailOnceRenderer();
    const workflow = new DesignDirectionWorkflow(renderer, () => 20, () => "generation-retry");
    const partial = await (await workflow.generate(input)).completion;
    expect(partial.status).toBe("partial");
    expect(renderer.calls).toEqual(["editorial", "modular", "narrative"]);
    const retried = await (await workflow.retry(input)).completion;
    expect(retried.status).toBe("ready");
    expect(renderer.calls).toEqual(["editorial", "modular", "narrative", "modular"]);
  });

  test("advances every progress and selection timestamp with a constant clock", async () => {
    const input = session("timestamps");
    const workflow = new DesignDirectionWorkflow(undefined, () => 70, () => "generation-timestamps");
    const started = await workflow.generate(input);
    const ready = await started.completion;
    const selected = await workflow.select(input.sessionId, ready.generation_id, 0, "editorial");
    await workflow.undo(input.sessionId, ready.generation_id, selected.selection_revision);
    const states = (await listSessionEvents(input.sessionId)).flatMap((item) =>
      item.event.type === "design.direction_state" ? [parseDesignDirectionState(item.event.state)] : [],
    );

    expect(states.map((state) => state.updated_at)).toEqual([70, 71, 72, 73, 74, 75]);
    expect(states.at(-1)?.selection_revision).toBe(2);
  });

  test("acknowledges cancellation only after the parsed terminal snapshot is published", async () => {
    const input = session("cancel-terminal-ack");
    const renderer = new ProgressGateRenderer();
    const workflow = new DesignDirectionWorkflow(renderer, () => 79, () => "generation-cancel-terminal-ack");
    const blocked = renderer.nextBlockedCall();
    const started = await workflow.generate(input);
    await blocked;

    const cancelled = await workflow.cancel(input.sessionId);
    const persisted = await getLatestDirectionState(input.sessionId);
    const completed = await started.completion;

    expect(cancelled).toEqual(completed);
    expect(persisted).toEqual(completed);
    expect(completed.status).toBe("cancelled");
    expect(completed.directions.map((slot) => slot.status)).toEqual(["ready", "cancelled", "cancelled"]);
  });

  test("cancels when abort is requested immediately before renderer resolution", async () => {
    const input = session("cancel-before-resolve");
    let cancelOperation: (() => void) | null = null;
    const renderer: DesignDirectionRenderer = {
      async render(): Promise<void> {
        const cancel = cancelOperation;
        if (cancel === null) throw new TypeError("cancel callback missing");
        cancel();
      },
    };
    const workflow = new DesignDirectionWorkflow(renderer, () => 80, () => "generation-cancel-before-resolve");
    cancelOperation = () => { void workflow.cancel(input.sessionId); };

    const completed = await (await workflow.generate(input)).completion;

    expect(completed.status).toBe("cancelled");
    expect(completed.directions.every((slot) => slot.status === "cancelled")).toBeTrue();
    expect(await workflow.cancel(input.sessionId)).toBeNull();
  });

  test("cancels through a renderer gate subscribed before generation", async () => {
    const input = session("cancel");
    const renderer = new GateRenderer();
    const workflow = new DesignDirectionWorkflow(renderer, () => 30, () => "generation-cancel");
    const entered = renderer.nextCall();
    const started = await workflow.generate(input);
    await entered;
    expect(startUserTurn(input.sessionId, { type: "user.message", text: "blocked" })).toBeNull();
    const acknowledged = await workflow.cancel(input.sessionId);
    const cancelled = await started.completion;
    expect(acknowledged).toEqual(cancelled);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.directions.every((slot) => slot.status === "cancelled")).toBeTrue();
  });

  test("persists selection, detects conflicts, and undoes one revision", async () => {
    const input = session("selection");
    const workflow = new DesignDirectionWorkflow(undefined, () => 40, () => "generation-selection");
    const ready = await (await workflow.generate(input)).completion;
    const first = await workflow.select(input.sessionId, ready.generation_id, 0, "editorial");
    const second = await workflow.select(input.sessionId, ready.generation_id, 1, "narrative");
    expect((await getLatestDirectionState(input.sessionId))?.selected_id).toBe("narrative");
    expect((await buildSessionContext(input.sessionId))?.designDirectionState?.selected_id).toBe("narrative");
    await expect(workflow.select(input.sessionId, ready.generation_id, 1, "modular")).rejects.toBeInstanceOf(DesignDirectionWorkflowError);
    const undone = await workflow.undo(input.sessionId, ready.generation_id, second.selection_revision);
    expect(undone.selected_id).toBe(first.selected_id);
    expect(undone.selection_revision).toBe(3);
  });

  test("recovers orphaned loading state as retryable failure", async () => {
    const input = session("recovery");
    const state: DesignDirectionState = {
      schema_version: 1, project_id: projectId, session_id: input.sessionId, generation_id: "orphan", status: "loading",
      content_outline: ["문제"], selected_id: null, selection_revision: 0, selection_history: [], error: null, updated_at: 50,
      directions: [
        { id: "editorial", order: 0, layout_key: "editorial", title: "편집", summary: "요약", style_facts: ["사실"], status: "pending", preview_url: null, error: null },
        { id: "modular", order: 1, layout_key: "modular", title: "모듈", summary: "요약", style_facts: ["사실"], status: "pending", preview_url: null, error: null },
        { id: "narrative", order: 2, layout_key: "narrative", title: "서사", summary: "요약", style_facts: ["사실"], status: "pending", preview_url: null, error: null },
      ],
    };
    await publishDirectionState(input.sessionId, state);
    const recovered = await new DesignDirectionWorkflow(undefined, () => 51).recover(input.sessionId);
    expect(recovered?.status).toBe("failed");
    expect(recovered?.directions.every((slot) => slot.error === DIRECTION_INTERRUPTION_ERROR)).toBeTrue();
  });
});
