import { UX_FINDING_CODES, UX_LIMITATION_CODES, type UxFindingCode, type UxReviewFinding } from "@bg/shared";
import type { MessageKey, t } from "@/i18n/t";

/** Localized finding copy by stable backend code; the authored strings remain the fallback for an unknown code. */
export const UX_FINDING_COPY = {
  page_heading: { title: "modes.ux.finding.page_heading.title", evidence: "modes.ux.finding.page_heading.evidence", proposal: "modes.ux.finding.page_heading.proposal" },
  heading_jump: { title: "modes.ux.finding.heading_jump.title", evidence: "modes.ux.finding.heading_jump.evidence", proposal: "modes.ux.finding.heading_jump.proposal" },
  action_name: { title: "modes.ux.finding.action_name.title", evidence: "modes.ux.finding.action_name.evidence", evidenceLabel: "modes.ux.finding.action_name.evidenceLabel", proposal: "modes.ux.finding.action_name.proposal" },
  input_label: { title: "modes.ux.finding.input_label.title", evidence: "modes.ux.finding.input_label.evidence", proposal: "modes.ux.finding.input_label.proposal" },
  link_name: { title: "modes.ux.finding.link_name.title", evidence: "modes.ux.finding.link_name.evidence", evidenceLabel: "modes.ux.finding.link_name.evidenceLabel", proposal: "modes.ux.finding.link_name.proposal" },
  image_alt: { title: "modes.ux.finding.image_alt.title", evidence: "modes.ux.finding.image_alt.evidence", proposal: "modes.ux.finding.image_alt.proposal" },
  long_paragraph: { title: "modes.ux.finding.long_paragraph.title", evidence: "modes.ux.finding.long_paragraph.evidence", proposal: "modes.ux.finding.long_paragraph.proposal" },
} as const satisfies Record<UxFindingCode, { title: MessageKey; evidence: MessageKey; evidenceLabel?: MessageKey; proposal: MessageKey }>;

export const UX_LIMITATION_COPY = {
  static_heuristics: "modes.ux.limitation.static_heuristics",
  bounded_findings: "modes.ux.limitation.bounded_findings",
} as const satisfies Record<(typeof UX_LIMITATION_CODES)[number], MessageKey>;

function findingCode(code: string): UxFindingCode | null {
  return (UX_FINDING_CODES as readonly string[]).includes(code) ? code as UxFindingCode : null;
}

export function uxFindingCopy(finding: UxReviewFinding, translate: typeof t): { title: string; evidence: string; proposal: string } {
  const code = findingCode(finding.code);
  if (code === null) return { title: finding.title, evidence: finding.evidence, proposal: finding.proposal };
  const keys = UX_FINDING_COPY[code];
  const detail = finding.detail ?? {};
  const evidenceKey = "evidenceLabel" in keys && typeof detail.label === "string" ? keys.evidenceLabel : keys.evidence;
  return { title: translate(keys.title), evidence: translate(evidenceKey, detail), proposal: translate(keys.proposal) };
}

export function uxLimitationCopy(code: string, translate: typeof t): string {
  return (UX_LIMITATION_CODES as readonly string[]).includes(code) ? translate(UX_LIMITATION_COPY[code as (typeof UX_LIMITATION_CODES)[number]]) : code;
}
