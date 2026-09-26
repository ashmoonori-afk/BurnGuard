import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LUCIDE_REFERENCE_REL_PATH, provisionLucideIconReference } from "../src/harness/lucide-reference";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import {
  LUCIDE_ICONS,
  renderLucideIconReference,
} from "../src/harness/assets/lucide/icons";
import { buildPrompt, MAX_SKILL_CHARS } from "../src/harness/prompt-builder";
import { DECK_SKILL_MD } from "../src/harness/skills/deck-skill";
import { DIAGRAM_SKILL_MD } from "../src/harness/skills/diagram-skill";
import { PROTOTYPE_SKILL_MD } from "../src/harness/skills/prototype-skill";

const ICON_POINTER_SENTINEL = "LUCIDE_ICON_REFERENCE";
const ASSET_DIR = path.resolve(import.meta.dir, "../src/harness/assets/lucide");

type BuildContext = Parameters<typeof buildPrompt>[0];

function makeContext(projectType: "prototype" | "slide_deck"): BuildContext {
  return {
    project: {
      project_id: "icon-test",
      project_name: "Icon test",
      project_type: projectType,
      entrypoint: projectType === "prototype" ? "index.html" : "deck.html",
      project_dir: path.join(import.meta.dir, "fixtures", "missing-icon-project"),
      options_json: null,
    },
    files: [],
    attachments: [],
    designSystem: null,
    openComments: [],
  } as BuildContext;
}

describe("bundled Lucide icon vocabulary", () => {
  test("contains a valid curated subset", () => {
    const entries = Object.entries(LUCIDE_ICONS);

    expect(entries.length).toBeGreaterThanOrEqual(24);
    expect(entries.length).toBeLessThanOrEqual(40);
    for (const [name, icon] of entries) {
      expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(icon.viewBox.trim().length).toBeGreaterThan(0);
      expect(icon.pathData.trim().length).toBeGreaterThan(0);
    }
  });

  test("ships the generated on-demand reference and donor license", async () => {
    const [reference, license] = await Promise.all([
      readFile(path.join(ASSET_DIR, "reference.md"), "utf8"),
      readFile(path.join(ASSET_DIR, "LICENSE"), "utf8"),
    ]);

    const normalizedReference = reference.replaceAll("\r\n", "\n");
    expect(normalizedReference).toBe(renderLucideIconReference());
    expect(normalizedReference).toContain(ICON_POINTER_SENTINEL);
    expect(normalizedReference).toContain('stroke="currentColor"');
    expect(normalizedReference).toContain("var(--icon-size");
    for (const [name, icon] of Object.entries(LUCIDE_ICONS)) {
      expect(normalizedReference).toContain(`### ${name}`);
      expect(normalizedReference).toContain(icon.pathData);
    }
    expect(license).toContain("ISC License");
    expect(license).toContain("Lucide Contributors");
  });

  test("keeps every full injected skill inside the per-turn budget", () => {
    for (const skill of [
      PROTOTYPE_SKILL_MD,
      DECK_SKILL_MD,
      DIAGRAM_SKILL_MD,
    ]) {
      expect(skill.length).toBeLessThanOrEqual(MAX_SKILL_CHARS);
    }
  });

  test("PH-01: Given a prepared stage When the prompt names the icon reference Then the path resolves inside the stage to the generated reference and the canonical tree digest is unchanged", async () => {
    const stage = await mkdtemp(path.join(tmpdir(), "bg-lucide-stage-"));
    try {
      await writeFile(path.join(stage, "index.html"), "<!doctype html><p>Stage</p>", "utf8");
      const before = await inspectCanonicalTree(stage);
      await provisionLucideIconReference(stage);
      await provisionLucideIconReference(stage);
      const after = await inspectCanonicalTree(stage);
      expect(after.tree_digest).toBe(before.tree_digest);
      expect(after.files.map((file) => file.path)).toEqual(["index.html"]);
      for (const projectType of ["prototype", "slide_deck"] as const) {
        const context = makeContext(projectType);
        const prompt = await buildPrompt({ ...context, project: { ...context.project, project_dir: stage } }, { type: "user.message", text: "Use an icon" });
        const pointer = prompt.match(/\(LUCIDE_ICON_REFERENCE\)[^`]*`([^`]+)`/u)?.[1];
        expect(pointer).toBe(LUCIDE_REFERENCE_REL_PATH);
        expect(await readFile(path.join(stage, pointer!), "utf8")).toBe(renderLucideIconReference());
      }
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  });

  test("ships the icon reference sentinel in prototype and deck prompts", async () => {
    for (const projectType of ["prototype", "slide_deck"] as const) {
      const prompt = await buildPrompt(makeContext(projectType), {
        type: "user.message",
        text: "Use an icon",
      });
      expect(prompt).toContain(ICON_POINTER_SENTINEL);
    }
  });
});
