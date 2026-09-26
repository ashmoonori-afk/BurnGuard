import { afterEach, describe, expect, test } from "bun:test";
import type { UxReviewReport } from "@bg/shared";
import { ApiError } from "../src/api/client";
import { uxReviewErrorKey, uxReviewIsCurrent, uxReviewRequest } from "../src/components/modes/UxReviewPanel";
import { useLocaleStore } from "../src/i18n/locale";
import { t } from "../src/i18n/t";

afterEach(() => useLocaleStore.getState().setLocale("ko"));

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
    const [intro, title, guidance, ...outro] = text.split("\n");
    expect(intro).toBe(t("modes.ux.request.intro", { path: JSON.stringify(report.source_path), revision: 2, digest: report.artifact_digest, node: t("modes.ux.request.node", { id: JSON.stringify("cta") }) }));
    expect(intro).toContain('data-bg-node-id="cta"');
    expect(title).toBe("버튼 이름");
    expect(guidance).toBe("목적을 설명해 주세요.");
    expect(outro.join("\n")).toBe(t("modes.ux.request.outro"));
    expect(uxReviewRequest(report, "t", "g").split("\n")[0]).toBe(t("modes.ux.request.intro", { path: JSON.stringify(report.source_path), revision: 2, digest: report.artifact_digest, node: "" }));
  });

  test("Given the en locale When building a request Then no prose line contains Hangul while the bg-auto anchor rule survives", () => {
    useLocaleStore.getState().setLocale("en");
    const text = uxReviewRequest(report, "Title", "Guidance", "cta");
    expect(text).not.toMatch(/\p{Script=Hangul}/u);
    expect(text).toContain("bg-auto");
  });

  test("Given a review load error When the copy key is resolved Then the code chooses the branch", () => {
    expect(uxReviewErrorKey(new ApiError("review_unavailable", "raw", 503))).toBe("modes.ux.unavailable");
    expect(uxReviewErrorKey(new ApiError("stale_artifact_identity", "raw", 409))).toBe("modes.ux.staleIdentity");
    expect(uxReviewErrorKey(new ApiError("some_other_code", "raw", 500))).toBe("modes.ux.loadFailed");
    expect(uxReviewErrorKey(new Error("fetch failed"))).toBe("modes.ux.loadFailed");
  });
});
