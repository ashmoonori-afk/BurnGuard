import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MEASURED_VIEWPORTS, parseDesignSystemMeasuredLayout } from "@bg/shared";
import { renderInitialArtifact } from "../src/db/templates";
import { appendDesignSystemContext } from "../src/harness/prompt-design-system";
import { MEASURED_PAGE_DECLARATION } from "../src/services/design-system-conformance";
import { renderMeasuredWireframe } from "../src/services/design-system-wireframe";
import { buildStarterCss, buildStarterHtml, entrypointBuiltAgainstSystem, seedStarterEntrypoint } from "../src/services/design-system-starter";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const TOKENS = ":root { --gray-100: #F4F5F7; --gray-90: #1B1E23; --gray-70: #4A505A; --gray-50: #8A909A; --primary-blue: #7399C6; --bg: var(--gray-100); --fg-1: var(--gray-90); --fg-2: var(--gray-70); --fg-3: var(--gray-50); --fg-on-brand: #FFFFFF; }";

const viewport = (name: "desktop" | "mobile") => ({
  viewport: { ...MEASURED_VIEWPORTS[name] }, page_height: 2400, container: { left: 120, width: 1200 }, gutter: 24, section_gap: 96, type_scale: { hero: 64, subheading: 24, cta: 16, h2: 40, h3: 24, body: 16, nav: 16 },
  blocks: { hero_heading: { x: 346, y: 300, width: 749, height: 128, align: "center" }, media: { x: 0, y: 100, width: 1440, height: 600, align: "center" } },
  sections: [{ heading: "Hero & more", top: 200, height: 700, columns: 1, align: "center" }, { heading: "Features", top: 900, height: 700, columns: 3, align: "center" }],
});
const measured = { schema_version: 1, method: "rendered-offline", pages: [{ path: "/", page_type: "home", viewports: { desktop: viewport("desktop"), mobile: viewport("mobile") } }] };
const pages = parseDesignSystemMeasuredLayout(measured).pages;

async function pinnedContext(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-portable-system-"));
  try {
    await writeFile(path.join(dir, "layout-measured.json"), JSON.stringify(measured));
    const system = { id: "portable", name: "Portable", status: "draft", source_type: "website", is_template: false, dir_path: dir, skill_md_path: null, tokens_css_path: null, readme_md_path: null, thumbnail_path: null, created_at: 1, updated_at: 1, archived_at: null } as const;
    const lines: string[] = [];
    await appendDesignSystemContext(lines, system, "full", "website", true);
    return lines.join("\n");
  } finally { await rm(dir, { recursive: true, force: true }); }
}

describe(`OS portability on ${process.platform}`, () => {
  test("Given a fixed measurement, then the wireframe SVG, starter stylesheet and skeleton are byte-identical on every OS", () => {
    expect(sha(renderMeasuredWireframe(pages[0]!.viewports.desktop))).toBe("14a5dd62048fb019ecda2c38b196a76be6facb14f57a4547ad304109d9600d8f");
    expect(sha(buildStarterCss(TOKENS, pages))).toBe("c2b649b2df7e994658c04f6484033848f541361abaffe19fc419c673a3ec1daf");
    expect(sha(buildStarterHtml(pages[0]!, "assets/hero/hero.png"))).toBe("9c6411e788b90ee2ec3dd79d2983d22d56cd5e6a7730e32483db8480d027117c");
  });

  test("Given a stage path with spaces and non-ASCII characters, then seeding the entrypoint works and the page declares its measured page", async () => {
    const context = await pinnedContext();
    const base = await mkdtemp(path.join(tmpdir(), "bg portable "));
    const stage = path.join(base, "dossier \u00e9t\u00e9 \u6771\u4eac", "stage dir");
    try {
      await mkdir(stage, { recursive: true });
      await writeFile(path.join(stage, "index.html"), renderInitialArtifact({ name: "Acme", type: "prototype" }));
      expect(await seedStarterEntrypoint(stage, context, "index.html")).toBe(true);
      const html = await readFile(path.join(stage, "index.html"), "utf8");
      expect(MEASURED_PAGE_DECLARATION.exec(html)?.[1]).toBe("/");
      expect(entrypointBuiltAgainstSystem(html, false)).toBe(false);
    } finally { await rm(base, { recursive: true, force: true }); }
  });

  test("Given an entrypoint saved with CRLF line endings, then the fresh-page and measured-page checks behave the same as with LF", async () => {
    const context = await pinnedContext();
    const creation = renderInitialArtifact({ name: "Acme", type: "prototype" }).replace(/\n/g, "\r\n");
    const stage = await mkdtemp(path.join(tmpdir(), "bg-portable-crlf-"));
    try {
      await writeFile(path.join(stage, "index.html"), creation);
      expect(await seedStarterEntrypoint(stage, context, "index.html")).toBe(true);
      const built = (await readFile(path.join(stage, "index.html"), "utf8")).replace(/ data-bg-placeholder(?:="[^"]*")?/g, "");
      expect(entrypointBuiltAgainstSystem(built.replace(/\n/g, "\r\n"), false)).toBe(true);
    } finally { await rm(stage, { recursive: true, force: true }); }
  });
});
