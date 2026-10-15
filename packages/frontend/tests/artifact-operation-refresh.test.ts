import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { artifactOperationRefresh } from "../src/lib/artifact-operation-refresh";
import { ExternalCaptures, ReviewFailedDrafts, UnverifiedDraftBadge } from "../src/components/canvas/ArtifactHistory";
import { t } from "../src/i18n/t";

test("Given a conflicted or recovered operation When the workspace plans its refresh Then files and artifacts are invalidated, the canvas reloads and the user is told", () => {
  for (const outcome of ["conflicted", "recovered"] as const) {
    const plan = artifactOperationRefresh(outcome);
    expect(plan.invalidate, outcome).toBe(true);
    expect(plan.refreshCanvas, outcome).toBe(true);
    expect(plan.openChangedTabs, outcome).toBe(false);
    expect(plan.notice, outcome).not.toBeNull();
  }
  expect(artifactOperationRefresh("conflicted").notice).toBe("workspace.project.operationConflicted");
  expect(artifactOperationRefresh("recovered").notice).toBe("workspace.project.operationRecovered");
});

test("Given a committed operation When the workspace plans its refresh Then it additionally opens the changed HTML files as tabs without a notice", () => {
  expect(artifactOperationRefresh("committed")).toEqual({ invalidate: true, refreshCanvas: true, openChangedTabs: true, notice: null });
});

test("Given a cancelled operation When the workspace plans its refresh Then nothing is requested", () => {
  expect(artifactOperationRefresh("cancelled")).toEqual({ invalidate: false, refreshCanvas: false, openChangedTabs: false, notice: null });
});

test("Given a failed operation with retained comparison findings When the workspace plans its refresh Then history refetches without reloading the unchanged canvas", () => {
  expect(artifactOperationRefresh("failed")).toEqual({ invalidate: true, refreshCanvas: false, openChangedTabs: false, notice: null });
});

test("Given a retained external edit that a generation replaced When the save history renders Then it lists the capture with one restore action", () => {
  const capture = { operation_id: "capture", captured_at: 1, file_count: 2 };
  const html = renderToStaticMarkup(createElement(ExternalCaptures, { captures: [capture], disabled: false, onReapply: async () => {} }));
  expect(html).toContain(`aria-label="${t("canvas.history.externalCaptures")}"`);
  expect(html).toContain(t("canvas.history.externalCapture"));
  expect(html.match(/<button\b/g)).toHaveLength(1);
  expect(html).toContain(t("canvas.history.reapplyExternal"));
  expect(renderToStaticMarkup(createElement(ExternalCaptures, { captures: [capture], disabled: true, onReapply: async () => {} }))).toContain("disabled");
  expect(renderToStaticMarkup(createElement(ExternalCaptures, { captures: [], disabled: false, onReapply: async () => {} }))).toBe("");
});

test("Given a review-failed operation When the history renders Then it offers one open-as-draft action keyed by the operation id and disables it while busy", () => {
  const offer = { operation_id: "failed-op", failed_at: 1, retained_until: 2, incomplete_checks: ["text_overflow"] };
  const html = renderToStaticMarkup(createElement(ReviewFailedDrafts, { offers: [offer], disabled: false, onRecover: async () => {} }));
  expect(html).toContain(`aria-label="${t("canvas.history.reviewFailedDrafts")}"`);
  expect(html).toContain('data-review-failed-draft="failed-op"');
  expect(html).toContain(t("canvas.history.openUnverifiedDraft"));
  expect(html.match(/<button\b/g)).toHaveLength(1);
  expect(renderToStaticMarkup(createElement(ReviewFailedDrafts, { offers: [offer], disabled: true, onRecover: async () => {} }))).toContain("disabled");
  expect(renderToStaticMarkup(createElement(ReviewFailedDrafts, { offers: [], disabled: false, onRecover: async () => {} }))).toBe("");
});

test("Given a recovered draft When the toolbar renders Then the unverified badge carries the failure reason sentinel and is absent once verified", () => {
  const state = { schema_version: 1 as const, reason: "design_review_failed" as const, incomplete_checks: ["text_overflow"], retained_until: 2, recovered_at: 1, source_project_id: "p", source_operation_id: "o" };
  const html = renderToStaticMarkup(createElement(UnverifiedDraftBadge, { state }));
  expect(html).toContain('data-unverified-draft="design_review_failed"');
  expect(html).toContain(t("canvas.draft.unverified"));
  expect(renderToStaticMarkup(createElement(UnverifiedDraftBadge, { state: null }))).toBe("");
});
