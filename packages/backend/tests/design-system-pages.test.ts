import type { Browser } from "playwright-core";
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { MAX_LAYOUT_REFERENCE_BYTES, MAX_PAGE_COVERAGE_BYTES, MEASURED_VIEWPORTS, parseDesignSystemLayoutReference, parseDesignSystemMeasuredLayout, parseDesignSystemPageCoverage, type DesignSystemMeasuredLayout, type DesignSystemPageEvidence } from "@bg/shared";
import { getSqlite } from "../src/db/sqlite-client";
import { appendDesignSystemContext } from "../src/harness/prompt-design-system";
import { systemsDir } from "../src/lib/paths";
import { extractDesignSystemFromSource, readDesignSystemTokens } from "../src/services/design-system-extract";
import { readDesignSystemMeasuredLayout } from "../src/services/design-system-measured-layout";
import { measureRenderedLayout, type RenderedLayoutInput } from "../src/services/extraction-rendered-layout";
import { parseCssSource } from "../src/services/extraction-css";
import { analyzeLocalTree } from "../src/services/extraction-local-tree";
import { boundPageCoverage, buildPageCoverage, buildPageTemplateReadme, canonicalPagePath, classifyPageType, discoverPages, pageCoveragePromptSummary, pageLink, parseRobots, parseSitemap, robotsPatternMatches } from "../src/services/extraction-pages";

const EVIDENCE: DesignSystemPageEvidence = { hero_media: null, feature_columns: null, footer_lists: null, alignment: null, icons: 0, photos: 0, illustrations: 0, gradients: 0, background_patterns: 0, motion_ms: null, animations: 0 };

describe("Page discovery primitives", () => {
  test("Given robots.txt groups, then the BurnGuard group replaces the wildcard group, the longest rule wins, ties allow and wildcards apply", () => {
    const wildcardOnly = parseRobots(["User-agent: Googlebot", "Disallow: /", "", "User-agent: *", "Disallow: /private", "Allow: /private/public", "Disallow: /*.json$", "Disallow:", "Sitemap: https://example.com/sitemap.xml"].join("\n"));
    expect(["/", "/pricing", "/private", "/private/x", "/private/public/page", "/data.json", "/data.json/x"].map(wildcardOnly.allows)).toEqual([true, true, false, false, true, false, true]);
    expect(wildcardOnly.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
    const specific = parseRobots(["User-agent: *", "Allow: /public", "", "User-agent: BurnGuard", "Disallow: /"].join("\n"));
    expect(["/public", "/"].map(specific.allows)).toEqual([false, false]);
    expect(parseRobots("User-agent: *\nDisallow: /private/").allows("/private/")).toBe(false);
    expect(parseRobots("").allows("/anything")).toBe(true);
  });

  test("Given hostile wildcard patterns, then matching stays linear and correct", () => {
    const pattern = "/" + "a*".repeat(14) + "b";
    const target = "/" + "a".repeat(46);
    const started = performance.now();
    expect(robotsPatternMatches(pattern, target)).toBe(false);
    expect(parseRobots("User-agent: *\nDisallow: " + pattern).allows(target)).toBe(true);
    expect(performance.now() - started).toBeLessThan(50);
    expect([["/a*c", "/abbbc/x"], ["/a*c$", "/abbbc"], ["/a*c$", "/abbbcd"], ["*.pdf$", "/x/y.pdf"], ["/", "/anything"]].map(([p, s]) => robotsPatternMatches(p!, s!))).toEqual([true, true, false, true, true]);
  });

  test("Given sitemaps and hrefs, then locations are read, dedupe keys are canonical and the fetched path is kept", () => {
    expect(parseSitemap("<urlset><url><loc> https://e.com/a </loc></url><url><loc>https://e.com/b?x=1&amp;y=2</loc></url></urlset>")).toEqual({ urls: ["https://e.com/a", "https://e.com/b?x=1&y=2"], isIndex: false });
    expect(parseSitemap("<sitemapindex><sitemap><loc>https://e.com/s1.xml</loc></sitemap></sitemapindex>").isIndex).toBe(true);
    const base = new URL("https://e.com/");
    expect(["/pricing/", "/pricing#plans", "/pricing?ref=nav", "/blog/index.html", "https://other.com/x", "/brochure.pdf", "mailto:a@e.com", "//e.com//docs//"].map(href => canonicalPagePath(href, base))).toEqual(["/pricing", "/pricing", "/pricing", "/blog", null, null, null, "/docs"]);
    expect(pageLink("/private/", base)).toEqual({ key: "/private", fetchPath: "/private/" });
    expect(pageLink("/blog/" + "%ED%95%9C".repeat(34), base)).toBeNull();
  });

  test("Given a landing page, then candidates come entry-first in nav, footer, sitemap and link order, deduped, with robots checked on the fetched path", () => {
    const html = '<header><nav><a href="/pricing">P</a><a href="/blog/">B</a><a href="/private/">X</a></nav></header><main><a href="/pricing#top">again</a><a href="/careers">C</a></main><footer><a href="/about">A</a></footer>';
    const result = discoverPages({ base: new URL("https://e.com/"), homepageHtml: html, sitemapUrls: ["https://e.com/contact", "https://e.com/blog"], robots: parseRobots("User-agent: *\nDisallow: /private/"), limit: 4 });
    expect(result.discovered).toBe(7);
    expect(result.selected.map(c => [c.path, c.source])).toEqual([["/", "entry"], ["/pricing", "nav"], ["/blog", "nav"], ["/about", "footer"]]);
    expect(result.skipped.map(c => [c.path, c.source, c.reason])).toEqual([["/private", "nav", "robots"], ["/contact", "sitemap", "cap"], ["/careers", "link", "cap"]]);
  });

  test("Given many sibling links before other page kinds, then the limit is spent on distinct page types and sections first", () => {
    const html = "<nav>" + ["a", "b", "c", "d", "e", "f"].map(slug => '<a href="/browse/' + slug + '">' + slug + "</a>").join("") + '</nav><footer><a href="/help">Help</a><a href="/contact">Contact</a><a href="/news">News</a></footer>';
    const result = discoverPages({ base: new URL("https://e.com/"), homepageHtml: html, sitemapUrls: [], robots: parseRobots(""), limit: 4 });
    expect(result.selected.map(candidate => candidate.path)).toEqual(["/", "/browse/a", "/help", "/contact"]);
  });

  test("Given paths and headings, then page types follow the path first and the heading second", () => {
    expect(["/", "/pricing", "/docs/getting-started", "/blog/post-1", "/features", "/company/team", "/contact-sales", "/x"].map(p => classifyPageType(p, ""))).toEqual(["home", "pricing", "docs", "blog", "product", "about", "contact", "other"]);
    expect(classifyPageType("/x", "<title>Plans and pricing</title>")).toBe("pricing");
  });

  test("Given extracted pages, then records are unique, templates carry properties and evidence, differences cover tokens, properties, fonts and alignment, and the document parses strictly", () => {
    const page = (path: string, pageType: "home" | "pricing", max: string, accent: string, font: string, alignment: "left" | "center") => ({ path, source: "nav" as const, pageType, layoutTokens: { "--layout-max": max }, patterns: ["hero"], colors: [], fonts: [font], customProperties: { "--brand-accent": accent }, evidence: { ...EVIDENCE, alignment, photos: pageType === "home" ? 2 : 0 } });
    const coverage = buildPageCoverage({
      limit: 12, discovered: 5,
      extracted: [page("/", "home", "1140px", "#ff0000", "Brand Sans", "left"), page("/pricing", "pricing", "960px", "#0000ff", "Brand Serif", "center"), page("/pricing", "pricing", "1px", "#000000", "X", "left")],
      skipped: [{ path: "/pricing", source: "link", reason: "cap", pageType: "pricing" }, { path: "/private", source: "nav", reason: "robots", pageType: "other" }],
    });
    expect(coverage.pages.map(p => [p.path, p.status])).toEqual([["/", "extracted"], ["/pricing", "extracted"], ["/private", "skipped"]]);
    expect(coverage.templates.map(t => [t.page_type, t.custom_properties["--brand-accent"], t.evidence.photos])).toEqual([["home", "#ff0000", 2], ["pricing", "#0000ff", 0]]);
    expect(coverage.differences.map(d => d.key)).toEqual(["--layout-max", "primary-font", "alignment", "--brand-accent"]);
    expect(parseDesignSystemPageCoverage(JSON.parse(JSON.stringify(coverage)))).toEqual(coverage);
    expect(() => parseDesignSystemPageCoverage({ ...coverage, extra: 1 })).toThrow();
    expect(() => parseDesignSystemPageCoverage({ ...coverage, page_limit: 99 })).toThrow();
    expect(() => parseDesignSystemPageCoverage({ ...coverage, pages: [{ ...coverage.pages[0]!, status: "skipped" }] })).toThrow();
    expect(() => parseDesignSystemPageCoverage({ ...coverage, pages: [coverage.pages[0], coverage.pages[0]] })).toThrow();
    expect(() => parseDesignSystemPageCoverage({ ...coverage, pages: [{ ...coverage.pages[0]!, path: "https://e.com/" }] })).toThrow();
    expect(() => parseDesignSystemPageCoverage({ ...coverage, templates: [{ ...coverage.templates[0]!, custom_properties: { "--x": "url(x)" } }] })).toThrow();
    expect(() => parseDesignSystemPageCoverage({ ...coverage, pages: [{ ...coverage.pages[0]!, evidence: { ...EVIDENCE, photos: -1 } }] })).toThrow();
  });
});

describe("Repository HTML evidence", () => {
  test("Given equivalent .html and .htm pages, then both feed the same source evidence", async () => {
    const markup = '<section class="hero"><h1>Brand</h1><img src="a.jpg"></section><footer><ul><li>a</li></ul><ul><li>b</li></ul></footer>';
    const roots = await Promise.all([".html", ".htm"].map(async extension => {
      const root = await mkdtemp(path.join(tmpdir(), "bg-htm-"));
      await writeFile(path.join(root, "index" + extension), markup);
      return root;
    }));
    try {
      const [html, htm] = await Promise.all(roots.map(root => analyzeLocalTree(root, "Brand", new AbortController().signal)));
      expect(htm!.sourceEvidence).toEqual(html!.sourceEvidence);
      expect(html!.sourceEvidence!.hero).toEqual({ media: true });
    } finally {
      await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })));
    }
  });
});

