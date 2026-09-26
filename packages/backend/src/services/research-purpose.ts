import type { ProjectType } from "@bg/shared";
import { loadResearchCatalog, type CatalogConfidence, type CatalogPurpose } from "./research-catalog";
import type { PromptPurpose } from "./prompt-purpose";

const COMMON_BASELINE_IDS = ["CR-001", "CR-002", "CR-003", "CR-004", "CR-005", "CR-008", "CR-009"] as const;
const PPTX_REQUEST_PATTERN = /\b(?:pptx|powerpoint)\b/i;

const INTENT_SELECTORS = [
  { intent: "company", purpose: "deck.company", pattern: /\b(?:company profile|corporate overview|company introduction)\b|(?:회사|기업)\s*(?:소개|개요)|회사소개서|기업소개서/iu },
  { intent: "sales", purpose: "deck.sales", pattern: /\b(?:sales proposal|client proposal|commercial proposal|sales deck)\b|(?:고객사?|영업)\s*(?:제안서|자료|덱|슬라이드)|영업제안서/iu },
  { intent: "report", purpose: "deck.report", pattern: /\b(?:quarterly|annual|business|status|performance)\s+report(?:\s+deck)?\b|(?:분기|연간)\s*(?:실적|업무|성과)?\s*(?:보고서|보고 자료|리포트)|(?:업무|실적|성과)\s*(?:보고서|보고 자료|리포트)/iu },
  { intent: "training", purpose: "deck.training", pattern: /\b(?:training deck|training material|employee training|onboarding training)\b|(?:신입사원|사내)?\s*교육\s*(?:자료|덱|슬라이드)|연수\s*(?:자료|덱|슬라이드)/iu },
  { intent: "diagram", purpose: "prototype.diagram", pattern: /\b(?:diagram|flowchart|org(?:anization(?:al)?)? chart|process map|service topology|system topology)\b|다이어그램|흐름도|조직도|프로세스\s*맵|서비스\s*구조/iu },
  { intent: "dashboard", purpose: "prototype.dashboard", pattern: /\b(?:dashboard|admin console|analytics console)\b|대시보드|관리자\s*화면|분석\s*화면/iu },
  { intent: "editorial_microsite", purpose: "prototype.editorial", pattern: /\b(?:editorial microsite|editorial site|magazine site|newsletter site)\b|편집형\s*사이트|매거진\s*사이트|뉴스레터\s*사이트/iu },
  { intent: "design_sandbox", purpose: "prototype.sandbox", pattern: /\b(?:design sandbox|design-system playground|design system playground|component gallery)\b|디자인\s*샌드박스|컴포넌트\s*(?:갤러리|쇼케이스)|디자인\s*시스템\s*문서/iu },
  { intent: "landing", purpose: "prototype.landing", pattern: /\b(?:landing page|marketing homepage|marketing site)\b|랜딩\s*페이지|마케팅\s*홈페이지|홍보\s*사이트/iu },
  { intent: "pitch", purpose: "deck.pitch", pattern: /\b(?:investor pitch|pitch deck|fundrais(?:e|ing))\b|투자\s*유치|IR\s*자료|피치\s*덱/iu },
] as const;

type RequestIntent = (typeof INTENT_SELECTORS)[number]["intent"] | "unspecified";
type CreationMode = "blank" | "existing" | "template" | "other";
type ResearchAuthority = "normative_web_constraint" | "sampled_system_guidance" | "research_heuristic";
type ResearchAdvice = "reflow_320_with_2d_exceptions" | "non_color_state_cues" | "target_size_24" | "reduced_motion" | "svg_aria_labelledby_ids" | "pptx_text_first";

type ResearchRouting = {
  readonly project_type: ProjectType;
  readonly request_intent: RequestIntent;
  readonly creation_mode: CreationMode;
  readonly fallback: "common_baseline" | "none";
  readonly purpose: PromptPurpose | null;
};

