import { describe, expect, test } from "bun:test";
import { parse } from "node-html-parser";
import type { LogoSetV1 } from "@bg/shared";
import { renderInitialArtifact } from "../src/db/templates";

const logoSet: LogoSetV1 = {
  schema_version: 1,
  brand_name: "누림",
  niche: "친환경 생활용품",
  character: ["단정한", "따뜻한", "정직한"],
  logo_type: "combination",
  symbol_keywords: ["잎", "물결"],
  avoid: "지구본 아이콘",
};

describe("initial logo template", () => {
  test("Given a logo set When rendered Then exactly one 1920x1080 brief artboard is emitted", () => {
    const html = renderInitialArtifact({ name: "누림 로고", type: "logo", options: { logo_set: logoSet } });
    const root = parse(html);
    const artboards = root.querySelectorAll("[data-graphic-artboard]");

    expect(artboards).toHaveLength(1);
    expect(artboards[0]?.getAttribute("id")).toBe("frame-1-logo-brief");
    expect(artboards[0]?.getAttribute("style")).toBe("width:1920px;height:1080px");
    expect(root.querySelector('[data-bg-node-id="logo-brief"]')?.textContent).toContain("누림");
    expect(html).toContain("Four logo candidates will appear here after the first turn.");
    expect(html).not.toContain("data-slide");
  });

  test("Given a logo set When rendered Then the brief carries the whole intake", () => {
    const html = renderInitialArtifact({ name: "누림 로고", type: "logo", options: { logo_set: logoSet } });
    const text = parse(html).textContent;

    for (const value of ["친환경 생활용품", "단정한", "따뜻한", "정직한", "combination", "잎", "물결", "지구본 아이콘"]) {
      expect(text).toContain(value);
    }
  });

  test("Given a logo project When rendered Then bundled fonts and the page background token are wired", () => {
    const html = renderInitialArtifact({ name: "누림 로고", type: "logo", options: { logo_set: logoSet } });

    expect(html).toContain('<link rel="stylesheet" href="fonts/fonts.css">');
    expect(html).toContain("--page-background");
  });

  test("Given markup in the brand name When rendered Then it is escaped", () => {
    const html = renderInitialArtifact({
      name: "<script>alert(1)</script>",
      type: "logo",
      options: { logo_set: { ...logoSet, brand_name: "<script>alert(2)</script>" } },
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("Given no logo set When rendered Then the template refuses", () => {
    expect(() => renderInitialArtifact({ name: "누림 로고", type: "logo" })).toThrow(TypeError);
  });
});
