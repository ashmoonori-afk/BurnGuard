import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { chromiumNodeCommand, launchChromiumViaNode } from "../src/services/chromium-node-launch";
import { launchChromium, openRenderSession } from "../src/services/export-render-session";
import { resetChromiumCapability } from "../src/services/chromium-capability";
import { playwrightInstallCommand } from "../src/services/playwright-install";
import { version } from "playwright-core/package.json";
import { loadProjectThumbnail } from "../src/services/project-thumbnails";
import { getSqlite } from "../src/db/sqlite-client";
import { projectsDir } from "../src/lib/paths";
import { parsePng } from "../src/services/export-png-validation";

const systemChromeAvailable = process.platform === "darwin"
  ? existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
  : process.platform === "win32"
    ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].some(root => root && existsSync(path.join(root, "Google/Chrome/Application/chrome.exe")))
    : existsSync("/opt/google/chrome/chrome");

test.skipIf(!systemChromeAvailable)("system Chrome confines popup requests and closes extra pages while retaining staged files and the deck runtime", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-popup-policy-"));
  const stagedDir = path.join(root, "artifact");
  const requests: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) { requests.push(request.url); return new Response("fixture"); } });
  let browser: Awaited<ReturnType<typeof launchChromiumViaNode>> | undefined;
  try {
    browser = await launchChromiumViaNode({ channel: "chrome" }, AbortSignal.timeout(20000));
    await mkdir(stagedDir);
    await writeFile(path.join(root, "outside.html"), "OUTSIDE_FIXTURE");
    await writeFile(path.join(stagedDir, "inside.js"), "window.insideLoaded = true;");
    const contexts = spyOn(browser, "newContext");
    await writeFile(path.join(stagedDir, "deck.html"), `<!doctype html><html><head><script src="inside.js"></script><script defer src="/runtime/deck-stage.js"></script></head><body><section data-slide style="width:640px;height:480px"><script>window.popupResults=[]</script><button id="remote" onclick="popupResults.push(window.open('${server.url.origin}/popup')===null)">Remote popup</button><button id="file" onclick="popupResults.push(window.open('${pathToFileURL(path.join(root, "outside.html")).href}')===null)">File popup</button><button id="blank" onclick="popupResults.push(window.open('about:blank')===null)">Blank popup</button><a id="blank-link" target="_blank" href="${server.url.origin}/anchor-popup">Blank link</a></section></body></html>`);
    const session = await openRenderSession({ stagedDir, entrypoint: "deck.html", viewport: { width: 640, height: 480, dpr: 1 }, deck: true, strict: false, signal: AbortSignal.timeout(20000), browser });
    try {
      expect(await session.page.evaluate(() => Reflect.get(window, "insideLoaded"))).toBe(true);
      expect(contexts).toHaveBeenCalledWith(expect.objectContaining({ serviceWorkers: "block" }));
      contexts.mockRestore();
      expect(session.findings).toEqual([]);
      // Exercise HTTP/file findings independently: a popup can be closed before
      // its first route is dispatched, and must not be kept alive just to log it.
      for (const url of [`${server.url.origin}/resource`, pathToFileURL(path.join(root, "outside.html")).href]) {
        await session.page.evaluate(url => new Promise<void>((resolve, reject) => {
          const image = new Image();
          const timer = setTimeout(() => reject(new Error("image_event_timeout")), 3000);
          image.onload = image.onerror = () => { clearTimeout(timer); resolve(); };
          image.src = url;
        }), url);
      }
      for (const id of ["remote", "file", "blank"]) {
        await session.page.locator(`#${id}`).click();
        expect(requests).toEqual([]);
        expect(session.context.pages()).toEqual([session.page]);
      }
      await session.page.locator("#blank-link").click();
      expect(
        await session.page.evaluate(() => Reflect.get(window, "popupResults")),
      ).toEqual([true, true, true]);
      expect(requests).toEqual([]);
      expect(session.context.pages()).toEqual([session.page]);
      expect(session.findings).toContainEqual({ code: "remote_request", path: `${server.url.origin}/resource` });
      expect(session.findings).toContainEqual({ code: "remote_request", path: "file:outside-artifact" });
      expect(JSON.stringify(session.findings)).not.toContain(root);
    } finally { await session.close(); }
  } finally { await browser?.close(); await server.stop(true); await rm(root, { recursive: true, force: true }); }
}, 30000);

