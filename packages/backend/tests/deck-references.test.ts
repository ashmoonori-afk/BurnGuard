import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractDesignSystemSurface, parseDesignSystemSurface } from "@bg/shared";
import { bundledDesignSystems } from "../src/data/bundled-design-systems";
import { DECK_REFERENCES, deckReferenceFor, deckReferenceSection } from "../src/data/deck-references";
import { readBundledSystemPreview } from "../src/services/bundled-system-preview";
import { readDesignSystemSurface } from "../src/services/design-system-surface";
import { resolveRepoRoot } from "../src/lib/paths";
import legacy from "./fixtures/deck-surface-v0.5.15.json";

describe("Reference-driven slide systems", () => {
  test("Given all bundled themes When resolving deck references Then every theme has one complete untruncated recipe and four renderable specimens", async () => {
    const assigned = Object.values(DECK_REFERENCES).flatMap(reference => [...reference.themes]);
    expect([...assigned].sort()).toEqual(bundledDesignSystems.map(theme => theme.slug).sort());
    expect(new Set(assigned).size).toBe(41);
    for (const { slug } of bundledDesignSystems) {
      const reference = deckReferenceFor(slug)!;
      const root = path.join(resolveRepoRoot(), "design system themes", slug);
      const css = await readFile(path.join(root, "surfaces/slides.css"), "utf8");
      const readme = await readFile(path.join(root, "README.md"), "utf8");
      expect(readme.match(/^## Slide deck\r?$/gm)).toHaveLength(1);
      const contract = extractDesignSystemSurface(css, readme, "slides");
      expect(parseDesignSystemSurface(contract).sections.find(section => section.kind === "slides")?.text).toBe(deckReferenceSection(reference));
      expect(contract.tokens["--slide-type-hero"]).toBe(`${reference.hero}px`);
      const html = (await readBundledSystemPreview(`builtin-theme-${slug}`, "preview/slides.html"))!.toString();
      expect([...html.matchAll(/data-slide-kind="([^"]+)"/g)].map(match => match[1])).toEqual(["cover", "body", "evidence", "closing"]);
      expect(html).not.toMatch(/<script\b|(?:src|href)="https?:\/\//);
      expect(html).toContain('href="./fonts.css"');
    }
    expect(await readBundledSystemPreview("user-made", "preview/slides.html")).toBeNull();
  });

  test("Given the exact previous shipped surface When reading after upgrade Then rules update without writing files, while authored changes win", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-deck-upgrade-"));
    try {
      await mkdir(path.join(root, "surfaces"));
      const cssPath = path.join(root, "surfaces/slides.css");
      const readmePath = path.join(root, "README.md");
      const system = { id: "builtin-theme-night-marquee", dir_path: root, tokens_css_path: null, readme_md_path: readmePath };
      // Both checkout newline conventions must match the immutable legacy fingerprint.
      for (const newline of ["\n", "\r\n"]) {
        await writeFile(cssPath, legacy.css.replace(/\n/g, newline));
        await writeFile(readmePath, legacy.readme.replace(/\n/g, newline));
        const updated = (await readDesignSystemSurface(system, "slides")).contract;
        expect(updated.sections.find(section => section.kind === "slides")?.text).toBe(deckReferenceSection(DECK_REFERENCES.config));
        expect(updated.tokens["--slide-type-hero"]).toBe(`${DECK_REFERENCES.config.hero}px`);
        expect(updated.supplied).toContain("slides");
        expect(await readFile(readmePath, "utf8")).toBe(legacy.readme.replace(/\n/g, newline));
      }
      const customReadme = "## Slide deck\n\nUser-authored layout.\n";
      await writeFile(readmePath, customReadme);
      await writeFile(cssPath, legacy.css.replace(/--slide-type-hero: [\d.]+px/, "--slide-type-hero: 144px"));
      const authored = (await readDesignSystemSurface(system, "slides")).contract;
      expect(authored.sections.find(section => section.kind === "slides")?.text).toBe("User-authored layout.");
      expect(authored.tokens["--slide-type-hero"]).toBe("144px");
      expect(await readFile(readmePath, "utf8")).toBe(customReadme);
      const custom = (await readDesignSystemSurface({ ...system, id: "user-made" }, "slides")).contract;
      expect(custom.sections).toEqual(authored.sections.filter(section => section.kind === "slides"));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
