import { beforeAll, describe, expect, test } from "bun:test";
import { getSqlite } from "../src/db/sqlite-client";
import { buildPrompt } from "../src/harness/prompt-builder";
import { ensureLearningSchema } from "./learning-fixture";

type BuildContext = Parameters<typeof buildPrompt>[0];
type ResearchBlock = {
  readonly schema_version: 1;
  readonly routing: { readonly project_type: string; readonly request_intent: string; readonly creation_mode: string; readonly fallback: string; readonly purpose: string | null };
  readonly rules: readonly { readonly id: string; readonly rationale: string; readonly confidence: string; readonly source_ids: readonly string[]; readonly authority_class: string }[];
  readonly conflicts: readonly unknown[];
  readonly advice: readonly string[];
  readonly output_profile: string;
  readonly precedence: readonly string[];
  readonly assembly: string;
};

beforeAll(() => ensureLearningSchema(getSqlite()));

function context(projectType = "prototype", files: BuildContext["files"] = [], optionsJson: string | null = null): BuildContext {
  return {
    project: { project_id: `research-purpose-${projectType}`, project_name: "Research purpose", project_type: projectType, entrypoint: projectType === "slide_deck" ? "deck.html" : "index.html", project_dir: "/missing/research-purpose", options_json: optionsJson },
    files, attachments: [], designSystem: null, openComments: [],
  } as BuildContext;
}

function researchBlock(prompt: string): ResearchBlock {
  const match = prompt.match(/<burnguard-research-context-v1>\n([^\n]+)\n<\/burnguard-research-context-v1>/u);
  if (match?.[1] === undefined) throw new TypeError("research context block missing");
  return JSON.parse(match[1]);
}

