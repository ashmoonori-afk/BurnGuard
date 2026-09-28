import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseDesignSystemPageCoverage } from "@bg/shared";
import { getSqlite } from "../src/db/sqlite-client";
import { appendDesignSystemContext } from "../src/harness/prompt-design-system";
import { systemsDir } from "../src/lib/paths";
import { extractDesignSystemFromSource, readDesignSystemTokens } from "../src/services/design-system-extract";
import { analyzeLocalTree } from "../src/services/extraction-local-tree";
import { buildPageCoverage, canonicalPagePath, classifyPageType, discoverPages, parseRobots, parseSitemap } from "../src/services/extraction-pages";

describe("Page discovery primitives", () => {
  test("Given robots.txt groups, then the longest matching rule wins, ties allow, wildcards apply and other agents are ignored", () => {
    const robots = parseRobots(["User-agent: Googlebot", "Disallow: /", "", "User-agent: *", "Disallow: /private", "Allow: /private/public", "Disallow: /*.json$", "Disallow:", "Sitemap: https://example.com/sitemap.xml"].join("\n"));
    expect(["/", "/pricing", "/private", "/private/x", "/private/public/page", "/data.json", "/data.json/x"].map(robots.allows)).toEqual([true, true, false, false, true, false, true]);
    expect(robots.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
    expect(parseRobots("").allows("/anything")).toBe(true);
  });

  test("Given sitemaps and hrefs, then locations are read and paths are canonical, same-origin pages only", () => {
    expect(parseSitemap("<urlset><url><loc> https://e.com/a </loc></url><url><loc>https://e.com/b?x=1&amp;y=2</loc></url></urlset>")).toEqual({ urls: ["https://e.com/a", "https://e.com/b?x=1&y=2"], isIndex: false });
    expect(parseSitemap("<sitemapindex><sitemap><loc>https://e.com/s1.xml</loc></sitemap></sitemapindex>").isIndex).toBe(true);
    const base = new URL("https://e.com/");
    expect(["/pricing/", "/pricing#plans", "/pricing?ref=nav", "/blog/index.html", "https://other.com/x", "/brochure.pdf", "mailto:a@e.com", "//e.com//docs//"].map(href => canonicalPagePath(href, base))).toEqual(["/pricing", "/pricing", "/pricing", "/blog", null, null, null, "/docs"]);
  });

  test("Given a landing page, then candidates come entry-first in nav, footer, sitemap and link order, deduped, with robots and cap skips kept", () => {
    const html = '<header><nav><a href="/pricing">P</a><a href="/blog/">B</a><a href="/private/x">X</a></nav></header><main><a href="/pricing#top">again</a><a href="/careers">C</a></main><footer><a href="/about">A</a></footer>';
    const result = discoverPages({ base: new URL("https://e.com/"), homepageHtml: html, sitemapUrls: ["https://e.com/contact", "https://e.com/blog"], robots: parseRobots("User-agent: *\nDisallow: /private"), limit: 4 });
    expect(result.discovered).toBe(7);
    expect(result.selected).toEqual([{ path: "/", source: "entry" }, { path: "/pricing", source: "nav" }, { path: "/blog", source: "nav" }, { path: "/about", source: "footer" }]);
    expect(result.skipped).toEqual([{ path: "/private/x", source: "nav", reason: "robots" }, { path: "/contact", source: "sitemap", reason: "cap" }, { path: "/careers", source: "link", reason: "cap" }]);
  });

  test("Given paths and headings, then page types follow the path first and the heading second", () => {
    expect(["/", "/pricing", "/docs/getting-started", "/blog/post-1", "/features", "/company/team", "/contact-sales", "/x"].map(p => classifyPageType(p, ""))).toEqual(["home", "pricing", "docs", "blog", "product", "about", "contact", "other"]);
    expect(classifyPageType("/x", "<title>Plans and pricing</title>")).toBe("pricing");
  });

  test("Given extracted pages, then templates take the first page per type, differing values are recorded and the document parses strictly", () => {
    const coverage = buildPageCoverage({
      limit: 12, discovered: 5,
      extracted: [
        { path: "/", source: "entry", pageType: "home", layoutTokens: { "--layout-max": "1140px" }, patterns: ["hero"], colors: ["#111111"], fonts: ["Brand Sans"] },
        { path: "/pricing", source: "nav", pageType: "pricing", layoutTokens: { "--layout-max": "960px" }, patterns: ["pricing"], colors: [], fonts: ["Brand Serif"] },
        { path: "/plans", source: "link", pageType: "pricing", layoutTokens: { "--layout-max": "960px" }, patterns: [], colors: [], fonts: [] },
      ],
      skipped: [{ path: "/private", source: "nav", reason: "robots", pageType: "other" }],
    });
    expect(coverage.templates.map(template => [template.page_type, template.path])).toEqual([["home", "/"], ["pricing", "/pricing"]]);
    expect(coverage.differences).toEqual([
      { key: "--layout-max", values: [{ path: "/", value: "1140px" }, { path: "/pricing", value: "960px" }, { path: "/plans", value: "960px" }] },
      { key: "primary-font", values: [{ path: "/", value: "Brand Sans" }, { path: "/pricing", value: "Brand Serif" }] },
    ]);
    expect(parseDesignSystemPageCoverage(JSON.parse(JSON.stringify(coverage)))).toEqual(coverage);
    expect(() => parseDesignSystemPageCoverage({ ...coverage, extra: 1 })).toThrow();
    expect(() => parseDesignSystemPageCoverage({ ...coverage, page_limit: 99 })).toThrow();
    expect(() => parseDesignSystemPageCoverage({ ...coverage, pages: [{ ...coverage.pages[0]!, status: "skipped" }] })).toThrow();
    expect(() => parseDesignSystemPageCoverage({ ...coverage, pages: [coverage.pages[0], coverage.pages[0]] })).toThrow();
    expect(() => parseDesignSystemPageCoverage({ ...coverage, pages: [{ ...coverage.pages[0]!, path: "https://e.com/" }] })).toThrow();
    expect(() => parseDesignSystemPageCoverage({ ...coverage, templates: [{ ...coverage.templates[0]!, layout_tokens: { "--layout-max": "url(x)" } }] })).toThrow();
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
  test("Given a multi-page site, when extracted, then pages are discovered, bounded, typed and measured per page, persisted, served and injected for websites only", async () => {
    const shared = "body { font-family: 'Brand Sans', sans-serif; color: #1b1b1f } .grid { display: grid; grid-template-columns: repeat(12, 1fr); column-gap: 24px }";
    const page = (title: string, css: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="/shared.css"><link rel="stylesheet" href="/${css}"></head><body><header><nav><a href="/pricing">Pricing</a><a href="/blog/">Blog</a><a href="/docs#intro">Docs</a><a href="/private/area">Private</a></nav></header>${body}<footer><ul><li><a href="/about">About</a></li></ul><ul><li><a href="/contact">Contact</a></li></ul></footer></body></html>`;
    const routes: Record<string, [string, string]> = {
      "/source": [page("Brand", "home.css", '<section class="hero"><h1>Brand</h1><img alt="Team"></section>'), "text/html"],
      "/pricing": [page("Pricing", "pricing.css", '<section class="pricing-plans"><h1>Plans</h1></section>'), "text/html"],
      "/blog": [page("Blog", "home.css", "<main><h1>Blog</h1></main>"), "text/html"],
      "/docs": [page("Docs", "home.css", "<main><h1>Docs</h1></main>"), "text/html"],
      "/robots.txt": ["User-agent: *\nDisallow: /private\nSitemap: /sitemap.xml", "text/plain"],
      "/sitemap.xml": ["<urlset><url><loc>/pricing</loc></url><url><loc>/contact</loc></url></urlset>", "application/xml"],
      "/shared.css": [shared, "text/css"],
      "/home.css": [".container { max-width: 1140px }", "text/css"],
      "/pricing.css": [".container { max-width: 960px }", "text/css"],
    };
    const requests: string[] = [];
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => {
      const pathname = new URL(request.url).pathname.replace(/\/$/, "") || "/";
      requests.push(pathname);
      const route = routes[pathname];
      return route ? new Response(route[0], { headers: { "content-type": route[1] } }) : new Response("missing", { status: 404 });
    } });
    const origin = `http://127.0.0.1:${server.port}`;
    const settings = {
      BG_EXTRACTION_QA_ADAPTER_SOURCE_URL: `${origin}/source`,
      BG_EXTRACTION_QA_ADAPTER_STALL_URL: `${origin}/stall`,
      BG_EXTRACTION_QA_ADAPTER_RESOURCE_URLS: ["/source", "/stall", "/robots.txt", "/sitemap.xml", "/pricing", "/blog", "/docs", "/shared.css", "/home.css", "/pricing.css"].map(p => origin + p).join(","),
      BG_EXTRACTION_QA_ADAPTER_SECRET: "per-page-fixture-secret-000000000001",
    };
    const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
    Object.assign(process.env, settings);
    const id = `pages-${process.pid}`;
    try {
      await extractDesignSystemFromSource({ system_id: id, name: "Brand", source_type: "website", source_url: `${origin}/source`, page_limit: 4 });
      expect(requests.filter(p => p.endsWith(".css")).sort()).toEqual(["/home.css", "/pricing.css", "/shared.css"]);
      expect(requests).not.toContain("/private/area");
      const coverage = parseDesignSystemPageCoverage((await readDesignSystemTokens(id)).pages);
      expect(coverage.page_limit).toBe(4);
      expect(coverage.pages.map(p => [p.path, p.page_type, p.status, p.skip_reason])).toEqual([
        ["/source", "home", "extracted", null], ["/pricing", "pricing", "extracted", null], ["/blog", "blog", "extracted", null], ["/docs", "docs", "extracted", null],
        ["/private/area", "other", "skipped", "robots"], ["/about", "about", "skipped", "cap"], ["/contact", "contact", "skipped", "cap"],
      ]);
      expect(coverage.pages.find(p => p.path === "/pricing")!.layout_tokens["--layout-max"]).toBe("960px");
      expect(coverage.pages.find(p => p.path === "/source")!.layout_tokens["--layout-max"]).toBe("1140px");
      expect(coverage.pages.find(p => p.path === "/pricing")!.patterns).toContain("pricing");
      expect(coverage.differences.find(d => d.key === "--layout-max")!.values).toEqual([{ path: "/source", value: "1140px" }, { path: "/pricing", value: "960px" }, { path: "/blog", value: "1140px" }, { path: "/docs", value: "1140px" }]);
      expect(coverage.templates.map(t => t.page_type)).toEqual(["home", "pricing", "blog", "docs"]);
      const readme = await readFile(path.join(systemsDir, id, "README.md"), "utf8");
      expect(readme).toContain("## Page templates");

      const detail = { id, name: "Brand", status: "draft", source_type: "website", is_template: false, dir_path: path.join(systemsDir, id), skill_md_path: null, tokens_css_path: null, readme_md_path: path.join(systemsDir, id, "README.md"), thumbnail_path: null, created_at: 1, updated_at: 1, archived_at: null } as const;
      const render = async (surface: "website" | "slides") => { const lines: string[] = []; await appendDesignSystemContext(lines, detail as unknown as Parameters<typeof appendDesignSystemContext>[1], "full", surface); return lines.join("\n"); };
      const website = await render("website");
      const block = website.match(/<selected_design_system_pages>\n([^\n]+)\n<\/selected_design_system_pages>/u);
      expect(JSON.parse(block![1]!)).toEqual({ templates: coverage.templates, differences: coverage.differences });
      const slides = await render("slides");
      expect(slides).not.toContain("<selected_design_system_pages>");
    } finally {
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      await server.stop(true);
      getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(id);
      await rm(path.join(systemsDir, id), { recursive: true, force: true });
    }
  });
});
