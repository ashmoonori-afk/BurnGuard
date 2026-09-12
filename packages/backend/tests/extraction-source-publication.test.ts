import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "node-html-parser";
import { getSqlite } from "../src/db/sqlite-client";
import { systemsDir } from "../src/lib/paths";
import { extractDesignSystemFromSource, persistCanonicalExtraction } from "../src/services/design-system-extract";
import { analyzeLocalTree } from "../src/services/extraction-local-tree";
import { sanitizeSourceHtml } from "../src/services/extraction-html";
import { assertInertSourceMarkup } from "../src/services/extraction-safety";

// The two offending references in mdn/beginner-html-site/index.html.
const sourceHtml = '<!doctype html><html><head><meta charset="utf-8"></head><body><h1>Source</h1><img src="images/firefox-icon.png" alt="Firefox"><p><a href="https://www.mozilla.org/en-US/about/manifesto/">Manifesto</a></p></body></html>';

async function withSource(action: (source: string) => Promise<void>): Promise<void> {
  const source = await mkdtemp(path.join(tmpdir(), "bg-public-source-"));
  try { await action(source); }
  finally { await rm(source, { recursive: true, force: true }); }
}

async function removeSystem(id: string): Promise<void> {
  getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(id);
  await rm(path.join(systemsDir, id), { recursive: true, force: true });
}

async function assertPublished(result: Awaited<ReturnType<typeof persistCanonicalExtraction>>): Promise<void> {
  const { system, extraction } = result;
  expect(system.status).toBe("draft");
  expect(extraction.copied_logo_count).toBe(0);
  expect(extraction.generated_files.filter(file => file.startsWith("assets/"))).toEqual([]);
  const root = path.join(systemsDir, system.id);
  const html = await readFile(path.join(root, "ui_kits/website/index.html"), "utf8");
  assertInertSourceMarkup(html, "html");
  const parsed = parse(html);
  expect(parsed.querySelector("a")?.getAttribute("href")).toBeUndefined();
  expect(parsed.querySelector("img")?.getAttribute("src")).toBeUndefined();
  expect(parsed.querySelector("img")?.getAttribute("alt")).toBe("Firefox");
  const provenance = JSON.parse(await readFile(path.join(root, "extraction-provenance.json"), "utf8"));
  expect(provenance).toEqual(extraction.provenance);
  expect(provenance.content_digest).toBe(createHash("sha256").update(JSON.stringify(provenance.content)).digest("hex"));
  expect(provenance.content.entries.some((entry: { domain: string; state: string }) => entry.domain === "token" && entry.state === "observed")).toBe(false);
  expect(getSqlite().prepare("SELECT status FROM design_system_receipts WHERE design_system_id=?").get(system.id)).toMatchObject({ status: "committed" });
}

test("sanitization does not repair incomplete sources or relax the inert validator", () => {
  expect(() => sanitizeSourceHtml('<html><body><a href="https://www.mozilla.org/">Link</a>')).toThrow(expect.objectContaining({ code: "unsafe_source_content" }));
  expect(() => assertInertSourceMarkup(sourceHtml, "html")).toThrow(expect.objectContaining({ code: "unsafe_source_content" }));
});

test("a cloned public HTML tree publishes inert UI-kit bytes without inventing logo or token evidence", async () => {
  const id = `source-git-${process.pid}`;
  try {
    await withSource(async source => {
      await writeFile(path.join(source, "index.html"), sourceHtml);
      const signal = new AbortController().signal;
      const analysis = await analyzeLocalTree(source, "Source", signal);
      const result = await persistCanonicalExtraction({ requestedId: id, brandName: "Source", sourceType: "github", sourceReference: "https://github.com/mdn/beginner-html-site.git", lineage: null, analysis, signal });
      await assertPublished(result);
      expect(await readFile(path.join(source, "index.html"), "utf8")).toBe(sourceHtml);
    });
  } finally { await removeSystem(id); }
});

test("Website acquisition publishes the same inert source and linked-page bytes without following external navigation", async () => {
  const requests: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => {
    const pathname = new URL(request.url).pathname;
    requests.push(pathname);
    return new Response(pathname === "/source" ? sourceHtml.replace("</body>", '<a href="/linked">Next</a></body>') : sourceHtml, { headers: { "content-type": "text/html" } });
  } });
  const origin = `http://127.0.0.1:${server.port}`;
  const settings = {
    BG_EXTRACTION_QA_ADAPTER_SOURCE_URL: `${origin}/source`,
    BG_EXTRACTION_QA_ADAPTER_STALL_URL: `${origin}/stall`,
    BG_EXTRACTION_QA_ADAPTER_RESOURCE_URLS: `${origin}/source,${origin}/stall,${origin}/linked`,
    BG_EXTRACTION_QA_ADAPTER_SECRET: "source-publication-fixture-secret-000001",
  };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const id = `source-website-${process.pid}`;
  try {
    const result = await extractDesignSystemFromSource({ system_id: id, name: "Source", source_type: "website", source_url: `${origin}/source` });
    await assertPublished(result);
    expect(requests).toEqual(["/source", "/linked"]);
    for (const file of ["uploads/source.html", "ui_kits/website/page-2.html"]) {
      const markup = await readFile(path.join(systemsDir, id, file), "utf8");
      assertInertSourceMarkup(markup, "html");
      expect(parse(markup).querySelector("a")?.getAttribute("href")).toBeUndefined();
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await server.stop(true);
    await removeSystem(id);
  }
});

test.each([
  '<script>alert(1)</script>',
  '<a href="https://www.mozilla.org/" onclick="alert(1)">Link</a>',
  '<a href="javascript:alert(1)">Link</a>',
  '<iframe src="/frame"></iframe>',
  '<meta http-equiv="refresh" content="0;url=https://evil.test/">',
  '<img src="https://evil.test/image.png">',
  '<img src="//evil.test/image.png">',
  '<link rel="stylesheet" href="https://evil.test/style.css">',
  '<style>body{background:url(https://evil.test/image.png)}</style>',
])("source publication still rejects active or remote-resource markup: %s", async markup => {
  const id = `source-rejected-${process.pid}`;
  await withSource(async source => {
    await writeFile(path.join(source, "index.html"), `<html><head></head><body>${markup}</body></html>`);
    const before = (await readdir(systemsDir)).sort();
    const signal = new AbortController().signal;
    const analysis = await analyzeLocalTree(source, "Source", signal);
    await expect(persistCanonicalExtraction({ requestedId: id, brandName: "Source", sourceType: "github", sourceReference: "https://github.com/example/source", lineage: null, analysis, signal })).rejects.toMatchObject({ code: "unsafe_source_content" });
    expect((await readdir(systemsDir)).sort()).toEqual(before);
    expect(getSqlite().prepare("SELECT id FROM design_systems WHERE id=?").get(id)).toBeNull();
  });
});
