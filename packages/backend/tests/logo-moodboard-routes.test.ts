import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseLogoMoodboardV1, type LogoMoodboardV1 } from "@bg/shared";
import { getSqlite } from "../src/db/sqlite-client";
import { runMigrations } from "../src/db/migrate-local";
import { projectsDir } from "../src/lib/paths";
import { BURNGUARD_CAPABILITY_HEADER } from "../src/security/request-authority";
import { requestBodyLimitFor } from "../src/security/request-limits";
import { createApp, classifyApiRoute } from "../src/server";
import { replaceMoodboardFingerprintForTest } from "../src/routes/logo-moodboard";

const capability = "moodboard-route-capability";
const FINGERPRINT = "0123456789abcdef";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function png(payload: string): Buffer {
  return Buffer.concat([PNG_SIGNATURE, Buffer.from(payload)]);
}

const suffix = `${process.pid}-${Date.now()}`;
const mainProject = `moodboard-main-${suffix}`;
const secondaryProject = `moodboard-secondary-${suffix}`;
const nonLogoProject = `moodboard-nonlogo-${suffix}`;
const outsideProject = `moodboard-outside-${suffix}`;
const missingProject = `moodboard-missing-${suffix}`;
const roots: string[] = [];
let outsideRoot = "";
let restoreFingerprint: () => void = () => undefined;

const app = createApp({ capability, appAuthority: "127.0.0.1:14070" });

function insertProject(id: string, type: string, dirPath: string): void {
  const db = getSqlite();
  db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,?,?,'index.html','codex',1,1)").run(id, id, type, dirPath);
  db.prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(`${id}-session`, id);
}

async function request(pathname: string, init: RequestInit = {}, authorized = true): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("host", "127.0.0.1:14070");
  headers.set("origin", "http://127.0.0.1:14070");
  if (authorized) headers.set(BURNGUARD_CAPABILITY_HEADER, capability);
  return app.request(new Request(`http://127.0.0.1:14070${pathname}`, { ...init, headers }));
}