type PromptResearchRule = {
  readonly id: string;
  readonly axis: string;
  readonly directive: string;
  readonly rationale: string;
  readonly confidence: CatalogConfidence;
  readonly authority_class: ResearchAuthority;
  readonly source_ids: readonly string[];
};

export type BurnguardResearchContext = {
  readonly schema_version: 1;
  readonly routing: ResearchRouting;
  readonly rules: readonly PromptResearchRule[];
  readonly conflicts: readonly { readonly axis: string; readonly rule_ids: readonly string[]; readonly explanation: string }[];
  readonly advice: readonly ResearchAdvice[];
  readonly output_profile: "web" | "pptx_text_first";
  readonly precedence: readonly ["research", "design_system", "project", "user_request"];
  readonly assembly: "fixed_captured_state";
};

export type ResearchPurposeInput = {
  readonly projectType: ProjectType;
  readonly request: string;
  readonly hasCapturedFiles: boolean;
  /** The purpose stored on the project; used when the request itself matches no selector. */
  readonly storedPurpose?: PromptPurpose | null;
};

/** The purpose a request names, or null when no selector matches. */
export function matchResearchPurpose(request: string): PromptPurpose | null {
  return INTENT_SELECTORS.find((selector) => selector.pattern.test(request))?.purpose ?? null;
}

export function buildResearchPromptContext(input: ResearchPurposeInput): BurnguardResearchContext {
  const catalog = loadResearchCatalog();
  const selected = INTENT_SELECTORS.find((selector) => selector.pattern.test(input.request));
  const purpose = selected?.purpose ?? input.storedPurpose ?? null;
  const purposeRecord = purpose === null ? null : catalog.purposes.find((item) => item.id === purpose) ?? null;
  const commonIds = new Set([...COMMON_BASELINE_IDS, ...(purposeRecord?.common_rule_ids ?? [])]);
  const commonRules: readonly PromptResearchRule[] = catalog.common_rules
    .filter((rule) => commonIds.has(rule.id))
    .map((rule) => ({ id: rule.id, axis: rule.topic, directive: rule.statement, rationale: rule.limitations, confidence: rule.confidence, authority_class: rule.authority_class, source_ids: rule.source_ids }));
  const purposeRules = purposeRecord === null ? [] : promptPurposeRules(purposeRecord);
  const pptx = PPTX_REQUEST_PATTERN.test(input.request);
  const advice: ResearchAdvice[] = ["reflow_320_with_2d_exceptions", "non_color_state_cues", "target_size_24", "reduced_motion"];
  if (purpose === "prototype.diagram") advice.push("svg_aria_labelledby_ids");
  if (pptx) advice.push("pptx_text_first");

  return {
    schema_version: 1,
    routing: {
      project_type: input.projectType,
      request_intent: selected?.intent ?? "unspecified",
      creation_mode: creationMode(input),
      fallback: purpose === null ? "common_baseline" : "none",
      purpose,
    },
    rules: [...commonRules, ...purposeRules],
    conflicts: [],
    advice,
    output_profile: pptx ? "pptx_text_first" : "web",
    precedence: ["research", "design_system", "project", "user_request"],
    assembly: "fixed_captured_state",
  };
}

function creationMode(input: ResearchPurposeInput): CreationMode {
  switch (input.projectType) {
    case "from_template": return "template";
    case "prototype":
    case "slide_deck":
    case "graphic":
    case "logo": return input.hasCapturedFiles ? "existing" : "blank";
    case "other": return "other";
  }
}

function promptPurposeRules(purpose: CatalogPurpose): readonly PromptResearchRule[] {
  return purpose.guidance.map((directive, index) => ({
    id: `${purpose.id}:${index + 1}`,
    axis: `purpose:${index + 1}`,
    directive,
    rationale: purpose.limitations,
    confidence: purpose.confidence,
    authority_class: "research_heuristic",
    source_ids: purpose.source_ids,
  }));
}
