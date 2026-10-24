import { afterAll, beforeAll, expect, test } from "bun:test";
import path from "node:path";
import type { CatalogDesignSystemDetail, ProjectDesignSystemPin } from "@bg/shared";
import type { Browser, BrowserContext, Page } from "../../backend/node_modules/playwright-core";
import { launchChromiumViaNode } from "../../backend/src/services/chromium-node-launch";
import type {} from "./fixtures/design-system-pin-browser";

const oldDigest = "a".repeat(64);
const nextDigest = "b".repeat(64);
const pinPath = "/api/projects/pin-project/design-system-pin";
const systemPath = "/api/design-systems/pin-system";
const system = {
  id: "pin-system", name: "Pin fixture", description: null, status: "published",
  source_type: "manual", source_uri: null, dir_path: "pin-system",
  skill_md_path: null, tokens_css_path: "pin-system/colors_and_type.css", readme_md_path: null,
  archived_at: null, is_template: false, thumbnail_path: null, kind: "design-system",
  owner: "local", lifecycle: "active", provenance: "observed", license: "declared",
  tags: [], metadata_revision: 1, content: { revision: 1, receipt_id: null, digest: oldDigest },
  lineage: null, preview: null, usage: [], warning: null, created_at: 1, updated_at: 1,
} satisfies CatalogDesignSystemDetail;
let browser: Browser | undefined;
let script = "";
let css = "";
const lifetime = new AbortController();

async function compile(command: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [exit, output, errors] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  if (exit !== 0) throw new Error(`pin_fixture_compile_failed: ${errors}`);
  return output;
}

beforeAll(async () => {
  const frontend = path.resolve(import.meta.dir, "..");
  [script, css] = await Promise.all([
    compile([process.execPath, "build", `${import.meta.dir}/fixtures/design-system-pin-browser.tsx`, "--target=browser", "--format=iife"], frontend),
    compile([process.execPath, Bun.resolveSync("tailwindcss/lib/cli.js", frontend), "-i", "src/index.css", "-c", "tailwind.config.ts", "--minify"], frontend),
  ]);
  browser = await launchChromiumViaNode({}, lifetime.signal);
}, 60_000);

afterAll(async () => {
  try { await browser?.close(); }
  finally { lifetime.abort(); }
});

type Fixture = {
  readonly page: Page;
  readonly releaseRefresh: () => void;
  readonly pinReads: () => number;
  readonly applied: unknown[];
};