describe("Per-page website extraction", () => {
  test("Given a multi-page site with redirects, when extracted, then pages are discovered, bounded, typed and measured per page, persisted, served and injected for websites only", async () => {
    const shared = "body { font-family: 'Brand Sans', sans-serif; color: var(--brand-accent) } .grid { display: grid; grid-template-columns: repeat(12, 1fr); column-gap: 24px }";
    const page = (title: string, css: string, body: string) => '<!doctype html><html><head><meta charset="utf-8"><title>' + title + '</title><link rel="stylesheet" href="/shared.css"><link rel="stylesheet" href="/' + css + '"></head><body><header><nav><a href="/pricing">Pricing</a><a href="/plans">Plans</a><a href="/blog/">Blog</a><a href="/docs#intro">Docs</a><a href="/private/area">Private</a><a href="/away">Away</a><a href="/sneaky">Sneaky</a></nav></header>' + body + '<footer><ul><li><a href="/about">About</a></li></ul><ul><li><a href="/contact">Contact</a></li></ul></footer></body></html>';
    const routes: Record<string, [string, string]> = {
      "/source": [page("Brand", "home.css", '<section class="hero"><h1>Brand</h1><img alt="Team"></section>'), "text/html"],
      "/plans": [page("Pricing", "pricing.css", '<section class="pricing-plans"><h1>Plans</h1></section>'), "text/html"],
      "/blog": [page("Blog", "home.css", "<main><h1>Blog</h1></main>"), "text/html"],
      "/docs": [page("Docs", "home.css", "<main><h1>Docs</h1></main>"), "text/html"],
      "/robots.txt": ["User-agent: *\nDisallow: /private\nSitemap: /sitemap.xml", "text/plain"],
      "/sitemap.xml": ["<urlset><url><loc>/plans</loc></url><url><loc>/contact</loc></url></urlset>", "application/xml"],
      "/shared.css": [shared, "text/css"],
      "/home.css": [":root { --brand-accent: #ff0000 } .container { max-width: 1140px }", "text/css"],
      "/pricing.css": [":root { --brand-accent: #0000ff } .container { max-width: 960px }", "text/css"],
    };
    const requests: string[] = [];
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => {
      const pathname = new URL(request.url).pathname.replace(/\/$/, "") || "/";
      requests.push(pathname);
      if (pathname === "/pricing") return new Response(null, { status: 302, headers: { location: "/plans" } });
      if (pathname === "/away") return new Response(null, { status: 302, headers: { location: "https://example.com/elsewhere" } });
      if (pathname === "/sneaky") return new Response(null, { status: 302, headers: { location: "/private/inner" } });
      const route = routes[pathname];
      return route ? new Response(route[0], { headers: { "content-type": route[1] } }) : new Response("missing", { status: 404 });
    } });
    const origin = "http://127.0.0.1:" + server.port;
    const settings = {
      BG_EXTRACTION_QA_ADAPTER_SOURCE_URL: origin + "/source",
      BG_EXTRACTION_QA_ADAPTER_STALL_URL: origin + "/stall",
      BG_EXTRACTION_QA_ADAPTER_RESOURCE_URLS: ["/source", "/stall", "/robots.txt", "/sitemap.xml", "/pricing", "/plans", "/blog/", "/docs", "/away", "/sneaky", "/private/inner", "/shared.css", "/home.css", "/pricing.css"].map(p => origin + p).join(","),
      BG_EXTRACTION_QA_ADAPTER_SECRET: "per-page-fixture-secret-000000000001",
    };
    const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
    Object.assign(process.env, settings);
    const id = "pages-" + process.pid;
    try {
      await extractDesignSystemFromSource({ system_id: id, name: "Brand", source_type: "website", source_url: origin + "/source", page_limit: 12 });
      expect(requests.filter(p => p.endsWith(".css")).sort()).toEqual(["/home.css", "/pricing.css", "/shared.css"]);
      expect(requests).not.toContain("/private/area");
      expect(requests).not.toContain("/private/inner");
      const coverage = parseDesignSystemPageCoverage((await readDesignSystemTokens(id)).pages);
      expect(coverage.page_limit).toBe(12);
      const status = Object.fromEntries(coverage.pages.map(p => [p.path, [p.page_type, p.status, p.skip_reason]]));
      expect(status).toMatchObject({
        "/source": ["other", "extracted", null], "/plans": ["pricing", "extracted", null], "/blog": ["blog", "extracted", null], "/docs": ["docs", "extracted", null],
        "/private/area": ["other", "skipped", "robots"], "/away": ["other", "skipped", "fetch_failed"], "/sneaky": ["other", "skipped", "robots"],
      });
      expect(new Set(coverage.pages.map(p => p.path)).size).toBe(coverage.pages.length);
      expect(coverage.pages.find(p => p.path === "/plans")!.layout_tokens["--layout-max"]).toBe("960px");
      expect(coverage.pages.find(p => p.path === "/plans")!.custom_properties["--brand-accent"]).toBe("#0000ff");
      expect(coverage.pages.find(p => p.path === "/plans")!.patterns).toContain("pricing");
      expect(coverage.differences.map(d => d.key)).toEqual(expect.arrayContaining(["--layout-max", "--brand-accent"]));
      const readme = await readFile(path.join(systemsDir, id, "README.md"), "utf8");
      expect(readme).toContain("## Page templates");

      const detail = { id, name: "Brand", status: "draft", source_type: "website", is_template: false, dir_path: path.join(systemsDir, id), skill_md_path: null, tokens_css_path: null, readme_md_path: path.join(systemsDir, id, "README.md"), thumbnail_path: null, created_at: 1, updated_at: 1, archived_at: null } as const;
      const render = async (surface: "website" | "slides") => { const lines: string[] = []; await appendDesignSystemContext(lines, detail as unknown as Parameters<typeof appendDesignSystemContext>[1], "full", surface); return lines.join("\n"); };
      const block = (await render("website")).match(/<selected_design_system_pages>\n([^\n]+)\n<\/selected_design_system_pages>/u);
      expect(JSON.parse(block![1]!)).toEqual({ templates: coverage.templates, differences: coverage.differences });
      expect(await render("slides")).not.toContain("<selected_design_system_pages>");
    } finally {
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      await server.stop(true);
      getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(id);
      await rm(path.join(systemsDir, id), { recursive: true, force: true });
    }
  });
});

