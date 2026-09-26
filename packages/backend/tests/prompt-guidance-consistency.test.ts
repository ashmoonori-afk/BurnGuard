import { beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { copyBundledFonts } from "../src/data/bundled-fonts";
import { getSqlite } from "../src/db/sqlite-client";
import { CHART_AUTHORING_RULES } from "../src/harness/chart-authoring";
import { DESIGN_CRAFT_RULES, EXPORT_REMOTE_FRAME_RULE } from "../src/harness/design-craft";
import { buildPrompt, MAX_SKILL_CHARS } from "../src/harness/prompt-builder";
import { COMPACT_DECK_SKILL_MD } from "../src/harness/prompt-compact-skills";
import { IMAGE_ARTBOARD_COMPLETION_CHECKS } from "../src/harness/design-craft";
import { DECK_REVIEW_PROMPT, DECK_SKILL_MD } from "../src/harness/skills/deck-skill";
import { PROTOTYPE_SKILL_MD } from "../src/harness/skills/prototype-skill";
import { DECK_STAGE_JS } from "../src/runtime/deck-stage";
import {
  DEFAULT_VISUAL_IDENTITY,
  MAX_VISUAL_CRAFT_CHARS,
  PROTOTYPE_VISUAL_CRAFT,
  VISUAL_CRAFT_CORE,
} from "../src/harness/skills/visual-craft-skill";
import { ensureLearningSchema } from "./learning-fixture";

type BuildContext = Parameters<typeof buildPrompt>[0];
type ProjectType = BuildContext["project"]["project_type"];

const REQUEST = { type: "user.message", text: "Build it" } as const;

beforeAll(() => ensureLearningSchema(getSqlite()));

function makeContext(
  projectType: ProjectType,
  extra: Partial<Omit<BuildContext, "project">> = {},
  optionsJson: string | null = projectType === "graphic" ? JSON.stringify({ graphic_canvas: { schema_version: 1, width: 1080, height: 1350 } }) : null,
): BuildContext {
  return {
    project: {
      project_id: `guidance-${projectType}`,
      project_name: "Guidance consistency",
      project_type: projectType,
      entrypoint: projectType === "slide_deck" ? "deck.html" : "index.html",
      project_dir: `/missing/guidance-${projectType}`,
      options_json: optionsJson,
    },
    files: [],
    attachments: [],
    designSystem: null,
    openComments: [],
    ...extra,
  } as BuildContext;
}

/** The prompt text between two headings; the end heading may be absent when the section runs to the end. */
function section(prompt: string, start: string, end: string): string {
  const from = prompt.indexOf(start);
  expect(from, `${start} present`).toBeGreaterThanOrEqual(0);
  const to = prompt.indexOf(end, from + start.length);
  return prompt.slice(from, to === -1 ? undefined : to);
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("chart guidance", () => {
  test("PH-08: Given a full-mode deck prompt When the deck skill and deck craft blocks are sliced Then charts are native data-bg-chart figures and the chart rules ship once", async () => {
    const prompt = await buildPrompt(makeContext("slide_deck"), REQUEST, { contextMode: "full" });
    const skill = section(prompt, "## Slide deck skill", "## Visual craft");
    const craft = section(prompt, "## Deck craft (DECK_VISUAL_CRAFT)", "## Default visual identity");

    for (const block of [skill, craft]) {
      expect(block).not.toContain("inline SVG");
      expect(block).not.toContain("dot terminators");
      expect(block).toContain("data-bg-chart");
    }
    expect(countOccurrences(prompt, CHART_AUTHORING_RULES)).toBe(1);
  });
});

describe("palette guidance", () => {
  /** A warm off-white: red leads green leads blue by more than a rounding error. */
  const warmCream = (hex: string): boolean => {
    const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
    return r > g && g > b && r - b > 10;
  };

  test("PH-09: Given the default visual identity When its palette examples are parsed Then no light ground is a warm cream", () => {
    const palettes = [...DEFAULT_VISUAL_IDENTITY.matchAll(/--bg:#([0-9A-F]{6}) --surface:#([0-9A-F]{6}) --surface-2:#([0-9A-F]{6})/gu)];
    expect(palettes).toHaveLength(2);
    const light = palettes.filter(([, bg]) => [0, 2, 4].reduce((sum, offset) => sum + Number.parseInt(bg!.slice(offset, offset + 2), 16), 0) > 384);
    expect(light).toHaveLength(1);
    for (const [, bg, , surface2] of light) {
      expect(warmCream(bg!), `--bg #${bg}`).toBe(false);
      expect(warmCream(surface2!), `--surface-2 #${surface2}`).toBe(false);
    }
    expect(DEFAULT_VISUAL_IDENTITY).not.toContain("--bg:#F6F1E8");
  });
});

describe("Hangul typography guidance", () => {
  const KOREAN_BRIEF = JSON.stringify({
    design_brief: {
      schema_version: 1, output_type: "prototype", audience: "방문자", objective: "서비스 소개", content_source: "none",
      locale: "ko", brand_mode: "none", visual_mood: "formal", density: "balanced", output_size: "responsive",
    },
  });

  test("PH-12/CSS-19: Given a Korean brief without a design system When the prompt is built in both modes Then Hangul rules ship once before the request within the craft budget", async () => {
    for (const contextMode of ["full", "compact"] as const) {
      const prompt = await buildPrompt(makeContext("prototype", {}, KOREAN_BRIEF), REQUEST, { contextMode });
      const request = prompt.indexOf("## Request");
      expect(prompt.slice(0, request)).toContain("keep-all");
      expect(prompt.slice(0, request)).toContain("Hangul");
      expect(countOccurrences(prompt, DESIGN_CRAFT_RULES)).toBe(1);
    }
    expect(VISUAL_CRAFT_CORE).toMatch(/-0\.04em \(Latin only\)/u);
    expect(VISUAL_CRAFT_CORE.length + PROTOTYPE_VISUAL_CRAFT.length + DEFAULT_VISUAL_IDENTITY.length).toBeLessThanOrEqual(MAX_VISUAL_CRAFT_CHARS - 118);
  });
});

describe("prototype viewport guidance", () => {
  test("OWN-5: Given the website craft block Then it names the audited widths beside the 320px authoring floor within the craft budget", () => {
    // design-audit.ts renders responsive pages at 1280x900 and 375x812; the craft block must not promise a third measured width.
    for (const width of ["1280", "375", "320px"]) expect(PROTOTYPE_VISUAL_CRAFT).toContain(width);
    expect(PROTOTYPE_VISUAL_CRAFT).toContain("audits");
    expect(VISUAL_CRAFT_CORE.length + PROTOTYPE_VISUAL_CRAFT.length + DEFAULT_VISUAL_IDENTITY.length).toBeLessThanOrEqual(MAX_VISUAL_CRAFT_CHARS - 118);
  });
});

describe("deck skill export and token contracts", () => {
  test("PH-15: Given both deck skill variants Then each declares the deck font aliases the review prompt checks", () => {
    for (const skill of [DECK_SKILL_MD, COMPACT_DECK_SKILL_MD]) {
      expect(skill).toContain("--deck-font-heading: var(--font-display)");
      expect(skill).toContain("--deck-font-body: var(--font-body)");
    }
    expect(DECK_REVIEW_PROMPT).toContain("--deck-font-heading");
    expect(DECK_REVIEW_PROMPT).toContain("--deck-font-body");
  });

  test("PH-17: Given the craft rules and both deck skill variants Then the same export-failure rule and the static address fallback ship in all three", () => {
    for (const text of [DESIGN_CRAFT_RULES, DECK_SKILL_MD, COMPACT_DECK_SKILL_MD]) expect(text).toContain(EXPORT_REMOTE_FRAME_RULE);
    expect(EXPORT_REMOTE_FRAME_RULE).toContain("fail on any remote frame");
    expect(DESIGN_CRAFT_RULES).toContain("static address block");
    expect(DECK_SKILL_MD).not.toContain("PDF export won't capture them");
  });

  test("PH-28: Given the deck skill Then the aspect rule defers to --slide-aspect and the bullet cap is conditional", () => {
    expect(DECK_SKILL_MD).toContain("aspect-ratio: var(--slide-aspect, 16 / 9)");
    expect(DECK_SKILL_MD).toContain("When bullets are used");
  });

  test("CSS-18: Given the deck skill Then it states the exporter's own pagination so no print rules are authored, within budget", () => {
    expect(DECK_SKILL_MD).toContain("@page");
    expect(DECK_SKILL_MD.length).toBeLessThanOrEqual(MAX_SKILL_CHARS);
  });
});

describe("map embeds under export", () => {
  // Documents the exporter behaviour the prompt now describes; needs a real browser, so it runs only under the export smoke gate.
  test.skipIf(process.env.BG_EXPORT_SMOKE !== "1")("PH-17: Given a deck slide holding a Google Maps embed When the PDF renders Then it rejects with render_failed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bg-map-embed-export-"));
    try {
      await copyBundledFonts(dir);
      await mkdir(path.join(dir, "runtime"), { recursive: true });
      await writeFile(path.join(dir, "runtime", "deck-stage.js"), DECK_STAGE_JS, "utf8");
      await writeFile(path.join(dir, "deck.html"), `<!doctype html><html><head><style>html,body{margin:0}.slide{width:1280px;height:720px;background:white}[data-slide]:not([data-active]){display:none}</style></head><body><section class="slide" data-slide><h1 data-bg-node-id="one">Office</h1><iframe src="https://www.google.com/maps/embed?pb=!1m18" width="600" height="450"></iframe></section><script src="runtime/deck-stage.js"></script></body></html>`, "utf8");
      const { renderDeckToPdf } = await import("../src/services/export-pdf");
      await expect(renderDeckToPdf({ stagedDir: dir, entrypoint: "deck.html", outputPath: path.join(dir, "deck.pdf") })).rejects.toMatchObject({ code: "render_failed" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("prototype structure and breakpoint guidance", () => {
  test("PH-10: Given a full-mode prototype prompt When the default page structure is sliced Then social proof is conditional on supplied material while the spatial sentinels and archetypes still ship", async () => {
    const prompt = await buildPrompt(makeContext("prototype"), REQUEST, { contextMode: "full" });
    const structure = section(prompt, "## Default page structure", "## Per-section content rules");
    const sequence = structure.slice(structure.indexOf("default to:"), structure.indexOf("sections)"));

    expect(sequence).not.toContain("social proof");
    expect(structure).toContain("supplied");
    for (const sentinel of ["scroll-owner", "wrap-first", "load-bearing"]) expect(prompt).toContain(sentinel);
    expect(prompt).toContain("horizontal monochrome row of customer logos");
    expect(PROTOTYPE_SKILL_MD.length).toBeLessThanOrEqual(MAX_SKILL_CHARS);
  });

  test("PH-30: Given the prototype skill Then the breakpoint rule names --layout-bp-* before the fixed fallback and wrap-first still ships", () => {
    const token = PROTOTYPE_SKILL_MD.indexOf("--layout-bp-*");
    const fallback = PROTOTYPE_SKILL_MD.indexOf("640px");
    expect(token).toBeGreaterThanOrEqual(0);
    expect(fallback).toBeGreaterThan(token);
    expect(PROTOTYPE_SKILL_MD).toContain("1024px");
    expect(PROTOTYPE_SKILL_MD).toContain("wrap-first");
  });
});

describe("compact skill token sources", () => {
  test("CSS-21: Given compact prompts with and without a design system When the compact skill is sliced Then it names colors_and_type.css and the declared-token fallback instead of a list that is not there", async () => {
    const designSystem = { id: "compact-tokens", name: "Compact", dir_path: "/missing/compact-tokens", skill_md_path: null, tokens_css_path: null, readme_md_path: null } as unknown as NonNullable<BuildContext["designSystem"]>;
    for (const projectType of ["slide_deck", "prototype"] as const) {
      const heading = projectType === "slide_deck" ? "## Slide deck skill" : "## Prototype skill";
      const bare = section(await buildPrompt(makeContext(projectType), REQUEST, { contextMode: "compact" }), heading, "## Visual craft");
      const branded = section(await buildPrompt(makeContext(projectType, { designSystem }), REQUEST, { contextMode: "compact" }), heading, "## Visual craft");
      for (const skill of [bare, branded]) {
        expect(skill).not.toContain("see list above");
        expect(skill).toContain("colors_and_type.css");
        expect(skill).toContain("tokens you declared");
      }
    }
  });
});

describe("theme font wording", () => {
  test("CSS-25: Given a full-mode prompt with a theme SKILL.md When the design-system section is read Then the harness supersede line covers font files on export and precedes the inlined skill", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bg-theme-fonts-"));
    try {
      const skill = path.join(dir, "SKILL.md");
      await writeFile(skill, "Reference shared local fonts while working; include required font files and licenses on export. No CDN.");
      const designSystem = { id: "theme-fonts", name: "Theme", status: "published", source_type: "manual", is_template: false, dir_path: dir, skill_md_path: skill, tokens_css_path: null, readme_md_path: null, thumbnail_path: null, created_at: 1, updated_at: 1, archived_at: null } as unknown as NonNullable<BuildContext["designSystem"]>;
      const prompt = await buildPrompt(makeContext("prototype", { designSystem }), REQUEST, { contextMode: "full" });
      const supersede = prompt.indexOf("supersedes");
      expect(supersede).toBeGreaterThanOrEqual(0);
      const line = prompt.slice(supersede, prompt.indexOf("\n", supersede));
      expect(line).toContain("font files");
      expect(line).toContain("export");
      expect(supersede).toBeLessThan(prompt.indexOf("### SKILL.md"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("image verification ownership", () => {
  test("PH-23: Given every project type in both modes When counted Then the duplicate and display-size checks each ship once, owned by the completion checks and realism rules", async () => {
    for (const projectType of ["prototype", "slide_deck", "graphic"] as const) {
      for (const contextMode of ["full", "compact"] as const) {
        const prompt = await buildPrompt(makeContext(projectType), REQUEST, { contextMode });
        expect(countOccurrences(prompt, "still a duplicate")).toBe(1);
        expect(countOccurrences(prompt, "display size")).toBe(1);
        expect(countOccurrences(prompt, IMAGE_ARTBOARD_COMPLETION_CHECKS)).toBe(1);
      }
    }
  });
});

describe("delivery and direction guidance follow the selected design system", () => {
  const designSystem = { id: "delivery-tokens", name: "Delivery", dir_path: "/missing/delivery-tokens", skill_md_path: null, tokens_css_path: null, readme_md_path: null } as unknown as NonNullable<BuildContext["designSystem"]>;

  test("PH-18: Given a prototype with and without a design system When built Then only the branded Delivery section points at colors_and_type.css", async () => {
    const bare = section(await buildPrompt(makeContext("prototype"), REQUEST), "## Delivery", "## Request");
    const branded = section(await buildPrompt(makeContext("prototype", { designSystem }), REQUEST), "## Delivery", "## Request");

    expect(bare).not.toContain("colors_and_type.css");
    expect(bare).toContain("tokens you declared");
    expect(branded).toContain("colors_and_type.css");
  });

  test("DP-11: Given a selected editorial direction When built with and without a design system Then only the branded block hands layout to the system", async () => {
    const designDirectionState = {
      schema_version: 1, project_id: "guidance-prototype", session_id: "s1", generation_id: "g1", status: "ready",
      content_outline: ["outline-a"], selection_revision: 1, selection_history: [null], error: null, updated_at: 1,
      directions: [
        { id: "editorial", order: 0, layout_key: "editorial", title: "direction-title", summary: "summary", style_facts: ["cream-and-red-fact"], status: "ready", preview_url: "/a", error: null },
        { id: "modular", order: 1, layout_key: "modular", title: "other-b", summary: "other", style_facts: ["fact-b"], status: "ready", preview_url: "/b", error: null },
        { id: "narrative", order: 2, layout_key: "narrative", title: "other-c", summary: "other", style_facts: ["fact-c"], status: "ready", preview_url: "/c", error: null },
      ],
      selected_id: "editorial",
    } as const;
    const bare = section(await buildPrompt(makeContext("prototype", { designDirectionState }), REQUEST), "## Selected design direction", "## BurnGuard image production");
    const branded = section(await buildPrompt(makeContext("prototype", { designDirectionState, designSystem }), REQUEST), "## Selected design direction", "## BurnGuard image production");

    for (const block of [bare, branded]) {
      expect(block).toContain("cream-and-red-fact");
      expect(block).toContain("- layout: editorial");
    }
    expect(bare).not.toContain("design system owns");
    expect(bare).toContain("editorial:");
    expect(bare).toContain("modular:");
    expect(bare).toContain("narrative:");
    expect(branded).toContain("design system owns");
  });
});

describe("deck review locale", () => {
  test("PH-13: Given the deck review prompt Then the closing sentence follows the brief's locale rather than naming Korean", () => {
    expect(DECK_REVIEW_PROMPT).toContain("locale");
    expect(DECK_REVIEW_PROMPT).toContain("burnguard-design-brief-v1");
    expect(DECK_REVIEW_PROMPT).not.toContain("Korean sentence");
  });
});
