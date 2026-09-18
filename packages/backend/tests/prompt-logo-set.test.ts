import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LOGO_CANDIDATE_COUNT, LOGO_FILES, LOGO_PAGE, type LogoSetV1 } from "@bg/shared";
import { getSqlite } from "../src/db/sqlite-client";
import { buildPrompt } from "../src/harness/prompt-builder";
import { LOGO_VISUAL_CRAFT } from "../src/harness/skills/visual-craft-skill";
import { ensureLearningSchema } from "./learning-fixture";

type BuildContext = Parameters<typeof buildPrompt>[0];

const logoSet: LogoSetV1 = {
  schema_version: 1,
  brand_name: "Northvale",
  niche: "boutique asset management",
  character: ["calm", "precise"],
  logo_type: "combination",
  symbol_keywords: ["mountain"],
};

const SELECT = '<burnguard-logo-action-v1>{"action":"select","round":1,"candidate_id":"candidate-3"}</burnguard-logo-action-v1>';
const REGENERATE = '<burnguard-logo-action-v1>{"action":"regenerate"}</burnguard-logo-action-v1>';

let emptyDir: string;
let exploredDir: string;

beforeAll(() => {
  ensureLearningSchema(getSqlite());
  emptyDir = mkdtempSync(path.join(tmpdir(), "bg-logo-prompt-empty-"));
  exploredDir = mkdtempSync(path.join(tmpdir(), "bg-logo-prompt-round-"));
  mkdirSync(path.join(exploredDir, "explorations", "round-1"), { recursive: true });
  const candidates = Array.from({ length: LOGO_CANDIDATE_COUNT }, (_unused, index) => ({
    id: `candidate-${index + 1}`,
    file: `explorations/round-1/candidate-${index + 1}.png`,
    logo_type: (["wordmark", "abstract", "combination", "emblem"] as const)[index],
    prompt: "flat mark on a plain ground",
    rationale: "one idea",
  }));
  writeFileSync(
    path.join(exploredDir, "explorations", "manifest.json"),
    JSON.stringify({ schema_version: 1, rounds: [{ round: 1, candidates }], selected: null }),
    "utf8",
  );
});

afterAll(() => {
  rmSync(emptyDir, { recursive: true, force: true });
  rmSync(exploredDir, { recursive: true, force: true });
});

function makeContext(overrides: Partial<BuildContext["project"]> = {}): BuildContext {
  return {
    project: {
      project_id: "p-logo",
      project_name: "Northvale",
      project_type: "prototype",
      entrypoint: "index.html",
      project_dir: emptyDir,
      options_json: null,
      ...overrides,
    },
    files: [],
    attachments: [],
    designSystem: null,
    openComments: [],
  } as BuildContext;
}

function logoContext(projectDir: string): BuildContext {
  return makeContext({ project_type: "logo", project_dir: projectDir, options_json: JSON.stringify({ logo_set: logoSet }) });
}

function outputBlock(prompt: string): Record<string, unknown> {
  const match = /<burnguard-logo-output-v1>\n([^\n]+)\n<\/burnguard-logo-output-v1>/u.exec(prompt);
  if (match?.[1] === undefined) throw new TypeError("logo output block missing");
  const parsed: unknown = JSON.parse(match[1]);
  if (typeof parsed !== "object" || parsed === null) throw new TypeError("logo output block is not an object");
  return { ...parsed };
}

function rulePhases(prompt: string): readonly string[] {
  return [...prompt.matchAll(/<burnguard-logo-rules-v1 phase="([a-z]+)">/gu)].map((match) => match[1] ?? "");
}

async function promptFor(context: BuildContext, text: string, contextMode: "full" | "compact" = "full"): Promise<string> {
  return await buildPrompt(context, { type: "user.message", text }, { contextMode });
}

