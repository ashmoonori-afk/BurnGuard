import { describe, expect, test } from "bun:test";
import { isSafeCanvasPagePath, resolveCanvasNavigationAfterRefetch } from "../src/lib/canvas-source";

const documentUrl = "http://127.0.0.1:14070/api/projects/p1/fs/index.html";

describe("CANVAS-2 canvas page links with ordinary file names", () => {
  test("Given a just-written page named about_us.html missing from the cached index When its link is clicked Then the index is refetched and the page opens", async () => {
    let refetches = 0;
    const target = await resolveCanvasNavigationAfterRefetch("about_us.html", documentUrl, ["index.html"], async () => {
      refetches += 1;
      return ["index.html", "about_us.html"];
    });
    expect(refetches).toBe(1);
    expect(target?.relPath).toBe("about_us.html");
  });

  test("Given missing pages named with an underscore or a version dot When the create-page action is gated Then those names are accepted", () => {
    expect(isSafeCanvasPagePath("contact_us.html")).toBe(true);
    expect(isSafeCanvasPagePath("pricing.v2.html")).toBe(true);
  });
});
