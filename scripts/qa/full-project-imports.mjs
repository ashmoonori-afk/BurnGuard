#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, open, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { createAttachmentFixtures } from "./fixtures/full-settings-attachments/documents.mjs";

const require = createRequire(new URL("../../packages/backend/package.json", import.meta.url));
const JSZip = require("jszip");
const { PDFDocument } = require("pdf-lib");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const encoded = name => name.split("/").map(encodeURIComponent).join("/");

// Observe the actual browser/backend response stream, never poll or trigger work via an API.
function observe(page, select, timeout = 90_000) {
  let timer, listener;
  const dispose = () => { clearTimeout(timer); page.off("response", listener); };
  const promise = new Promise((resolve, reject) => {
    listener = async response => {
      try { const value = await select(response); if (value !== undefined) { dispose(); resolve(value); } }
      catch (error) { dispose(); reject(error); }
    };
    page.on("response", listener);
    timer = setTimeout(() => { dispose(); reject(new Error("Expected browser response was not observed")); }, timeout);
  });
  // An action can fail before it consumes the subscription; retain the failure without an unhandled rejection.
  promise.catch(() => {});
  return { promise, dispose };
}

export async function run({ page, context, base, home, check, shot, evidence }) {
  const ownedHome = await realpath(home);
  assert.ok(path.basename(ownedHome).startsWith("burnguard-e2e-home-"));
  const directory = path.join(ownedHome, "project-import-fixtures");
  await mkdir(directory, { recursive: true });
  const outcomes = [], failures = [], network = [], denied = [], browserErrors = [];
  const projects = {};
  let activeCase = "setup";
  const save = (name, data) => writeFile(path.join(evidence, `${name}.json`), JSON.stringify(data, null, 2));
  const report = () => save("project-import-report", { outcomes, failures, projects, denied, browserErrors,
    assumptions: ["Next-session inventory means reopening the imported project in a fresh application mount with cleared sessionStorage; the application exposes one persisted session per project, not a new-session UI.", "Symlink and traversal cases use UNIX ZIP metadata and raw archive paths through the unmodified ZIP picker."],
    resources: { fixtures: directory, cleanup: "Runner removes its isolated profile; temporary downloads are deleted after byte inspection." } });
  const onError = error => browserErrors.push({ case: activeCase, error: String(error) });
  const onResponse = response => {
    const url = new URL(response.url());
    if (url.origin === base && (response.request().method() !== "GET" || response.status() >= 400)) {
      network.push({ case: activeCase, method: response.request().method(), path: url.pathname, status: response.status() });
    }
  };
  page.on("pageerror", onError);
  page.on("response", onResponse);
  const guard = async route => {
    const req = route.request(), url = new URL(req.url());
    if ((["http:", "https:"].includes(url.protocol) && url.origin !== base) ||
      (req.method() !== "GET" && /\/sessions\/[^/]+\/events$|\/vercel(?:\/|$)/.test(url.pathname))) {
      denied.push({ case: activeCase, method: req.method(), url: url.origin + url.pathname });
      return route.abort("blockedbyclient");
    }
    return route.continue();
  };
  await context.route("**/*", guard);
  await context.addInitScript(origin => { if (window.top === window && location.origin === origin) localStorage.setItem("burnguard.locale", "en"); }, base);
  const scenario = async (name, action) => {
    activeCase = name;
    try {
      await check(`project-import-${name}`, async () => {
        const result = await action(); outcomes.push({ name, ok: true, result }); await report(); return result;
      });
    } catch (error) {
      const failure = { name, url: page.url(), error: String(error.stack ?? error) };
      failures.push(failure); outcomes.push({ ...failure, ok: false });
      await writeFile(path.join(evidence, `${name}-dom.txt`), await page.locator("body").innerText());
      console.error(`PROJECT IMPORT BLOCKER ${JSON.stringify(failure)}`);
      await report();
    }
  };
  const data = async suffix => {
    const response = await page.request.get(base + suffix);
    assert.ok(response.ok(), `GET ${suffix}: ${response.status()} ${await response.text()}`);
    return (await response.json()).data;
  };
  const inventory = async () => {
    const rows = await data("/api/projects?tab=mine&limit=1000");
    assert.ok(Array.isArray(rows), JSON.stringify(rows));
    const names = await readdir(path.join(ownedHome, ".burnguard", "data", "projects"));
    return { ids: rows.map(row => row.id).sort(), directories: names.sort() };
  };
  const archive = async (name, entries, options = {}) => {
    const zip = new JSZip();
    for (const [filename, bytes] of Object.entries(entries)) zip.file(filename, bytes, { createFolders: false, ...options });
    const filename = path.join(directory, `${name}.zip`);
    await writeFile(filename, await zip.generateAsync({ type: "nodebuffer", platform: "UNIX", compression: "DEFLATE" }));
    return filename;
  };
  const openDialog = async (name, source = "zip") => {
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Import project", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Project name", { exact: true }).fill(name);
    await dialog.getByRole("combobox").selectOption(source);
    return dialog;
  };
  const pick = async (dialog, filename, source = "zip") => {
    const chooser = page.waitForEvent("filechooser");
    await dialog.getByLabel(source === "zip" ? "Select ZIP" : "Select folder", { exact: true }).click();
    await (await chooser).setFiles(filename);
  };
  const submit = async dialog => {
    const pending = observe(page, async response => {
      if (new URL(response.url()).pathname !== "/api/projects/import" || response.request().method() !== "POST") return;
      return { status: response.status(), body: await response.json() };
    });
    try { await dialog.getByRole("button", { name: "Import and open", exact: true }).click(); return await pending.promise; }
    finally { pending.dispose(); }
  };
  const importFile = async (name, filename, source = "zip") => {
    const dialog = await openDialog(name, source);
    await pick(dialog, filename, source);
    const response = await submit(dialog);
    await save(`${name}-import-response`, response);
    assert.equal(response.status, 201, JSON.stringify(response));
    const result = response.body.data;
    projects[name] = result;
    await page.waitForURL(`${base}/projects/${result.id}`);
    return result;
  };
  const verifyAssets = async (project, entries, entrypoint) => {
    const detail = await data(`/api/projects/${project.id}`);
    assert.equal(detail.entrypoint, entrypoint);
    const canonicalDir = path.join(ownedHome, ".burnguard", "data", "projects", project.id);
    assert.equal(await realpath(detail.dir_path), await realpath(canonicalDir));
    const inspected = [];
    for (const [name, bytes] of Object.entries(entries)) {
      const response = await page.request.get(`${base}/api/projects/${project.id}/fs/${encoded(name)}`);
      assert.equal(response.status(), 200, name);
      assert.equal(response.headers()["x-burnguard-file-hash"], digest(bytes), name);
      // HTML responses intentionally add editor IDs; canonical files and export bytes must remain exact.
      assert.deepEqual(await readFile(path.join(canonicalDir, name)), Buffer.from(bytes), name);
      if (!/\.html?$/i.test(name)) assert.deepEqual(await response.body(), Buffer.from(bytes), name);
      inspected.push({ name, sha256: digest(bytes) });
    }
    await save(`${activeCase}-canonical-assets`, { entrypoint, inspected });
    const frame = page.frameLocator('iframe[title="Canvas"]');
    await frame.locator("#import-heading").waitFor();
    const rendered = await frame.locator("body").evaluate(async body => {
      const image = body.querySelector("#import-image");
      await new Promise((resolve, reject) => {
        if (image.complete) return image.naturalWidth > 0 ? resolve() : reject(new Error("Imported image is broken"));
        const finish = (error) => { clearTimeout(timer); image.removeEventListener("load", loaded); image.removeEventListener("error", failed); error ? reject(error) : resolve(); };
        const loaded = () => finish(), failed = () => finish(new Error("Imported image failed to load"));
        const timer = setTimeout(() => finish(new Error("Imported image load timed out")), 15_000);
        image.addEventListener("load", loaded, { once: true }); image.addEventListener("error", failed, { once: true });
      });
      const background = getComputedStyle(body).backgroundImage;
      const backgroundUrl = /^url\("(.+)"\)$/.exec(background)?.[1];
      if (!backgroundUrl) throw new Error(`Missing imported background: ${background}`);
      const backgroundImage = new Image();
      backgroundImage.src = backgroundUrl;
      await backgroundImage.decode();
      return { color: getComputedStyle(body.querySelector("#import-heading")).color,
        border: getComputedStyle(body.querySelector("#import-heading")).borderTopWidth,
        imageWidth: image.naturalWidth, background,
        backgroundWidth: backgroundImage.naturalWidth,
        href: body.querySelector("#import-link").getAttribute("href") };
    });
    assert.equal(rendered.color, "rgb(18, 52, 86)");
    assert.equal(rendered.border, "3px");
    assert.equal(rendered.imageWidth, 32);
    const backgroundData = /^url\("data:image\/svg\+xml;base64,([^"]+)"\)$/.exec(rendered.background)?.[1];
    assert.ok(backgroundData, JSON.stringify(rendered));
    assert.equal(rendered.backgroundWidth, 32);
    assert.deepEqual(Buffer.from(backgroundData, "base64"), Buffer.from(entries["images/brand mark.svg"]));
    assert.equal(rendered.href, "pages/about%20us.html");
    return { detail: { id: detail.id, type: detail.type, entrypoint: detail.entrypoint, current_digest: detail.current_digest }, inspected, rendered };
  };
  const rejectArchive = async (name, filename, status, code) => {
    const before = await inventory();
    const dialog = await openDialog(name);
    await pick(dialog, filename);
    const result = await submit(dialog);
    const after = await inventory();
    await save(`${name}-rejection`, { before, after, ...result });
    assert.equal(result.status, status, JSON.stringify(result));
    assert.equal(result.body.error?.code, code, JSON.stringify(result));
    await dialog.getByRole("alert").waitFor();
    assert.deepEqual(after, before, "Rejected import must leave neither a project record nor a partial project directory");
    assert.equal(new URL(page.url()).pathname, "/");
    return { ...result, noPartialProject: true, before, after };
  };

  try {
    const fixture = await createAttachmentFixtures(path.join(directory, "documents"));
    // The shared utility also creates unrelated sparse negative fixtures. Keep only the seven originals used here.
    const originals = Object.fromEntries(["reference.pdf", "reference.pptx", "reference.docx", "reference.png"].map(name => [name, fixture.bytes[name]]));
    originals["notes.txt"] = Buffer.from("BG_IMPORT_TXT_SENTINEL\nOriginal text source.\n");
    originals["brief.md"] = Buffer.from("# BG_IMPORT_MD_SENTINEL\nOriginal Markdown source.\n");
    originals["data.csv"] = Buffer.from("key,value\nBG_IMPORT_CSV_SENTINEL,42\n");
    assert.equal((await PDFDocument.load(originals["reference.pdf"])).getPageCount(), 1);
    await rm(fixture.directory, { recursive: true });
    const assets = {
      "css/site style.css": '@import url("nested/theme%20tokens.css"); body{background-image:url("../images/brand%20mark.svg")} #import-heading{color:rgb(18,52,86)}',
      "css/nested/theme tokens.css": "#import-heading{border-top:3px solid rgb(18,52,86)}",
      "images/brand mark.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="#abcdef"/></svg>',
      "images/source image.png": originals["reference.png"],
      "pages/about us.html": '<!doctype html><html><head><link rel="stylesheet" href="../css/site%20style.css"></head><body><h1 id="nested-heading">BG_IMPORT_NESTED_SENTINEL</h1><img src="../images/source%20image.png"></body></html>',
    };
    const html = slide => `<!doctype html><html><head><meta charset="utf-8"><title>BG_IMPORT_PROJECT</title><link rel="stylesheet" href="css/site%20style.css"></head><body><section ${slide ? 'data-slide="1"' : ""}><h1 id="import-heading">BG_IMPORT_HEADING_SENTINEL</h1><img id="import-image" src="images/source%20image.png"><a id="import-link" href="pages/about%20us.html">Nested page</a></section></body></html>`;
    const web = { "index.html": html(false), ...assets };
    const deck = { "deck.html": html(true), ...assets };
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Import project", exact: true }).waitFor();

    await scenario("valid-zip-nested-encoded-assets", async () => {
      const filename = await archive("valid-zip", Object.fromEntries(Object.entries(web).map(([name, bytes]) => [`Wrapped site/${name}`, bytes])));
      const project = await importFile("valid-zip", filename);
      return verifyAssets(project, web, "index.html");
    });
    await scenario("valid-folder-nested-encoded-deck-entrypoint", async () => {
      const folder = path.join(directory, "Folder deck");
      for (const [name, bytes] of Object.entries(deck)) { await mkdir(path.dirname(path.join(folder, name)), { recursive: true }); await writeFile(path.join(folder, name), bytes); }
      const project = await importFile("valid-folder", folder, "folder");
      const result = await verifyAssets(project, deck, "deck.html");
      assert.equal(result.detail.type, "slide_deck");
      for (const [name, bytes] of Object.entries(deck)) assert.deepEqual(await readFile(path.join(folder, name)), Buffer.from(bytes), "Source folder must remain unchanged");
      return result;
    });
    await scenario("html-zip-ui-export-download-reimport-round-trip", async () => {
      const source = projects["valid-zip"];
      assert.ok(source, "Blocked by valid ZIP import failure");
      await page.goto(`${base}/projects/${source.id}`, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Export", exact: true }).click();
      const previous = new Set((await data(`/api/projects/${source.id}/exports`)).map(row => row.id));
      const terminal = observe(page, async response => {
        const pathname = new URL(response.url()).pathname;
        if (response.request().method() !== "GET" || !response.ok() || !(pathname === `/api/projects/${source.id}/exports` || /^\/api\/exports\/[^/]+$/.test(pathname))) return;
        const value = (await response.json()).data;
        return (Array.isArray(value) ? value : [value]).find(row => row.project_id === source.id && !previous.has(row.id) && ["succeeded", "failed"].includes(row.status));
      });
      const created = observe(page, async response => {
        if (new URL(response.url()).pathname === `/api/projects/${source.id}/exports` && response.request().method() === "POST") return { status: response.status(), body: await response.json() };
      });
      let job;
      try {
        await page.getByRole("menuitem", { name: "HTML ZIP file", exact: true }).click();
        const first = await created.promise;
        await save("round-trip-export-created", first);
        assert.equal(first.status, 202, JSON.stringify(first));
        job = await terminal.promise;
        await save("round-trip-export-job", job);
        assert.equal(job.id, first.body.data.id); assert.equal(job.status, "succeeded", JSON.stringify(job));
      } finally { terminal.dispose(); created.dispose(); }
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download HTML ZIP file", exact: true }).first().click();
      const download = await downloaded;
      assert.equal(await download.failure(), null);
      const filename = path.join(directory, "round-trip.zip");
      await download.saveAs(filename);
      const bytes = await readFile(filename);
      assert.equal(digest(bytes), job.latest_attempt.digests.output);
      const zip = await JSZip.loadAsync(bytes);
      const manifest = JSON.parse(await zip.file("burnguard-export.json").async("string"));
      assert.equal(manifest.entrypoint, "index.html");
      for (const [name, content] of Object.entries(web)) assert.deepEqual(await zip.file(name).async("nodebuffer"), Buffer.from(content), name);
      await download.delete();
      await shot("project-import-export-download");
      const again = await importFile("round-trip", filename);
      assert.notEqual(again.id, source.id);
      const verified = await verifyAssets(again, web, "index.html");
      assert.equal(verified.detail.current_digest, (await data(`/api/projects/${source.id}`)).current_digest);
      return { downloadSha256: digest(bytes), manifest, verified };
    });

    await scenario("valid-pdf-pptx-docx-image-txt-md-csv-originals", async () => {
      const filename = await archive("documents", { ...web, ...Object.fromEntries(Object.entries(originals).map(([name, bytes]) => [`docs/${name}`, bytes])) });
      const project = await importFile("documents", filename);
      assert.equal(project.initialization.documents, 7);
      const files = await data(`/api/projects/${project.id}/files`);
      const documents = files.filter(file => file.rel_path.startsWith("docs/attachments/"));
      await save("imported-document-inventory", documents);
      assert.equal(documents.length, 7);
      await page.getByRole("button", { name: "Design files", exact: true }).click();
      const verified = [];
      for (const [name, bytes] of Object.entries(originals)) {
        const expected = `docs/attachments/${digest(bytes)}-${name}`;
        assert.ok(documents.some(file => file.rel_path === expected), expected);
        await page.locator(`button[title=${JSON.stringify(expected)}]`).click();
        const pending = page.waitForEvent("download");
        await page.getByRole("link", { name: "Download original", exact: true }).click();
        const download = await pending;
        assert.equal(await download.failure(), null);
        assert.deepEqual(await readFile(await download.path()), bytes, name);
        await download.delete();
        verified.push({ name, path: expected, sha256: digest(bytes), bytes: bytes.length });
      }
      return { initialization: project.initialization, verified };
    });
    await scenario("document-local-initialization-no-provider-turn", async () => {
      const project = projects.documents;
      assert.ok(project, "Blocked by document import failure");
      const detail = await data(`/api/projects/${project.id}`);
      const expectedDir = path.join(ownedHome, ".burnguard", "data", "projects", project.id);
      assert.equal(await realpath(detail.dir_path), await realpath(expectedDir));
      const report = JSON.parse(await readFile(path.join(expectedDir, ".meta", "import-context.json"), "utf8"));
      await save("document-initialization", report);
      assert.deepEqual(report.documents.map(row => row.name).sort(), Object.keys(originals).sort());
      assert.equal(project.initialization.needs_review, 0, JSON.stringify(report.documents));
      assert.ok(report.documents.every(row => row.status === "ready"), JSON.stringify(report.documents));
      const snapshot = await data(`/api/sessions/${project.session_id}/snapshot`);
      assert.equal(snapshot.session.status, "idle");
      assert.equal(snapshot.session.usage.input, 0); assert.equal(snapshot.session.usage.output, 0);
      const events = await data(`/api/sessions/${project.session_id}/events`);
      await save("document-initialization-events", events);
      assert.ok(!events.some(row => row.direction === "up" || row.event?.type === "user.message"));
      assert.equal(denied.filter(row => /\/events$/.test(row.url)).length, 0);
      return { report, snapshot, noProviderTurn: true };
    });
    await scenario("next-session-document-inventory-without-provider-turn", async () => {
      const project = projects.documents;
      assert.ok(project, "Blocked by document import failure");
      const before = await data(`/api/projects/${project.id}/files`);
      // Destroy the mounted application and its sessionStorage; reuse the driver's sole page for screenshots.
      await page.goto("about:blank");
      await page.goto(base, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => sessionStorage.clear());
      await page.goto(`${base}/projects/${project.id}`, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Design files", exact: true }).click();
      for (const [name, bytes] of Object.entries(originals)) {
        const rel = `docs/attachments/${digest(bytes)}-${name}`;
        await page.locator(`button[title=${JSON.stringify(rel)}]`).waitFor();
        const response = await page.request.get(`${base}/api/projects/${project.id}/fs/${encoded(rel)}`);
        assert.equal(response.status(), 200); assert.deepEqual(await response.body(), bytes);
      }
      const after = await data(`/api/projects/${project.id}/files`);
      assert.deepEqual(after.map(row => row.rel_path).sort(), before.map(row => row.rel_path).sort());
      const snapshot = await data(`/api/sessions/${project.session_id}/snapshot`);
      assert.equal(snapshot.session.usage.input, 0); assert.equal(snapshot.session.usage.output, 0);
      return { sessionId: project.session_id, paths: after.filter(row => row.rel_path.startsWith("docs/attachments/")).map(row => row.rel_path), usage: snapshot.session.usage };
    });

    await scenario("invalid-empty-selection-no-partial-project", async () => {
      const before = await inventory();
      const dialog = await openDialog("empty-selection");
      assert.equal(await dialog.getByRole("button", { name: "Import and open", exact: true }).isDisabled(), true);
      assert.deepEqual(await inventory(), before);
      return { submitDisabled: true, noPartialProject: true };
    });
    for (const [name, entries, status, code, options] of [
      ["invalid-empty-zip", {}, 400, "project_import_entrypoint"],
      ["invalid-no-html", { "readme.txt": "BG_NO_HTML" }, 400, "project_import_entrypoint"],
      ["invalid-traversal", { "index.html": html(false), "../escape.txt": "BG_ESCAPE" }, 400, "invalid_project_import"],
      ["invalid-case-collision", { "index.html": html(false), "INDEX.html": "BG_COLLISION" }, 400, "invalid_project_import"],
      ["invalid-symlink", { "index.html": "../../outside.html" }, 400, "invalid_project_import", { unixPermissions: 0o120777 }],
    ]) await scenario(name, async () => rejectArchive(name, await archive(name, entries, options), status, code));
    await scenario("invalid-malformed-zip", async () => {
      const filename = path.join(directory, "malformed.zip");
      await writeFile(filename, Buffer.from("PK\x03\x04BG_TRUNCATED_ARCHIVE"));
      return rejectArchive("invalid-malformed-zip", filename, 400, "invalid_project_import");
    });
    await scenario("invalid-oversized-upload", async () => {
      const before = await inventory(), filename = path.join(directory, "oversized.zip");
      const file = await open(filename, "w");
      try { await file.truncate(48 * 1024 * 1024 + 1); } finally { await file.close(); }
      try {
        const dialog = await openDialog("oversized-upload");
        await pick(dialog, filename);
        await dialog.getByRole("alert").waitFor();
        assert.equal(await dialog.getByRole("button", { name: "Import and open", exact: true }).isDisabled(), true);
        assert.deepEqual(await inventory(), before);
        assert.equal(network.filter(row => row.case === activeCase && row.method === "POST" && row.path === "/api/projects/import").length, 0);
        return { bytes: 48 * 1024 * 1024 + 1, submitDisabled: true, noPartialProject: true };
      } finally { await rm(filename, { force: true }); }
    });
    await scenario("invalid-oversized-expanded-zip", async () => {
      const filename = await archive("expanded-limit", { "index.html": Buffer.alloc(128 * 1024 * 1024 + 1, 120) });
      try { return await rejectArchive("invalid-oversized-expanded-zip", filename, 413, "project_import_limit"); }
      finally { await rm(filename, { force: true }); }
    });
    await scenario("no-provider-or-public-deploy-requests", async () => {
      assert.deepEqual(denied, [], "The project import surface must not attempt provider turns, publication, or external network access");
      return { denied, browserErrors };
    });
  } finally {
    await save("project-import-network", network);
    await report();
    page.off("pageerror", onError); page.off("response", onResponse);
    await context.unroute("**/*", guard);
    await rm(directory, { recursive: true, force: true });
  }
  if (failures.length) throw new AggregateError(failures.map(row => new Error(`${row.name}: ${row.error}`)), `${failures.length} project import cases failed; see project-import-report.json`);
}