for (const surface of ["export", "thumbnail"] as const) test.skipIf(!systemChromeAvailable)(`system Chrome ${surface} denies WebSockets before any upstream connection`, async () => {
  await mkdir(projectsDir, { recursive: true });
  const root = await mkdtemp(path.join(projectsDir, "bg-websocket-policy-"));
  const id = path.basename(root);
  const upgrades: string[] = [];
  const httpRequests: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
    fetch(request) {
      if (request.headers.get("upgrade") === "websocket") { upgrades.push(request.url); return new Response("upstream_reached", { status: 403 }); }
      httpRequests.push(request.url); return new Response("fixture");
    },
  });
  const socketUrl = `ws://127.0.0.1:${server.port}/socket?private=fixture`;
  const previousDeadline = process.env.BG_THUMBNAIL_RESPONSE_DEADLINE_MS;
  try {
    await writeFile(path.join(root, "local.js"), "window.localAssetLoaded=true");
    await writeFile(path.join(root, "index.html"), `<!doctype html><html><head><script src="local.js"></script></head><body style="background:#123456;color:white"><h1>Local render</h1><script>window.socketSettled=new Promise((resolve,reject)=>{const socket=new WebSocket('${socketUrl}');const timer=setTimeout(()=>reject(new Error('socket_event_timeout')),5000);socket.onclose=event=>{clearTimeout(timer);resolve(event.code)};});</script></body></html>`);
    if (surface === "export") {
      const browser = await launchChromiumViaNode({ channel: "chrome" }, AbortSignal.timeout(20000));
      try {
        const session = await openRenderSession({ stagedDir: root, entrypoint: "index.html", viewport: { width: 640, height: 360, dpr: 1 }, deck: false, strict: false, signal: AbortSignal.timeout(15000), browser });
        try {
          const code = await session.page.evaluate(() => Reflect.get(window, "socketSettled"));
          expect(code).toBe(1008);
          expect(upgrades).toEqual([]);
          expect(await session.page.evaluate(() => Reflect.get(window, "localAssetLoaded"))).toBe(true);
          expect(session.findings).toContainEqual({ code: "remote_request", path: `ws://127.0.0.1:${server.port}/socket` });
          expect(parsePng(new Uint8Array(await session.page.screenshot()))).toEqual({ width: 640, height: 360 });
        } finally { await session.close(); }
      } finally { await browser.close(); }
    } else {
      // Exercise the actual thumbnail default renderer, not an injected image writer.
      process.env.BG_THUMBNAIL_RESPONSE_DEADLINE_MS = "30000";
      const now = Date.now();
      getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at,current_revision,current_digest) VALUES (?,?,'prototype',?,'index.html','codex',?,?,1,?)").run(id, id, root, now, now, "a".repeat(64));
      const blocked = await loadProjectThumbnail(id);
      expect(upgrades).toEqual([]);
      expect(blocked).toEqual({ kind: "unavailable", code: "thumbnail_unavailable" });
      await writeFile(path.join(root, "index.html"), '<!doctype html><html><head><script src="local.js"></script></head><body style="background:#123456;color:white"><h1>Local render</h1></body></html>');
      const local = await loadProjectThumbnail(id);
      expect(local.kind).toBe("ready");
      if (local.kind !== "ready") throw new Error("local thumbnail missing");
      expect(parsePng(local.bytes)).toEqual({ width: 640, height: 360 });
    }
    expect(httpRequests).toEqual([]);
  } finally {
    if (previousDeadline === undefined) delete process.env.BG_THUMBNAIL_RESPONSE_DEADLINE_MS; else process.env.BG_THUMBNAIL_RESPONSE_DEADLINE_MS = previousDeadline;
    getSqlite().prepare("DELETE FROM projects WHERE id=?").run(id);
    await server.stop(true); await rm(root, { recursive: true, force: true });
  }
}, 60000);

test("Given the app browser installer When its local CLI reports its version Then no package manager or unpinned download is required", async () => {
  const command = playwrightInstallCommand();
  expect(command.slice(2)).toEqual(["install", "chromium"]);
  const child = Bun.spawn([...command.slice(0, 2), "--version"], { stdout: "pipe", stderr: "pipe" });
  expect(await child.exited).toBe(0);
  expect((await new Response(child.stdout).text()).trim()).toBe(`Version ${version}`);
});

test.skipIf(process.env.BG_BROWSER_SMOKE !== "1")("Given the installed Node browser runtime When Chromium connects and closes Then local content renders without a Bun child handshake", async () => {
  expect(chromiumNodeCommand()).not.toBeNull();
  resetChromiumCapability();
  try {
    const browser = await launchChromium(AbortSignal.timeout(30000));
    try {
      const page = await browser.newPage();
      await page.setContent('<html><body><h1 id="title">Local rendering</h1></body></html>');
      expect(await page.locator("#title").textContent()).toBe("Local rendering");
      const screenshot = await page.screenshot();
      expect(screenshot.byteLength).toBeGreaterThan(100);
    } finally { await browser.close(); }
  } finally {
    resetChromiumCapability();
  }
}, 60000);

test.skipIf(process.env.BG_BROWSER_SMOKE !== "1")("Given dynamic file resources When rendering an artifact Then inside assets load and outside files are blocked without private paths in findings", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-browser-files-"));
  const stagedDir = path.join(root, "artifact");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>';
  try {
    await mkdir(stagedDir);
    await writeFile(path.join(stagedDir, "inside.svg"), svg);
    await writeFile(path.join(root, "outside.svg"), svg);
    const outside = pathToFileURL(path.join(root, "outside.svg")).href;
    await writeFile(path.join(stagedDir, "index.html"), `<html><body><img id="inside" src="inside.svg"><img id="outside" src="${outside}"></body></html>`);
    const session = await openRenderSession({ stagedDir, entrypoint: "index.html", viewport: { width: 320, height: 200, dpr: 1 }, deck: false, strict: false, signal: AbortSignal.timeout(45000) });
    try {
      expect(await session.page.locator("#inside").evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(16);
      expect(await session.page.locator("#outside").evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(0);
      expect(session.findings).toContainEqual({ code: "remote_request", path: "file:outside-artifact" });
      expect(JSON.stringify(session.findings)).not.toContain(root);
    } finally { await session.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
