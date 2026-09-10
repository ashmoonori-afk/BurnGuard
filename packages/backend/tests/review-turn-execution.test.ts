import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { projectsDir } from "../src/lib/paths";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { interruptUserTurn, startUserTurn, type TurnDependencies } from "../src/services/turns";
import { settleProcessStreams } from "../src/adapters/process-streams";
import { closeOwnedProcessTree, ownedProcessSpawnOptions } from "../src/adapters/owned-process-tree";
import { sessionRoutes } from "../src/routes/session";
import { insertNormalizedEvent } from "../src/db/events";
import { insertAttachment } from "../src/db/attachments";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { broker } from "../src/services/broker";
import { managedFileRoutes } from "../src/routes/managed-files";
import { selectContextAttachments } from "../src/services/context";
import { createApp } from "../src/server";

let projectId: string;
let sessionId: string;
let projectDir: string;
let digest: string;
beforeAll(async () => { await runMigrations(); await mkdir(projectsDir, { recursive: true }); });
beforeEach(async () => {
  projectId = `review-turn-${crypto.randomUUID()}`;
  sessionId = `${projectId}-session`;
  projectDir = path.join(projectsDir, projectId);
  await mkdir(projectDir);
  await writeFile(path.join(projectDir, "index.html"), "base");
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, projectId, projectDir);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
  digest = (await new ArtifactCoordinator(getSqlite()).initialize(projectId, projectDir)).tree_digest;
});
afterEach(async () => { getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId); await rm(projectDir, { recursive: true, force: true }); });

function start(runAdapter: NonNullable<TurnDependencies["runAdapter"]>, text = "Create a result") {
  const turn = startUserTurn(sessionId, { type: "user.message", text }, undefined, {
    detectBackends: async () => ({ backends: [{ id: "codex", found: true, binary_path: "fixture", version: "test" }] }), runAdapter,
  });
  if (turn === null) throw new Error("turn reservation unavailable");
  return turn;
}

test("Given prompt-directed writes When generation succeeds Then only stage changes before commit", async () => {
  const turn = start(async (_backend, input) => {
    const target = input.prompt.match(/Write or edit files inside `([^`]+)`/)?.[1];
    expect(target).toBe(input.projectDir);
    expect(target).not.toBe(projectDir);
    await writeFile(path.join(target!, "index.html"), "success");
    expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe("base");
    await input.onEvent({ id: crypto.randomUUID(), ts: Date.now(), type: "chat.delta", turnId: input.turnId, text: "1. Red. 2. Blue." });
    await input.onEvent({ id: crypto.randomUUID(), ts: Date.now(), type: "status.idle", stopReason: "end_turn" });
    return { exitCode: 0 };
  });
  await turn.prepared;
  await turn.promise;
  expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe("success");
  expect(existsSync(path.join(projectDir, ".meta", "checkpoints", `${turn.turnId}.json`))).toBe(true);
  const followup = start(async (_backend, input) => {
    expect(input.prompt).toContain("1. Red. 2. Blue.");
    expect(input.prompt).toContain("<burnguard-conversation-v1>");
    return { exitCode: 0 };
  }, "Use the second option");
  await followup.promise;
});

test("Given many historical documents When selecting persistent context Then current and named originals take priority within intake limits", () => {
  const docs = Array.from({ length: 12 }, (_, index) => ({ id: `doc-${index}`, session_id: "s", turn_id: "old", file_path: `/stored/${index}.pdf`, mime_type: "application/pdf", original_name: `${index}.pdf`, size_bytes: 4 * 1024 * 1024, sha256: "a".repeat(64), source_role: "ordinary_content" as const, source_role_explicit: false, created_at: index }));
  const paths = selectContextAttachments(docs, [docs[1]!.file_path], "0.pdf 다시 읽어 주세요");
  expect(paths[0]).toBe(docs[1]!.file_path);
  expect(paths[1]).toBe(docs[0]!.file_path);
  expect(paths.length).toBe(6);
  expect(selectContextAttachments(docs.map(item => ({ ...item, size_bytes: 10 })), [], "")).toHaveLength(8);
});

test("Given a reopened session with an earlier PDF and no extracted sidecar When a follow-up is sent without reattaching Then original and recovered text are readable", async () => {
  await mkdir(path.join(projectDir, ".attachments"));
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("PRESERVE THE ORIGINAL BRIEF");
  const bytes = await pdf.save();
  const source = path.join(projectDir, ".attachments", "saved-brief.pdf");
  await writeFile(source, bytes);
  await insertAttachment({ sessionId, turnId: "previous-turn", filePath: source, mimeType: "application/pdf", originalName: "기획서.pdf", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  let read = false;
  const turn = start(async (_backend, input) => {
    const original = input.prompt.match(/source_path: (.+?) \(read-only document/)?.[1];
    const extracted = input.prompt.match(/extracted_text_path: (.+?) \(safe text version/)?.[1];
    expect(original).toBeDefined();
    expect(new Uint8Array(await readFile(original!))).toEqual(bytes);
    expect(await readFile(extracted!, "utf8")).toContain("PRESERVE THE ORIGINAL BRIEF");
    expect(input.prompt).not.toContain("do not Read/Glob/Bash this file");
    read = true;
    return { exitCode: 0 };
  }, "원문 그대로 다시 작업해 주세요");
  await turn.promise;
  expect(read).toBe(true);
  expect(new Uint8Array(await readFile(source))).toEqual(bytes);
});

test("Given a running generation When staged HTML changes Then draft files and in-app reports work before commit and expire afterward", async () => {
  let resolveChange: (event: Extract<import('@bg/shared').NormalizedEvent, { type: 'artifact.preview' }>) => void = () => {};
  const changed = new Promise<Extract<import('@bg/shared').NormalizedEvent, { type: 'artifact.preview' }>>(resolve => { resolveChange = resolve; });
  const unsubscribe = broker.subscribe(sessionId, event => { if (event.type === "artifact.preview" && event.active && event.version >= 2) resolveChange(event); });
  let previewUrl = "";
  let observed = false;
  try {
    const turn = start(async (_backend, input) => {
      await writeFile(path.join(input.projectDir, "index.html"), "<html><body><h1>First section</h1></body></html>");
      const event = await changed;
      previewUrl = `/api/projects/${projectId}/preview/${event.previewId}/fs/index.html`;
      const app = createApp({ capability: "preview-test", appAuthority: "127.0.0.1:14070" });
      const url = `http://127.0.0.1:14070${previewUrl}`;
      expect((await app.request(new Request(url, { headers: { host: "127.0.0.1:14070" } }))).status).toBe(403);
      const response = await app.request(new Request(url, { headers: { host: "127.0.0.1:14070", "x-burnguard-capability": "preview-test" } }));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("First section");
      expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe("base");
      expect(response.headers.get("X-Burnguard-Artifact-Digest")).toBeNull();
      expect((await managedFileRoutes.request(previewUrl.replace("index.html", ".attachments/private.css"))).status).toBe(404);
      const reportUrl = previewUrl.replace("fs/index.html", "report");
      const report = { version: event.version, width: 1200, height: 800, images: 2, brokenImages: 1, pendingImages: 0, horizontalOverflow: 20 };
      expect((await managedFileRoutes.request(reportUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) })).status).toBe(200);
      expect(JSON.parse(await readFile(path.join(path.dirname(input.projectDir), "preview-report.json"), "utf8")).brokenImages).toBe(1);
      expect((await managedFileRoutes.request(reportUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...report, instructions: "untrusted" }) })).status).toBe(409);
      observed = true;
      return { exitCode: 0 };
    });
    await turn.promise;
    expect(observed).toBe(true);
    expect((await managedFileRoutes.request(previewUrl)).status).toBe(404);
    expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toContain("First section");
    expect(existsSync(path.join(projectDir, "preview-report.json"))).toBe(false);
  } finally { unsubscribe(); }
});

