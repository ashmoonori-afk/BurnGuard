import { describe, expect, test } from "bun:test";
import { buildSandboxedArtifactSrcDoc } from "../src/components/canvas/frame-bridge";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { launchChromiumViaNode } from "../../backend/src/services/chromium-node-launch";

const BASE_HREF = "http://127.0.0.1:14070/api/projects/p/fs/index.html";

const systemChromeAvailable = process.platform === "darwin"
  ? existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
  : process.platform === "win32"
    ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].some(root => root && existsSync(path.join(root, "Google/Chrome/Application/chrome.exe")))
    : existsSync("/opt/google/chrome/chrome");

test("both shipped Canvas frames omit native popup capability", async () => {
  const source = await readFile(new URL("../src/components/canvas/Canvas.tsx", import.meta.url), "utf8");
  const policies = [...source.matchAll(/sandbox="([^"]+)"/g)].map(match => (match[1] ?? "").split(/\s+/));
  expect(policies).toHaveLength(2);
  for (const policy of policies) expect(policy).toEqual(["allow-scripts"]);
});

for (const action of ["popup", "navigation"] as const) test.skipIf(!systemChromeAvailable)(`system Chrome Canvas ${action} policy blocks popups and preserves project links`, async () => {
  const source = await readFile(new URL("../src/components/canvas/Canvas.tsx", import.meta.url), "utf8");
  const sandbox = /sandbox="([^"]+)"/.exec(source)?.[1];
  if (sandbox === undefined) throw new Error("Canvas sandbox attribute missing");
  const requests: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) { requests.push(new URL(request.url).pathname); return new Response("<!doctype html><body></body>", { headers: { "content-type": "text/html" } }); } });
  const browser = await launchChromiumViaNode({ channel: "chrome" }, AbortSignal.timeout(20000));
  try {
    const page = await browser.newPage();
    const base = `${server.url.origin}/api/projects/p/fs/index.html`;
    await page.goto(server.url.origin);
    await page.evaluate(() => window.addEventListener("message", event => {
      if (event.source === document.querySelector("iframe")?.contentWindow && event.data?.event === "navigate") console.log(`NAVIGATE:${event.data.payload.href}`);
    }));
    const html = buildSandboxedArtifactSrcDoc(`<html><head></head><body><button id="open" onclick="document.querySelector('output').textContent = window.open('${server.url.origin}/unexpected') === null ? 'blocked' : 'opened'">Open</button><output></output><a href="next.html">Normal link</a><a target="_blank" href="other.html">Blank link</a></body></html>`, base);
    await page.evaluate(({ html, sandbox }) => new Promise<void>((resolve, reject) => {
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", sandbox);
      const timer = setTimeout(() => reject(new Error("frame_load_timeout")), 5000);
      frame.addEventListener("load", () => { clearTimeout(timer); resolve(); }, { once: true });
      frame.srcdoc = html;
      document.body.append(frame);
    }), { html, sandbox });
    const frame = page.frameLocator("iframe");
    if (action === "popup") {
      await frame.locator("#open").click();
      expect(await frame.locator("output").textContent()).toBe("blocked");
    } else for (const [name, file] of [["Normal link", "next.html"], ["Blank link", "other.html"]] as const) {
      const navigation = page.waitForEvent("console", { predicate: message => message.text() === `NAVIGATE:${new URL(file, base).href}`, timeout: 3000 });
      navigation.catch(() => {});
      await frame.getByRole("link", { name, exact: true }).click();
      await navigation;
      expect(page.context().pages()).toEqual([page]);
    }
    expect(requests).not.toContain("/unexpected");
  } finally { await browser.close(); await server.stop(true); }
}, 20000);

