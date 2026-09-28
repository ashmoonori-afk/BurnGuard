import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildHandoffSpec,
  copyProjectIntoBundle,
  EXTRACT_HANDOFF_FN,
  HANDOFF_STYLE_KEYS,
  HandoffExportError,
} from "../src/services/export-handoff";

describe("buildHandoffSpec", () => {
  test("preserves typed renderer failure codes", () => {
    expect(new HandoffExportError("artifact_not_ready", "not ready").code).toBe("artifact_not_ready");
  });
  test("wraps extracted pages with project + design-system metadata", () => {
    const spec = buildHandoffSpec({
      project: {
        id: "p1",
        name: "Test",
        type: "slide_deck",
        entrypoint: "deck.html",
      },
      viewport: { width: 1280, height: 720 },
      pages: [
        {
          slide_index: 0,
          title: "Slide 1",
          rect: { w: 1280, h: 720 },
          nodes: [
            {
              bg_id: "hero",
              tag: "h1",
              parent_bg_id: null,
              text: "Hero",
              rect: { x: 64, y: 96, w: 800, h: 120 },
              styles: { "font-size": "96px", color: "rgb(255,255,255)" },
            },
          ],
        },
      ],
      designSystem: {
        name: "Northvale Capital",
        tokensFileInZip: "tokens/colors_and_type.css",
      },
      generatedAt: 1700000000,
    });

    expect(spec.spec_version).toBe(1);
    expect(spec.generated_at).toBe(1700000000);
    expect(spec.project.name).toBe("Test");
    expect(spec.viewport).toEqual({ width: 1280, height: 720 });
    expect(spec.design_system.name).toBe("Northvale Capital");
    expect(spec.design_system.tokens_file).toBe("tokens/colors_and_type.css");
    expect(spec.pages).toHaveLength(1);
    expect(spec.pages[0].nodes[0].bg_id).toBe("hero");
  });

  test("null-tolerant design-system metadata", () => {
    const spec = buildHandoffSpec({
      project: {
        id: "p1",
        name: "Test",
        type: "prototype",
        entrypoint: "index.html",
      },
      viewport: { width: 1280, height: 720 },
      pages: [],
      designSystem: { name: null, tokensFileInZip: null },
    });
    expect(spec.design_system).toEqual({ name: null, tokens_file: null });
    expect(spec.pages).toEqual([]);
  });

  test("generated_at defaults to now when omitted", () => {
    const before = Date.now();
    const spec = buildHandoffSpec({
      project: {
        id: "p1",
        name: "T",
        type: "prototype",
        entrypoint: "index.html",
      },
      viewport: { width: 100, height: 100 },
      pages: [],
      designSystem: { name: null, tokensFileInZip: null },
    });
    const after = Date.now();
    expect(spec.generated_at).toBeGreaterThanOrEqual(before);
    expect(spec.generated_at).toBeLessThanOrEqual(after);
  });
});

describe("copyProjectIntoBundle", () => {
  test("mirrors managed project files without control or stage-input directories", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bg-handoff-copy-"));
    const staged = path.join(root, "staged");
    const bundleSource = path.join(root, "bundle", "source");
    try {
      mkdirSync(staged, { recursive: true });
      writeFileSync(path.join(staged, "deck.html"), "<h1/>", "utf8");
      writeFileSync(path.join(staged, "style.css"), "body{}", "utf8");
      mkdirSync(path.join(staged, "assets"), { recursive: true });
      writeFileSync(path.join(staged, "assets", "hero.png"), "PNG", "utf8");
      mkdirSync(path.join(staged, "fonts"), { recursive: true });
      writeFileSync(
        path.join(staged, "fonts", "brand.woff2"),
        "FONT",
        "utf8",
      );
      mkdirSync(path.join(staged, ".meta", "checkpoints"), { recursive: true });
      writeFileSync(
        path.join(staged, ".meta", "checkpoints", "x.json"),
        "{}",
        "utf8",
      );
      mkdirSync(path.join(staged, ".attachments"), { recursive: true });
      writeFileSync(path.join(staged, ".attachments", "upload.bin"), "SECRET", "utf8");
      mkdirSync(path.join(staged, ".burnguard-inputs"), { recursive: true });
      writeFileSync(path.join(staged, ".burnguard-inputs", "source.pdf"), "INPUT", "utf8");

      const result = await copyProjectIntoBundle(staged, bundleSource);

      expect(result.copied.sort()).toEqual(
        ["assets", "deck.html", "fonts", "style.css"].sort(),
      );
      expect(result.skipped.sort()).toEqual([".attachments", ".burnguard-inputs", ".meta"].sort());

      expect(readFileSync(path.join(bundleSource, "deck.html"), "utf8")).toBe("<h1/>");
      expect(
        readFileSync(path.join(bundleSource, "assets", "hero.png"), "utf8"),
      ).toBe("PNG");
      expect(
        readFileSync(path.join(bundleSource, "fonts", "brand.woff2"), "utf8"),
      ).toBe("FONT");

      // Reserved dirs must not leak into the bundle.
      const present = readdirSync(bundleSource);
      expect(present).not.toContain(".meta");
      expect(present).not.toContain(".attachments");
      expect(present).not.toContain(".burnguard-inputs");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("works when source has zero entries (empty project)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bg-handoff-empty-"));
    const staged = path.join(root, "staged");
    const bundleSource = path.join(root, "bundle", "source");
    try {
      mkdirSync(staged, { recursive: true });
      const result = await copyProjectIntoBundle(staged, bundleSource);
      expect(result.copied).toEqual([]);
      expect(result.skipped).toEqual([]);
      expect(readdirSync(bundleSource)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("EXTRACT_HANDOFF_FN", () => {
  test("is an IIFE-compatible function source that references the required API", () => {
    expect(EXTRACT_HANDOFF_FN.startsWith("() => {")).toBe(true);
    expect(EXTRACT_HANDOFF_FN).toContain("[data-bg-node-id]");
    expect(EXTRACT_HANDOFF_FN).toContain("[data-slide]");
    expect(EXTRACT_HANDOFF_FN).toContain("[data-graphic-artboard]");
    expect(EXTRACT_HANDOFF_FN).toContain("getComputedStyle");
    // Must read every property we committed to exposing, otherwise the
    // spec JSON loses fidelity for the listed key.
    for (const key of HANDOFF_STYLE_KEYS) {
      expect(EXTRACT_HANDOFF_FN).toContain(JSON.stringify(key));
    }
  });
});