for (const reviewFails of [false, true]) test(`Given a deck generation When mandatory copy review ${reviewFails ? "fails" : "succeeds"} Then publication ${reviewFails ? "rolls back" : "includes corrections"}`, async () => {
  getSqlite().prepare("UPDATE projects SET type='slide_deck' WHERE id=?").run(projectId);
  let calls = 0;
  const turn = start(async (_backend, input) => {
    calls += 1;
    expect(input.generation?.effort).toBe("low");
    if (calls === 1) await writeFile(path.join(input.projectDir, "index.html"), '<section data-slide><h1>Placeholder</h1></section>');
    else {
      const { DECK_REVIEW_PROMPT } = await import("../src/harness/skills/deck-skill");
      const { IMAGE_ARTBOARD_COMPLETION_CHECKS } = await import("../src/harness/design-craft");
      expect(input.prompt.endsWith(DECK_REVIEW_PROMPT)).toBe(true);
      expect(input.prompt.split(IMAGE_ARTBOARD_COMPLETION_CHECKS)).toHaveLength(2);
      expect(input.prompt).toContain("--deck-font-heading");
      expect(input.prompt).toContain("including every slide");
      if (reviewFails) return { exitCode: 1 };
      await writeFile(path.join(input.projectDir, "index.html"), '<section data-slide><h1>Reviewed wording</h1></section>');
    }
    return { exitCode: 0 };
  });
  await turn.promise;
  expect(calls).toBe(2);
  expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe(reviewFails ? "base" : '<section data-slide><h1>Reviewed wording</h1></section>');
});

test("Given explicit generation options When a turn runs Then the adapter receives the validated selected model and effort", async () => {
  let observed = false;
  const generation = { model: "fixture-model", effort: "high" as const, vanilla: true, provider: "native" as const };
  const turn = startUserTurn(sessionId, { type: "user.message", text: "Create", generation }, undefined, {
    detectBackends: async () => ({ backends: [{ id: "codex", found: true, binary_path: "fixture", models: [{ id: "fixture-model", label: "Fixture", efforts: ["low", "high"] }] }] }),
    runAdapter: async (_backend, input) => { expect(input.generation).toEqual(generation); observed = true; return { exitCode: 0 }; },
  });
  await turn!.promise;
  expect(observed).toBe(true);
});

