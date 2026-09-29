import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import { tmpdir } from "node:os";
import path from "node:path";
import { MEASURED_VIEWPORTS, parseDesignSystemMeasuredLayout, type MeasuredViewportLayout } from "@bg/shared";
import { appendDesignSystemContext } from "../src/harness/prompt-design-system";
import { compareMeasuredViewport, literalValueFindings, measuredPagesFromPinnedContext, reviewDesignSystemConformance, selectMeasuredPage } from "../src/services/design-system-conformance";

const centred = (name: "desktop" | "mobile"): MeasuredViewportLayout => ({
  viewport: { ...MEASURED_VIEWPORTS[name] }, page_height: 4000, container: { left: 120, width: 1200 }, gutter: 24, section_gap: 96,
  type_scale: { hero: 64, subheading: 24, cta: 17, h2: 50, body: 17 },
  blocks: { hero_heading: { x: 346, y: 407, width: 749, height: 128, align: "center" }, subheading: { x: 346, y: 567, width: 749, height: 64, align: "center" } },
  sections: [{ heading: "Own your AI", top: 407, height: 900, columns: 1, align: "center" }, { heading: "Features", top: 1400, height: 900, columns: 3, align: "center" }],
});
const layout = { schema_version: 1, method: "rendered-offline", pages: [
  { path: "/", page_type: "home", viewports: { desktop: centred("desktop"), mobile: centred("mobile") } },
  { path: "/about", page_type: "about", viewports: { desktop: { ...centred("desktop"), page_height: 2000 }, mobile: centred("mobile") } },
] };

async function pinnedContextFor(measured: unknown | null): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-conformance-system-"));
  try {
    if (measured !== null) await writeFile(path.join(dir, "layout-measured.json"), JSON.stringify(measured));
    const system = { id: "conformance", name: "Conformance", status: "draft", source_type: "website", is_template: false, dir_path: dir, skill_md_path: null, tokens_css_path: null, readme_md_path: null, thumbnail_path: null, created_at: 1, updated_at: 1, archived_at: null } as const;
    const lines: string[] = [];
    await appendDesignSystemContext(lines, system, "full", "website", true);
    return lines.join("\n");
  } finally { await rm(dir, { recursive: true, force: true }); }
}

