import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MEASURED_VIEWPORTS, type DesignSurface, type MeasuredViewportLayout } from "@bg/shared";
import { appendDesignSystemContext, DESIGN_SYSTEM_CONTRACT } from "../src/harness/prompt-design-system";

const viewport = (name: "desktop" | "mobile"): MeasuredViewportLayout => ({
  viewport: { ...MEASURED_VIEWPORTS[name] }, page_height: 2000, container: { left: 20, width: 350 }, gutter: 24, section_gap: 96,
  type_scale: { hero: 48 }, blocks: {}, sections: [{ heading: "Hero", top: 120, height: 600, columns: 1, align: "center" }],
});
const README = [
  "# Brand", "", "## Voice", "VOICE_TEXT", "",
  "## Hero", "HERO_PROSE split hero with media on the right", "",
  "## Section patterns", "- Hero (observed): centred heading. Default details: DEFAULT_DETAIL_TEXT", "- Cards (default): CARD_DEFAULT_TEXT", "- Footer (observed): four link columns", "",
  "## Navigation", "NAV_TEXT", "",
].join("\n");

async function context(options: { readonly measured: boolean; readonly surface: DesignSurface }): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-contract-"));
  try {
    await writeFile(path.join(dir, "README.md"), README);
    if (options.measured) await writeFile(path.join(dir, "layout-measured.json"), JSON.stringify({ schema_version: 1, method: "rendered-offline", pages: [{ path: "/", page_type: "home", viewports: { desktop: viewport("desktop"), mobile: viewport("mobile") } }] }));
    const system = { id: "contract", name: "Contract", status: "draft", source_type: "website", is_template: false, dir_path: dir, skill_md_path: null, tokens_css_path: null, readme_md_path: path.join(dir, "README.md"), thumbnail_path: null, created_at: 1, updated_at: 1, archived_at: null } as const;
    const lines: string[] = [];
    await appendDesignSystemContext(lines, system, "full", options.surface, true);
    return lines.join("\n");
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const tagged = (text: string, tag: string): unknown => { const match = new RegExp(`<${tag}>\\n([^\\n]+)\\n</${tag}>`, "u").exec(text); return match ? JSON.parse(match[1]!) : null; };
type Layout = { readonly sections: readonly { readonly kind: string; readonly text: string }[] };

describe("Compact design-system contract", () => {
  test("Given a measured website system, when its context is built, then the contract states the precedence, and hero prose, default details and default patterns are gone from the layout and README while other sections stay", async () => {
    const text = await context({ measured: true, surface: "website" });
    expect(tagged(text, "design_system_contract")).toEqual(DESIGN_SYSTEM_CONTRACT);
    const layout = tagged(text, "selected_design_system_layout") as Layout;
    expect(layout.sections.map(section => section.kind)).toEqual(["patterns", "navigation"]);
    expect(layout.sections.find(section => section.kind === "patterns")?.text).toBe("- Hero (observed): centred heading.\n- Footer (observed): four link columns");
    for (const removed of ["HERO_PROSE", "DEFAULT_DETAIL_TEXT", "CARD_DEFAULT_TEXT"]) expect(text).not.toContain(removed);
    for (const kept of ["VOICE_TEXT", "NAV_TEXT", "<selected_design_system_measured_layout>"]) expect(text).toContain(kept);
    expect(text.indexOf("<design_system_contract>")).toBeLessThan(text.indexOf("<selected_design_system_layout>"));
  });

  test("Given an unmeasured website system or a measured system on the slides surface, when the context is built, then there is no contract and nothing is removed", async () => {
    const unmeasured = await context({ measured: false, surface: "website" });
    expect(tagged(unmeasured, "design_system_contract")).toBeNull();
    for (const kept of ["HERO_PROSE", "DEFAULT_DETAIL_TEXT", "CARD_DEFAULT_TEXT"]) expect(unmeasured).toContain(kept);
    const slides = await context({ measured: true, surface: "slides" });
    expect(tagged(slides, "design_system_contract")).toBeNull();
  });
});
