import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "node-html-parser";
import { missingDesignSystemLayout } from "@bg/shared";
import { getDesignSystemDetail } from "../src/db/seed";
import { getSqlite } from "../src/db/sqlite-client";
import { systemsDir } from "../src/lib/paths";
import { extractDesignSystemFromSource } from "../src/services/design-system-extract";
import { readDesignSystemLayout } from "../src/services/design-system-layout";
import { analyzeLocalTree } from "../src/services/extraction-local-tree";
import { assertInertSourceMarkup } from "../src/services/extraction-safety";

type Route = { readonly body: string; readonly type: string };
type Site = { readonly id: string; readonly origin: string; readonly requests: string[]; readonly root: string };

/** Serves a same-origin QA-adapter website; every route is registered as an owned resource URL. */
async function withQaWebsite<T>(label: string, routes: (origin: string) => Record<string, Route>, run: (site: Site) => Promise<T>): Promise<T> {
  const requests: string[] = [];
  let origin = "";
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => {
    const pathname = new URL(request.url).pathname;
    requests.push(pathname);
    const route = routes(origin)[pathname];
    return route ? new Response(route.body, { headers: { "content-type": route.type } }) : new Response("missing", { status: 404 });
  } });
  origin = `http://127.0.0.1:${server.port}`;
  const settings = {
    BG_EXTRACTION_QA_ADAPTER_SOURCE_URL: `${origin}/source`,
    BG_EXTRACTION_QA_ADAPTER_STALL_URL: `${origin}/stall`,
    BG_EXTRACTION_QA_ADAPTER_RESOURCE_URLS: [`${origin}/source`, `${origin}/stall`, ...Object.keys(routes(origin)).map((pathname) => `${origin}${pathname}`)].join(","),
    BG_EXTRACTION_QA_ADAPTER_SECRET: "website-acquisition-fixture-secret-000001",
  };
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const id = `website-${label}-${process.pid}`;
  try {
    return await run({ id, origin, requests, root: path.join(systemsDir, id) });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await server.stop(true);
    getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(id);
    await rm(path.join(systemsDir, id), { recursive: true, force: true });
  }
}

async function readReport(root: string): Promise<{ readonly detected_css_vars: [string, string][]; readonly notes: string[] }> {
  return JSON.parse(await readFile(path.join(root, "uploads/extraction-report.json"), "utf8"));
}

test("V13-extraction-perf-NEW-1: Given a homepage with scripts, an absolute same-origin stylesheet, a form and an onclick handler When website extraction runs Then the draft publishes inert source bytes and the stylesheet tokens", async () => {
  await withQaWebsite("active", (origin) => ({
    "/source": { type: "text/html", body: `<!doctype html><html><head><meta charset="utf-8"><script src="/app.js"></script><script>window.x = 1</script><link rel="stylesheet" href="${origin}/site.css"></head><body><h1 onclick="alert(1)">Source</h1><form action="/search"><input name="q"></form><p style="color:#111;background:url(/bg.png)">Body copy</p></body></html>` },
    "/site.css": { type: "text/css", body: ":root{--brand-primary:#123456;--surface:#ffffff}" },
  }), async ({ id, origin, requests, root }) => {
    const result = await extractDesignSystemFromSource({ system_id: id, name: "Source", source_type: "website", source_url: `${origin}/source` });
    expect(result.system.status).toBe("draft");
    expect(requests).toEqual(["/source", "/site.css"]);
    for (const file of ["uploads/source.html", "ui_kits/website/index.html"]) {
      const markup = await readFile(path.join(root, file), "utf8");
      assertInertSourceMarkup(markup, "html");
      const parsed = parse(markup);
      expect(parsed.querySelectorAll("script").length).toBe(0);
      expect(parsed.querySelectorAll("form").length).toBe(0);
      expect(parsed.querySelector("h1")?.getAttribute("onclick")).toBeUndefined();
      expect(parsed.querySelector("link")?.getAttribute("href")).toBeUndefined();
      expect(parsed.querySelector("p")?.getAttribute("style")).toBeUndefined();
      expect(parsed.querySelector("h1")?.text).toBe("Source");
    }
    expect((await readReport(root)).detected_css_vars).toContainEqual(["brand-primary", "#123456"]);
  });
});

