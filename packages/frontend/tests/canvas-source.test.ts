import { describe, expect, test } from "bun:test";
import { resolveCanvasNavigation, resolveCanvasNavigationAfterRefetch, resolveCanvasPageTarget, resolveCanvasSource } from "../src/lib/canvas-source";

describe("resolveCanvasSource", () => {
  test("Given a stale active entrypoint and zero indexed files When resolved Then the empty canvas does not fetch the missing file", () => {
    const source = resolveCanvasSource({
      projectId: "project-1",
      activeRelPath: "index.html",
      indexedRelPaths: [],
      entrypointUrl: null,
    });

    expect(source).toBeNull();
  });

  test("Given a refreshed artifact and a stale empty index When resolved Then the available artifact stays visible", () => {
    expect(resolveCanvasSource({
      projectId: "project-1",
      activeRelPath: "index.html",
      indexedRelPaths: [],
      entrypointUrl: "/api/projects/project-1/fs/generated.html",
    })).toBe("/api/projects/project-1/fs/generated.html");
  });

  test("Given an indexed nested active file When resolved Then its encoded project URL is returned", () => {
    const source = resolveCanvasSource({
      projectId: "project-1",
      activeRelPath: "sections/hero panel.html",
      indexedRelPaths: ["sections/hero panel.html"],
      entrypointUrl: null,
    });

    expect(source).toBe(
      "/api/projects/project-1/fs/sections/hero%20panel.html",
    );
  });

  test("Given a non-empty stale index and a newly generated active file When resolved Then the new file remains renderable", () => {
    const source = resolveCanvasSource({
      projectId: "project-1",
      activeRelPath: "generated/new deck.html",
      indexedRelPaths: ["index.html"],
      entrypointUrl: "/api/projects/project-1/fs/index.html",
    });

    expect(source).toBe(
      "/api/projects/project-1/fs/generated/new%20deck.html",
    );
  });

  test("Given an unavailable file index and an active file When resolved Then the existing canvas remains renderable", () => {
    const source = resolveCanvasSource({
      projectId: "project-1",
      activeRelPath: "index.html",
      indexedRelPaths: null,
      entrypointUrl: "/api/projects/project-1/fs/index.html",
    });

    expect(source).toBe("/api/projects/project-1/fs/index.html");
  });

  test("Given no active file When a valid artifact entrypoint exists Then the fallback remains available", () => {
    expect(
      resolveCanvasSource({
        projectId: "project-1",
        activeRelPath: null,
        indexedRelPaths: ["index.html"],
        entrypointUrl: "/api/projects/project-1/fs/index.html",
      }),
    ).toBe("/api/projects/project-1/fs/index.html");
  });
});
test("Given prototype page links When navigating Then only indexed HTML in the current project resolves", () => {
  const source = "http://localhost:5173/api/projects/project-1/fs/index.html";
  const files = ["index.html", "pages/about us.html", "script.js"];
  const about = resolveCanvasNavigation("pages/about%20us.html?view=detail#team", source, files);
  expect(about).toEqual({ relPath: "pages/about us.html", url: "http://localhost:5173/api/projects/project-1/fs/pages/about%20us.html?view=detail#team" });
  expect(resolveCanvasNavigation("../index.html", about!.url, files)?.relPath).toBe("index.html");
  expect(resolveCanvasNavigation("%ed%8e%98%ec%9d%b4%ec%a7%80.html#details", source, ["페이지.html"])?.relPath).toBe("페이지.html");
  expect(resolveCanvasNavigation("products/?tab=all#featured", source, [...files, "products/index.html"])).toEqual({ relPath: "products/index.html", url: "http://localhost:5173/api/projects/project-1/fs/products/index.html?tab=all#featured" });
  expect(resolveCanvasNavigation("products", source, [...files, "products/index.html"])?.relPath).toBe("products/index.html");
  expect(resolveCanvasPageTarget("missing.html", source)?.relPath).toBe("missing.html");
  expect(resolveCanvasPageTarget("https://example.com/missing.html", source)).toBeNull();
  for (const href of [null, {}, "https://example.com/index.html", "//example.com/index.html", "javascript:alert(1)", "data:text/html,hi", "/api/projects/project-2/fs/index.html", "../index.html", "missing.html", "script.js", "pages%2fabout%20us.html", "pages%5cabout%20us.html", "pages/%ZZ.html", "http://user:pass@localhost:5173/api/projects/project-1/fs/index.html"]) {
    expect(resolveCanvasNavigation(href, source, files)).toBeNull();
  }
});

describe("resolveCanvasNavigationAfterRefetch", () => {
  const documentUrl = "http://localhost/api/projects/project-1/fs/index.html";

  test("Given a stale index without the linked page When the refetched index contains it Then the target resolves without a toast", async () => {
    let refetched = 0;
    const target = await resolveCanvasNavigationAfterRefetch("about.html", documentUrl, ["index.html"], async () => { refetched += 1; return ["index.html", "about.html"]; });

    expect(target?.relPath).toBe("about.html");
    expect(refetched).toBe(1);
  });

  test("Given an index that already contains the linked page When navigating Then no refetch is needed", async () => {
    let refetched = 0;
    const target = await resolveCanvasNavigationAfterRefetch("about.html", documentUrl, ["index.html", "about.html"], async () => { refetched += 1; return []; });

    expect(target?.relPath).toBe("about.html");
    expect(refetched).toBe(0);
  });

  test("Given both indexes lack the linked page When navigating Then it resolves to nothing", async () => {
    expect(await resolveCanvasNavigationAfterRefetch("about.html", documentUrl, ["index.html"], async () => ["index.html"])).toBeNull();
  });

  test("Given an unsafe link When navigating Then the index is not refetched", async () => {
    let refetched = 0;
    expect(await resolveCanvasNavigationAfterRefetch("https://evil.test/x.html", documentUrl, ["index.html"], async () => { refetched += 1; return ["x.html"]; })).toBeNull();
    expect(refetched).toBe(0);
  });
});
