import { expect, test } from "bun:test";
import type { DesignAuditResult } from "@bg/shared";
import { qualityFixRequest } from "../src/lib/quality-fix-request";

test("Given audit findings When building an auto-fix request Then source identity and bounded evidence accompany honest rechecking instructions", () => {
  const report = { artifact_revision: 3, artifact_digest: "a".repeat(64), checks: [{ findings: [{ source: { rel_path: "contact.html", node_bg_id: "title" }, check_code: "contrast", severity: "must_fix", targeted_action: "increase_color_contrast", evidence: "x".repeat(500) }] }] } as unknown as DesignAuditResult;
  const request = qualityFixRequest(report);
  expect(request).toContain("contact.html");
  expect(request).toContain('"node":"title"');
  expect(request).toContain("버전 3");
  expect(request).toContain(report.artifact_digest);
  expect(request).toContain("x".repeat(200));
  expect(request).not.toContain("x".repeat(201));
  expect(request).toContain("검사 비활성화, 기준 완화, 오류 숨김으로 통과시키지");
  expect(request).toContain("품질 검사를 다시 실행");
});
