import { describe, expect, test } from "bun:test";
import type { SequencedEventEnvelope } from "@bg/shared";
import { launchChromiumViaNode } from "../../backend/src/services/chromium-node-launch";
import type {} from "./fixtures/project-first-message-browser";

async function fixture(options: { complete?: boolean; createFails?: boolean; sendFails?: boolean } = {}) {
  const compiler = Bun.spawn([process.execPath, "build", `${import.meta.dir}/fixtures/project-first-message-browser.tsx`, "--target=browser", "--format=iife"], { stdout: "pipe", stderr: "pipe" });
  const [code, script, errors] = await Promise.all([compiler.exited, new Response(compiler.stdout).text(), new Response(compiler.stderr).text()]);
  if (code !== 0) throw new Error(`Creation fixture bundle failed (${code}): ${errors}`);
  const creates: unknown[] = [];
  const sends: { text: string; files: string[]; generation: unknown }[] = [];
  const events: SequencedEventEnvelope[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/") return new Response('<!doctype html><html><body><div id="root"></div></body></html>', { headers: { "content-type": "text/html" } });
      if (pathname === "/api/bootstrap") return Response.json({ data: { capability: "creation-test" } });
      if (pathname === "/api/projects" && request.method === "POST") {
        creates.push(await request.json());
        return options.createFails
          ? Response.json({ error: { code: "backend_not_found", message: "unavailable" } }, { status: 503 })
          : Response.json({ data: { id: "project", session_id: "session" } });
      }
      if (pathname === "/api/sessions/session/events") {
        if (request.method === "GET") return Response.json({ data: events });
        let text: string;
        let files: string[] = [];
        let generation: unknown;
        if (request.headers.get("content-type")?.includes("multipart/form-data")) {
          const form = await request.formData();
          text = String(form.get("text"));
          files = form.getAll("files").flatMap((file) => file instanceof File ? [file.name] : []);
          generation = JSON.parse(String(form.get("generation")));
        } else {
          const body: unknown = await request.json();
          if (body === null || typeof body !== "object" || !("text" in body) || typeof body.text !== "string") return new Response(null, { status: 400 });
          text = body.text;
          generation = "generation" in body ? body.generation : undefined;
        }
        sends.push({ text, files, generation });
        if (options.sendFails) return Response.json({ error: { code: "backend_not_found", message: "unavailable" } }, { status: 503 });
        events.push({ sequence: 1, event: { id: "first", ts: 1, type: "chat.user_message", turnId: "turn", text, attachmentCount: files.length } });
        return Response.json({ data: { accepted: true } });
      }
      return new Response(null, { status: 404 });
    },
  });
  const browser = await launchChromiumViaNode({}, AbortSignal.timeout(30_000));
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(server.url.origin);
  await page.addScriptTag({ content: script });
  await page.evaluate((complete) => globalThis.creationTest.mount(complete), options.complete ?? false);
  return { page, creates, sends, close: async () => { await browser.close(); await server.stop(true); } };
}

describe("create to first message", () => {
  test("Given only an idea When creating once Then the first message is sent and rendered without another action", async () => {
    const f = await fixture();
    try {
      await f.page.locator("#brief-objective").fill("A bakery website");
      expect(await f.page.locator('[data-qa="creation-submit"]').isEnabled()).toBe(true);
      expect(await f.page.locator("#project-name").inputValue()).toBe("A bakery website");
      expect(await f.page.locator('[data-qa="creation-advanced"]').getAttribute("open")).toBeNull();
      expect(await f.page.locator('[data-qa="creation-suggestions"] button').count()).toBe(1);
      await f.page.getByRole("button", { name: "Browse all design systems", exact: true }).click();
      await f.page.locator("#system-picker-title").waitFor();
      await f.page.getByRole("button", { name: "Back to brief", exact: true }).click();
      expect(await f.page.locator("#brief-objective").inputValue()).toBe("A bakery website");
      await f.page.locator('[data-qa="creation-advanced"] summary').click();
      await f.page.locator("#brief-density").selectOption("dense");
      await f.page.locator('[data-qa="creation-submit"]').click();
      await f.page.locator('[data-qa="created"]').waitFor();
      expect(f.creates).toHaveLength(1);
      expect(f.creates[0]).toMatchObject({ name: "A bakery website", design_system_id: null, options: { design_brief: { audience: "", density: "dense" } } });
      expect(f.sends).toHaveLength(1);
      expect(f.sends[0]?.text).toBe("A bakery website");
      expect(await f.page.locator('[data-qa="created"]').textContent()).toContain("A bakery website");
      expect(await f.page.evaluate(() => globalThis.creationTest.draft?.text)).toBe("");
    } finally { await f.close(); }
  }, 60_000);

  test("Given a complete brief and attachments When submitting twice synchronously Then exactly one first turn preserves the files", async () => {
    const f = await fixture({ complete: true });
    try {
      await f.page.locator("#design-system").selectOption("published-system");
      await f.page.locator("#project-materials").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Opening hours") });
      await f.page.locator("form").evaluate((form) => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      await f.page.locator('[data-qa="created"]').waitFor();
      expect(f.creates).toHaveLength(1);
      expect(f.sends).toHaveLength(1);
      expect(f.sends[0]).toMatchObject({ text: "A bakery website", files: ["notes.txt"] });
      expect(f.sends[0]?.generation).toBeDefined();
    } finally { await f.close(); }
  }, 60_000);

  test("Given a failed first send When creation completes Then the original idea and files remain recoverable", async () => {
    const f = await fixture({ complete: true, sendFails: true });
    try {
      await f.page.locator("#design-system").selectOption("published-system");
      await f.page.locator("#project-materials").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Opening hours") });
      await f.page.locator('[data-qa="creation-submit"]').click();
      await f.page.locator('[data-qa="created"]').waitFor({ state: "attached" });
      expect(f.sends).toHaveLength(1);
      expect(await f.page.evaluate(() => ({
        text: globalThis.creationTest.draft?.text,
        files: globalThis.creationTest.draft?.items.map((item) => item.file.name),
      }))).toEqual({ text: "A bakery website", files: ["notes.txt"] });
    } finally { await f.close(); }
  }, 60_000);

  test("Given an empty idea or failed create When submitting Then no empty first turn is sent and input survives", async () => {
    const f = await fixture({ createFails: true });
    try {
      expect(await f.page.locator('[data-qa="creation-submit"]').isEnabled()).toBe(false);
      await f.page.locator("form").dispatchEvent("submit");
      expect(f.creates).toHaveLength(0);
      expect(f.sends).toHaveLength(0);
      await f.page.locator("#brief-objective").fill("A bakery website");
      await f.page.locator("#design-system").selectOption("published-system");
      const failed = f.page.waitForResponse((response) => response.url().endsWith("/api/projects") && response.request().method() === "POST");
      await f.page.locator('[data-qa="creation-submit"]').click();
      expect((await failed).status()).toBe(503);
      await f.page.locator('p[role="alert"]').waitFor();
      expect(f.sends).toHaveLength(0);
      expect(await f.page.locator("#brief-objective").inputValue()).toBe("A bakery website");
    } finally { await f.close(); }
  }, 60_000);
});
