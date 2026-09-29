import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MEASURED_VIEWPORTS, parseDesignSystemLayoutReference, type MeasuredViewportLayout } from "@bg/shared";
import { appendDesignSystemContext, appendDesignSystemStarter } from "../src/harness/prompt-design-system";
import { layoutReferenceFromPinnedContext, provisionDesignSystemLayoutReference, STAGED_REFERENCE_DIR } from "../src/services/design-system-layout-reference";
import { starterPlan } from "../src/services/design-system-starter";

const viewport = (name: "desktop" | "mobile"): MeasuredViewportLayout => ({
  viewport: { ...MEASURED_VIEWPORTS[name] }, page_height: 2000, container: { left: 20, width: 350 }, gutter: 24, section_gap: 96,
  type_scale: { hero: 48 }, blocks: {}, sections: [{ heading: "Hero", top: 120, height: 600, columns: 1, align: "center" }],
});
const page = (pagePath: string, type: "home" | "about") => ({ path: pagePath, page_type: type, viewports: { desktop: viewport("desktop"), mobile: viewport("mobile") } });
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const shot = (pagePath: string, index: number, name: "desktop" | "mobile", bytes: Uint8Array) => ({
  path: pagePath, viewport: name, file: `layout-reference/p${index}-${name}.jpg`, width: MEASURED_VIEWPORTS[name].width, height: 1800, size: bytes.byteLength, sha256: sha(bytes),
});
const BYTES = { home: new TextEncoder().encode("home-desktop-jpeg"), homeMobile: new TextEncoder().encode("home-mobile-jpeg"), about: new TextEncoder().encode("about-desktop-jpeg") };

async function withSystem(run: (dir: string, context: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-layout-reference-"));
  try {
    await writeFile(path.join(dir, "layout-measured.json"), JSON.stringify({ schema_version: 1, method: "rendered-offline", pages: [page("/", "home"), page("/about", "about")] }));
    await mkdir(path.join(dir, "layout-reference"));
    await writeFile(path.join(dir, "layout-reference", "p0-desktop.jpg"), BYTES.home);
    await writeFile(path.join(dir, "layout-reference", "p0-mobile.jpg"), BYTES.homeMobile);
    await writeFile(path.join(dir, "layout-reference", "p1-desktop.jpg"), BYTES.about);
    await writeFile(path.join(dir, "layout-reference.json"), JSON.stringify({ schema_version: 1, shots: [shot("/", 0, "desktop", BYTES.home), shot("/", 0, "mobile", BYTES.homeMobile), shot("/about", 1, "desktop", BYTES.about)] }));
    const system = { id: "reference", name: "Reference", status: "draft", source_type: "website", is_template: false, dir_path: dir, skill_md_path: null, tokens_css_path: null, readme_md_path: null, thumbnail_path: null, created_at: 1, updated_at: 1, archived_at: null } as const;
    const lines: string[] = [];
    await appendDesignSystemContext(lines, system, "full", "website", true);
    await run(dir, lines.join("\n"));
  } finally { await rm(dir, { recursive: true, force: true }); }
}

describe("Design-system layout reference", () => {
  test("Given reference indexes, then the strict parser accepts valid shots and rejects unsafe files, viewport mismatches, bad digests, duplicates and oversize files", () => {
    const valid = shot("/", 0, "desktop", BYTES.home);
    expect(parseDesignSystemLayoutReference({ schema_version: 1, shots: [valid] }).shots).toEqual([valid]);
    for (const bad of [{ ...valid, file: "../p0-desktop.jpg" }, { ...valid, file: "layout-reference/p0-mobile.jpg" }, { ...valid, sha256: "x" }, { ...valid, size: 2_000_000 }, { ...valid, extra: 1 }]) {
      expect(() => parseDesignSystemLayoutReference({ schema_version: 1, shots: [bad] })).toThrow();
    }
    expect(() => parseDesignSystemLayoutReference({ schema_version: 1, shots: [valid, valid] })).toThrow();
  });

  test("Given a system with reference screenshots, then the pinned context freezes them and the starter plan lists the staged paths per page", async () => {
    await withSystem(async (_dir, context) => {
      expect(layoutReferenceFromPinnedContext(context).map(item => [item.path, item.viewport, item.sha256])).toEqual([["/", "desktop", sha(BYTES.home)], ["/", "mobile", sha(BYTES.homeMobile)], ["/about", "desktop", sha(BYTES.about)]]);
      const plan = starterPlan(context);
      expect(plan?.pages.map(entry => [entry.path, entry.reference])).toEqual([
        ["/", { desktop: `${STAGED_REFERENCE_DIR}/p0-desktop.jpg`, mobile: `${STAGED_REFERENCE_DIR}/p0-mobile.jpg` }],
        ["/about", { desktop: `${STAGED_REFERENCE_DIR}/p1-desktop.jpg` }],
      ]);
      const lines: string[] = [];
      appendDesignSystemStarter(lines, context, "website");
      expect(JSON.parse(lines[1]!)).toEqual(plan);
    });
  });

  test("Given a pinned context, then staging copies only screenshots whose bytes still match the pin, and nothing without a system directory", async () => {
    await withSystem(async (dir, context) => {
      const stage = await mkdtemp(path.join(tmpdir(), "bg-layout-reference-stage-"));
      try {
        await writeFile(path.join(dir, "layout-reference", "p1-desktop.jpg"), new TextEncoder().encode("re-extracted-bytes"));
        expect(await provisionDesignSystemLayoutReference(stage, context, null)).toEqual([]);
        expect(await provisionDesignSystemLayoutReference(stage, context, dir)).toEqual([`${STAGED_REFERENCE_DIR}/p0-desktop.jpg`, `${STAGED_REFERENCE_DIR}/p0-mobile.jpg`]);
        expect(new Uint8Array(await readFile(path.join(stage, STAGED_REFERENCE_DIR, "p0-desktop.jpg")))).toEqual(BYTES.home);
        expect(await readFile(path.join(stage, STAGED_REFERENCE_DIR, "p1-desktop.jpg")).catch(() => null)).toBeNull();
      } finally { await rm(stage, { recursive: true, force: true }); }
    });
  });

  test("Given a system without reference screenshots or a non-website surface, then no reference block is pinned", async () => {
    await withSystem(async (dir) => {
      await rm(path.join(dir, "layout-reference.json"));
      const system = { id: "plain", name: "Plain", status: "draft", source_type: "website", is_template: false, dir_path: dir, skill_md_path: null, tokens_css_path: null, readme_md_path: null, thumbnail_path: null, created_at: 1, updated_at: 1, archived_at: null } as const;
      const lines: string[] = [];
      await appendDesignSystemContext(lines, system, "full", "website", true);
      expect(layoutReferenceFromPinnedContext(lines.join("\n"))).toEqual([]);
      expect(starterPlan(lines.join("\n"))?.pages.every(entry => entry.reference === undefined)).toBe(true);
    });
    await withSystem(async (dir) => {
      const system = { id: "slides", name: "Slides", status: "draft", source_type: "website", is_template: false, dir_path: dir, skill_md_path: null, tokens_css_path: null, readme_md_path: null, thumbnail_path: null, created_at: 1, updated_at: 1, archived_at: null } as const;
      const lines: string[] = [];
      await appendDesignSystemContext(lines, system, "full", "slides", true);
      expect(lines.join("\n")).not.toContain("<selected_design_system_layout_reference>");
    });
  });
});
