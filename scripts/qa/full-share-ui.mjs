import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fakeToken = "LOCAL_QA_NOT_A_VERCEL_TOKEN";
const publicUrl = "https://burnguard-qa-fixture.vercel.app";

export async function run({ page, context, base, home, check }) {
  const denied = [], requests = [];
  let reply = { status: 200, body: { data: { id: "dpl_fixture", ready: false, url: publicUrl } } };
  let release, reached;
  await context.addInitScript(() => {
    if (window !== window.top) return;
    localStorage.setItem("burnguard.locale", "en");
    window.__qaClipboard = [];
    window.__qaClipboardFail = false;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async text => {
        if (window.__qaClipboardFail) throw new Error("Controlled clipboard rejection");
        window.__qaClipboard.push(text);
      },
    } });
  });
  await context.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base || (request.method() === "POST" && /\/(?:events|vercel)$/.test(url.pathname))) {
      denied.push({ method: request.method(), path: url.pathname });
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  // Page routes precede context routes. Every publication request terminates here.
  await page.route("**/api/exports/*/vercel", async route => {
    assert.equal(route.request().method(), "POST");
    requests.push(route.request().postDataJSON());
    if (reached) {
      const signal = reached;
      reached = undefined;
      const gate = new Promise(resolve => { release = resolve; });
      signal();
      await gate;
    }
    await route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) });
  });
  await page.goto(base);
  await page.getByRole("tab", { name: "Recent work", exact: true }).waitFor();
  const seeded = await promisify(execFile)("bun", [path.join(root, "scripts/qa/fixtures/full-export/seed.ts"), home], {
    cwd: root, env: { ...process.env, BG_APP_ROOT: path.join(home, ".burnguard") }, timeout: 60000,
  });
  const project = JSON.parse(seeded.stdout.trim().split("\n").at(-1)).web;
  await page.goto(`${base}/projects/${project.id}`);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const token = dialog.getByLabel("Vercel token", { exact: true });
  const publish = () => dialog.getByRole("button", { name: "Publish publicly to Vercel", exact: true });
  const response = () => page.waitForResponse(item => item.request().method() === "POST" && /\/api\/exports\/[^/]+\/vercel$/.test(new URL(item.url()).pathname));

  await check("share-ui-real-preparation", async () => {
    await dialog.getByRole("button", { name: "Prepare current output", exact: true }).click();
    await dialog.getByRole("status").filter({ hasText: /Revision \d+ ready/ }).waitFor();
    assert.equal(await publish().isDisabled(), true);
    await token.fill(` ${fakeToken} `);
    await dialog.getByLabel("Team ID (optional)", { exact: true }).fill(" team_fixture ");
    return { realLocalPreparation: true, publicDeployment: false };
  });

  for (const code of ["publish_size_limit", "publish_unsafe_asset", "publish_auth_failed", "publish_rate_limit", "publish_build_failed"]) {
    await check(`share-ui-${code}`, async () => {
      reply = { status: 400, body: { error: { code, message: "PRIVATE_PROVIDER_DETAIL" } } };
      const completed = response();
      await publish().click();
      assert.equal((await completed).status(), 400);
      await dialog.getByRole("alert").waitFor();
      assert.equal((await dialog.innerText()).includes("PRIVATE_PROVIDER_DETAIL"), false);
      assert.equal(await token.inputValue(), ` ${fakeToken} `);
      assert.equal(await publish().isEnabled(), true);
      assert.deepEqual(requests.at(-1), { token: fakeToken, team_id: "team_fixture" });
      return { syntheticProviderError: code, recoverable: true };
    }, "synthetic-publish-response");
  }

  await check("share-ui-pending-and-modal-guard", async () => {
    reply = { status: 200, body: { data: { id: "dpl_fixture", ready: false, url: publicUrl } } };
    const received = new Promise(resolve => { reached = resolve; });
    const completed = response();
    try {
      await publish().click();
      await received;
      assert.equal(await publish().isDisabled(), true);
      assert.equal(await token.isDisabled(), true);
      await page.keyboard.press("Escape");
      assert.equal(await dialog.isVisible(), true);
    } finally { release?.(); }
    await completed;
    await dialog.getByRole("button", { name: "Check deployment status", exact: true }).waitFor();
    return { syntheticAccepted: true, noExternalWrite: true };
  }, "synthetic-publish-response");

  await check("share-ui-ready-clears-token", async () => {
    reply = { status: 200, body: { data: { id: "dpl_fixture", ready: true, url: publicUrl } } };
    const completed = response();
    await dialog.getByRole("button", { name: "Check deployment status", exact: true }).click();
    await completed;
    await dialog.getByRole("link", { name: publicUrl, exact: true }).waitFor();
    assert.equal(await token.inputValue(), "");
    assert.equal(requests.at(-1).deployment_id, "dpl_fixture");
    assert.equal(await page.evaluate(value => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]).includes(value), fakeToken), false);
    return { syntheticReady: true, tokenCleared: true };
  }, "synthetic-publish-response");

  await check("share-ui-copy-success", async () => {
    await dialog.getByRole("button", { name: "Copy link", exact: true }).click();
    await dialog.getByText("Link copied.", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__qaClipboard), [publicUrl]);
    assert.equal(await dialog.getByRole("alert").count(), 0, "Successful copying is not an error alert");
    return { clipboardCallCaptured: true, realSystemClipboardUntouched: true };
  }, "synthetic-clipboard-boundary");

  await check("share-ui-copy-rejection", async () => {
    await page.evaluate(() => { window.__qaClipboardFail = true; });
    await dialog.getByRole("button", { name: "Copy link", exact: true }).click();
    await dialog.getByRole("alert").waitFor();
    assert.equal(await dialog.getByRole("link", { name: publicUrl, exact: true }).getAttribute("href"), publicUrl);
    assert.deepEqual(denied, []);
    return { clipboardRejection: true, manualLinkRetained: true, noPublicDeployment: true };
  }, "synthetic-clipboard-boundary");
}
