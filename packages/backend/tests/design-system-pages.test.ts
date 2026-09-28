import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MAX_PAGE_COVERAGE_BYTES, parseDesignSystemPageCoverage, type DesignSystemPageEvidence } from "@bg/shared";
import { getSqlite } from "../src/db/sqlite-client";
import { appendDesignSystemContext } from "../src/harness/prompt-design-system";
import { systemsDir } from "../src/lib/paths";
import { extractDesignSystemFromSource, readDesignSystemTokens } from "../src/services/design-system-extract";
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

  test("Given no named primary token, then the most used mid-tone chromatic colour (design tokens before literals) becomes the primary, a named token still wins, and neutral-only sites keep the scaffold", async () => {
    const used = (n: number, style: string) => Array.from({ length: n }, () => '<p style="' + style + '">x</p>').join("");
    const cases = [
      { name: "framer", head: ":root{--token-a:#b77dea;--token-b:#262146;--token-c:#1ac2e6}", body: used(3, "color:var(--token-a, #ffffff)") + used(5, "background-color:var(--token-b)") + used(1, "border-color:#ff0000") + used(6, "color:#2ec4f2"), primary: "#b77dea" },
      { name: "literal-only", head: "body{color:#111111}", body: used(2, "color:#2ec4f2") + used(1, "background:#b77dea"), primary: "#2ec4f2" },
      { name: "named", head: ":root{--brand-primary:#123abc;--token-a:#b77dea}", body: used(4, "color:var(--token-a)"), primary: "#123abc" },
      { name: "neutral", head: "body{color:#111111;background:#fafafa}", body: used(3, "color:#333333"), primary: "#0057B8" },
    ];
    for (const item of cases) {
      await withSite({ "/source": "<html><head><style>" + item.head + "</style></head><body>" + item.body + "</body></html>" }, async (origin, id) => {
        await extractDesignSystemFromSource({ system_id: id, name: item.name, source_type: "website", source_url: origin + "/source" });
        const css = await readFile(path.join(systemsDir, id, "colors_and_type.css"), "utf8");
        expect({ name: item.name, primary: /--primary-blue: ([^;]+);/.exec(css)?.[1] }).toEqual({ name: item.name, primary: item.primary });
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
      expect(coverage.templates.find(t => t.page_type === "pricing")!.colors[0]).toBe("background-color: #0000ff");
      expect(coverage.pages.find(p => p.path === "/source")!.colors[0]).toBe("background-color: #ff0000");
      expect(coverage.differences.find(d => d.key === "palette")!.values).toEqual([{ path: "/source", value: "background-color: #ff0000" }, { path: "/pricing", value: "background-color: #0000ff" }]);
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