test.skipIf(!systemChromeAvailable)("system Chrome routes trusted external clicks with modifiers and preserves activation across postMessage", async () => {
  const compiler = Bun.spawn([process.execPath, "build", `${import.meta.dir}/fixtures/canvas-css-browser.ts`, "--target=browser", "--format=iife"], { stdout: "pipe", stderr: "pipe" });
  const [exit, script, errors] = await Promise.all([compiler.exited, new Response(compiler.stdout).text(), new Response(compiler.stderr).text()]);
  if (exit !== 0) throw new Error(errors);
  const requests: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const pathname = new URL(request.url).pathname;
    requests.push(pathname);
    return pathname === "/bridge-fixture.js"
      ? new Response(script, { headers: { "content-type": "application/javascript" } })
      : new Response('<!doctype html><body><script src="/bridge-fixture.js"></script></body>', { headers: { "content-type": "text/html" } });
  } });
  const browser = await launchChromiumViaNode({ channel: "chrome" }, AbortSignal.timeout(30_000));
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const external = `http://localhost:${server.port}/external`;
    page.setDefaultTimeout(5000);
    const html = buildSandboxedArtifactSrcDoc(`<html><head></head><body><a target="_blank" href="${external}">External link</a><a target="_blank" href="next.html">Internal link</a><a href="#target">Fragment</a><p id="target">Target</p><button onclick="document.querySelector('output').textContent = window.open('${external}') === null ? 'blocked' : 'opened'">Script popup</button><output></output><script>parent.postMessage({__bgFrameBridge:true,type:'event',event:'navigate-external',payload:{href:'${external}'}},'*');window.addEventListener('click',event=>{if(event.isTrusted)parent.postMessage({event:'click-ack'},'*')});window.addEventListener('contextmenu',event=>{if(event.isTrusted)parent.postMessage({event:'context-ack'},'*')});</script></body></html>`, `${server.url.origin}/api/projects/p/fs/index.html`);
    // page.evaluate grants test-only user activation. Mount from real page startup
    // instead, so only the native mouse clicks below can activate the parent.
    await page.addInitScript(html => window.addEventListener("DOMContentLoaded", () => {
      if (window !== window.top) return;
      const api = Reflect.get(window, "canvasCssTest");
      const opened: { url: string; target: string | undefined; features: string | undefined; active: boolean }[] = [];
      let internal = 0;
      Reflect.set(window, "capturedOpen", opened);
      window.open = (url, target, features) => {
        opened.push({ url: String(url), target, features, active: navigator.userActivation.isActive });
        console.log(`OPEN_ACK:${JSON.stringify(opened[opened.length - 1])}`);
        return null;
      };
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts");
      let loaded = false, forgedMessageReceived = false;
      const finish = () => {
        if (!loaded || !forgedMessageReceived) return;
        console.log(`EXTERNAL_READY:${JSON.stringify({ opened, active: navigator.userActivation.isActive })}`);
      };
      const received = (event: MessageEvent) => {
        if (event.source !== frame.contentWindow) return;
        if (!forgedMessageReceived && event.data?.event === "navigate-external") { forgedMessageReceived = true; finish(); }
        if (event.data?.event === "click-ack") console.log(`CLICK_ACK:${JSON.stringify({ opened, internal })}`);
        if (event.data?.event === "context-ack") console.log(`CONTEXT_ACK:${JSON.stringify({ opened, internal })}`);
      };
      window.addEventListener("message", received);
      frame.addEventListener("load", () => { loaded = true; finish(); }, { once: true });
      frame.srcdoc = html;
      document.body.append(frame);
      api.subscribeFrameEvent(frame, "navigate-external", api.openFrameExternalLink);
      api.subscribeFrameEvent(frame, "navigate", () => { internal += 1; });
    }), html);
    const ready = page.waitForEvent("console", { predicate: message => message.text().startsWith("EXTERNAL_READY:"), timeout: 5000 });
    ready.catch(() => {});
    await page.goto(server.url.origin);
    expect(JSON.parse((await ready).text().slice("EXTERNAL_READY:".length))).toEqual({ opened: [], active: false });
    const frame = page.frameLocator("iframe");
    // macOS Ctrl-left-click is an OS context-menu gesture, not link activation.
    const actions: Array<Array<"Control" | "Meta" | "Shift" | "Alt">> =
      process.platform === "darwin"
        ? [[], ["Meta"], ["Shift"], ["Alt"]]
        : [[], ["Control"], ["Meta"], ["Shift"], ["Alt"]];
    const expected: { url: string; target: string; features: string; active: boolean }[] = [];
    for (const modifiers of actions) {
      const macContextMenu =
        process.platform === "darwin" && modifiers[0] === "Control";
      const ack = page.waitForEvent("console", {
        predicate: message =>
          message.text().startsWith(macContextMenu ? "CONTEXT_ACK:" : "OPEN_ACK:"),
        timeout: 3000,
      });
      ack.catch(() => {});
      await frame.getByRole("link", { name: "External link" }).click({ modifiers });
      const result = (await ack.catch(error => { throw new Error(`External click failed for ${JSON.stringify(modifiers)}`, { cause: error }); })).text();
      // macOS Ctrl-left-click is a native context-menu gesture, not a click.
      if (macContextMenu) {
        expect(JSON.parse(result.slice("CONTEXT_ACK:".length))).toEqual({ opened: expected, internal: 0 });
        await page.keyboard.press("Escape");
        continue;
      }
      const opened = { url: external, target: "_blank", features: "noopener,noreferrer", active: true };
      expected.push(opened);
      expect(JSON.parse(result.slice("OPEN_ACK:".length))).toEqual(opened);
    }
    for (const name of ["Internal link", "Fragment"]) {
      const ack = page.waitForEvent("console", { predicate: message => message.text().startsWith("CLICK_ACK:"), timeout: 3000 });
      ack.catch(() => {});
      await frame.getByRole("link", { name, exact: true }).click();
      expect(JSON.parse((await ack).text().slice("CLICK_ACK:".length))).toEqual({ opened: expected, internal: 1 });
    }
    await page.evaluate(() => {
      const api = Reflect.get(window, "canvasCssTest");
      for (const href of ["javascript:alert(1)", "data:text/html,x", "file:///tmp/fixture", "/relative", `${location.origin}/api/settings`, `${location.origin}/%61pi/settings`, "https://user:secret@outside.invalid/"]) api.openFrameExternalLink({ href });
    });
    expect(await page.evaluate(() => Reflect.get(window, "capturedOpen"))).toEqual(expected);
    expect(page.context().pages()).toEqual([page]);
    expect(requests).not.toContain("/external");
    expect(await frame.getByRole("link", { name: "External link" }).count()).toBe(1);
  } finally {
    await context.close();
    await browser.close();
    await server.stop(true);
  }
}, 30000);

