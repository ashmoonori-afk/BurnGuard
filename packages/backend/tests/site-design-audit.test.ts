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
});
