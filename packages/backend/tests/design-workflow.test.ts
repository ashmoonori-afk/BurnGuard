import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DESIGN_AUDIT_CHECK_CODES, type DesignAuditResult, type NormalizedEvent } from "@bg/shared";
import { getSqlite } from "../src/db/sqlite-client";
import { systemsDir, projectsDir } from "../src/lib/paths";
import { createApp } from "../src/server";
import { ensureProjectDesignSystemPin, inspectProjectDesignSystemPin, readProjectDesignSystemPin } from "../src/services/project-design-system-pin";
import { reviewTurnDesign } from "../src/services/turn-design-review";
import { RenderSessionError } from "../src/services/export-render-session";

const id = `design-workflow-${process.pid}`;
const systemDir = path.join(systemsDir, id);
const projectDir = path.join(projectsDir, id);
const db = getSqlite();
const app = createApp({ capability: "workflow-test", appAuthority: "workflow.test" });
const headers = { Host: "workflow.test", Origin: "http://workflow.test", "x-burnguard-capability": "workflow-test", "content-type": "application/json" };
beforeAll(async () => {
  await mkdir(systemDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(systemDir, "colors_and_type.css"), ":root { --brand: #123456; }");
  await writeFile(path.join(systemDir, "README.md"), "# Example\n## Composition\nKeep a clear hierarchy.");
  await writeFile(path.join(projectDir, "index.html"), "<!doctype html><p>Example</p>");
  db.prepare("INSERT INTO design_systems(id,name,status,source_type,is_template,dir_path,tokens_css_path,readme_md_path,created_at,updated_at) VALUES (?,?,'published','manual',0,?,?,?,1,1)")
    .run(id, "Example", systemDir, path.join(systemDir, "colors_and_type.css"), path.join(systemDir, "README.md"));
  db.prepare("INSERT INTO projects(id,name,type,design_system_id,dir_path,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,?,'codex',1,1)").run(id, "Example", id, projectDir);
  db.prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(id, id);
});
afterAll(async () => {
  db.prepare("DELETE FROM projects WHERE id=?").run(id);
  db.prepare("DELETE FROM design_systems WHERE id=?").run(id);
  for (const [root, dir] of [[systemsDir, systemDir], [projectsDir, projectDir]]) {
    if (path.dirname(dir) !== path.resolve(root)) throw new Error("Fixture escaped");
    await rm(dir, { recursive: true, force: true });
  }
});

test("Given a pinned system When its tokens change Then only an explicit idle-project update changes the baseline", async () => {
  const first = await ensureProjectDesignSystemPin(id);
  expect(first?.context).not.toContain(systemDir);
  expect(first?.context).toContain('surface="website"');
  await writeFile(path.join(systemDir, "colors_and_type.css"), ":root { --brand: #654321; }");
  expect((await ensureProjectDesignSystemPin(id))?.digest).toBe(first?.digest);
  const proposed = await inspectProjectDesignSystemPin(id);
  expect(proposed?.tokens_changed).toBe(true);
  const url = `http://workflow.test/api/projects/${id}/design-system-pin`;
  expect((await app.request(url, { method: "POST", headers, body: "{}" })).status).toBe(400);
  expect((await app.request(url, { method: "POST", headers: { Host: "workflow.test", Origin: "http://workflow.test" }, body: "{}" })).status).toBe(403);
  const body = JSON.stringify({ expected_digest: first!.digest, candidate_digest: proposed!.candidate_digest });
  db.prepare("UPDATE sessions SET status='running' WHERE id=?").run(id);
  expect((await app.request(url, { method: "POST", headers, body })).status).toBe(409);
  db.prepare("UPDATE sessions SET status='idle' WHERE id=?").run(id);
  expect((await app.request(url, { method: "POST", headers, body })).status).toBe(200);
  expect(readProjectDesignSystemPin(id)?.revision).toBe(2);
  expect(readProjectDesignSystemPin(id)?.digest).toBe(proposed!.candidate_digest);
  expect((await app.request(url, { method: "POST", headers, body })).status).toBe(409);
});

function result(blocked: boolean): DesignAuditResult {
  return { schema_version: 1, project_id: id, artifact_revision: 1, artifact_digest: "a".repeat(64), created_at: 1,
    overall_status: blocked ? "must_fix" : "ready",
    checks: DESIGN_AUDIT_CHECK_CODES.map(code => ({ code, status: blocked && code === "text_overflow" ? "fail" : "pass", reason: null,
      findings: blocked && code === "text_overflow" ? [{ id: "overflow", check_code: code, severity: "must_fix", source: { rel_path: "index.html", node_bg_id: "text" }, evidence: "overflow", targeted_action: "expand_or_reflow_text" }] : [] })),
  };
}
function reviewInput(events: NormalizedEvent[]) {
  return { projectId: id, type: "prototype" as const, entrypoint: "index.html", revision: 1,
    adapter: { sessionId: id, turnId: id, projectDir, binaryPath: "unused", prompt: "Keep brand rules.",
      signal: new AbortController().signal, onEvent: async (event: NormalizedEvent) => { events.push(event); } },
  };
}
test("Given persistent findings When reviewing Then exactly two repairs run and the remaining failure is visible", async () => {
  let repairs = 0;
  const events: NormalizedEvent[] = [];
  const review = await reviewTurnDesign({ ...reviewInput(events), audit: async () => result(true), run: async input => {
    repairs++;
    expect(input.prompt).toContain("<design_review_findings>");
    return { exitCode: 0 };
  } });
  expect(repairs).toBe(2);
  expect(review.result?.overall_status).toBe("must_fix");
  expect(events.at(-1)).toMatchObject({ type: "tool.finished", ok: false });
});
test("Given repaired output When remeasured Then the loop stops immediately", async () => {
  let count = 0;
  const review = await reviewTurnDesign({ ...reviewInput([]), audit: async () => result(count++ === 0), run: async () => ({ exitCode: 0 }) });
  expect(review.repairs).toBe(1);
  expect(review.result?.overall_status).toBe("ready");
});
test("Given unavailable Chromium When reviewing Then no repair is charged and no success is reported", async () => {
  const events: NormalizedEvent[] = [];
  const review = await reviewTurnDesign({ ...reviewInput(events), audit: async () => { throw new RenderSessionError("chromium_not_installed", "unavailable"); }, run: async () => { throw new Error("must not run"); } });
  expect(review.status).toBe("unavailable");
  expect(review.repairs).toBe(0);
  expect(events.at(-1)).toMatchObject({ ok: false });
});
