import { expect, spyOn, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
import { sanitizeAcquiredWebsiteHtml } from "../src/services/extraction-html";

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

test("R2-1: Given a tag-manager noscript frame, a template image, srcset and ping references and prose that mentions CSS network syntax When the website page is stripped Then the stored bytes carry none of them, pass the inert gate and keep the prose readable", () => {
  const stored = sanitizeAcquiredWebsiteHtml([
    "<html><head><title>Home</title></head><body>",
    '<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-1" height="0" width="0"></iframe></noscript>',
    '<template><img src="https://cdn.example/a.png"></template>',
    '<img src="https://cdn.example/a.jpg" srcset="https://cdn.example/a.jpg 2x" alt="Hero">',
    '<a href="/about" ping="https://t.example/p">About</a>',
    "<p>Write backgrounds as url(https://example.com/x.png) and never @import them.</p>",
    "</body></html>",
  ].join(""));
  expect(() => assertInertSourceMarkup(stored, "html")).not.toThrow();
  for (const forbidden of ["<noscript", "<template", "srcset", "ping=", "googletagmanager", "cdn.example", "t.example"]) expect(stored).not.toContain(forbidden);
  expect(stored).toContain('<img alt="Hero">');
  expect(stored).toContain("<a>About</a>");
  expect(stored).toContain("url&#40;https://example.com/x.png");
  expect(stored).toContain("&#64;import them");
});

test("IMPORT-1: Given a homepage whose logo is an ordinary SVG with a gradient fill url(#g) When website extraction runs Then the import still publishes a draft with an inert copy of the logo", async () => {
  const logo = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#123456"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg>';
  await withQaWebsite("svg-logo", () => ({
    "/source": { type: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><title>Acme</title></head><body><header><img src="/logo.svg" alt="Acme"></header><h1>Acme</h1></body></html>' },
    "/logo.svg": { type: "image/svg+xml", body: logo },
  }), async ({ id, origin, requests, root }) => {
    const result = await extractDesignSystemFromSource({ system_id: id, name: "Acme", source_type: "website", source_url: `${origin}/source` });
    expect(result.system.status).toBe("draft");
    expect(requests).toContain("/logo.svg");
    const published = await readFile(path.join(root, "assets/logos/logo.svg"), "utf8");
    expect(() => assertInertSourceMarkup(published, "svg")).not.toThrow();
    expect(parse(published).querySelector("rect")?.getAttribute("width")).toBe("10");
  });
});

test("IMPORT-2: Given a homepage with 65 product images and no logo candidates When website extraction runs Then the import still publishes a draft instead of failing on the asset-count limit", async () => {
  const images = Array.from({ length: 65 }, (_, index) => `<img src="/products/item-${index}.png" alt="Item ${index}">`).join("");
  await withQaWebsite("many-images", () => ({
    "/source": { type: "text/html", body: `<!doctype html><html><head><meta charset="utf-8"><title>Shop</title></head><body><h1>Shop</h1><main>${images}</main></body></html>` },
  }), async ({ id, origin, requests }) => {
    const result = await extractDesignSystemFromSource({ system_id: id, name: "Shop", source_type: "website", source_url: `${origin}/source` });
    expect(result.system.status).toBe("draft");
    expect(requests.filter((request) => request.startsWith("/products/"))).toEqual([]);
  });
});

test("IMPORT-6: Given a same-origin stylesheet link that redirects to another origin When website extraction runs Then the off-origin stylesheet is never requested", async () => {
  const source = "https://93.184.215.14";
  const foreign = "151.101.1.1";
  const requestedHosts: string[] = [];
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>Redirect</title><link rel="stylesheet" href="/site.css"></head><body><h1>Redirect</h1></body></html>';
  const fakeSite = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    requestedHosts.push(`${url.hostname}${url.pathname}`);
    if (url.hostname === "93.184.215.14" && url.pathname === "/") return new Response(html, { headers: { "content-type": "text/html" } });
    if (url.hostname === "93.184.215.14" && url.pathname === "/site.css") return new Response(null, { status: 302, headers: { location: `https://${foreign}/theme.css` } });
    if (url.hostname === foreign) return new Response(":root{--foreign:#abcdef}", { headers: { "content-type": "text/css" } });
    return new Response("missing", { status: 404 });
  };
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(Object.assign(fakeSite, { preconnect: globalThis.fetch.preconnect }));
  const id = `website-css-redirect-${process.pid}`;
  try {
    await extractDesignSystemFromSource({ system_id: id, name: "Redirect", source_type: "website", source_url: `${source}/` });
    expect(requestedHosts).toContain("93.184.215.14/site.css");
    expect(requestedHosts.filter((entry) => entry.startsWith(foreign))).toEqual([]);
    expect((await readReport(path.join(systemsDir, id))).detected_css_vars.some(([name]) => name === "foreign")).toBe(false);
  } finally {
    fetchSpy.mockRestore();
    getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(id);
    await rm(path.join(systemsDir, id), { recursive: true, force: true });
  }
});

test("IMPORT-4: Given twelve extracted pages in discovery order When the draft is published Then the eight UI-kit pages are the first eight in discovery order, not a lexical page-10 before page-2 selection", async () => {
  const sections = Array.from({ length: 11 }, (_, index) => `/section${index + 1}`);
  const html = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
  await withQaWebsite("ui-kit-order", () => ({
    "/source": { type: "text/html", body: html("Multi", `<nav>${sections.map((href) => `<a href="${href}">${href}</a>`).join("")}</nav><h1>Home</h1>`) },
    ...Object.fromEntries(sections.map((href) => [href, { type: "text/html", body: html(href, `<h1>${href}</h1>`) }])),
  }), async ({ id, origin, root }) => {
    const result = await extractDesignSystemFromSource({ system_id: id, name: "Multi", source_type: "website", source_url: `${origin}/source` });
    expect(result.system.status).toBe("draft");
    const published = (await readdir(path.join(root, "ui_kits", "website"))).filter((name) => name.endsWith(".html")).sort();
    expect(published).toEqual(["index.html", "page-2.html", "page-3.html", "page-4.html", "page-5.html", "page-6.html", "page-7.html", "page-8.html"]);
  });
});

test("IMPORT-3: Given a page title whose first segment is empty and no explicit name When website extraction runs Then the derived brand name falls back to the hostname", async () => {
  await withQaWebsite("empty-title-segment", () => ({
    "/source": { type: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><title>| Home</title></head><body><h1>Home</h1></body></html>' },
  }), async ({ id, origin }) => {
    const result = await extractDesignSystemFromSource({ system_id: id, source_type: "website", source_url: `${origin}/source` });
    expect(result.extraction.brand_name).toBe("127");
  });
});