async function withFixture(
  options: { readonly width?: number; readonly rejectSave?: boolean; readonly rejectRefresh?: boolean },
  action: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  if (!browser) throw new Error("pin_fixture_browser_missing");
  const refresh = Promise.withResolvers<void>();
  const applied: unknown[] = [];
  let pinReads = 0;
  let value = "#112233";
  let candidate = oldDigest;
  let pin: ProjectDesignSystemPin = {
    revision: 1, digest: oldDigest, candidate_digest: oldDigest,
    rules_changed: false, tokens_changed: false, rules_only_changed: false,
  };
  const tokens = () => ({ colors: [{ name: "primary", value }], token_file_path: system.tokens_css_path });
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/") return new Response(`<!doctype html><html><head><style>${css}</style></head><body><div id="root"></div></body></html>`, { headers: { "content-type": "text/html" } });
      if (pathname === "/api/bootstrap") return Response.json({ data: { capability: "pin-fixture" } });
      if (pathname === systemPath) return Response.json({ data: system });
      if (pathname === `${systemPath}/tokens`) return Response.json({ data: tokens() });
      if (pathname === `${systemPath}/previews`) return Response.json({ data: [] });
      if (pathname === `${systemPath}/colors` && request.method === "PATCH") {
        if (options.rejectSave) return Response.json({ error: { code: "invalid_color_value", message: "invalid" } }, { status: 400 });
        const body: unknown = await request.json();
        if (!body || typeof body !== "object" || !("value" in body) || typeof body.value !== "string") return new Response(null, { status: 400 });
        value = body.value;
        candidate = nextDigest;
        return Response.json({ data: tokens() });
      }
      if (pathname === pinPath) {
        if (request.method === "POST") {
          applied.push(await request.json());
          pin = { ...pin, revision: 2, digest: candidate };
        } else {
          pinReads += 1;
          if (pinReads > 1) {
            await refresh.promise;
            if (options.rejectRefresh) return Response.json({ error: { code: "pin_unavailable", message: "unavailable" } }, { status: 503 });
          }
        }
        return Response.json({ data: { ...pin, candidate_digest: candidate, tokens_changed: pin.digest !== candidate } });
      }
      return new Response(null, { status: 404 });
    },
  });
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({ viewport: { width: options.width ?? 1440, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(server.url.origin);
    await page.addScriptTag({ content: script });
    await page.evaluate(() => globalThis.designSystemPinTest.mount());
    await page.locator("[data-pin-banner] > div").waitFor();
    await action({ page, applied, pinReads: () => pinReads, releaseRefresh: () => refresh.resolve() });
  } finally {
    refresh.resolve();
    try { await context?.close(); }
    finally { await server.stop(true); }
  }
}

async function prepareColor(page: Page): Promise<string> {
  const labels = await page.evaluate(() => globalThis.designSystemPinTest.labels());
  await page.getByRole("button", { name: labels.edit, exact: true }).click();
  await page.locator("#system-color-value").fill("#445566");
  await page.evaluate(() => globalThis.designSystemPinTest.armMutation());
  return labels.save;
}

for (const width of [390, 1440]) {
  test(`Given a mounted editor and pin at ${width}px When a color is saved Then the candidate refreshes without changing the pin until Apply`, async () => {
    await withFixture({ width }, async f => {
      const save = await prepareColor(f.page);
      const requested = f.page.waitForRequest(request => new URL(request.url()).pathname === pinPath && request.method() === "GET");
      await Promise.all([requested, f.page.getByRole("button", { name: save, exact: true }).click()]);
      expect((await f.page.evaluate(() => globalThis.designSystemPinTest.state())).pin).toMatchObject({ revision: 1, digest: oldDigest, candidate_digest: oldDigest });
      expect(await f.page.locator("[data-pin-banner] button").count()).toBe(0);
      f.releaseRefresh();
      await f.page.locator("[data-pin-banner] button").waitFor();
      expect(await f.page.evaluate(() => globalThis.designSystemPinTest.mutation)).toBe("success");
      expect((await f.page.evaluate(() => globalThis.designSystemPinTest.state())).pin).toMatchObject({ revision: 1, digest: oldDigest, candidate_digest: nextDigest });
      expect(f.pinReads()).toBe(2);
      expect(f.applied).toHaveLength(0);
      await f.page.evaluate(() => globalThis.designSystemPinTest.armMutation());
      const applied = f.page.waitForResponse(response => new URL(response.url()).pathname === pinPath && response.request().method() === "POST");
      await f.page.locator("[data-pin-banner] button").click();
      expect((await applied).status()).toBe(200);
      expect(await f.page.evaluate(() => globalThis.designSystemPinTest.mutation)).toBe("success");
      expect(f.applied).toEqual([{ expected_digest: oldDigest, candidate_digest: nextDigest }]);
      expect((await f.page.evaluate(() => globalThis.designSystemPinTest.state())).pin).toMatchObject({ revision: 2, digest: nextDigest, candidate_digest: nextDigest });
      expect(await f.page.locator("[data-pin-banner] button").count()).toBe(0);
    });
  }, 60_000);
}

test("Given a rejected color save When the mutation settles Then the saved tokens and pinned baseline remain unchanged", async () => {
  await withFixture({ rejectSave: true }, async f => {
    const save = await prepareColor(f.page);
    await f.page.getByRole("button", { name: save, exact: true }).click();
    expect(await f.page.evaluate(() => globalThis.designSystemPinTest.mutation)).toBe("error");
    const state = await f.page.evaluate(() => globalThis.designSystemPinTest.state());
    expect(state.tokens?.colors).toEqual([{ name: "primary", value: "#112233" }]);
    expect(state.pin).toMatchObject({ revision: 1, digest: oldDigest, candidate_digest: oldDigest });
    expect(f.pinReads()).toBe(1);
    expect(f.applied).toHaveLength(0);
  });
}, 60_000);

test("Given a saved color and failed pin refresh When the query rejects Then the saved token survives and the pin shows an error", async () => {
  await withFixture({ rejectRefresh: true }, async f => {
    const save = await prepareColor(f.page);
    const requested = f.page.waitForRequest(request => new URL(request.url()).pathname === pinPath && request.method() === "GET");
    await Promise.all([requested, f.page.getByRole("button", { name: save, exact: true }).click()]);
    f.releaseRefresh();
    await f.page.locator("[data-pin-banner] [role=alert]").waitFor();
    expect(await f.page.evaluate(() => globalThis.designSystemPinTest.mutation)).toBe("success");
    const state = await f.page.evaluate(() => globalThis.designSystemPinTest.state());
    expect(state.tokens?.colors).toEqual([{ name: "primary", value: "#445566" }]);
    expect(state.pin).toMatchObject({ revision: 1, digest: oldDigest });
    expect(f.applied).toHaveLength(0);
  });
}, 60_000);
