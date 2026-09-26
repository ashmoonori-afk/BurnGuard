import { afterEach, expect, test } from "bun:test";
import type { DesignAuditFinding, DesignAuditResult } from "@bg/shared";
import { useLocaleStore } from "../src/i18n/locale";
import { t } from "../src/i18n/t";
import { qualityFixRequest } from "../src/lib/quality-fix-request";

afterEach(() => useLocaleStore.getState().setLocale("ko"));

function finding(node: string, evidence = "e"): DesignAuditFinding {
  return { id: `f-${node}`, source: { rel_path: "contact.html", node_bg_id: node }, check_code: "contrast", severity: "must_fix", targeted_action: "increase_color_contrast", evidence } as DesignAuditFinding;
}
const report = { artifact_revision: 3, artifact_digest: "a".repeat(64), checks: [{ findings: [finding("title", "x".repeat(500))] }] } as unknown as DesignAuditResult;

test("Given audit findings When building an auto-fix request Then the localized intro carries the identity, the JSON payload is bounded and the outro follows", () => {
  const request = qualityFixRequest(report);
  const [intro, payload, ...outro] = request.split("\n");
  expect(intro).toBe(t("modes.quality.fixRequest.intro", { revision: 3, digest: report.artifact_digest }));
  expect(JSON.parse(payload!)).toEqual([{ file: "contact.html", node: "title", check: "contrast", severity: "must_fix", action: "increase_color_contrast", evidence: "x".repeat(200) }]);
  expect(outro.join("\n")).toBe(t("modes.quality.fixRequest.outro", { image: t("modes.quality.fixRequest.imageNeutral") }));
});

test("Given the en locale When building an auto-fix request Then the prose lines follow the locale while the payload stays byte-identical", () => {
  const korean = qualityFixRequest(report).split("\n")[1];
  useLocaleStore.getState().setLocale("en");
  const request = qualityFixRequest(report);
  expect(request.split("\n")[0]).toBe(t("modes.quality.fixRequest.intro", { revision: 3, digest: report.artifact_digest }));
  expect(request.split("\n")[1]).toBe(korean);
  expect(request).not.toMatch(/\p{Script=Hangul}/u);
});

test("Given the same report When built for claude-code Then no Codex tool is named, and When built for codex Then it is (UXM-03)", () => {
  useLocaleStore.getState().setLocale("en");
  expect(qualityFixRequest(report, { backendId: "claude-code" })).not.toContain("Codex");
  expect(qualityFixRequest(report)).not.toContain("Codex");
  expect(qualityFixRequest(report, { backendId: "codex" })).toContain("Codex");
  expect(qualityFixRequest(report, { backendId: "codex" })).toContain(t("modes.quality.fixRequest.imageCodex"));
});

test("Given a report with three findings When a subset is requested Then the payload holds exactly that finding with the artifact identity (UXM-34)", () => {
  const findings = [finding("a"), finding("b"), finding("c")];
  const three = { ...report, checks: [{ findings }] } as unknown as DesignAuditResult;
  const request = qualityFixRequest(three, { findings: [findings[1]!] });
  const payload = JSON.parse(request.split("\n")[1]!) as { node: string }[];
  expect(payload.map((entry) => entry.node)).toEqual(["b"]);
  expect(request).toContain(three.artifact_digest);
  expect((JSON.parse(qualityFixRequest(three).split("\n")[1]!) as unknown[]).length).toBe(3);
});
