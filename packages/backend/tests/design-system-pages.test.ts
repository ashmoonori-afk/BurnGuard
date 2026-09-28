import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseDesignSystemPageCoverage, type DesignSystemPageEvidence } from "@bg/shared";
import { getSqlite } from "../src/db/sqlite-client";
import { appendDesignSystemContext } from "../src/harness/prompt-design-system";
import { systemsDir } from "../src/lib/paths";
import { extractDesignSystemFromSource, readDesignSystemTokens } from "../src/services/design-system-extract";
import { analyzeLocalTree } from "../src/services/extraction-local-tree";
import { buildPageCoverage, canonicalPagePath, classifyPageType, discoverPages, pageLink, parseRobots, parseSitemap, robotsPatternMatches } from "../src/services/extraction-pages";

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
    expect(coverage.differences.map(d => d.key)).toEqual(["--layout-max", "--brand-accent", "primary-font", "alignment"]);
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