function metaPolicy(srcDoc: string): Map<string, string[]> {
  const content = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/u.exec(srcDoc)?.[1] ?? null;
  const out = new Map<string, string[]>();
  for (const part of (content ?? "").split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out.set(name, values);
  }
  return out;
}

describe("sandboxed artifact policy", () => {
  test("Given an artifact with a head When sandboxed Then the CSP meta precedes the base tag and confines network to the app origin", () => {
    const srcDoc = buildSandboxedArtifactSrcDoc("<html><head><title>t</title></head><body>x</body></html>", BASE_HREF);
    const policy = metaPolicy(srcDoc);
    expect(policy.get("connect-src")).toEqual(["http://127.0.0.1:14070"]);
    expect(policy.get("form-action")).toEqual(["'none'"]);
    expect(policy.get("frame-src")).toEqual(["https://www.google.com/maps/embed", "https://www.google.com/maps/embed/"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["http://127.0.0.1:14070"]);
    expect(srcDoc.indexOf("Content-Security-Policy")).toBeLessThan(srcDoc.indexOf("<base href"));
  });

  test("Given a bare fragment When sandboxed Then the generated head still carries the CSP meta", () => {
    const policy = metaPolicy(buildSandboxedArtifactSrcDoc("<p>fragment</p>", BASE_HREF));
    expect(policy.get("connect-src")).toEqual(["http://127.0.0.1:14070"]);
  });
});