describe("Design-system conformance", () => {
  test("Given a pinned website context with measured pages, then the frozen pages are read back, and a context without them yields none", async () => {
    expect(measuredPagesFromPinnedContext(await pinnedContextFor(layout))).toEqual(parseDesignSystemMeasuredLayout(layout).pages);
    expect(measuredPagesFromPinnedContext(await pinnedContextFor(null))).toBeNull();
    expect(measuredPagesFromPinnedContext("<selected_design_system_measured_layout>\n[{\"path\":1}]\n</selected_design_system_measured_layout>")).toBeNull();
  });

  test("Given a declared measured page, then that entry is compared, otherwise the home entry", () => {
    const pages = parseDesignSystemMeasuredLayout(layout).pages;
    expect(selectMeasuredPage(pages, "/about")?.path).toBe("/about");
    expect(selectMeasuredPage(pages, "/missing")?.path).toBe("/");
    expect(selectMeasuredPage(pages, null)?.path).toBe("/");
    expect(selectMeasuredPage([], null)).toBeNull();
  });

  test("Given a split hero with larger type and a longer page, then alignment, position, type, section and height findings name measured and expected values; the measured layout itself conforms", () => {
    const expected = centred("desktop");
    expect(compareMeasuredViewport(expected, expected, "desktop")).toEqual([]);
    const split: MeasuredViewportLayout = { ...expected, page_height: 6400, container: { left: 120, width: 1200 },
      type_scale: { hero: 88, subheading: 14, cta: 17, h2: 51, body: 17 },
      blocks: { hero_heading: { x: 120, y: 380, width: 600, height: 180, align: "left" } },
      sections: [...expected.sections, ...expected.sections, ...expected.sections] };
    const findings = compareMeasuredViewport(expected, split, "desktop");
    expect(findings.map(finding => [finding.code, finding.target])).toEqual([
      ["type_size", "hero"], ["type_size", "subheading"],
      ["block_alignment", "hero_heading"], ["block_position", "hero_heading.x"], ["block_position", "hero_heading.width"],
      ["block_position", "subheading"],
      ["section_count", "sections"], ["page_height", "page"],
    ]);
    expect(findings[0]).toEqual({ code: "type_size", viewport: "desktop", target: "hero", measured: "88px", expected: "64px +/-2px" });
  });

  test("Given authored CSS, then literal colour, font-size and font-family values are counted per property while variables, keywords and custom property definitions pass", () => {
    const findings = literalValueFindings([
      ":root { --ink: #111; --m-type-hero: 64px; } h1 { font-size: 88px; color: #fff; } p { font-size: 14px; color: var(--ink); }",
      ".hero { background: linear-gradient(#000, #111); font-family: Inter, sans-serif; } .x { background: url(a.png) no-repeat; color: currentColor; border-color: transparent; font-size: var(--m-type-hero) !important; }",
      "/* color: #abc */",
    ]);
    expect(findings.map(finding => [finding.target, finding.measured.split(" ")[0]])).toEqual([["font-size", "2"], ["color", "1"], ["background", "1"], ["font-family", "1"]]);
    expect(findings.every(finding => finding.code === "literal_value" && finding.viewport === null)).toBe(true);
  });

  test("Given a turn that did not change the entrypoint, then there is nothing to compare and no browser starts", async () => {
    const context = await pinnedContextFor(layout);
    for (const changedPaths of [["assets/hero.png"], ["contact.html", "styles.css"]]) expect(await reviewDesignSystemConformance({ projectDir: tmpdir(), entrypoint: "index.html", pinnedContext: context, changedPaths, signal: AbortSignal.timeout(5_000) })).toBeNull();
  });

  test.skipIf(process.env.BG_BROWSER_SMOKE !== "1")("Given a real Chromium, when a split-hero page is reviewed against a centred measured home, then rendered findings and literal values are reported", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "bg-conformance-project-"));
    try {
      await writeFile(path.join(project, "index.html"), '<!doctype html><html><head><meta name="bg-measured-page" content="/"><style>body{margin:0} .hero{display:flex;max-width:1200px;margin:0 auto} h1{font-size:88px;margin:0;text-align:left;width:600px} p{font-size:14px;color:#fff}</style></head><body><section class="hero"><div><h1>Own your AI.</h1><p>Private expert AI systems powered by local models</p></div></section></body></html>');
      const result = await reviewDesignSystemConformance({ projectDir: project, entrypoint: "index.html", pinnedContext: await pinnedContextFor(layout), changedPaths: ["index.html"], signal: AbortSignal.timeout(60_000) });
      expect(result?.page).toBe("/");
      const codes = new Set(result!.findings.map(finding => `${finding.viewport}:${finding.code}:${finding.target}`));
      expect(codes.has("desktop:type_size:hero")).toBe(true);
      expect(codes.has("desktop:block_alignment:hero_heading")).toBe(true);
      expect(codes.has("null:literal_value:font-size")).toBe(true);
    } finally { await rm(project, { recursive: true, force: true }); }
  }, 90_000);

  test.skipIf(process.env.BG_BROWSER_SMOKE !== "1")("Given a staged reference screenshot pinned in the context, when the page is reviewed, then a report-only visual score per measured section and the lowest sections are returned", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "bg-conformance-visual-project-"));
    const system = await mkdtemp(path.join(tmpdir(), "bg-conformance-visual-system-"));
    try {
      const jpeg = (width: number, height: number): Uint8Array => {
        const canvas = createCanvas(width, height);
        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        return new Uint8Array(canvas.toBuffer("image/jpeg"));
      };
      const shots = (["desktop", "mobile"] as const).map(name => ({ name, bytes: jpeg(MEASURED_VIEWPORTS[name].width, 2700) }));
      await mkdir(path.join(system, "layout-reference"));
      await mkdir(path.join(project, ".burnguard-inputs", "design-system-starter", "reference"), { recursive: true });
      for (const { name, bytes } of shots) {
        await writeFile(path.join(system, "layout-reference", `p0-${name}.jpg`), bytes);
        await writeFile(path.join(project, ".burnguard-inputs", "design-system-starter", "reference", `p0-${name}.jpg`), bytes);
      }
      await writeFile(path.join(system, "layout-measured.json"), JSON.stringify(layout));
      await writeFile(path.join(system, "layout-reference.json"), JSON.stringify({ schema_version: 1, shots: shots.map(({ name, bytes }) => ({
        path: "/", viewport: name, file: `layout-reference/p0-${name}.jpg`, width: MEASURED_VIEWPORTS[name].width, height: 2700, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"),
      })) }));
      const lines: string[] = [];
      await appendDesignSystemContext(lines, { id: "visual", name: "Visual", status: "draft", source_type: "website", is_template: false, dir_path: system, skill_md_path: null, tokens_css_path: null, readme_md_path: null, thumbnail_path: null, created_at: 1, updated_at: 1, archived_at: null }, "full", "website", true);
      await writeFile(path.join(project, "index.html"), '<!doctype html><html><head><meta name="bg-measured-page" content="/"><style>body{margin:0;background:#fff} h1{font-size:64px;text-align:center}</style></head><body><h1>Own your AI.</h1></body></html>');
      const result = await reviewDesignSystemConformance({ projectDir: project, entrypoint: "index.html", pinnedContext: lines.join("\n"), changedPaths: ["index.html"], signal: AbortSignal.timeout(60_000) });
      expect(result?.visual?.map(report => [report.viewport, report.unavailable])).toEqual([["desktop", false], ["mobile", false]]);
      expect(result?.visual?.[0]?.sections).toHaveLength(2);
      expect(result?.repair_targets?.length).toBeGreaterThan(0);
      expect(result!.repair_targets!.length).toBeLessThanOrEqual(3);
    } finally {
      await rm(project, { recursive: true, force: true });
      await rm(system, { recursive: true, force: true });
    }
  }, 90_000);
});