async function withSite(routes: Record<string, string>, run: (origin: string, id: string) => Promise<void>): Promise<void> {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => {
    const pathname = new URL(request.url).pathname;
    const body = routes[pathname];
    return body === undefined ? new Response("missing", { status: 404 }) : new Response(body, { headers: { "content-type": pathname.endsWith(".css") ? "text/css" : "text/html" } });
  } });
  const origin = "http://127.0.0.1:" + server.port;
  const settings = {
    BG_EXTRACTION_QA_ADAPTER_SOURCE_URL: origin + "/source",
    BG_EXTRACTION_QA_ADAPTER_STALL_URL: origin + "/stall",
    BG_EXTRACTION_QA_ADAPTER_RESOURCE_URLS: ["/stall", ...Object.keys(routes)].map(p => origin + p).join(","),
    BG_EXTRACTION_QA_ADAPTER_SECRET: "per-page-fixture-secret-000000000002",
  };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const id = "pages-extra-" + process.pid + "-" + Math.random().toString(36).slice(2, 8);
  try { await run(origin, id); }
  finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await server.stop(true);
    getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(id);
    await rm(path.join(systemsDir, id), { recursive: true, force: true });
  }
}

describe("Per-page extraction limits and ordering", () => {
  test("Given a disallowed root with an allowed directory, then the allowed directory is still discovered", () => {
    const result = discoverPages({ base: new URL("https://e.com/"), homepageHtml: '<nav><a href="/docs/">Docs</a><a href="/private">P</a></nav>', sitemapUrls: [], robots: parseRobots("User-agent: *\nDisallow: /\nAllow: /docs/"), limit: 5 });
    expect(result.selected.map(c => c.path)).toEqual(["/", "/docs"]);
    expect(result.skipped.map(c => [c.path, c.reason])).toEqual([["/private", "robots"]]);
  });

  test("Given large pages, when the download budget runs low, then remaining pages are recorded as budget skips and extraction completes", async () => {
    const padding = "<!--" + "x".repeat(850_000) + "-->";
    const links = Array.from({ length: 9 }, (_, i) => '<a href="/s' + i + '/page">P' + i + "</a>").join("");
    const routes: Record<string, string> = { "/source": "<html><body><nav>" + links + "</nav><h1>Home</h1>" + padding + "</body></html>" };
    for (let i = 0; i < 9; i += 1) routes["/s" + i + "/page"] = "<html><body><h1>Page " + i + "</h1>" + padding + "</body></html>";
    await withSite(routes, async (origin, id) => {
      await extractDesignSystemFromSource({ system_id: id, name: "Big", source_type: "website", source_url: origin + "/source", page_limit: 12 });
      const coverage = parseDesignSystemPageCoverage((await readDesignSystemTokens(id)).pages);
      const reasons = coverage.pages.map(p => p.skip_reason);
      expect(reasons).toContain("budget");
      expect(coverage.pages.filter(p => p.status === "extracted").length).toBeLessThan(10);
    });
  });

  test("Given stylesheets that exceed the aggregate download budget, then extraction stops with an acquisition limit instead of continuing", async () => {
    const big = ".a { color: #111111 }" + "/*" + "y".repeat(690_000) + "*/";
    const sheets = Array.from({ length: 13 }, (_, i) => "/c" + i + ".css");
    const routes: Record<string, string> = { "/source": "<html><head>" + sheets.map(s => '<link rel="stylesheet" href="' + s + '">').join("") + "</head><body><h1>Home</h1></body></html>" };
    for (const sheet of sheets) routes[sheet] = big;
    await withSite(routes, async (origin, id) => {
      await expect(extractDesignSystemFromSource({ system_id: id, name: "Heavy", source_type: "website", source_url: origin + "/source" })).rejects.toMatchObject({ code: "acquisition_limit" });
    });
  });

  test("Given two pages linking shared stylesheets in opposite orders, then each page keeps its own cascade winner", async () => {
    const page = (first: string, second: string, title: string) => '<html><head><link rel="stylesheet" href="' + first + '"><link rel="stylesheet" href="' + second + '"></head><body><nav><a href="/other/page">Other</a></nav><h1>' + title + "</h1></body></html>";
    await withSite({ "/source": page("/a.css", "/b.css", "Home"), "/other/page": page("/b.css", "/a.css", "Other"), "/a.css": ":root { --accent: #aa0000 }", "/b.css": ":root { --accent: #0000bb }" }, async (origin, id) => {
      await extractDesignSystemFromSource({ system_id: id, name: "Order", source_type: "website", source_url: origin + "/source" });
      const coverage = parseDesignSystemPageCoverage((await readDesignSystemTokens(id)).pages);
      const accent = Object.fromEntries(coverage.pages.filter(p => p.status === "extracted").map(p => [p.path, p.custom_properties["--accent"]]));
      expect(accent).toEqual({ "/source": "#0000bb", "/other/page": "#aa0000" });
      expect(coverage.differences.find(d => d.key === "--accent")).toBeDefined();
    });
  });

  test("Given a worst-case coverage document, then pages.json and the prompt summary stay within their consumer limits and literal palettes differ per page", () => {
    const properties = (seed: number) => Object.fromEntries(Array.from({ length: 48 }, (_, i) => ["--palette-" + i, "#" + ((seed * 48 + i) % 0xffffff).toString(16).padStart(6, "0")]));
    const coverage = buildPageCoverage({
      limit: 24, discovered: 400,
      extracted: Array.from({ length: 24 }, (_, i) => ({ path: "/section-" + i + "/" + "p".repeat(200), source: "link" as const, pageType: "other" as const, layoutTokens: { "--layout-max": 900 + i + "px" }, patterns: ["hero"], colors: ["#10" + String(i).padStart(4, "0"), "#ffffff"], fonts: ["Font " + i], customProperties: properties(i), evidence: EVIDENCE })),
      skipped: Array.from({ length: 200 }, (_, i) => ({ path: "/skipped-" + i + "/" + "q".repeat(250), source: "link" as const, reason: "cap" as const, pageType: "other" as const })),
    });
    expect(Buffer.byteLength(JSON.stringify(coverage, null, 2))).toBeLessThanOrEqual(MAX_PAGE_COVERAGE_BYTES);
    expect(parseDesignSystemPageCoverage(JSON.parse(JSON.stringify(coverage)))).toEqual(coverage);
    expect(JSON.stringify(pageCoveragePromptSummary(coverage)).length).toBeLessThanOrEqual(24_000);
    expect(coverage.differences.map(d => d.key)).toContain("palette");
    expect(boundPageCoverage(coverage)).toEqual(coverage);
  });
});

