import { describe, expect, test } from "bun:test";
import { auditSiteStructure } from "../src/services/site-shared-blocks";
import { buildSiteMap } from "../src/services/site-map";

const files = ["index.html", "about.html", "legacy.html"].map((rel_path) => ({ rel_path, category: "html" as const }));

describe("auditSiteStructure", () => {
  test("Given shared and legacy pages with navigation defects When audited Then advisory findings own their page and active-link normalization avoids false divergence", async () => {
    // Given
    const html = new Map([
      ["index.html", '<style>/* @bg-shared-css */nav{}/* @bg-page-css */main{}</style><header data-bg-shared="header">Brand</header><nav data-bg-shared="nav"><a aria-current="page" href="index.html">Home</a><a href="about.html">About</a><a href="missing.html">Missing</a></nav><main data-bg-content>Home</main><footer data-bg-shared="footer">Foot</footer>'],
      ["about.html", '<style>/* @bg-shared-css */nav{}/* @bg-page-css */main{}</style><header data-bg-shared="header">Brand</header><nav data-bg-shared="nav"><a href="index.html">Home</a><a aria-current="page" href="about.html">About</a><a href="missing.html">Missing</a></nav><main data-bg-content>About<img src="/asset.png"></main><footer data-bg-shared="footer">Foot</footer>'],
      ["legacy.html", '<header>Other brand</header><nav><a href="index.html">Home</a></nav><main>Legacy</main><footer>Legacy foot</footer>'],
    ]);
    const siteMap = await buildSiteMap(files, "index.html", (relPath) => html.get(relPath) ?? "");

    // When
    const result = auditSiteStructure(siteMap, [...html].map(([rel_path, source]) => ({ rel_path, html: source })));

    // Then
    expect(result.findings).toContainEqual(expect.objectContaining({ code: "site_dangling_link", rel_path: "index.html", severity: "recommended" }));
    expect(result.findings).toContainEqual(expect.objectContaining({ code: "site_root_absolute_asset", rel_path: "about.html", severity: "recommended" }));
    expect(result.findings).toContainEqual(expect.objectContaining({ code: "site_missing_shared_block", rel_path: "legacy.html", severity: "recommended" }));
    expect(result.findings.some((finding) => finding.code === "site_nav_mismatch" && finding.rel_path === "about.html")).toBe(false);
    expect(result.divergent_pages).toEqual(["legacy.html"]);
  });

  test("Given a page without a current navigation marker When audited Then the missing aria-current finding is advisory", async () => {
    // Given
    const html = new Map([
      ["index.html", '<header data-bg-shared="header"></header><nav data-bg-shared="nav"><a href="index.html">Home</a><a href="about.html">About</a></nav><main data-bg-content></main><footer data-bg-shared="footer"></footer><style>/* @bg-shared-css *//* @bg-page-css */</style>'],
      ["about.html", '<header data-bg-shared="header"></header><nav data-bg-shared="nav"><a href="index.html">Home</a><a href="about.html">About</a></nav><main data-bg-content></main><footer data-bg-shared="footer"></footer><style>/* @bg-shared-css *//* @bg-page-css */</style>'],
    ]);
    const siteMap = await buildSiteMap(files.slice(0, 2), "index.html", (relPath) => html.get(relPath) ?? "");

    // When
    const result = auditSiteStructure(siteMap, [...html].map(([rel_path, source]) => ({ rel_path, html: source })));

    // Then
    expect(result.findings.filter((finding) => finding.code === "site_missing_aria_current")).toHaveLength(2);
    expect(result.findings.every((finding) => finding.severity === "recommended")).toBe(true);
  });

  test("Given srcset candidates that are root-absolute first or after a bare comma When audited Then site_root_absolute_asset is reported and protocol-relative, relative or data-URI candidates are not", async () => {
    // Given: a base64 JPEG payload starts with "/9j/" right after a comma that belongs to the URL.
    const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ";
    const html = new Map([
      ["index.html", '<picture><source srcset="/img/a.webp 1x"><img src="img/a.png" alt=""></picture>'],
      ["about.html", '<img srcset="img/a.png 1x,/img/b.png 2x" alt="">'],
      ["legacy.html", '<img srcset="//cdn.example/a.png 1x, img/b.png 2x" alt="">'],
      ["data-first.html", `<img src="img/hero.jpg" srcset="${jpeg} 1x, img/hero@2x.jpg 2x" alt="">`],
      ["data-later.html", `<img srcset="img/hero.jpg 1x, ${jpeg} 2x" alt="">`],
      ["data-then-root.html", `<img srcset="${jpeg} 1x, /img/b.png 2x" alt="">`],
    ]);
    const siteMap = await buildSiteMap([...html.keys()].map((rel_path) => ({ rel_path, category: "html" as const })), "index.html", (relPath) => html.get(relPath) ?? "");

    // When
    const result = auditSiteStructure(siteMap, [...html].map(([rel_path, source]) => ({ rel_path, html: source })));

    // Then
    expect(result.findings.filter((finding) => finding.code === "site_root_absolute_asset").map((finding) => finding.rel_path)).toEqual(["index.html", "about.html", "data-then-root.html"]);
  });
});