function jsonPost(pathname: string, body: unknown): Promise<Response> {
  return request(pathname, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function jsonDelete(pathname: string, body: unknown): Promise<Response> {
  return request(pathname, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function fileUpload(bytes: Buffer, name: string, type: string, revision: unknown, extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.append("files", new File([new Uint8Array(bytes)], name, { type }));
  form.set("expected_revision", String(revision));
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}

async function board(response: Response): Promise<LogoMoodboardV1> {
  const payload: unknown = await response.json();
  const data = (payload as { data: unknown }).data;
  return parseLogoMoodboardV1(data);
}

function projectDir(id: string): string {
  return path.join(projectsDir, id);
}

beforeAll(async () => {
  await runMigrations();
  await mkdir(projectsDir, { recursive: true });
  outsideRoot = await mkdtemp(path.join(tmpdir(), "burnguard-moodboard-outside-"));
  roots.push(path.join(projectsDir, mainProject), path.join(projectsDir, secondaryProject), path.join(projectsDir, nonLogoProject), outsideRoot);
  await mkdir(projectDir(mainProject), { recursive: true });
  await mkdir(projectDir(secondaryProject), { recursive: true });
  await mkdir(projectDir(nonLogoProject), { recursive: true });
  insertProject(mainProject, "logo", projectDir(mainProject));
  insertProject(secondaryProject, "logo", projectDir(secondaryProject));
  insertProject(nonLogoProject, "prototype", projectDir(nonLogoProject));
  insertProject(outsideProject, "logo", outsideRoot);
  restoreFingerprint = replaceMoodboardFingerprintForTest(async () => FINGERPRINT);
});

afterAll(async () => {
  restoreFingerprint();
  const db = getSqlite();
  for (const id of [mainProject, secondaryProject, nonLogoProject, outsideProject]) {
    db.prepare("DELETE FROM sessions WHERE project_id=?").run(id);
    db.prepare("DELETE FROM projects WHERE id=?").run(id);
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("logo moodboard routes", () => {
  test("Given the route family When classified Then it owns its paths, multipart ceiling, and no generic project fallthrough", () => {
    expect(classifyApiRoute(`/api/projects/${mainProject}/logo/moodboard`, "GET")).toBe("logo-moodboard");
    expect(classifyApiRoute(`/api/projects/${mainProject}/logo/moodboard/links`, "POST")).toBe("logo-moodboard");
    expect(classifyApiRoute(`/api/projects/${mainProject}/logo/moodboard/items/abc`, "DELETE")).toBe("logo-moodboard");
    expect(classifyApiRoute(`/api/projects/${mainProject}/logo/moodboard/files/abc`, "GET")).toBe("logo-moodboard");
    expect(requestBodyLimitFor(`/api/projects/${mainProject}/logo/moodboard/files`, "POST")).toBe(64 * 1024 * 1024);
    expect(requestBodyLimitFor(`/api/projects/${mainProject}/logo/moodboard/links`, "POST")).toBe(1024 * 1024);
  });

  test("Given an authorized caller When the board is read Then the canonical empty board is returned", async () => {
    const response = await request(`/api/projects/${mainProject}/logo/moodboard`);
    expect(response.status).toBe(200);
    expect(await board(response)).toEqual({ schema_version: 1, revision: 0, digest: expect.any(String), items: [] });
  });

  test("Given a missing capability When the board is read Then the global authority refuses it without exemption", async () => {
    const response = await request(`/api/projects/${mainProject}/logo/moodboard`, {}, false);
    expect(response.status).toBe(403);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("forbidden");
  });

  test("Given a logo project When files, links and removal are driven Then each revisioned mutation persists and the raw file serves its exact bytes", async () => {
    const bytes = png("reference-bytes");
    const upload = await request(`/api/projects/${mainProject}/logo/moodboard/files`, { method: "POST", body: fileUpload(bytes, "mark.png", "image/png", 0) });
    expect(upload.status).toBe(200);
    const afterUpload = await board(upload);
    expect(afterUpload.revision).toBe(1);
    const fileItem = afterUpload.items[0];
    if (fileItem?.kind !== "file") throw new TypeError("expected a file item");
    expect(fileItem.mime_type).toBe("image/png");
    expect(fileItem.size_bytes).toBe(bytes.byteLength);
    expect(fileItem.original_name).toBe("mark.png");
    expect(fileItem.fingerprint).toBe(FINGERPRINT);

    const raw = await request(`/api/projects/${mainProject}/logo/moodboard/files/${fileItem.id}`);
    expect(raw.status).toBe(200);
    expect(raw.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await raw.arrayBuffer()).equals(bytes)).toBe(true);
    expect((await request(`/api/projects/${mainProject}/logo/moodboard/files/${"0".repeat(64)}`)).status).toBe(404);

    const link = await jsonPost(`/api/projects/${mainProject}/logo/moodboard/links`, { url: "https://Example.com:443/pin/1", expected_revision: 1 });
    expect(link.status).toBe(200);
    const afterLink = await board(link);
    expect(afterLink.revision).toBe(2);
    expect(afterLink.items.find((item) => item.kind === "link")).toMatchObject({ url: "https://example.com/pin/1" });

    const removed = await jsonDelete(`/api/projects/${mainProject}/logo/moodboard/items/${fileItem.id}`, { expected_revision: 2 });
    expect(removed.status).toBe(200);
    const afterRemove = await board(removed);
    expect(afterRemove.revision).toBe(3);
    expect(afterRemove.items.some((item) => item.id === fileItem.id)).toBe(false);

    const stale = await jsonPost(`/api/projects/${mainProject}/logo/moodboard/links`, { url: "https://example.com/pin/2", expected_revision: 0 });
    expect(stale.status).toBe(409);
    expect((await stale.json() as { error: { code: string } }).error.code).toBe("moodboard_conflict");
  });

  test("Given invalid bodies, revisions and unknown fields When mutations run Then every one is refused with 400", async () => {
    const files = `/api/projects/${secondaryProject}/logo/moodboard/files`;
    const links = `/api/projects/${secondaryProject}/logo/moodboard/links`;
    const item = `/api/projects/${secondaryProject}/logo/moodboard/items/${"a".repeat(64)}`;

    for (const body of [
      {},
      { url: "https://example.com/pin/1" },
      { url: "https://example.com/pin/1", expected_revision: -1 },
      { url: "https://example.com/pin/1", expected_revision: 1.5 },
      { url: "https://example.com/pin/1", expected_revision: "1" },
      { url: 42, expected_revision: 0 },
      { url: "https://example.com/pin/1", expected_revision: 0, extra: true },
    ]) {
      expect((await jsonPost(links, body)).status).toBe(400);
    }

    for (const body of [{}, { expected_revision: "0" }, { expected_revision: 0, extra: true }, { expected_revision: null }]) {
      expect((await jsonDelete(item, body)).status).toBe(400);
    }

    expect((await request(files, { method: "POST", body: fileUpload(png("x"), "mark.png", "image/png", "not-a-number") })).status).toBe(400);
    expect((await request(files, { method: "POST", body: fileUpload(png("x"), "mark.png", "image/png", 0, { unexpected: "1" }) })).status).toBe(400);
    const noFile = new FormData();
    noFile.set("expected_revision", "0");
    expect((await request(files, { method: "POST", body: noFile })).status).toBe(400);
    expect((await request(files, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(400);
  });

  test("Given unknown, non-logo or out-of-storage projects When the board is read Then it is refused without leaking a path", async () => {
    const unknown = await request(`/api/projects/${missingProject}/logo/moodboard`);
    expect(unknown.status).toBe(404);
    expect((await unknown.json() as { error: { code: string } }).error.code).toBe("project_session_not_found");

    const nonLogo = await request(`/api/projects/${nonLogoProject}/logo/moodboard`);
    expect(nonLogo.status).toBe(404);
    expect((await nonLogo.json() as { error: { code: string } }).error.code).toBe("moodboard_not_found");

    const outside = await request(`/api/projects/${outsideProject}/logo/moodboard`);
    expect(outside.status).toBe(503);
    const body = await outside.json();
    expect((body as { error: { code: string } }).error.code).toBe("project_path_unavailable");
    expect(JSON.stringify(body)).not.toContain(outsideRoot);
    expect((await request(`/api/projects/${outsideProject}/logo/moodboard/links`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://example.com/pin/1", expected_revision: 0 }) })).status).toBe(503);
  });

  test("Given a running user turn When a mutation is attempted Then it answers 409 but reads still succeed", async () => {
    getSqlite().prepare("UPDATE sessions SET status='running' WHERE project_id=?").run(secondaryProject);
    try {
      const read = await request(`/api/projects/${secondaryProject}/logo/moodboard`);
      expect(read.status).toBe(200);
      const link = await jsonPost(`/api/projects/${secondaryProject}/logo/moodboard/links`, { url: "https://example.com/pin/1", expected_revision: 0 });
      expect(link.status).toBe(409);
      expect((await link.json() as { error: { code: string } }).error.code).toBe("session_busy");
      const upload = await request(`/api/projects/${secondaryProject}/logo/moodboard/files`, { method: "POST", body: fileUpload(png("busy"), "mark.png", "image/png", 0) });
      expect(upload.status).toBe(409);
      const remove = await jsonDelete(`/api/projects/${secondaryProject}/logo/moodboard/items/${"a".repeat(64)}`, { expected_revision: 0 });
      expect(remove.status).toBe(409);
    } finally {
      getSqlite().prepare("UPDATE sessions SET status='idle' WHERE project_id=?").run(secondaryProject);
    }
  });
});
