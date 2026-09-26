import { afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DesignAuditFinding, DesignAuditResult, UxReviewReport } from "@bg/shared";
import UserMessage from "../src/components/chat/blocks/UserMessage";
import { uxReviewRequest } from "../src/components/modes/UxReviewPanel";
import { useLocaleStore } from "../src/i18n/locale";
import { t } from "../src/i18n/t";
import { platformFixRequest } from "../src/lib/platform-fix-request";
import { qualityFixRequest } from "../src/lib/quality-fix-request";
import { requestDisplayText } from "../src/lib/request-display";

afterEach(() => useLocaleStore.getState().setLocale("ko"));

const digest = "a".repeat(64);
function finding(node: string): DesignAuditFinding {
  return { id: `f-${node}`, source: { rel_path: "contact.html", node_bg_id: node }, check_code: "contrast", severity: "must_fix", targeted_action: "increase_color_contrast", evidence: "evidence" } as DesignAuditFinding;
}
const report = { artifact_revision: 3, artifact_digest: digest, checks: [{ findings: [finding("a"), finding("b")] }] } as unknown as DesignAuditResult;
const uxReport: UxReviewReport = { schema_version: 1, project_id: "project", artifact_revision: 2, artifact_digest: digest, source_path: "pages/home.html", basis: "local_html_heuristics", limitations: [], findings: [] };

test("Given a quality fix request with two findings When displayed Then the heading carries the count and hides the payload and digest (UXM-02)", () => {
  const shown = requestDisplayText(qualityFixRequest(report));
  expect(shown).toBe(t("workspace.quality.fixDisplay", { count: 2 }));
  expect(shown).not.toContain("[{");
  expect(shown).not.toContain(digest);
});

test("Given a request sent under another locale When displayed later Then it is still recognised", () => {
  useLocaleStore.getState().setLocale("en");
  const sent = qualityFixRequest(report);
  useLocaleStore.getState().setLocale("ko");
  expect(requestDisplayText(sent)).toBe(t("workspace.quality.fixDisplay", { count: 2 }));
});

test("Given a platform fix request When displayed Then the heading carries the finding count without the JSON", () => {
  const sent = platformFixRequest([{ code: "cafe24_unresolved_link", page: "contact.html", message: "m", severity: "warning" }]);
  if (sent === null) throw new TypeError("expected a request");
  expect(requestDisplayText(sent)).toBe(t("workspace.export.fixDisplay", { count: 1 }));
  expect(requestDisplayText(sent)).not.toContain("cafe24_unresolved_link");
});

test("Given a UX proposal request When displayed Then the heading names the proposal and hides identity and node", () => {
  const sent = uxReviewRequest(uxReport, "Button purpose", "Explain the goal.", "cta");
  const shown = requestDisplayText(sent);
  expect(shown).toBe(t("workspace.ux.fixDisplay", { title: "Button purpose" }));
  expect(shown).not.toContain(digest);
  expect(shown).not.toContain("cta");
});

test("Given ordinary text or a damaged payload When displayed Then the text is returned unchanged", () => {
  const header = qualityFixRequest(report).split("\n")[0]!;
  for (const text of ["안녕하세요", "line one\nline two", `${header}\n{not an array}`, `${header}\n{"a":1}`, `${header}`]) expect(requestDisplayText(text)).toBe(text);
});

test("Given a rendered user message holding a quality fix request When rendered Then the bubble shows the heading and not the payload", () => {
  const html = renderToStaticMarkup(createElement(UserMessage, { text: qualityFixRequest(report) }));
  expect(html).toContain(t("workspace.quality.fixDisplay", { count: 2 }));
  expect(html).not.toContain(digest);
  expect(html).not.toContain("&quot;node&quot;");
});