describe("Per-page cascade, palettes and pinned-context budget", () => {
  test("Given bounded style blocks whose combined CSS exceeds the parser limit, then canonical tokens retain observed brand and font values", async () => {
    const padding = "/*" + "x".repeat(360_000) + "*/";
    const extraVars = Array.from({ length: 50 }, (_, i) => "--framer-layout-" + i + ": 1px;").join("");
    const html = '<html><head><style>:root { --brand-primary: #8b4bd7; --framer-font-family: "Site Sans", sans-serif; --token-accent: #b77dea;' + extraVars + ' } code { font-family: "Site Mono", monospace }' + padding + '</style><style>body { background: 0 0; color: #f0e4ff; font-family: "Site Sans", sans-serif }' + padding + '</style></head><body><h1>Home</h1></body></html>';
    await withSite({ "/source": html }, async (origin, id) => {
      await extractDesignSystemFromSource({ system_id: id, name: "Brand", source_type: "website", source_url: origin + "/source" });
      const css = await readFile(path.join(systemsDir, id, "colors_and_type.css"), "utf8");
      expect(css).toContain("--primary-blue: #8b4bd7;");
      expect(css).toContain('--font-sans: "Site Sans", var(--font-sans-fallback);');
      expect(css).toContain("--src-token-accent: #b77dea;");
      expect(css).toContain("--src-color-1: #f0e4ff;");
    });
  });

  test("Given a page ground and text colour declared on body through custom properties, then the canonical ground and ink use the resolved values", async () => {
    const html = '<html><head><style>:root { --token-ground: #0f0a1c; --token-ink: #d6d6d6 } html body { background: var(--token-ground, rgb(0, 0, 0)) } body { color: var(--token-ink, #000) } .card body { background: #ff0000 } .card { background: #ffffff } @media (prefers-color-scheme: light) { body { background: #fafafa } }</style></head><body><h1>Home</h1></body></html>';
    await withSite({ "/source": html }, async (origin, id) => {
      await extractDesignSystemFromSource({ system_id: id, name: "Ground", source_type: "website", source_url: origin + "/source" });
      const css = await readFile(path.join(systemsDir, id, "colors_and_type.css"), "utf8");
      expect(css).toContain("--bg: #0f0a1c;");
      expect(css).toContain("--surface: #0f0a1c;");
      expect(css).toContain("--fg-1: #d6d6d6;");
      expect((await parseCssSource({ content: css })).issues).toEqual([]);
    });
  });

  test("Given page colours spread over a linked sheet, conditional or scoped variables, nested rules and named colours, then the canonical ground and ink follow the page's own cascade", async () => {
    const cases: { name: string; routes: Record<string, string>; bg: string; fg: string }[] = [
      { name: "link-then-style", routes: { "/source": '<html><head><link rel="stylesheet" href="/site.css"><style>body{background:#0f0a1c;color:#d6d6d6}</style></head><body><h1>A</h1></body></html>', "/site.css": "body{background:#ffffff;color:#111111}" }, bg: "#0f0a1c", fg: "#d6d6d6" },
      { name: "style-then-link", routes: { "/source": '<html><head><style>body{background:#0f0a1c;color:#d6d6d6}</style><link rel="stylesheet" href="/site.css"></head><body><h1>A</h1></body></html>', "/site.css": "body{background:#ffffff;color:#111111}" }, bg: "#ffffff", fg: "#111111" },
      { name: "media-variable", routes: { "/source": "<html><head><style>:root{--ground:#0f0a1c} body{background:var(--ground)} @media (prefers-color-scheme: light){:root{--ground:#ffffff}}</style></head><body><h1>A</h1></body></html>" }, bg: "#0f0a1c", fg: "#f8fafc" },
      { name: "scoped-variable", routes: { "/source": "<html><head><style>:root{--ground:#0f0a1c} body{background:var(--ground)} .card{--ground:#ffffff}</style></head><body><h1>A</h1></body></html>" }, bg: "#0f0a1c", fg: "#f8fafc" },
      { name: "nested-rule", routes: { "/source": "<html><head><style>body{background:#ffffff;color:#111111} .card{body{background:#0f0a1c;color:#d6d6d6}}</style></head><body><h1>A</h1></body></html>" }, bg: "#ffffff", fg: "#111111" },
      { name: "named-black", routes: { "/source": "<html><head><style>body{background:black}</style></head><body><h1>A</h1></body></html>" }, bg: "#000000", fg: "#f8fafc" },
    ];
    for (const item of cases) {
      await withSite(item.routes, async (origin, id) => {
        await extractDesignSystemFromSource({ system_id: id, name: item.name, source_type: "website", source_url: origin + "/source" });
        const css = await readFile(path.join(systemsDir, id, "colors_and_type.css"), "utf8");
        expect({ name: item.name, bg: /--bg: ([^;]+);/.exec(css)?.[1], fg: /--fg-1: ([^;]+);/.exec(css)?.[1] }).toEqual({ name: item.name, bg: item.bg, fg: item.fg });
      });
    }
  });

  test("Given an opening region with a large image and a script-drawn canvas, then the image is copied as a hero asset and the README hero pattern names it and the canvas", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    const html = '<html><head></head><body><nav><img src="/logo.svg" alt="Brand"></nav><div><img src="/images/rings.png" alt=""><div data-framer-name="Particles Background"><canvas></canvas></div><h1>Own your AI.</h1><p>Private expert AI.</p></div><section><h2>More</h2><img src="/images/later.png" alt=""></section></body></html>';
    await withSite({ "/source": html, "/images/rings.png": png.toString("binary"), "/images/later.png": png.toString("binary"), "/logo.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>" }, async (origin, id) => {
      await extractDesignSystemFromSource({ system_id: id, name: "Hero", source_type: "website", source_url: origin + "/source" });
      const dir = path.join(systemsDir, id);
      expect((await readFile(path.join(dir, "assets", "hero", "rings.png"))).byteLength).toBeGreaterThan(0);
      const readme = await readFile(path.join(dir, "README.md"), "utf8");
      const hero = readme.split("\n").find(line => line.startsWith("- Hero (")) ?? "";
      expect(hero).toContain("assets/hero/rings.png");
      expect(hero).toContain("<canvas>");
      expect(readme).not.toContain("assets/hero/later.png");
    });
  });

  test("Given pages whose card colours differ from the page ground, then each page record and template leads with its page background and text colour roles", async () => {
    const page = (cards: string) => '<html><head><style>:root{--ground:#0f0a1c} html body{background:var(--ground, #000000);color:#d6d6d6} ' + cards + '</style></head><body><nav><a href="/about">About</a></nav><h1>A</h1></body></html>';
    await withSite({ "/source": page(".x{background-color:#141926}"), "/about": page(".card{background-color:#efedff} .alt{background-color:#ffffff}") }, async (origin, id) => {
      await extractDesignSystemFromSource({ system_id: id, name: "Roles", source_type: "website", source_url: origin + "/source" });
      const coverage = parseDesignSystemPageCoverage((await readDesignSystemTokens(id)).pages);
      const about = coverage.pages.find(p => p.path === "/about")!;
      expect(about.colors.slice(0, 2)).toEqual(["page-background: #0f0a1c", "page-color: #d6d6d6"]);
      expect(coverage.templates.find(t => t.path === "/about")!.colors.slice(0, 2)).toEqual(["page-background: #0f0a1c", "page-color: #d6d6d6"]);
      expect(about.colors).toContain("background-color: #efedff");
    });
  });

  test("Given no named primary token, then the most used mid-tone chromatic colour (design tokens before literals) becomes the primary, a named token still wins, and neutral-only sites keep the scaffold", async () => {
    const used = (n: number, style: string) => Array.from({ length: n }, () => '<p style="' + style + '">x</p>').join("");
    const cases = [
      { name: "framer", head: ":root{--token-a:#b77dea;--token-b:#262146;--token-c:#1ac2e6}", body: used(3, "color:var(--token-a, #ffffff)") + used(5, "background-color:var(--token-b)") + used(1, "border-color:#ff0000") + used(6, "color:#2ec4f2"), primary: "#b77dea" },
      { name: "literal-only", head: "body{color:#111111}", body: used(2, "color:#2ec4f2") + used(1, "background:#b77dea"), primary: "#2ec4f2" },
      { name: "light-token", head: ":root{--token-y:#ffd54f}", body: used(3, "background:var(--token-y)"), primary: "#ffd54f" },
      { name: "named", head: ":root{--brand-primary:#123abc;--token-a:#b77dea}", body: used(4, "color:var(--token-a)"), primary: "#123abc" },
      { name: "neutral", head: "body{color:#111111;background:#fafafa}", body: used(3, "color:#333333"), primary: "#0057B8" },
      { name: "feedback-states", head: "a{color:#0d6efd} .btn{background:#0d6efd} .invalid-feedback{color:#dc3545} .is-invalid{border-color:#dc3545} .is-invalid:focus{border-color:#dc3545} .alert-danger{color:#dc3545} a:hover{color:#dc3545}", body: "", primary: "#0d6efd" },
    ];
    for (const item of cases) {
      await withSite({ "/source": "<html><head><style>" + item.head + "</style></head><body>" + item.body + "</body></html>" }, async (origin, id) => {
        await extractDesignSystemFromSource({ system_id: id, name: item.name, source_type: "website", source_url: origin + "/source" });
        const css = await readFile(path.join(systemsDir, id, "colors_and_type.css"), "utf8");
        expect({ name: item.name, primary: /--primary-blue: ([^;]+);/.exec(css)?.[1] }).toEqual({ name: item.name, primary: item.primary });
        // Text on brand fills must stay readable on whatever primary was chosen (WCAG AA for large text or UI).
        const onBrand = /--fg-on-brand: ([^;]+);/.exec(css)?.[1] ?? "";
        const luminance = (hex: string) => { const [r, g, b] = [1, 3, 5].map(i => { const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; };
        const [hi, lo] = [luminance(item.primary.toLowerCase()), luminance(onBrand)].sort((x, y) => y - x) as [number, number];
        expect({ name: item.name, contrastAtLeast3: (hi + 0.05) / (lo + 0.05) >= 3 }).toEqual({ name: item.name, contrastAtLeast3: true });
      });
    }
  });

  test("Given body and code font families, then the sans and display stacks never lead with a monospace family and the mono role uses the code font", async () => {
    const cases = [
      { name: "framer", css: ':root{--framer-font-family:"Inter", sans-serif;--framer-code-font-family:"Fragment Mono", monospace} body{font-family:"Inter", sans-serif} code{font-family:"Fragment Mono", monospace}', sans: "Inter", mono: '"Fragment Mono"' },
      { name: "plain", css: 'code{font-family:"Aa Mono", monospace} body{font-family:"Zeta Sans", sans-serif}', sans: '"Zeta Sans"', mono: '"Aa Mono"' },
      { name: "tailwind-var", css: ':root{--font-mono:"Geist Mono"} code{font-family:var(--font-mono)} body{font-family:"Zeta Sans", sans-serif}', sans: '"Zeta Sans"', mono: '"IBM Plex Mono"' },
      { name: "tailwind-reset", css: 'code,pre{font-family:var(--default-mono-font-family, ui-monospace, monospace)} body{font-family:"Zeta Sans", sans-serif}', sans: '"Zeta Sans"', mono: '"IBM Plex Mono"' },
      { name: "generic-mono", css: 'code{font-family:ui-monospace, SFMono-Regular, monospace} body{font-family:"Zeta Sans", sans-serif}', sans: '"Zeta Sans"', mono: "ui-monospace" },
    ];
    for (const item of cases) {
      await withSite({ "/source": "<html><head><style>" + item.css + "</style></head><body><h1>A</h1></body></html>" }, async (origin, id) => {
        await extractDesignSystemFromSource({ system_id: id, name: item.name, source_type: "website", source_url: origin + "/source" });
        const tokens = await readFile(path.join(systemsDir, id, "colors_and_type.css"), "utf8");
        const fonts = await readFile(path.join(systemsDir, id, "fonts", "fonts.css"), "utf8");
        expect({ name: item.name, sans: /--font-sans: ([^,]+),/.exec(tokens)?.[1], mono: /--font-mono: ([^,]+),/.exec(tokens)?.[1], sansFallback: /--font-sans-fallback: ([^,]+),/.exec(fonts)?.[1], displayFallback: /--font-display-fallback: ([^,]+),/.exec(fonts)?.[1] })
          .toEqual({ name: item.name, sans: item.sans, mono: item.mono, sansFallback: item.sans, displayFallback: item.sans });
      });
    }
  });

  test("Given a dark page ground without a page text colour, then canonical ink and neutrals switch to light values", async () => {
    await withSite({ "/source": '<html><head><style>:root body { background: #0b0b0b }</style></head><body><h1>Home</h1></body></html>' }, async (origin, id) => {
      await extractDesignSystemFromSource({ system_id: id, name: "Dark", source_type: "website", source_url: origin + "/source" });
      const css = await readFile(path.join(systemsDir, id, "colors_and_type.css"), "utf8");
      expect(css).toContain("--bg: #0b0b0b;");
      expect(css).toContain("--fg-1: #f8fafc;");
      expect(css).toContain("--fg-2: #cbd5e1;");
    });
  });

  test("Given no body or html colours, then the canonical ground and ink keep the scaffold defaults", async () => {
    await withSite({ "/source": '<html><head><style>.card { background: #123456; color: #fedcba }</style></head><body><h1>Home</h1></body></html>' }, async (origin, id) => {
      await extractDesignSystemFromSource({ system_id: id, name: "Plain", source_type: "website", source_url: origin + "/source" });
      const css = await readFile(path.join(systemsDir, id, "colors_and_type.css"), "utf8");
      expect(css).toContain("--bg: #ffffff;");
      expect(css).toContain("--fg-1: #0f172a;");
    });
  });

  test("Given a variable Framer font, multiline style attributes and named or modern colours, then canonical tokens stay parsable and keep those signals", async () => {
    const filler = Array.from({ length: 50 }, (_, i) => "--a" + i + ": 1px;").join("");
    const html = '<html><head><style>:root { --brand-font: "Body Sans"; --framer-font-family: var(--brand-font, sans-serif); ' + filler + ' --z-red: red; --z-modern: oklch(62% 0.2 30); --z-word: solid } body { font-family: "Body Sans", sans-serif; background: inherit; color: red; border-color: oklch(62% 0.2 30) }</style></head><body><h1 style="--brand-primary: rgb(\n 18, 52, 86); color: rgb(\n 18, 52, 86)">Home</h1></body></html>';
    await withSite({ "/source": html }, async (origin, id) => {
      await extractDesignSystemFromSource({ system_id: id, name: "Vars", source_type: "website", source_url: origin + "/source" });
      const css = await readFile(path.join(systemsDir, id, "colors_and_type.css"), "utf8");
      expect((await parseCssSource({ content: css })).issues).toEqual([]);
      expect(css).toContain('--font-sans: "Body Sans", var(--font-sans-fallback);');
      expect(css).toContain("--primary-blue: rgb(  18, 52, 86);");
      expect(css).toContain("--src-z-red: red;");
      expect(css).toContain("--src-z-modern: oklch(62% 0.2 30);");
      expect(css).not.toContain("--src-z-word:");
      expect(css).toMatch(/--src-color-\d+: red;/);
      expect(css).toMatch(/--src-color-\d+: oklch\(62% 0\.2 30\);/);
      expect(css).not.toMatch(/--src-color-\d+: inherit;/);
    });
  });

  test("Given style blocks before and after a stylesheet, then document order decides each page's winner", async () => {
    const page = (head: string, title: string) => "<html><head>" + head + '</head><body><nav><a href="/other/page">Other</a></nav><h1>' + title + "</h1></body></html>";
    await withSite({
      "/source": page('<style>:root { --accent: #aa0000 }</style><link rel="stylesheet" href="/b.css">', "Home"),
      "/other/page": page('<link rel="stylesheet" href="/b.css"><style>:root { --accent: #aa0000 }</style>', "Other"),
      "/b.css": ":root { --accent: #0000bb }",
    }, async (origin, id) => {
      await extractDesignSystemFromSource({ system_id: id, name: "Inline", source_type: "website", source_url: origin + "/source" });
      const coverage = parseDesignSystemPageCoverage((await readDesignSystemTokens(id)).pages);
      expect(Object.fromEntries(coverage.pages.filter(p => p.status === "extracted").map(p => [p.path, p.custom_properties["--accent"]]))).toEqual({ "/source": "#0000bb", "/other/page": "#aa0000" });
    });
  });

  test("Given a shared stylesheet plus page-specific backgrounds, then templates and differences keep each page's own colour", async () => {
    const shared = Array.from({ length: 150 }, (_, i) => { const hex = "#" + (i + 1).toString(16).padStart(2, "0").repeat(3); return ".t" + i + "{color:" + hex + "}.bg" + i + "{background-color:" + hex + "}.bd" + i + "{border-color:" + hex + "}"; }).join("");
    const page = (css: string, title: string) => '<html><head><link rel="stylesheet" href="/shared.css"><link rel="stylesheet" href="' + css + '"></head><body><nav><a href="/pricing">Pricing</a></nav><h1>' + title + "</h1></body></html>";
    await withSite({ "/source": page("/home.css", "Home"), "/pricing": page("/pricing.css", "Pricing"), "/shared.css": shared, "/home.css": "body{background-color:#ff0000}", "/pricing.css": "body{background-color:#0000ff}" }, async (origin, id) => {
      await extractDesignSystemFromSource({ system_id: id, name: "Palette", source_type: "website", source_url: origin + "/source" });
      const coverage = parseDesignSystemPageCoverage((await readDesignSystemTokens(id)).pages);
      expect(coverage.templates.find(t => t.page_type === "pricing")!.colors.slice(0, 2)).toEqual(["page-background: #0000ff", "background-color: #0000ff"]);
      expect(coverage.pages.find(p => p.path === "/source")!.colors.slice(0, 2)).toEqual(["page-background: #ff0000", "background-color: #ff0000"]);
      expect(coverage.differences.find(d => d.key === "palette")!.values).toEqual([{ path: "/source", value: "page-background: #ff0000; background-color: #ff0000" }, { path: "/pricing", value: "page-background: #0000ff; background-color: #0000ff" }]);
    });
  });

  test("Given a worst-case system, then the full website design-system context stays under the pinned-context limit and the README section is not duplicated", async () => {
    const properties = (seed: number) => Object.fromEntries(Array.from({ length: 48 }, (_, i) => ["--palette-" + i, "#" + ((seed * 48 + i) % 0xffffff).toString(16).padStart(6, "0")]));
    const coverage = buildPageCoverage({
      limit: 24, discovered: 400,
      extracted: Array.from({ length: 24 }, (_, i) => ({ path: "/section-" + i + "/" + "p".repeat(110), source: "link" as const, pageType: "other" as const, layoutTokens: { "--layout-max": 900 + i + "px" }, patterns: ["hero"], colors: ["background-color: #10" + String(i).padStart(4, "0")], fonts: ["Font " + i], customProperties: properties(i), evidence: EVIDENCE })),
      skipped: Array.from({ length: 200 }, (_, i) => ({ path: "/skipped-" + i + "/" + "q".repeat(110), source: "link" as const, reason: "cap" as const, pageType: "other" as const })),
    });
    const dir = await mkdtemp(path.join(tmpdir(), "bg-pin-budget-"));
    try {
      await writeFile(path.join(dir, "pages.json"), JSON.stringify(coverage, null, 2));
      await writeFile(path.join(dir, "README.md"), "# Big\n\n## Voice\nVOICE_TEXT\n" + buildPageTemplateReadme(coverage) + "\n## Notes\n" + "n".repeat(40_000) + "\n");
      const detail = { id: "pin-budget", name: "Big", status: "draft", source_type: "website", is_template: false, dir_path: dir, skill_md_path: null, tokens_css_path: null, readme_md_path: path.join(dir, "README.md"), thumbnail_path: null, created_at: 1, updated_at: 1, archived_at: null } as const;
      const lines: string[] = [];
      await appendDesignSystemContext(lines, detail as unknown as Parameters<typeof appendDesignSystemContext>[1], "full", "website");
      const context = lines.join("\n");
      expect(context.length).toBeLessThan(100_000);
      expect(context).toContain("<selected_design_system_pages>");
      expect(context).toContain("VOICE_TEXT");
      expect(context).not.toContain("## Page templates");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("Page colour evidence forms", () => {
  test("Given substitution fallbacks and transparent colours, then fallbacks are not reported and alpha is kept", async () => {
    const page = '<html><head><link rel="stylesheet" href="/site.css"></head><body><h1>Home</h1></body></html>';
    await withSite({ "/source": page, "/site.css": ":root{--surface:#0000ff} body{background-color:var(--surface,#ff0000)} .ghost{background-color:rgba(0,0,0,0)} .half{color:#11223380} .solid{color:#445566ff} .fade{border-color:rgba(255,0,0,var(--alpha))} .mix{outline-color:hsl(var(--hue) 50% 50%)}" }, async (origin, id) => {
      await extractDesignSystemFromSource({ system_id: id, name: "Colours", source_type: "website", source_url: origin + "/source" });
      const colors = parseDesignSystemPageCoverage((await readDesignSystemTokens(id)).pages).pages[0]!.colors;
      expect(colors).not.toContain("background-color: #ff0000");
      expect(colors).toEqual(expect.arrayContaining(["background-color: #00000000", "color: #11223380", "color: #445566"]));
      expect(colors.some(color => color.startsWith("border-color: #ff0000"))).toBe(false);
    });
  });
});

describe("Measured layout tokens", () => {
  const viewportLayout = (name: "desktop" | "mobile") => ({ viewport: { ...MEASURED_VIEWPORTS[name] }, page_height: 2400, container: { left: 120, width: 1200 }, gutter: 24, section_gap: 96, type_scale: { hero: 64, h2: 32, body: 20 }, blocks: { hero_heading: { x: 346, y: 407, width: 749, height: 128, align: "center" } }, sections: [{ heading: "Own your AI", top: 407, height: 900, columns: 1, align: "center" }] });

  test("Given an injected measurer, when a website is extracted, then it receives the entry and one page per type with their stylesheets and the result is stored and read back", async () => {
    const calls: RenderedLayoutInput[] = [];
    const layout: DesignSystemMeasuredLayout = { schema_version: 1, method: "rendered-offline", pages: [{ path: "/source", page_type: "other", viewports: { desktop: viewportLayout("desktop"), mobile: viewportLayout("mobile") } }] } as DesignSystemMeasuredLayout;
    const page = (title: string) => '<html><head><link rel="stylesheet" href="/site.css"></head><body><nav><a href="/pricing">Pricing</a><a href="/about">About</a></nav><h1>' + title + "</h1></body></html>";
    await withSite({ "/source": page("Home"), "/pricing": page("Pricing"), "/about": page("About"), "/site.css": "h1{font-size:64px}" }, async (origin, id) => {
      await extractDesignSystemFromSource({ system_id: id, name: "Measured", source_type: "website", source_url: origin + "/source" }, { measureLayout: async input => { calls.push(input); return layout; } });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.pages.map(p => [p.path, p.pageType])).toEqual([["/source", "other"], ["/pricing", "pricing"], ["/about", "about"]]);
      expect(calls[0]!.stylesheets.get(origin + "/site.css")).toBe("h1{font-size:64px}");
      const system = { dir_path: path.join(systemsDir, id) } as Parameters<typeof readDesignSystemMeasuredLayout>[0];
      expect(await readDesignSystemMeasuredLayout(system)).toEqual(layout);
    });
  });

  test("Given a measurer that captures screenshots, when a website is extracted, then only screenshots of measured pages are stored with a verified index and a note counts the missing views", async () => {
    const layout = { schema_version: 1, method: "rendered-offline", pages: [{ path: "/source", page_type: "other", viewports: { desktop: viewportLayout("desktop"), mobile: viewportLayout("mobile") } }] } as DesignSystemMeasuredLayout;
    const jpeg = (label: string) => new TextEncoder().encode(label);
    const page = (title: string) => '<html><body><nav><a href="/pricing">Pricing</a></nav><h1>' + title + "</h1></body></html>";
    await withSite({ "/source": page("Home"), "/pricing": page("Pricing") }, async (origin, id) => {
      const result = await extractDesignSystemFromSource({ system_id: id, name: "Shots", source_type: "website", source_url: origin + "/source" }, { measureLayout: async input => {
        input.captureReference?.({ path: "/source", viewport: "desktop", jpeg: jpeg("source-desktop"), width: 1440, height: 2400 });
        input.captureReference?.({ path: "/pricing", viewport: "desktop", jpeg: jpeg("pricing-desktop"), width: 1440, height: 900 });
        input.captureReference?.({ path: "/source", viewport: "mobile", jpeg: new Uint8Array(MAX_LAYOUT_REFERENCE_BYTES + 1), width: 390, height: 2532 });
        return layout;
      } });
      const dir = path.join(systemsDir, id);
      const reference = parseDesignSystemLayoutReference(JSON.parse(await readFile(path.join(dir, "layout-reference.json"), "utf8")));
      expect(reference.shots.map(shot => [shot.path, shot.viewport, shot.file, shot.height])).toEqual([["/source", "desktop", "layout-reference/p0-desktop.jpg", 2400]]);
      const stored = await readFile(path.join(dir, "layout-reference", "p0-desktop.jpg"));
      expect(new TextDecoder().decode(stored)).toBe("source-desktop");
      expect(reference.shots[0]!.sha256).toBe(createHash("sha256").update(stored).digest("hex"));
      expect(result.extraction.generated_files).toEqual(expect.arrayContaining(["layout-reference.json", "layout-reference/p0-desktop.jpg"]));
      expect(result.extraction.notes.some(note => note.startsWith("Layout reference screenshots were captured for 1 of 2"))).toBe(true);
    });
  });

  test("Given a measurer that fails, then extraction still succeeds without a measured layout file", async () => {
    await withSite({ "/source": "<html><body><h1>Home</h1></body></html>" }, async (origin, id) => {
      await extractDesignSystemFromSource({ system_id: id, name: "Unmeasured", source_type: "website", source_url: origin + "/source" }, { measureLayout: async () => null });
      const system = { dir_path: path.join(systemsDir, id) } as Parameters<typeof readDesignSystemMeasuredLayout>[0];
      expect(await readDesignSystemMeasuredLayout(system)).toBeNull();
    });
  });

  test("Given a measurer that outlives the remaining acquisition budget, then extraction still succeeds without measured tokens and records a note", async () => {
    await withSite({ "/source": "<html><body><h1>Home</h1></body></html>" }, async (origin, id) => {
      const waitForAbort = (input: RenderedLayoutInput) => new Promise<null>((_, reject) => input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true }));
      const result = await extractDesignSystemFromSource({ system_id: id, name: "Slow", source_type: "website", source_url: origin + "/source" }, { timeoutMs: 8_000, measureLayout: waitForAbort });
      expect(result.extraction.notes.some(note => note.startsWith("Rendered layout measurement"))).toBe(true);
      const system = { dir_path: path.join(systemsDir, id) } as Parameters<typeof readDesignSystemMeasuredLayout>[0];
      expect(await readDesignSystemMeasuredLayout(system)).toBeNull();
    });
  }, 30_000);

  test("Given a measurer that throws, then extraction still succeeds without measured tokens", async () => {
    await withSite({ "/source": "<html><body><h1>Home</h1></body></html>" }, async (origin, id) => {
      const result = await extractDesignSystemFromSource({ system_id: id, name: "Broken", source_type: "website", source_url: origin + "/source" }, { measureLayout: async () => { throw new Error("chromium_not_installed"); } });
      expect(result.extraction.notes.some(note => note.startsWith("Rendered layout measurement"))).toBe(true);
    });
  });

  test("Given a measurement deadline that fires during a later page, then the pages measured before it are kept, an abort before any page propagates, and other failures give no layout", async () => {
    // Contexts open in order: entry desktop, entry mobile, second page desktop, ...; failAt picks the one that fails.
    const run = async (failAt: number, abort: boolean) => {
      const controller = new AbortController();
      let opened = 0;
      const context = (index: number) => ({
        routeWebSocket: async () => {}, route: async () => {}, close: async () => {},
        newPage: async () => ({ goto: async () => {}, evaluate: async (_fn: unknown, arg: { width: number }) => {
          if (index === failAt) { if (abort) controller.abort(new Error("layout_measure_deadline")); throw new Error("Chromium connection aborted"); }
          return viewportLayout(arg.width === MEASURED_VIEWPORTS.desktop.width ? "desktop" : "mobile");
        } }),
      });
      const browser = { newContext: async () => context(opened++), close: async () => {} };
      const pages = ["/source", "/pricing"].map(p => ({ path: p, pageType: p === "/source" ? "other" as const : "pricing" as const, url: "https://site.test" + p, html: "<h1>x</h1>" }));
      return measureRenderedLayout({ pages, stylesheets: new Map(), signal: controller.signal, launch: async () => browser as unknown as Browser });
    };
    expect((await run(2, true))?.pages.map(page => page.path)).toEqual(["/source"]);
    await expect(run(0, true)).rejects.toThrow("Chromium connection aborted");
    expect(await run(2, false)).toBeNull();
  });

  test("Given malformed measured layouts, then the strict parser rejects them", () => {
    const valid = { schema_version: 1, method: "rendered-offline", pages: [{ path: "/", page_type: "home", viewports: { desktop: viewportLayout("desktop"), mobile: viewportLayout("mobile") } }] };
    expect(() => parseDesignSystemMeasuredLayout(valid)).not.toThrow();
    const broken = [
      { ...valid, method: "static" },
      { ...valid, pages: [{ ...valid.pages[0], viewports: { desktop: { ...viewportLayout("desktop"), viewport: { width: 1280, height: 900 } }, mobile: viewportLayout("mobile") } }] },
      { ...valid, pages: [{ ...valid.pages[0], viewports: { desktop: { ...viewportLayout("desktop"), type_scale: { display: 80 } }, mobile: viewportLayout("mobile") } }] },
      { ...valid, pages: [{ ...valid.pages[0], viewports: { desktop: { ...viewportLayout("desktop"), sections: [{ heading: "<script>", top: 0, height: 1, columns: 1, align: "left" }] }, mobile: viewportLayout("mobile") } }] },
      { ...valid, extra: true },
    ];
    for (const value of broken) expect(() => parseDesignSystemMeasuredLayout(value)).toThrow();
  });

  test("Given subheading and CTA type roles, then the strict parser keeps them beside the older roles", () => {
    const withRoles = (name: "desktop" | "mobile") => ({ ...viewportLayout(name), type_scale: { hero: 64, subheading: 24, cta: 17, nav: 26 } });
    const parsed = parseDesignSystemMeasuredLayout({ schema_version: 1, method: "rendered-offline", pages: [{ path: "/", page_type: "home", viewports: { desktop: withRoles("desktop"), mobile: withRoles("mobile") } }] });
    expect(parsed.pages[0]!.viewports.desktop.type_scale).toEqual({ hero: 64, subheading: 24, cta: 17, nav: 26 });
  });

  test.skipIf(process.env.BG_BROWSER_SMOKE !== "1")("Given a real Chromium, when an acquired page is measured offline, then sizes and positions come from rendering and the page script does not run", async () => {
    const html = '<!doctype html><html><head><link rel="stylesheet" href="https://site.test/site.css"><script>document.documentElement.innerHTML = "<h1 style=font-size:10px>changed</h1>"</script></head><body><main><h1>Own your AI.</h1><p class="sub">Private expert AI systems powered by local models</p><a class="cta" href="/go">Get started</a><img src="https://cdn.test/hero.png" width="600" height="300"><h2>Section two</h2><div class="cards"><div>One card with a long enough body text</div><div>Two card with a long enough body text</div><div>Three card with a long enough body text</div></div></main></body></html>';
    const css = "body{margin:0} main{max-width:960px;margin:0 auto} h1{font-size:64px;text-align:center} h2{font-size:32px} p{font-size:20px} .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:24px} .cards div{height:120px}";
    const layout = await measureRenderedLayout({ pages: [{ path: "/", pageType: "home", url: "https://site.test/", html }], stylesheets: new Map([["https://site.test/site.css", css]]), signal: AbortSignal.timeout(60_000) });
    expect(layout).not.toBeNull();
    const desktop = layout!.pages[0]!.viewports.desktop;
    expect(desktop.type_scale).toMatchObject({ hero: 64, h2: 32, subheading: 20, cta: 16 });
    expect(desktop.blocks.hero_heading?.align).toBe("center");
    expect(desktop.container).toEqual({ left: 240, width: 960 });
    expect(desktop.sections.map(section => section.columns)).toEqual([1, 3]);
    expect(desktop.blocks.media).toMatchObject({ width: 600, height: 300 });
    expect(desktop.gutter).toBe(24);
  }, 90_000);

  test.skipIf(process.env.BG_BROWSER_SMOKE !== "1")("Given a real Chromium and a reference capture, when a tall page is measured, then each viewport yields a JPEG capped at three viewport heights and the measured values are unchanged", async () => {
    const html = '<!doctype html><html><head><link rel="stylesheet" href="https://site.test/site.css"></head><body><h1>Own your AI.</h1><img src="https://cdn.test/hero.png" width="600" height="300"><div class="tall"></div></body></html>';
    const css = "body{margin:0} h1{font-size:64px} .tall{height:5000px}";
    const input = { pages: [{ path: "/", pageType: "home" as const, url: "https://site.test/", html }], stylesheets: new Map([["https://site.test/site.css", css]]), signal: AbortSignal.timeout(60_000) };
    const shots: { viewport: string; jpeg: Uint8Array; width: number; height: number }[] = [];
    const captured = await measureRenderedLayout({ ...input, captureReference: shot => shots.push(shot) });
    expect(captured).toEqual(await measureRenderedLayout(input));
    expect(shots.map(shot => [shot.viewport, shot.width, shot.height])).toEqual([["desktop", 1440, 2700], ["mobile", 390, 2532]]);
    for (const shot of shots) expect([...shot.jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  }, 90_000);

  test.skipIf(process.env.BG_BROWSER_SMOKE !== "1")("Given centred 1200px section wrappers holding a narrow centred text column, when measured, then the container is the wrapper width rather than the text column", async () => {
    const section = (title: string) => '<section class="wrap"><h2>' + title + '</h2><p class="narrow">A narrow centred paragraph that stays well inside the wrapper width on purpose.</p><div class="panel"></div></section>';
    const html = '<!doctype html><html><head><link rel="stylesheet" href="https://site.test/site.css"></head><body><section class="wrap"><h1>Own your AI.</h1><p class="narrow">Private expert AI systems powered by local models</p></section>' + section("One") + section("Two") + "</body></html>";
    const css = "body{margin:0} .wrap{max-width:1200px;margin:0 auto 96px} h1,h2,p{text-align:center} .narrow{max-width:540px;margin:0 auto} .panel{height:240px;background:#222}";
    const layout = await measureRenderedLayout({ pages: [{ path: "/", pageType: "home", url: "https://site.test/", html }], stylesheets: new Map([["https://site.test/site.css", css]]), signal: AbortSignal.timeout(60_000) });
    expect(layout!.pages[0]!.viewports.desktop.container).toEqual({ left: 120, width: 1200 });
  }, 90_000);

  test.skipIf(process.env.BG_BROWSER_SMOKE !== "1")("Given a full-width padded layout with one centred 720px lead paragraph, when measured, then the container stays at the text edges rather than the lone centred element", async () => {
    const section = (title: string) => "<section><h2>" + title + "</h2><p>Left aligned body copy that runs across the full padded width of the layout for this section.</p></section>";
    const html = '<!doctype html><html><head><link rel="stylesheet" href="https://site.test/site.css"></head><body><div class="wrap"><h1>Own your AI.</h1><p class="lead">A centred lead paragraph with its own narrow max width.</p>' + section("One") + section("Two") + section("Three") + "</div></body></html>";
    const css = "body{margin:0} .wrap{padding:0 24px} .lead{max-width:720px;margin:0 auto;text-align:center}";
    const layout = await measureRenderedLayout({ pages: [{ path: "/", pageType: "home", url: "https://site.test/", html }], stylesheets: new Map([["https://site.test/site.css", css]]), signal: AbortSignal.timeout(60_000) });
    expect(layout!.pages[0]!.viewports.desktop.container).toEqual({ left: 24, width: 1392 });
  }, 90_000);
});

describe("Measured layout prompt injection", () => {
  const viewport = (name: "desktop" | "mobile", sections: number, heading: string) => ({ viewport: { ...MEASURED_VIEWPORTS[name] }, page_height: 9000, container: { left: 120, width: 1200 }, gutter: 24, section_gap: 96, type_scale: { hero: 64, h2: 50, h3: 32, body: 17, nav: 17 }, blocks: { hero_heading: { x: 346, y: 407, width: 749, height: 128, align: "center" }, subheading: { x: 346, y: 567, width: 749, height: 64, align: "center" }, cta: { x: 649, y: 663, width: 143, height: 38, align: "center" }, media: { x: 120, y: 70, width: 1200, height: 909, align: "center" } }, sections: Array.from({ length: sections }, (_, i) => ({ heading, top: 400 + i * 500, height: 500, columns: 3, align: "center" })) });
  const layoutOf = (pages: number, sections: number, heading = "Own your AI") => ({ schema_version: 1, method: "rendered-offline", pages: Array.from({ length: pages }, (_, i) => ({ path: "/p" + i, page_type: i === 0 ? "home" : "other", viewports: { desktop: viewport("desktop", sections, heading), mobile: viewport("mobile", sections, heading) } })) });
  const render = async (dir: string, surface: "website" | "slides") => {
    const detail = { id: "measured", name: "Measured", status: "draft", source_type: "website", is_template: false, dir_path: dir, skill_md_path: null, tokens_css_path: null, readme_md_path: null, thumbnail_path: null, created_at: 1, updated_at: 1, archived_at: null } as const;
    const lines: string[] = [];
    await appendDesignSystemContext(lines, detail as unknown as Parameters<typeof appendDesignSystemContext>[1], "full", surface);
    return lines.join("\n");
  };

  test("Given a measured layout, then only the website context carries it as a parsed block, and a system without one carries none", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bg-measured-prompt-"));
    try {
      expect(await render(dir, "website")).not.toContain("<selected_design_system_measured_layout>");
      const layout = layoutOf(1, 3);
      await writeFile(path.join(dir, "layout-measured.json"), JSON.stringify(layout));
      const block = (await render(dir, "website")).match(/<selected_design_system_measured_layout>\n([^\n]+)\n<\/selected_design_system_measured_layout>/u);
      expect(JSON.parse(block![1]!)).toEqual(parseDesignSystemMeasuredLayout(layout).pages);
      expect(await render(dir, "slides")).not.toContain("<selected_design_system_measured_layout>");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  test("Given the largest measured layout the parser accepts beside a worst-case page coverage and long design-system files, then the website context stays under the pinned-context limit with a bounded measured block", async () => {
    const big = { x: 100_000, y: 100_000, width: 100_000, height: 100_000, align: "center" };
    const maxViewport = (name: "desktop" | "mobile") => ({ viewport: { ...MEASURED_VIEWPORTS[name] }, page_height: 100_000, container: { left: 100_000, width: 100_000 }, gutter: 100_000, section_gap: 100_000, type_scale: { hero: 100_000, h2: 100_000, h3: 100_000, body: 100_000, nav: 100_000 }, blocks: { hero_heading: big, subheading: big, cta: big, media: big }, sections: Array.from({ length: 16 }, () => ({ heading: '"'.repeat(60), top: 100_000, height: 100_000, columns: 100_000, align: "center" })) });
    const maxLayout = { schema_version: 1, method: "rendered-offline", pages: Array.from({ length: 6 }, (_, i) => ({ path: "/" + String(i) + "<".repeat(298), page_type: "other", viewports: { desktop: maxViewport("desktop"), mobile: maxViewport("mobile") } })) };
    const coverage = buildPageCoverage({
      limit: 24, discovered: 400,
      extracted: Array.from({ length: 24 }, (_, i) => ({ path: "/section-" + i + "/" + "p".repeat(110), source: "link" as const, pageType: "other" as const, layoutTokens: { "--layout-max": 900 + i + "px" }, patterns: ["hero"], colors: ["background-color: #10" + String(i).padStart(4, "0")], fonts: ["Font " + i], customProperties: Object.fromEntries(Array.from({ length: 48 }, (_, k) => ["--palette-" + k, "#" + ((i * 48 + k) % 0xffffff).toString(16).padStart(6, "0")])), evidence: EVIDENCE })),
      skipped: Array.from({ length: 200 }, (_, i) => ({ path: "/skipped-" + i + "/" + "q".repeat(110), source: "link" as const, reason: "cap" as const, pageType: "other" as const })),
    });
    const dir = await mkdtemp(path.join(tmpdir(), "bg-measured-budget-"));
    try {
      await writeFile(path.join(dir, "layout-measured.json"), JSON.stringify(maxLayout));
      await writeFile(path.join(dir, "pages.json"), JSON.stringify(coverage, null, 2));
      await writeFile(path.join(dir, "README.md"), "# Big\n\n## Voice\nVOICE_TEXT\n" + buildPageTemplateReadme(coverage) + "\n## Notes\n" + "n".repeat(40_000) + "\n");
      await writeFile(path.join(dir, "SKILL.md"), "# Skill\n" + "s".repeat(60_000) + "\n");
      await writeFile(path.join(dir, "colors_and_type.css"), ":root {\n" + Array.from({ length: 3000 }, (_, i) => "  --t" + i + ": #123456;").join("\n") + "\n}\n");
      for (const mode of ["full", "compact"] as const) {
        const detail = { id: "measured-budget", name: "Big", status: "draft", source_type: "website", is_template: false, dir_path: dir, skill_md_path: path.join(dir, "SKILL.md"), tokens_css_path: path.join(dir, "colors_and_type.css"), readme_md_path: path.join(dir, "README.md"), thumbnail_path: null, created_at: 1, updated_at: 1, archived_at: null } as const;
        const lines: string[] = [];
        await appendDesignSystemContext(lines, detail as unknown as Parameters<typeof appendDesignSystemContext>[1], mode, "website");
        const context = lines.join("\n");
        expect(context.length).toBeLessThan(100_000);
        const block = context.match(/<selected_design_system_measured_layout>\n([^\n]+)\n/u)?.[1] ?? "";
        expect(block.length).toBeGreaterThan(0);
        expect(block.length).toBeLessThanOrEqual(mode === "full" ? 12_000 : 6_000);
        expect(JSON.parse(block).length).toBeGreaterThan(0);
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
