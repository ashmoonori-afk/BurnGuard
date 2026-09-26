import { afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UX_FINDING_CODES, UX_LIMITATION_CODES, type UxReviewFinding, type UxReviewReport } from "@bg/shared";
import UxReviewPanel from "../src/components/modes/UxReviewPanel";
import { UX_FINDING_COPY, UX_LIMITATION_COPY, uxFindingCopy, uxLimitationCopy } from "../src/components/modes/ux-finding-copy";
import { LOCALES, useLocaleStore } from "../src/i18n/locale";
import { messages } from "../src/i18n/messages";
import { t } from "../src/i18n/t";

afterEach(() => useLocaleStore.getState().setLocale("ko"));

function finding(overrides: Partial<UxReviewFinding>): UxReviewFinding {
  return { id: "f", code: "input_label", priority: "high", title: "입력 레이블 연결", evidence: "연결된 레이블을 찾지 못했습니다.", proposal: "label을 연결하세요.", node_bg_id: "field", pattern_id: "form", ...overrides };
}

test("Given every backend finding and limitation code When the copy tables are read Then each code has title, evidence and proposal keys in every locale (DP-10, UXM-04)", () => {
  for (const code of UX_FINDING_CODES) {
    const keys = UX_FINDING_COPY[code];
    for (const key of [keys.title, keys.evidence, keys.proposal, ...("evidenceLabel" in keys ? [keys.evidenceLabel] : [])]) {
      for (const locale of LOCALES) expect(typeof messages[key][locale], `${key}/${locale}`).toBe("string");
    }
  }
  for (const code of UX_LIMITATION_CODES) for (const locale of LOCALES) expect(typeof messages[UX_LIMITATION_COPY[code]][locale]).toBe("string");
});

test("Given locale en and a finding with code input_label When the card copy is derived Then it is the localized copy without Hangul", () => {
  useLocaleStore.getState().setLocale("en");
  const copy = uxFindingCopy(finding({}), t);
  expect(copy.title).toBe(t("modes.ux.finding.input_label.title"));
  for (const text of [copy.title, copy.evidence, copy.proposal]) expect(text).not.toMatch(/\p{Script=Hangul}/u);
});

test("Given details When the card copy is derived Then the label, levels and length are interpolated and an unknown code keeps the authored strings", () => {
  useLocaleStore.getState().setLocale("en");
  expect(uxFindingCopy(finding({ code: "action_name", detail: { label: "OK" } }), t).evidence).toBe(t("modes.ux.finding.action_name.evidenceLabel", { label: "OK" }));
  expect(uxFindingCopy(finding({ code: "action_name" }), t).evidence).toBe(t("modes.ux.finding.action_name.evidence"));
  expect(uxFindingCopy(finding({ code: "heading_jump", detail: { previous: 1, level: 3 } }), t).evidence).toBe(t("modes.ux.finding.heading_jump.evidence", { previous: 1, level: 3 }));
  expect(uxFindingCopy(finding({ code: "long_paragraph", detail: { length: 600 } }), t).evidence).toContain("600");
  const unknown = finding({ code: "future_code", title: "Authored title", evidence: "Authored evidence", proposal: "Authored proposal" });
  expect(uxFindingCopy(unknown, t)).toEqual({ title: "Authored title", evidence: "Authored evidence", proposal: "Authored proposal" });
  expect(uxLimitationCopy("static_heuristics", t)).toBe(t("modes.ux.limitation.static_heuristics"));
  expect(uxLimitationCopy("Static only", t)).toBe("Static only");
});

// A server render reads the store's initial locale, so this case checks code-based lookup rather than a locale switch.
test("Given a cached report whose authored strings differ from the code When the panel renders Then finding cards and limitations show the code's localized copy", () => {
  const report: UxReviewReport = { schema_version: 1, project_id: "project", artifact_revision: 1, artifact_digest: "a".repeat(64), source_path: "index.html", basis: "local_html_heuristics", limitations: [...UX_LIMITATION_CODES], findings: [finding({ code: "link_name", detail: { label: "더 보기" } })] };
  const client = new QueryClient();
  client.setQueryData(["ux-review", "project", "index.html", report.artifact_digest, 1], report);
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(UxReviewPanel, { binding: { projectId: "project", relPath: "index.html", digest: report.artifact_digest, revision: 1, disabled: false, async onRequestAI() {} } })));
  expect(html).toContain(t("modes.ux.finding.link_name.title"));
  expect(html).toContain(t("modes.ux.finding.link_name.evidenceLabel", { label: "더 보기" }));
  expect(html).toContain(t("modes.ux.limitation.static_heuristics"));
  expect(html).not.toContain("입력 레이블 연결");
  expect(html).not.toContain(">static_heuristics<");
});
