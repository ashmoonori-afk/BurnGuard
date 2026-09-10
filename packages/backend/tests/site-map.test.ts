import { describe, expect, test } from "bun:test";
import type { FileInfo } from "@bg/shared";
import { SITE_MAP_PAGE_LIMIT, buildSiteMap } from "../src/services/site-map";

function file(relPath: string): FileInfo {
  return { rel_path: relPath, category: "html", size_bytes: 1, hash: relPath, updated_at: 1 };
}

describe("buildSiteMap", () => {
  test("Given entrypoint navigation and unlinked pages When the map is built Then it orders home, nav targets, and alphabetical remainder", async () => {
    // Given
    const html = new Map([
      ["index.html", '<title>Home</title><nav data-bg-shared="nav"><a href="contact.html">Contact</a><a href="about.html#team">About</a></nav>'],
      ["about.html", "<title>About us</title>"],
      ["contact.html", "<h1>Contact</h1>"],
      ["z-last.html", "<title>Last</title>"],
    ]);

    // When
    const map = await buildSiteMap([...html.keys()].map(file), "index.html", (relPath) => html.get(relPath) ?? "");

    // Then
    expect(map.pages).toEqual([
      { rel_path: "index.html", title: "Home", is_home: true, nav_order: 0 },
      { rel_path: "contact.html", title: "Contact", is_home: false, nav_order: 1 },
      { rel_path: "about.html", title: "About us", is_home: false, nav_order: 2 },
      { rel_path: "z-last.html", title: "Last", is_home: false, nav_order: 3 },
    ]);
    expect(map.overflow).toBe(false);
    expect(map.omitted_count).toBe(0);
  });

  test("Given nested Unicode pages, directory links, fragments, and missing targets When mapped Then targets resolve relative to their owner without losing href text", async () => {
    // Given
    const html = new Map([
      ["index.html", '<nav><a href="제품/">제품</a><a href="없는.html#문의">Missing</a></nav>'],
      ["제품/index.html", '<title>제품</title><nav data-bg-shared="nav"><a href="상세.html?tab=1#가격">상세</a></nav>'],
      ["제품/상세.html", "<title>상세</title>"],
    ]);

    // When
    const map = await buildSiteMap([...html.keys()].map(file), "index.html", (relPath) => html.get(relPath) ?? "");

    // Then
    expect(map.pages.map((page) => page.rel_path)).toEqual(["index.html", "제품/index.html", "제품/상세.html"]);
    expect(map.nav_links).toContainEqual({ from: "index.html", href: "제품/", target_rel_path: "제품/index.html" });
    expect(map.nav_links).toContainEqual({ from: "제품/index.html", href: "상세.html?tab=1#가격", target_rel_path: "제품/상세.html" });
    expect(map.dangling).toEqual([{ from: "index.html", href: "없는.html#문의" }]);
  });

  test("Given more HTML pages than the summary limit When mapped Then truncation is explicit", async () => {
    // Given
    const files = [file("index.html"), ...Array.from({ length: SITE_MAP_PAGE_LIMIT + 4 }, (_, index) => file(`page-${String(index).padStart(2, "0")}.html`))];

    // When
    const map = await buildSiteMap(files, "index.html", () => "<title>Page</title>");

    // Then
    expect(map.pages).toHaveLength(SITE_MAP_PAGE_LIMIT);
    expect(map.overflow).toBe(true);
    expect(map.omitted_count).toBe(5);
  });
});
