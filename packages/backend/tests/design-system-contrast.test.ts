import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { auditRenderedTree } from "../src/services/design-audit";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { MEASURED_VIEWPORTS, parseDesignSystemMeasuredLayout } from "@bg/shared";
import { contrastRatio, readableRole, resolveTokenColor } from "../src/services/design-system-contrast";
import { buildStarterCss, buildStarterHtml } from "../src/services/design-system-starter";

const TOKENS = ":root { --gray-100: #F4F5F7; --gray-90: #1B1E23; --gray-70: #4A505A; --gray-50: #8A909A; --primary-blue: #7399C6; --bg: var(--gray-100); --fg-1: var(--gray-90); --fg-2: var(--gray-70); --fg-3: var(--gray-50); --fg-on-brand: #FFFFFF; --loop-a: var(--loop-b); --loop-b: var(--loop-a); --alpha: #11223380; }";

describe("Design-system contrast roles", () => {
  test("Given hex colours, then the WCAG ratio matches the reference values and unparseable colours give null", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777", "#fff")).toBeCloseTo(4.48, 1);
    expect(contrastRatio("rebeccapurple", "#fff")).toBeNull();
    expect(contrastRatio("#11223380", "#fff")).toBeNull();
  });

  test("Given token chains, then colours resolve through var() with fallbacks, and loops or unknown names resolve to null", () => {
    expect(resolveTokenColor(TOKENS, "--bg")).toBe("#f4f5f7");
    expect(resolveTokenColor(TOKENS, "--missing")).toBeNull();
    expect(resolveTokenColor(TOKENS, "--loop-a")).toBeNull();
    expect(resolveTokenColor(TOKENS, "--alpha")).toBeNull();
    expect(resolveTokenColor(":root { --a: var(--nope, #123456); }", "--a")).toBe("#123456");
  });

  test("Given a role whose first token fails 4.5:1, then the first candidate that passes wins; a passing first token stays; unresolvable tokens keep the first candidate", () => {
    expect(readableRole(TOKENS, ["--fg-3", "--fg-2", "--fg-1"], ["--bg"])).toBe("--fg-2");
    expect(readableRole(TOKENS, ["--fg-2", "--fg-1"], ["--bg"])).toBe("--fg-2");
    expect(readableRole(TOKENS, ["--fg-on-brand", "--fg-1"], ["--brand-primary", "--primary-blue"])).toBe("--fg-1");
    expect(readableRole(TOKENS, ["--nope", "--fg-1"], ["--bg"])).toBe("--nope");
    expect(readableRole(TOKENS, ["--fg-3", "--gray-50"], ["--bg"])).toBe("--fg-3");
  });

  test("Given tokens whose default roles fail contrast, then the starter stylesheet defines readable --m-fg roles and its rules use them", () => {
    const layout = (name: "desktop" | "mobile") => ({ viewport: { ...MEASURED_VIEWPORTS[name] }, page_height: 2000, container: null, gutter: null, section_gap: null, type_scale: {}, blocks: {}, sections: [] });
    const pages = parseDesignSystemMeasuredLayout({ schema_version: 1, method: "rendered-offline", pages: [{ path: "/", page_type: "home", viewports: { desktop: layout("desktop"), mobile: layout("mobile") } }] }).pages;
    const css = buildStarterCss(TOKENS, pages);
    expect(css).toContain("--m-fg-footer: var(--fg-2);");
    expect(css).toContain("--m-fg-subtitle: var(--fg-2);");
    expect(css).toContain("--m-fg-on-brand: var(--fg-1);");
    expect(css).toMatch(/\.bg-footer \{[^}]*color: var\(--m-fg-footer\)/);
    expect(css).toMatch(/\.bg-button \{[^}]*color: var\(--m-fg-on-brand\)/);
    expect(buildStarterCss(TOKENS, pages)).toBe(css);
  });

  test.skipIf(process.env.BG_BROWSER_SMOKE !== "1")("Given the reference design system's real tokens, when a page built from the starter classes is audited in a real browser, then it has no must_fix finding (button and footer text are readable)", async () => {
    const view = (name: "desktop" | "mobile") => ({ viewport: { ...MEASURED_VIEWPORTS[name] }, page_height: 3000, container: { left: 120, width: 1200 }, gutter: 24, section_gap: 96, type_scale: { hero: 64, subheading: 24, cta: 16, h2: 40, h3: 24, body: 16, nav: 16 }, blocks: { hero_heading: { x: 346, y: 300, width: 749, height: 128, align: "center" } }, sections: [{ heading: "Hero", top: 200, height: 700, columns: 1, align: "center" }, { heading: "Features", top: 900, height: 700, columns: 3, align: "center" }] });
    const pages = parseDesignSystemMeasuredLayout({ schema_version: 1, method: "rendered-offline", pages: [{ path: "/", page_type: "home", viewports: { desktop: view("desktop"), mobile: view("mobile") } }] }).pages;
    const tokens = await readFile(path.join(import.meta.dir, "..", "..", "..", "design system sample", "colors_and_type.css"), "utf8");
    const stage = await mkdtemp(path.join(tmpdir(), "bg-contrast-stage-"));
    try {
      await mkdir(path.join(stage, "design-system"), { recursive: true });
      await writeFile(path.join(stage, "design-system", "system.css"), buildStarterCss(tokens, pages));
      const html = buildStarterHtml(pages[0]!).replace("HEADLINE", "Own your AI.").replace("SUBHEADING", "Private expert AI systems powered by local models").replace("CALL TO ACTION", "Get started").replace(/SECTION TITLE/g, "Why teams choose us").replace(/ITEM TEXT/g, "A short description of this item for the card body.").replace(/ITEM/g, "Feature").replace("LOGO", "Brand").replace("LINK", "Pricing").replace("FOOTER", "All rights reserved.").replace(/HERO MEDIA[^<]*/, "");
      await writeFile(path.join(stage, "index.html"), html);
      const manifest = await inspectCanonicalTree(stage);
      const result = await auditRenderedTree({ projectId: "contrast", projectDir: stage, entrypoint: "index.html", revision: 1, digest: manifest.tree_digest, deck: false, signal: AbortSignal.timeout(60_000) });
      expect(result.checks.flatMap(check => check.findings).filter(finding => finding.severity === "must_fix").map(finding => [finding.check_code, finding.measured])).toEqual([]);
    } finally { await rm(stage, { recursive: true, force: true }); }
  }, 90_000);
});
