import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { importProject } from "../src/services/project-import";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { getProjectDetail } from "../src/db/project-read-repository";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { createApp } from "../src/server";
import { enqueueProjectExport } from "../src/services/exports";
import { getExportJob } from "../src/db/exports";
import { sequencedBroker } from "../src/services/broker";

const created: { id: string; dir: string }[] = [];
beforeAll(runMigrations);
afterAll(async () => { for (const project of created) { getSqlite().query("DELETE FROM projects WHERE id=?").run(project.id); await rm(project.dir, { recursive: true, force: true }); } });
async function zipForm(files: Record<string, string>, name = "한국흑연") {
  const zip = new JSZip(); for (const [name, content] of Object.entries(files)) zip.file(name, content);
  const form = new FormData(); form.set("name", name); form.set("source", "zip"); form.set("files", new File([await zip.generateAsync({ type: "uint8array" })], "project.zip")); return form;
}
async function track(form: FormData) {
  const result = await importProject(form); const project = await getProjectDetail(result.id); if (!project) throw new Error("missing project"); created.push({ id: result.id, dir: project.dir_path }); return { result, project };
}

test("Given an exported Korean multipage website When imported, exported and imported again Then CSS, images, subpages and canonical authority survive without AI", async () => {
  const html = '<!doctype html><html><head><link rel="stylesheet" href="css/site.css"></head><body><h1>한국흑연</h1><img src="images/logo.svg"><a href="회사/소개.html">소개</a></body></html>';
  const { result, project } = await track(await zipForm({ "한국흑연/index.html": html, "한국흑연/css/site.css": "h1{color:red}", "한국흑연/images/logo.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>', "한국흑연/회사/소개.html": "소개" }));
  expect(await readFile(path.join(project.dir_path, "index.html"), "utf8")).toBe(html);
  expect(project.current_digest).toBe((await inspectCanonicalTree(project.dir_path)).tree_digest);
  expect(result).not.toHaveProperty("dir_path");
  const terminal = new Promise<void>((resolve, reject) => { const timer = setTimeout(() => { stop(); reject(new Error("export timeout")); }, 30000); const stop = sequencedBroker.subscribe(result.session_id, event => { if (event.event.type === "export.attempt" && ["validated", "failed"].includes(event.event.status)) { clearTimeout(timer); stop(); resolve(); } }); });
  const job = await enqueueProjectExport(result.id, "html_zip", {}); await terminal;
  const exported = await getExportJob(job!.id); expect(exported?.status).toBe("succeeded");
  const form = new FormData(); form.set("name", "재가져오기"); form.set("source", "zip"); form.set("files", new File([await readFile(exported!.output_path!)], "export.zip"));
  const again = await track(form);
  expect(await readFile(path.join(again.project.dir_path, "회사/소개.html"), "utf8")).toBe("소개");
  expect(again.project.current_digest).toBe(project.current_digest);
}, 60000);

test("Given a folder selection When imported Then relative paths and the deck entrypoint are retained", async () => {
  const form = new FormData(); form.set("name", "슬라이드"); form.set("source", "folder");
  form.append("files", new File(['<section data-slide>slide</section>'], "deck.html")); form.append("paths", "내 폴더/deck.html");
  const { project } = await track(form); expect(project.type).toBe("slide_deck"); expect(project.entrypoint).toBe("deck.html");
});

test("Given unsafe archives When imported Then traversal, case collisions and missing HTML fail without creating projects", async () => {
  const count = () => getSqlite().query<{ count: number }, []>("SELECT count(*) as count FROM projects").get()!.count;
  const before = count();
  for (const files of [{ "../index.html": "bad" }, { "index.html": "ok", "INDEX.html": "collision" }, { "index.html": "ok", ".env": "secret" }, { "readme.txt": "no HTML" }]) await expect(importProject(await zipForm(files))).rejects.toThrow();
  expect(count()).toBe(before);
});

test("Given import requests without launch authority When submitted Then the shared API gate denies them", async () => {
  const app = createApp({ capability: "import-test", appAuthority: "127.0.0.1:14070" });
  const response = await app.request(new Request("http://127.0.0.1:14070/api/projects/import", { method: "POST", headers: { host: "127.0.0.1:14070", origin: "http://127.0.0.1:14070" }, body: await zipForm({ "index.html": "ok" }) }));
  expect(response.status).toBe(403);
});

test("Given symlinks or highly compressed oversized content When imported Then extraction is rejected", async () => {
  for (const kind of ["symlink", "oversized"]) {
    const zip = new JSZip();
    zip.file("index.html", kind === "oversized" ? "x".repeat(128 * 1024 * 1024 + 1) : "outside", kind === "symlink" ? { unixPermissions: 0o120777 } : {});
    const form = new FormData(); form.set("name", "unsafe"); form.set("source", "zip");
    form.set("files", new File([await zip.generateAsync({ type: "uint8array", platform: "UNIX", compression: "DEFLATE" })], "unsafe.zip"));
    await expect(importProject(form)).rejects.toThrow();
  }
}, 60000);
