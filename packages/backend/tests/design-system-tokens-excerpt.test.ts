import { beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { bundledDesignSystemId, bundledDesignSystems } from "../src/data/bundled-design-systems";
import { getSqlite } from "../src/db/sqlite-client";
import { buildPrompt } from "../src/harness/prompt-builder";
import { resolveRepoRoot } from "../src/lib/paths";
import { ensureLearningSchema } from "./learning-fixture";

type BuildContext = Parameters<typeof buildPrompt>[0];

beforeAll(() => ensureLearningSchema(getSqlite()));

const SYSTEMS: readonly { readonly id: string; readonly dir: string }[] = [
  ...bundledDesignSystems.map((theme) => ({ id: bundledDesignSystemId(theme.slug), dir: path.join(resolveRepoRoot(), "design system themes", theme.slug) })),
  { id: "northvale-capital", dir: path.join(resolveRepoRoot(), "design system sample") },
];

function context(system: { readonly id: string; readonly dir: string }, projectType: BuildContext["project"]["project_type"]): BuildContext {
  return {
    project: { project_id: `tokens-${system.id}`, project_name: "Tokens", project_type: projectType, entrypoint: projectType === "slide_deck" ? "deck.html" : "index.html", project_dir: `/missing/tokens-${system.id}`, options_json: null },
    files: [],
    attachments: [],
    openComments: [],
    designSystem: { id: system.id, name: system.id, status: "published", source_type: "manual", is_template: false, dir_path: system.dir, skill_md_path: path.join(system.dir, "SKILL.md"), tokens_css_path: path.join(system.dir, "colors_and_type.css"), readme_md_path: path.join(system.dir, "README.md"), thumbnail_path: null, created_at: 1, updated_at: 1, archived_at: null },
  } as BuildContext;
}

/** The fenced token excerpt the full prompt inlines. */
function excerptOf(prompt: string): string {
  const heading = prompt.indexOf("### colors_and_type.css (excerpt)");
  expect(heading).toBeGreaterThanOrEqual(0);
  const open = prompt.indexOf("```css\n", heading) + "```css\n".length;
  return prompt.slice(open, prompt.indexOf("\n```", open));
}

/** Every custom property declared in the first :root block of the source file, comments removed. */
function firstRootTokens(css: string): readonly string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  const start = stripped.indexOf(":root");
  const block = stripped.slice(start, stripped.indexOf("}", start));
  return [...block.matchAll(/(--[\w-]+)\s*:/gu)].map((match) => match[1]!);
}

test("Given every bundled theme and the sample When a full prompt is built Then the token excerpt carries the complete first :root block", async () => {
  for (const system of SYSTEMS) {
    const tokens = firstRootTokens(await readFile(path.join(system.dir, "colors_and_type.css"), "utf8"));
    expect(tokens.length, system.id).toBeGreaterThan(40);
    const excerpt = excerptOf(await buildPrompt(context(system, "prototype"), { type: "user.message", text: "Build it" }, { contextMode: "full" }));
    for (const token of tokens) expect(excerpt, `${system.id} ${token}`).toContain(`${token}:`);
    expect(excerpt).not.toContain("/*");
  }
});

test("Given signal-console selected for a deck When a full prompt is built Then elevation and motion tokens reach the model", async () => {
  const system = SYSTEMS.find((entry) => entry.id === bundledDesignSystemId("signal-console"))!;
  const excerpt = excerptOf(await buildPrompt(context(system, "slide_deck"), { type: "user.message", text: "Build it" }, { contextMode: "full" }));

  expect(excerpt).toContain("--shadow-1:");
  expect(excerpt).toContain("--dur-fast:");
  expect(excerpt).toContain("--layout-max:");
});
