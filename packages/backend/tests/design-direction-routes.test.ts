import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isRecord, parseDesignDirectionState, type DesignDirectionState, type SequencedEventEnvelope } from "@bg/shared";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { projectsDir } from "../src/lib/paths";
import { designDirectionRoutes, replaceDesignDirectionWorkflowForTest } from "../src/routes/design-directions";
import { projectRoutes } from "../src/routes/project";
import { sequencedBroker } from "../src/services/broker";
import { buildSessionContext } from "../src/services/context";
import { buildPrompt } from "../src/harness/prompt-builder";
import type { DesignDirectionRenderer, DirectionRenderInput } from "../src/services/design-direction-renderer";
import { DesignDirectionWorkflow } from "../src/services/design-direction-workflow";
import { canCreateSymlink, SYMLINK_SKIP_REASON } from "./helpers/platform";

const projectId = `direction-routes-${process.pid}`;
const sessionId = `${projectId}-session`;
const outsideProjectId = `${projectId}-outside`;
const symlinkProjectId = `${projectId}-symlink`;
let root = "";
let outsideRoot = "";
const jsonHeaders = { "content-type": "application/json" };

beforeAll(async () => {
  await runMigrations();
  await mkdir(projectsDir, { recursive: true });
  root = path.join(projectsDir, projectId);
  outsideRoot = await mkdtemp(path.join(tmpdir(), "burnguard-direction-outside-"));
  await mkdir(root, { recursive: true });
  const options = JSON.stringify({ design_brief: { schema_version: 1, output_type: "prototype", audience: "처음 서비스를 검토하는 운영 책임자", objective: "복잡한 운영 현황을 한눈에 이해시키기", content_source: "none", locale: "ko-KR", brand_mode: "none", visual_mood: "formal", density: "balanced", output_size: "responsive" } });
  const insertProject = getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,options_json,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',?,1,1)");
  const insertSession = getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)");
  insertProject.run(projectId, "경로 테스트", root, options);
  insertSession.run(sessionId, projectId);
  insertProject.run(outsideProjectId, "외부 경로", outsideRoot, null);
  insertSession.run(`${outsideProjectId}-session`, outsideProjectId);
});
afterAll(async () => {
  for (const id of [projectId, outsideProjectId, symlinkProjectId]) getSqlite().prepare("DELETE FROM projects WHERE id=?").run(id);
  await rm(root, { recursive: true, force: true });
  await rm(path.join(projectsDir, symlinkProjectId), { force: true });
  await rm(outsideRoot, { recursive: true, force: true });
});

function request(route: string, method = "GET", body?: unknown, headers?: Readonly<Record<string, string>>): Promise<Response> {
  return designDirectionRoutes.request(`http://local${route}`, { method, headers: body === undefined ? headers : { ...jsonHeaders, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
}

class RouteProgressGateRenderer implements DesignDirectionRenderer {
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
    if (waiter === null) throw new TypeError("route renderer subscriber missing");
    this.blockedWaiter = null;
    waiter();
    await new Promise<void>((resolve, reject) => input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true }));
  }
}

function nextTerminalState(): Promise<DesignDirectionState> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { unsubscribe(); reject(new TypeError("direction terminal event timed out")); }, 2_000);
    const unsubscribe = sequencedBroker.subscribe(sessionId, (item: SequencedEventEnvelope) => {
      if (item.event.type !== "design.direction_state" || item.event.state.status === "loading") return;
      clearTimeout(timeout); unsubscribe(); resolve(item.event.state);
    });
  });
}

