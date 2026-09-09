import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { createApp } from "../src/server";
import { requestBodyLimitFor } from "../src/security/request-limits";

const projectId = `documents-${crypto.randomUUID()}`;
const sessionId = `${projectId}-session`;
const origin = "http://127.0.0.1:14192";
const capability = "document-test-capability";
const app = createApp({ capability, appAuthority: "127.0.0.1:14192" });
const host = { Host: "127.0.0.1:14192" };
const headers = { ...host, Origin: origin, "X-Burnguard-Capability": capability };
let root: string;
const bytes = "%PDF-1.4\nAn original survives even when text extraction cannot read it.\n%%EOF";

beforeAll(async () => {
  await runMigrations();
  root = await mkdtemp(path.join(tmpdir(), "burnguard-documents-"));
  await writeFile(path.join(root, "index.html"), "<html><body>Project</body></html>");
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, projectId, root);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
});
afterAll(async () => {
  getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
  await rm(root, { recursive: true, force: true });
});

function upload(content = bytes) {
  const form = new FormData();
  form.append("files", new File([content], "프로젝트 자료.pdf", { type: "application/pdf" }));
  return form;
}

test("Given a picked PDF, when saved before sending, then authority is required and raw bytes persist without an AI turn", async () => {
  const url = `${origin}/api/sessions/${sessionId}/documents`;
  expect((await app.request(url, { method: "POST", headers: host, body: upload() })).status).toBe(403);
  expect(await readdir(path.join(root, "docs")).catch(() => [])).toEqual([]);
  const misleading = new FormData();
  misleading.append("files", new File([bytes], "payload.exe", { type: "application/pdf" }));
  expect((await app.request(url, { method: "POST", headers, body: misleading })).status).toBe(415);
  const responses = await Promise.all([0, 1].map(() => app.request(url, { method: "POST", headers, body: upload() })));
  for (const response of responses) expect(response.status).toBe(200);
  const result = await responses[0]!.json() as { data: { paths: string[] } };
  const relativePath = result.data.paths[0]!;
  expect(relativePath).toMatch(/^docs\/attachments\/[a-f0-9]{64}-프로젝트 자료\.pdf$/);
  expect(await readFile(path.join(root, relativePath), "utf8")).toBe(bytes);
  expect(await readdir(path.join(root, "docs/attachments"))).toHaveLength(1);
  expect(getSqlite().query<{ count: number }, [string]>("SELECT COUNT(*) count FROM attachments WHERE session_id=?").get(sessionId)?.count).toBe(0);
  expect(getSqlite().query<{ status: string }, [string]>("SELECT status FROM sessions WHERE id=?").get(sessionId)?.status).toBe("idle");
  const files = await (await app.request(`${origin}/api/projects/${projectId}/files`, { headers })).json() as { data: { rel_path: string }[] };
  expect(files.data.some((file) => file.rel_path === relativePath)).toBe(true);
  const readUrl = `${origin}/api/projects/${projectId}/fs/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
  expect((await app.request(readUrl, { headers: host })).status).toBe(403);
  const download = await app.request(readUrl, { headers });
  expect(download.status).toBe(200);
  expect(download.headers.get("cache-control")).toBe("no-store");
  expect(await download.text()).toBe(bytes);
});

test("Given another PDF with the same name, when saved, then neither original is overwritten and multipart supports files over 1MB", async () => {
  const different = `${bytes}\nA newer version`;
  const response = await app.request(`${origin}/api/sessions/${sessionId}/documents`, { method: "POST", headers, body: upload(different) });
  expect(response.status).toBe(200);
  const { data } = await response.json() as { data: { paths: string[] } };
  expect(await readFile(path.join(root, data.paths[0]!), "utf8")).toBe(different);
  expect(await readdir(path.join(root, "docs/attachments"))).toHaveLength(2);
  expect(requestBodyLimitFor(`/api/sessions/${sessionId}/documents`, "POST")).toBeGreaterThan(25 * 1024 * 1024);
});

test("Given a changed saved original, when downloaded or uploaded again, then identity checks reject it instead of replacing it", async () => {
  const name = (await readdir(path.join(root, "docs/attachments")))[0]!;
  await chmod(path.join(root, "docs/attachments", name), 0o600);
  await writeFile(path.join(root, "docs/attachments", name), "changed");
  const response = await app.request(`${origin}/api/projects/${projectId}/fs/docs/attachments/${encodeURIComponent(name)}`, { headers });
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain(root);
});
