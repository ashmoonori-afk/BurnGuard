import { expect, test } from "bun:test";
import { launchChromiumViaNode } from "../../backend/src/services/chromium-node-launch";

declare global { var userMessageState: { reverted: string[]; nativeConfirms: number }; var mountUserMessage: (turnId: string) => void }

test("Given a revert handler and a webview whose native confirm answers Cancel When revert is requested Then an in-app dialog decides and only confirming reverts", async () => {
  const compiler = Bun.spawn([process.execPath, "build", `${import.meta.dir}/fixtures/user-message-browser.ts`, "--target=browser", "--format=iife"], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, script, errors] = await Promise.all([compiler.exited, new Response(compiler.stdout).text(), new Response(compiler.stderr).text()]);
  if (exitCode !== 0) throw new Error(`User message fixture bundle failed (${exitCode}): ${errors}`);
  const browser = await launchChromiumViaNode({}, AbortSignal.timeout(30_000));
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: script });
    await page.evaluate(() => globalThis.mountUserMessage("turn-1"));
    const revert = page.locator('[data-qa="turn-revert"]');
    const dialog = page.locator('[data-qa="revert-confirm"]');

    await revert.click();
    await dialog.waitFor({ state: "visible" });
    await dialog.locator('[data-qa="revert-cancel"]').click();
    await dialog.waitFor({ state: "detached" });
    expect(await page.evaluate(() => globalThis.userMessageState.reverted)).toEqual([]);

    await revert.click();
    await dialog.locator('[data-qa="revert-accept"]').click();
    await dialog.waitFor({ state: "detached" });
    expect(await page.evaluate(() => ({ ...globalThis.userMessageState }))).toEqual({ reverted: ["turn-1"], nativeConfirms: 0 });
  } finally {
    await browser.close();
  }
}, 30_000);