describe("logo output prompt block", () => {
  test("Given a fresh logo project When the prompt is built Then the block declares an explore round of four candidates and the mandatory image-generation sentinel", async () => {
    const prompt = await promptFor(logoContext(emptyDir), "로고 만들어줘");

    expect(outputBlock(prompt)).toMatchObject({
      schema_version: 1,
      phase: "explore",
      round: 1,
      candidate_count: LOGO_CANDIDATE_COUNT,
      page: { width: LOGO_PAGE.width, height: LOGO_PAGE.height },
      brand_name: "Northvale",
      logo_type: "combination",
      files: { ...LOGO_FILES },
    });
    expect(rulePhases(prompt)).toEqual(["explore"]);
    expect(prompt.split("LOGO_IMAGE_GENERATION_REQUIRED")).toHaveLength(2);
    expect(prompt.split("LOGO_REALISM_EXCEPTION")).toHaveLength(2);
    expect(prompt.split("LOGO_SKILL_MD")).toHaveLength(2);
  });

  test("Given an explored round and a regenerate action When the prompt is built Then the phase stays explore on the next round", async () => {
    const block = outputBlock(await promptFor(logoContext(exploredDir), `${REGENERATE}\n다시 만들어주세요.`));

    expect(block).toMatchObject({ phase: "explore", round: 2 });
    expect(block["selected"]).toBeUndefined();
  });

  test("Given an explored round and a select action When the prompt is built Then the phase is finalize with the selected candidate and the required guideline pages", async () => {
    const prompt = await promptFor(logoContext(exploredDir), `${SELECT}\n3번 시안으로 진행해주세요.`);
    const block = outputBlock(prompt);

    expect(block).toMatchObject({
      phase: "finalize",
      round: 1,
      selected: { round: 1, candidate_id: "candidate-3", file: "explorations/round-1/candidate-3.png" },
    });
    expect(Array.isArray(block["required_pages"])).toBe(true);
    expect(block["page_count"]).toEqual({ min: 8, max: 13 });
    const pages = (block["required_pages"] as readonly unknown[]).length;
    expect(pages).toBeGreaterThanOrEqual(12);
    expect(pages).toBeLessThanOrEqual(13);
    expect(rulePhases(prompt)).toEqual(["finalize"]);
  });

  test("Given a select action that names a candidate outside the manifest When the prompt is built Then the phase falls back to explore", async () => {
    const stray = '<burnguard-logo-action-v1>{"action":"select","round":4,"candidate_id":"candidate-1"}</burnguard-logo-action-v1>';
    expect(outputBlock(await promptFor(logoContext(exploredDir), stray))).toMatchObject({ phase: "explore", round: 2 });
  });

  test("Given a prototype project When the prompt is built Then no logo block, rules, skill or craft appear", async () => {
    const prompt = await promptFor(makeContext(), "홈페이지 만들어줘");

    expect(prompt).not.toContain("<burnguard-logo-output-v1>");
    expect(rulePhases(prompt)).toEqual([]);
    expect(prompt).not.toContain("LOGO_IMAGE_GENERATION_REQUIRED");
    expect(prompt).not.toContain("LOGO_SKILL_MD");
    expect(prompt).not.toContain("LOGO_VISUAL_CRAFT");
  });

  test("Given compact and full context modes When a logo prompt is built Then the block and craft appear exactly once and before delivery", async () => {
    for (const contextMode of ["full", "compact"] as const) {
      const prompt = await promptFor(logoContext(emptyDir), "로고 만들어줘", contextMode);
      expect(prompt.split("<burnguard-logo-output-v1>")).toHaveLength(2);
      expect(prompt.split("<burnguard-logo-rules-v1")).toHaveLength(2);
      expect(prompt.split("LOGO_VISUAL_CRAFT")).toHaveLength(2);
      expect(prompt.split("GRAPHIC_VISUAL_CRAFT")).toHaveLength(1);
      expect(prompt.indexOf("<burnguard-logo-output-v1>")).toBeLessThan(prompt.indexOf("## Delivery"));
      const shipped = LOGO_VISUAL_CRAFT.trim();
      const start = prompt.indexOf(shipped.slice(0, shipped.indexOf("\n")));
      expect(prompt.slice(start, start + shipped.length)).toBe(shipped);
    }
  });
});
