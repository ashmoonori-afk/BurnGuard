import { describe, expect, test } from "bun:test";
import type { UxReviewReport } from "@bg/shared";
import { uxReviewIsCurrent, uxReviewRequest } from "../src/components/modes/UxReviewPanel";

const report: UxReviewReport = {
  schema_version: 1, project_id: "project", artifact_revision: 2,
  artifact_digest: "a".repeat(64), source_path: "pages/home.html",
  basis: "local_html_heuristics", limitations: [], findings: [],
};

describe("UX review request", () => {
  test("Given a report When the project, path, digest or revision changes Then requests are stale", () => {
    const target = { projectId: "project", relPath: "pages/home.html", digest: "a".repeat(64), revision: 2 };
    expect(uxReviewIsCurrent(report, target)).toBe(true);
    for (const changed of [{ projectId: "other" }, { relPath: "other.html" }, { digest: "b".repeat(64) }, { revision: 3 }]) {
      expect(uxReviewIsCurrent(report, { ...target, ...changed })).toBe(false);
    }
  });

  test("Given an explicit proposal When building a request Then canonical identity, node and limitations accompany the guidance", () => {
    const text = uxReviewRequest(report, "버튼 이름", "목적을 설명해 주세요.", "cta");
    expect(text).toContain(JSON.stringify(report.source_path));
    expect(text).toContain(report.artifact_digest);
    expect(text).toContain('data-bg-node-id="cta"');
    expect(text).toContain("bg-auto 임시 앵커");
    expect(text).toContain("목적을 설명해 주세요.");
    expect(text).toContain("실제 사용성 검증 결과가 아니에요");
  });
});