test("CSS-17: Given a linked stylesheet that starts with @import and a cross-origin stylesheet link When website extraction runs Then neither is fetched and the report names both skips", async () => {
  await withQaWebsite("imports", () => ({
    "/source": { type: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="https://cdn.example.invalid/theme.css"></head><body><h1>Source</h1></body></html>' },
    "/a.css": { type: "text/css", body: '@import url("/imported.css");\n:root{--brand-primary:#123456}' },
    "/imported.css": { type: "text/css", body: ":root{--accent:#654321}" },
  }), async ({ id, origin, requests, root }) => {
    await extractDesignSystemFromSource({ system_id: id, name: "Source", source_type: "website", source_url: `${origin}/source` });
    expect(requests).toEqual(["/source", "/a.css"]);
    const report = await readReport(root);
    expect(report.notes).toContain("Skipped @import in qa-adapter:/a.css: /imported.css");
    expect(report.notes).toContain("Skipped cross-origin stylesheet: https://cdn.example.invalid/theme.css");
    expect(report.detected_css_vars).toContainEqual(["brand-primary", "#123456"]);
    expect(report.detected_css_vars.some(([name]) => name === "accent")).toBe(false);
  });
});

const DARK_SCHEME_CSS = "@media (prefers-color-scheme: dark){:root{--bg:#000;--fg:#eee;--only-dark:#333}}\n:root{--bg:#fff;--fg:#111}\n@supports (display: grid){@media (prefers-color-scheme: dark){:root{--bg:#010101}}}";

test("CSS-16: Given root and dark-scheme declarations of the same custom properties When a local tree is analyzed Then the non-dark cascade winner sets each token and every declaration carries its at-rule context", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-dark-scheme-"));
  try {
    await writeFile(path.join(root, "site.css"), DARK_SCHEME_CSS);
    const analysis = await analyzeLocalTree(root, "Source", new AbortController().signal);
    expect(analysis.cssVars.get("bg")).toBe("#fff");
    expect(analysis.cssVars.get("fg")).toBe("#111");
    expect(analysis.cssVars.get("only-dark")).toBe("#333");
    expect(analysis.cssDeclarations.map((declaration) => [declaration.property, declaration.value, declaration.context])).toEqual([
      ["--bg", "#000", "@media (prefers-color-scheme: dark)"],
      ["--fg", "#eee", "@media (prefers-color-scheme: dark)"],
      ["--only-dark", "#333", "@media (prefers-color-scheme: dark)"],
      ["--bg", "#fff", ""],
      ["--fg", "#111", ""],
      ["--bg", "#010101", "@supports (display: grid) @media (prefers-color-scheme: dark)"],
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CSS-16: Given a website stylesheet with dark-scheme overrides When website extraction runs Then the report keeps the light values", async () => {
  await withQaWebsite("dark", () => ({
    "/source": { type: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/site.css"></head><body><h1>Source</h1></body></html>' },
    "/site.css": { type: "text/css", body: DARK_SCHEME_CSS },
  }), async ({ id, origin, root }) => {
    await extractDesignSystemFromSource({ system_id: id, name: "Source", source_type: "website", source_url: `${origin}/source` });
    const report = await readReport(root);
    expect(report.detected_css_vars).toContainEqual(["bg", "#fff"]);
    expect(report.detected_css_vars).toContainEqual(["fg", "#111"]);
  });
});

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

test("CSS-15: Given a relative-only homepage When website extraction runs Then the token file follows the canonical neutral ramp, leading, tracking, pair and layout contract and no layout rule is missing", async () => {
  await withQaWebsite("canonical", () => ({
    "/source": { type: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/a.css"></head><body><h1>Source</h1><p>Body copy</p></body></html>' },
    "/a.css": { type: "text/css", body: ':root{--brand-primary:#123456}\nbody{font-family:"Brand Sans",sans-serif}' },
  }), async ({ id, origin, root }) => {
    await extractDesignSystemFromSource({ system_id: id, name: "Source", source_type: "website", source_url: `${origin}/source` });
    const tokens = await readFile(path.join(root, "colors_and_type.css"), "utf8");
    const token = (name: string) => tokens.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim();
    expect(luminance(token("--gray-100")!)).toBeGreaterThan(luminance(token("--gray-10")!));
    expect(luminance(token("--gray-10")!)).toBeGreaterThan(luminance(token("--gray-90")!));
    expect(token("--lh-normal")).toBeDefined();
    expect(token("--ls-normal")).toBeDefined();
    expect(token("--lh-base")).toBeUndefined();
    expect(token("--fg-on-success")).toBeDefined();
    expect(token("--font-mono")).toContain("IBM Plex Mono");
    expect(await readFile(path.join(root, "fonts/fonts.css"), "utf8")).toMatch(/--font-mono-fallback:[^;]*IBM Plex Mono/);
    const system = await getDesignSystemDetail(id);
    if (!system) throw new Error("system_missing");
    expect(missingDesignSystemLayout(await readDesignSystemLayout(system))).toEqual([]);
  });
});