describe("research purpose prompt integration", () => {
  test.each([
    ["prototype", "Create a landing page", "prototype.landing"],
    ["prototype", "Create an analytics dashboard", "prototype.dashboard"],
    ["prototype", "Create an architecture diagram", "prototype.diagram"],
    ["prototype", "Create an editorial microsite", "prototype.editorial"],
    ["prototype", "Create a design sandbox", "prototype.sandbox"],
    ["slide_deck", "Create an investor pitch deck", "deck.pitch"],
  ])("Given a project and concrete request When built Then the requested purpose is selected", async (projectType, request, purpose) => {
    expect(researchBlock(await buildPrompt(context(projectType), { type: "user.message", text: request })).routing.purpose).toBe(purpose);
  });

  test.each([
    ["회사소개서를 만들어 주세요", "deck.company", "company"],
    ["Create a company profile deck", "deck.company", "company"],
    ["고객사 제안서 슬라이드를 준비해 줘", "deck.sales", "sales"],
    ["Create a sales proposal deck", "deck.sales", "sales"],
    ["분기 실적 보고서를 만들어 줘", "deck.report", "report"],
    ["Create a quarterly report deck", "deck.report", "report"],
    ["신입사원 교육 자료를 만들어 줘", "deck.training", "training"],
    ["Create a training deck", "deck.training", "training"],
    ["투자 유치 IR 자료를 만들어 줘", "deck.pitch", "pitch"],
  ])("Given a Korean or English deck request When built Then purpose and intent separate by deck kind", async (request, purpose, intent) => {
    const block = researchBlock(await buildPrompt(context("slide_deck"), { type: "user.message", text: request }));
    expect(block.routing.purpose).toBe(purpose);
    expect(block.routing.request_intent).toBe(intent);
  });

  test("Given a Korean sales deck request When built Then purpose rules carry catalog ids and explicit confidence", async () => {
    const block = researchBlock(await buildPrompt(context("slide_deck"), { type: "user.message", text: "영업 제안서 덱을 만들어 줘" }));
    const purposeRules = block.rules.filter((rule) => rule.id.startsWith("deck.sales:"));
    expect(purposeRules.map((rule) => rule.id)).toEqual(["deck.sales:1", "deck.sales:2", "deck.sales:3"]);
    expect(purposeRules.every((rule) => rule.confidence === "medium" && rule.source_ids.length > 0 && rule.authority_class === "research_heuristic")).toBe(true);
    expect(block.rules.map((rule) => rule.id)).toEqual(expect.arrayContaining(["CR-001", "CR-002", "CR-004", "CR-008"]));
    expect(block.output_profile).toBe("web");
  });

  test("Given a Korean training deck for PowerPoint When built Then the purpose and text-first profile hold together", async () => {
    const block = researchBlock(await buildPrompt(context("slide_deck"), { type: "user.message", text: "사내 교육 자료를 PPTX로 만들어 줘" }));
    expect(block.routing).toEqual({ project_type: "slide_deck", request_intent: "training", creation_mode: "blank", fallback: "none", purpose: "deck.training" });
    expect(block.output_profile).toBe("pptx_text_first");
    expect(block.advice).toContain("pptx_text_first");
  });

  test("Given generic and template requests When built Then fallback remains separate from intent and mode", async () => {
    const generic = researchBlock(await buildPrompt(context(), { type: "user.message", text: "Polish this" }));
    const template = researchBlock(await buildPrompt(context("from_template"), { type: "user.message", text: "Polish this" }));
    const selectedTemplate = researchBlock(await buildPrompt(context("from_template"), { type: "user.message", text: "Improve this dashboard" }));
    expect(generic.routing).toEqual({ project_type: "prototype", request_intent: "unspecified", creation_mode: "blank", fallback: "common_baseline", purpose: null });
    expect(template.routing).toEqual({ project_type: "from_template", request_intent: "unspecified", creation_mode: "template", fallback: "common_baseline", purpose: null });
    expect(selectedTemplate.routing.purpose).toBe("prototype.dashboard");
  });

  test("Given a stored research purpose When an edit request matches no selector Then the stored purpose routes the rules", async () => {
    const stored = JSON.stringify({ research_purpose: "deck.company" });
    const edit = researchBlock(await buildPrompt(context("slide_deck", [], stored), { type: "user.message", text: "2페이지 글자 키워줘" }));
    expect(edit.routing).toEqual({ project_type: "slide_deck", request_intent: "unspecified", creation_mode: "blank", fallback: "none", purpose: "deck.company" });
    expect(edit.rules.map((rule) => rule.id)).toEqual(expect.arrayContaining(["deck.company:1", "deck.company:2", "deck.company:3"]));
    const explicit = researchBlock(await buildPrompt(context("slide_deck", [], stored), { type: "user.message", text: "Create a sales proposal deck" }));
    expect(explicit.routing).toMatchObject({ request_intent: "sales", fallback: "none", purpose: "deck.sales" });
    expect(explicit.rules.some((rule) => rule.id.startsWith("deck.company:"))).toBe(false);
  });

  test("Given captured files When built Then creation mode changes without changing request intent", async () => {
    const block = researchBlock(await buildPrompt(context("prototype", [{ rel_path: "index.html", category: "code", size_bytes: 10, hash: "digest", updated_at: 1 }]), { type: "user.message", text: "Polish this" }));
    expect(block.routing.creation_mode).toBe("existing");
    expect(block.routing.request_intent).toBe("unspecified");
  });

  test("Given a sourced selection When built Then explanations, provenance, and conflicts are explicit", async () => {
    const block = researchBlock(await buildPrompt(context(), { type: "user.message", text: "Create a dashboard" }));
    expect(block.rules.length).toBeGreaterThan(0);
    expect(block.rules.every((rule) => rule.id.length > 0 && rule.rationale.length > 0 && rule.confidence.length > 0 && rule.source_ids.length > 0)).toBe(true);
    expect(block.rules.some((rule) => rule.authority_class === "sampled_system_guidance")).toBe(true);
    expect(block.conflicts).toEqual([]);
  });

  test("Given project and design-system context When built Then the block precedes overrides and request stays last", async () => {
    const request = "Create a landing page";
    const prompt = await buildPrompt({ ...context(), designSystem: { id: "ds", name: "System", status: "published", source_type: "manual", is_template: false, dir_path: "/missing/design-system", skill_md_path: null, tokens_css_path: null, readme_md_path: null, thumbnail_path: null, created_at: 1, updated_at: 1, archived_at: null } }, { type: "user.message", text: request });
    expect(prompt.match(/<burnguard-research-context-v1>/gu)).toHaveLength(1);
    expect(prompt.indexOf("<burnguard-research-context-v1>")).toBeLessThan(prompt.indexOf("## Design system"));
    expect(prompt.endsWith(`## Request\n${request}`)).toBe(true);
  });

  test("Given the research context When built Then precedence keeps research first and the request last", async () => {
    const block = researchBlock(await buildPrompt(context(), { type: "user.message", text: "Create a landing page" }));
    expect(block.precedence).toEqual(["research", "design_system", "project", "user_request"]);
  });

  test("Given fixed captured state When built repeatedly Then prompt bytes repeat", async () => {
    const fixedContext = context();
    const event = { type: "user.message", text: "Create an editorial microsite" } as const;
    expect(await buildPrompt(fixedContext, event)).toBe(await buildPrompt(fixedContext, event));
    expect(researchBlock(await buildPrompt(fixedContext, event)).assembly).toBe("fixed_captured_state");
  });

  test("Given web output When built Then accessibility contracts are selected", async () => {
    const block = researchBlock(await buildPrompt(context(), { type: "user.message", text: "Create a dashboard" }));
    expect(block.rules.map((rule) => rule.id)).toEqual(expect.arrayContaining(["CR-002", "CR-003", "CR-005", "CR-009", "prototype.dashboard:1"]));
    expect(block.advice).toEqual(expect.arrayContaining(["reflow_320_with_2d_exceptions", "non_color_state_cues", "target_size_24", "reduced_motion"]));
  });

  test("Given a diagram request When built Then SVG naming and bounded 2D advice are selected", async () => {
    const block = researchBlock(await buildPrompt(context(), { type: "user.message", text: "Create a service topology diagram" }));
    expect(block.routing.purpose).toBe("prototype.diagram");
    expect(block.advice).toEqual(expect.arrayContaining(["svg_aria_labelledby_ids", "reflow_320_with_2d_exceptions"]));
  });

  test("Given a PowerPoint request When built Then the text-first PPTX-safe profile is selected", async () => {
    const block = researchBlock(await buildPrompt(context("slide_deck"), { type: "user.message", text: "Create an investor pitch for PowerPoint export" }));
    expect(block.routing.purpose).toBe("deck.pitch");
    expect(block.output_profile).toBe("pptx_text_first");
    expect(block.advice).toContain("pptx_text_first");
  });
});
