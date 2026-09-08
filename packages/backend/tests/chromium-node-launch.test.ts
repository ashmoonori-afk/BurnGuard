import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { chromiumNodeCommand } from "../src/services/chromium-node-launch";
import { launchChromium, openRenderSession } from "../src/services/export-render-session";
import { resetChromiumCapability } from "../src/services/chromium-capability";
import { playwrightInstallCommand } from "../src/services/playwright-install";
import { version } from "playwright-core/package.json";

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