test("Given a graphic project without authenticated Codex When a turn starts Then no adapter runs and the session returns to idle", async () => {
  getSqlite().prepare("UPDATE projects SET type='graphic' WHERE id=?").run(projectId);
  let invoked = false;
  const turn = start(async () => { invoked = true; return { exitCode: 0 }; });
  void turn.prepared.catch(() => {});
  await expect(turn.promise).rejects.toThrow("graphic_requires_authenticated_codex");
  expect(invoked).toBe(false);
  expect(getSqlite().query("SELECT status FROM sessions WHERE id=?").get(sessionId)).toEqual({ status: "idle" });
  expect((await inspectCanonicalTree(projectDir)).tree_digest).toBe(digest);
});

for (const failure of ["exit", "event"] as const) {
  test(`Given provider ${failure} failure after a write When generation ends Then live identity stays and no success checkpoint is written`, async () => {
    const turn = start(async (_backend, input) => {
      await writeFile(path.join(input.projectDir, "index.html"), "partial");
      if (failure === "event") await input.onEvent({ id: crypto.randomUUID(), ts: Date.now(), type: "status.error", message: "provider failed", recoverable: true });
      return { exitCode: failure === "exit" ? 1 : 0 };
    });
    await turn.promise;
    expect((await inspectCanonicalTree(projectDir)).tree_digest).toBe(digest);
    expect(getSqlite().query("SELECT status FROM artifact_operations WHERE id=?").get(turn.operationId)).toEqual({ status: "failed" });
    expect(existsSync(path.join(projectDir, ".meta", "checkpoints", `${turn.turnId}.json`))).toBe(false);
  });
}

test("Given stage writes in a running turn When interrupted Then live bytes and revision are preserved", async () => {
  let entered: () => void = () => {};
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const turn = start(async (_backend, input) => {
    await writeFile(path.join(input.projectDir, "index.html"), "cancelled");
    entered();
    await new Promise<void>((resolve) => { if (input.signal?.aborted) resolve(); else input.signal?.addEventListener("abort", () => resolve(), { once: true }); });
    return { exitCode: 0 };
  });
  await ready;
  expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe("base");
  expect(interruptUserTurn(sessionId)).toBe(true);
  await turn.promise;
  expect((await inspectCanonicalTree(projectDir)).tree_digest).toBe(digest);
  expect(getSqlite().query("SELECT current_revision FROM projects WHERE id=?").get(projectId)).toEqual({ current_revision: 0 });
});

test("Given a pending permission When decided twice Then one durable decision and a coherent snapshot are exposed", async () => {
  await insertNormalizedEvent(sessionId, { id: crypto.randomUUID(), ts: Date.now(), type: "tool.permission_required", turnId: "permission-turn", toolCallId: "permission", tool: "Bash", input: {} });
  const request = () => sessionRoutes.request(`/api/sessions/${sessionId}/tool-decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ toolCallId: "permission", decision: "allow" }) });
  expect((await request()).status).toBe(200);
  expect((await request()).status).toBe(409);
  const response = await sessionRoutes.request(`/api/sessions/${sessionId}/snapshot`);
  const body = await response.json();
  expect(body.data.pending_permissions).toEqual([]);
  expect(body.data.session.id).toBe(sessionId);
  expect(getSqlite().query("SELECT COUNT(*) value FROM events WHERE session_id=? AND type='tool.permission_decided'").get(sessionId)).toEqual({ value: 1 });
});

test("Given a real child tree continuously writing When its output callback fails Then the owned tree exits before failure returns", async () => {
  const script = `const child=Bun.spawn([process.execPath,'-e','setInterval(()=>{},1000)'],{stdin:'ignore',stdout:'ignore',stderr:'ignore'}); console.log(child.pid); setInterval(()=>process.stdout.write('x'.repeat(65536)),1);`;
  const proc = Bun.spawn({ cmd: [process.execPath, "-e", script], stdout: "pipe", stderr: "pipe", ...ownedProcessSpawnOptions() });
  let childPid = 0;
  const stdout = (async () => {
    const reader = proc.stdout.getReader();
    let text = "";
    try {
      while (!text.includes("\n")) {
        const part = await reader.read();
        if (part.done) throw new Error("fixture exited early");
        text += new TextDecoder().decode(part.value);
      }
      childPid = Number(text.split("\n")[0]);
      throw new Error("injected event persistence failure");
    } finally { reader.releaseLock(); }
  })();
  const stderr = new Response(proc.stderr).text().then(() => {});
  try {
    await expect(settleProcessStreams(proc, [stdout, stderr])).rejects.toThrow("injected event persistence failure");
    expect(Number.isSafeInteger(childPid) && childPid > 0).toBe(true);
    expect(() => process.kill(proc.pid, 0)).toThrow();
    expect(() => process.kill(childPid, 0)).toThrow();
  } finally {
    await closeOwnedProcessTree(proc.pid);
    if (childPid > 0) { try { process.kill(childPid, "SIGKILL"); } catch {} }
  }
}, 15_000);
