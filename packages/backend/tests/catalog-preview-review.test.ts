import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { systemsDir } from "../src/lib/paths";
import { createApp } from "../src/server";

const id = `preview-review-${process.pid}`;
const root = path.resolve(systemsDir, id);
const app = createApp({ capability: "preview-test", appAuthority: "preview.test" });
const headers = { Host: "preview.test", "x-burnguard-capability": "preview-test" };
beforeAll(async () => {
  await runMigrations();
  await mkdir(path.join(root, "preview"), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "preview", "custom.html"), '<link rel="stylesheet" href="../colors.css"><p>자료</p>'),
    writeFile(path.join(root, "preview", "not-preview.txt"), "not HTML"),
    writeFile(path.join(root, "colors.css"), "p{color:blue}"),
  ]);
  getSqlite().prepare("INSERT INTO design_systems(id,name,status,source_type,is_template,dir_path,created_at,updated_at) VALUES (?,?,'published','manual',0,?,1,1)").run(id, "한국어 미리보기", root);
});
afterAll(async () => {
  getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(id);
  if (path.dirname(root) !== path.resolve(systemsDir)) throw new Error("fixture escaped systems root");
  await rm(root, { recursive: true, force: true });
});

test("Given real preview files When the authenticated list is read Then it only lists existing HTML previews", async () => {
  const response = await app.request(`http://preview.test/api/design-systems/${id}/previews`, { headers });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: [{ path: "preview/custom.html" }] });
});

test("Given a preview iframe When checking its file and relative CSS Then authenticated HEAD and GET return real MIME and missing files stay 404", async () => {
  const base = `http://preview.test/api/design-systems/${id}/files/`;
  const head = await app.request(`${base}preview/custom.html`, { method: "HEAD", headers });
  expect(head.status).toBe(200);
  expect(head.headers.get("content-type")).toContain("text/html");
  expect(await head.text()).toBe("");
  const css = await app.request(`${base}colors.css`, { headers });
  expect(css.headers.get("content-type")).toContain("text/css");
  expect(await css.text()).toBe("p{color:blue}");
  expect((await app.request(`${base}preview/missing.html`, { method: "HEAD", headers })).status).toBe(404);
});

test("Given no preview folder When the system is listed Then the response is empty rather than sixteen broken cards", async () => {
  await rm(path.join(root, "preview", "custom.html"));
  const response = await app.request(`http://preview.test/api/design-systems/${id}/previews`, { headers });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: [] });
});
