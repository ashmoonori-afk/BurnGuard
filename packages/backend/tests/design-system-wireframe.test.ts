import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MEASURED_VIEWPORTS, parseDesignSystemLayoutReference, type MeasuredViewportLayout } from "@bg/shared";
import { renderMeasuredWireframe } from "../src/services/design-system-wireframe";
import { layoutReferencePromptLines, provisionDesignSystemLayoutReference, STAGED_REFERENCE_DIR } from "../src/services/design-system-layout-reference";

const layout: MeasuredViewportLayout = {
  viewport: { ...MEASURED_VIEWPORTS.desktop }, page_height: 2400, container: { left: 120, width: 1200 }, gutter: 24, section_gap: 96,
  type_scale: { hero: 64 },
  blocks: { hero_heading: { x: 120, y: 200, width: 700, height: 160, align: "left" }, media: { x: 840, y: 160, width: 480, height: 400, align: "right" } },
  sections: [
    { heading: "Hero", top: 120, height: 600, columns: 1, align: "left" },
    { heading: "Features & <more>", top: 816, height: 500, columns: 3, align: "center" },
  ],
};
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

describe("Design-system block-box wireframe", () => {
  test("Given a measured viewport, then the wireframe is deterministic, sized to the page and draws each section and block once", () => {
    const svg = renderMeasuredWireframe(layout);
    expect(renderMeasuredWireframe(layout)).toBe(svg);
    expect(svg).toContain('viewBox="0 0 1440 2400"');
    expect(svg.match(/data-kind="section"/g)).toHaveLength(2);
    expect(svg.match(/data-kind="block"/g)).toHaveLength(2);
    expect(svg.match(/data-kind="column"/g)).toHaveLength(4);
    expect(svg).toContain('data-kind="container"');
  });

  test("Given untrusted heading text, then the SVG is inert: escaped text, no script, no external references", () => {
    const svg = renderMeasuredWireframe(layout);
    expect(svg).toContain("Features &amp; &lt;more&gt;");
    expect(svg).not.toMatch(/<script|href=|xlink|<image|<foreignObject|on[a-z]+=/i);
  });

  test("Given a page with no container or blocks, then the section boxes span the viewport", () => {
    const svg = renderMeasuredWireframe({ ...layout, container: null, blocks: {}, sections: [{ heading: "Only", top: 0, height: 300, columns: 1, align: "left" }] });
    expect(svg).not.toContain('data-kind="container"');
    expect(svg).toContain('data-kind="section" x="0" y="0" width="1440" height="300"');
  });

  test("Given reference indexes, then the parser accepts an optional pinned wireframe and rejects unsafe or partial ones", () => {
    const bytes = renderMeasuredWireframe(layout);
    const base = { path: "/", viewport: "desktop", file: "layout-reference/p0-desktop.jpg", width: 1440, height: 1800, size: 10, sha256: sha("jpg") };
    const wireframe = { file: "layout-reference/p0-desktop.svg", size: bytes.length, sha256: sha(bytes) };
    expect(parseDesignSystemLayoutReference({ schema_version: 1, shots: [base] }).shots).toEqual([base]);
    expect(parseDesignSystemLayoutReference({ schema_version: 1, shots: [{ ...base, wireframe }] }).shots[0]?.wireframe).toEqual(wireframe);
    for (const bad of [
      { ...wireframe, file: "layout-reference/p0-mobile.svg" }, { ...wireframe, file: "../p0-desktop.svg" }, { ...wireframe, file: "layout-reference/p0-desktop.jpg" },
      { ...wireframe, sha256: "x" }, { ...wireframe, size: 0 }, { ...wireframe, size: 2_000_000 }, { ...wireframe, extra: 1 }, { file: wireframe.file },
    ]) {
      expect(() => parseDesignSystemLayoutReference({ schema_version: 1, shots: [{ ...base, wireframe: bad }] })).toThrow();
    }
  });

  test("Given a pinned wireframe, then staging copies it only while its bytes still match the pin", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bg-wireframe-"));
    const stage = await mkdtemp(path.join(tmpdir(), "bg-wireframe-stage-"));
    try {
      const svg = renderMeasuredWireframe(layout);
      const jpg = new TextEncoder().encode("jpeg-bytes");
      await mkdir(path.join(dir, "layout-reference"));
      await writeFile(path.join(dir, "layout-reference", "p0-desktop.jpg"), jpg);
      await writeFile(path.join(dir, "layout-reference", "p0-desktop.svg"), svg);
      const reference = parseDesignSystemLayoutReference({ schema_version: 1, shots: [{
        path: "/", viewport: "desktop", file: "layout-reference/p0-desktop.jpg", width: 1440, height: 1800, size: jpg.byteLength, sha256: createHash("sha256").update(jpg).digest("hex"),
        wireframe: { file: "layout-reference/p0-desktop.svg", size: Buffer.byteLength(svg), sha256: sha(svg) },
      }] });
      const context = layoutReferencePromptLines(reference, ["/"]).join("\n");
      expect(await provisionDesignSystemLayoutReference(stage, context, dir)).toEqual([`${STAGED_REFERENCE_DIR}/p0-desktop.jpg`, `${STAGED_REFERENCE_DIR}/p0-desktop.svg`]);
      expect(await readFile(path.join(stage, STAGED_REFERENCE_DIR, "p0-desktop.svg"), "utf8")).toBe(svg);
      await rm(path.join(stage, STAGED_REFERENCE_DIR), { recursive: true });
      await writeFile(path.join(dir, "layout-reference", "p0-desktop.svg"), "<svg/>");
      expect(await provisionDesignSystemLayoutReference(stage, context, dir)).toEqual([`${STAGED_REFERENCE_DIR}/p0-desktop.jpg`]);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(stage, { recursive: true, force: true });
    }
  });
});