describe("design direction routes", () => {
  test("generates state, selects, undoes, and serves validated SVG caching", async () => {
    expect((await request("/api/projects/missing/design-directions")).status).toBe(404);
    const terminalEvent = nextTerminalState();
    const started = await request(`/api/projects/${projectId}/design-directions/generate`, "POST");
    expect(started.status).toBe(202);
    const ready = await terminalEvent;
    expect(ready.status).toBe("ready");
    expect(ready.content_outline).toContain("목표: 복잡한 운영 현황을 한눈에 이해시키기");
    expect(ready.content_outline).toContain("대상: 처음 서비스를 검토하는 운영 책임자");
    expect((await request(`/api/projects/${projectId}/design-directions`)).status).toBe(200);
    expect((await projectRoutes.request(`http://local/api/projects/${projectId}/design-directions`)).status).toBe(200);

    const selectedResponse = await request(`/api/projects/${projectId}/design-directions/select`, "POST", { generation_id: ready.generation_id, expected_selection_revision: 0, direction_id: "editorial" });
    expect(selectedResponse.status).toBe(200);
    const promptContext = await buildSessionContext(sessionId);
    if (promptContext === null) throw new TypeError("session context missing");
    const prompt = await buildPrompt(promptContext, { type: "user.message", text: "계속" });
    expect(prompt).toContain("복잡한 운영 현황을 한눈에 이해시키기");
    expect(prompt).toContain("처음 서비스를 검토하는 운영 책임자");
    expect(prompt).not.toContain("모듈 시스템");
    expect(prompt).not.toContain("흐름 서사");
    expect((await request(`/api/projects/${projectId}/design-directions/select`, "POST", { generation_id: ready.generation_id, expected_selection_revision: 0, direction_id: "modular" })).status).toBe(409);
    expect((await request(`/api/projects/${projectId}/design-directions/undo-selection`, "POST", { generation_id: ready.generation_id, expected_selection_revision: 1 })).status).toBe(200);

    const previewPath = `/api/projects/${projectId}/design-directions/${ready.generation_id}/editorial/preview`;
    const preview = await request(previewPath);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("image/svg+xml");
    expect(preview.headers.get("cache-control")).toBe("private, no-cache");
    const etag = preview.headers.get("etag");
    expect(etag).not.toBeNull();
    expect((await request(previewPath, "GET", undefined, { "if-none-match": etag ?? "" })).status).toBe(304);
    expect((await request(`/api/projects/${projectId}/design-directions/${ready.generation_id}/unknown/preview`)).status).toBe(404);
    expect((await request(`/api/projects/${projectId}/design-directions/${ready.generation_id}/%5Cescape/preview`)).status).toBe(400);
  });

  test("Given an unmanaged project directory When generating Then it rejects without writing outside", async () => {
    for (const id of [outsideProjectId]) {
      const response = await request(`/api/projects/${id}/design-directions/generate`, "POST");
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: { code: "project_path_unavailable", message: "Project directory is outside managed storage" } });
      expect(await Bun.file(path.join(outsideRoot, ".meta", "directions")).exists()).toBeFalse();
      expect((await request(`/api/projects/${id}/design-directions/generation/editorial/preview`)).status).toBe(503);
    }
  });

  for (const alias of [{ type: "dir" as const, name: "symlink", supported: canCreateSymlink() }, { type: "junction" as const, name: "Windows junction", supported: process.platform === "win32" }]) {
    test.skipIf(!alias.supported)(`Given a ${alias.name} project directory When generating Then it rejects without writing outside (${alias.type === "dir" ? SYMLINK_SKIP_REASON : "Windows only"})`, async () => {
      const id = `${symlinkProjectId}-${alias.type}`;
      const linked = path.join(projectsDir, id);
      try {
        await symlink(outsideRoot, linked, alias.type);
        getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(id, "Alias", linked);
        getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(`${id}-session`, id);
        const response = await request(`/api/projects/${id}/design-directions/generate`, "POST");
        expect(response.status).toBe(503);
        expect(JSON.stringify(await response.json())).not.toContain(outsideRoot);
        expect(await Bun.file(path.join(outsideRoot, ".meta", "directions")).exists()).toBeFalse();
        expect((await request(`/api/projects/${id}/design-directions/generation/editorial/preview`)).status).toBe(503);
      } finally {
        getSqlite().prepare("DELETE FROM projects WHERE id=?").run(id);
        if (alias.type === "junction") await rmdir(linked); else await unlink(linked);
      }
    });
  }

  test("returns typed busy, cancellation, and retry outcomes", async () => {
    getSqlite().prepare("UPDATE sessions SET status='running' WHERE id=?").run(sessionId);
    expect((await request(`/api/projects/${projectId}/design-directions/generate`, "POST")).status).toBe(409);
    getSqlite().prepare("UPDATE sessions SET status='idle' WHERE id=?").run(sessionId);
    expect((await request(`/api/projects/${projectId}/design-directions/cancel`, "POST")).status).toBe(409);
    const retry = await request(`/api/projects/${projectId}/design-directions/retry`, "POST");
    expect(retry.status).toBe(422);
    expect(await retry.json()).toEqual({ error: { code: "nothing_to_retry", message: "nothing_to_retry" } });
  });

  test("returns the exact terminal cancellation state before immediate GET", async () => {
    const renderer = new RouteProgressGateRenderer();
    const replacement = new DesignDirectionWorkflow(renderer, () => 90, () => "route-cancel-terminal");
    const restore = replaceDesignDirectionWorkflowForTest(replacement);
    try {
      const blocked = renderer.nextBlockedCall();
      expect((await request(`/api/projects/${projectId}/design-directions/generate`, "POST")).status).toBe(202);
      await blocked;

      const response = await request(`/api/projects/${projectId}/design-directions/cancel`, "POST");
      const body: unknown = await response.json();
      const terminal = parseDesignDirectionState(isRecord(body) ? body["data"] : null);
      const immediateBody: unknown = await (await request(`/api/projects/${projectId}/design-directions`)).json();

      expect(response.status).toBe(202);
      expect(body).toEqual({ data: terminal });
      expect(terminal.status).toBe("cancelled");
      expect(terminal.directions.map((slot) => slot.status)).toEqual(["ready", "cancelled", "cancelled"]);
      expect(immediateBody).toEqual({ data: terminal });
      expect((await request(`/api/projects/${projectId}/design-directions/cancel`, "POST")).status).toBe(409);
    } finally {
      restore();
    }
  });
});
