import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { artifactOperationRefresh } from "../src/lib/artifact-operation-refresh";
import { ExternalCaptures } from "../src/components/canvas/ArtifactHistory";
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

test("Given a cancelled or failed operation When the workspace plans its refresh Then nothing is requested", () => {
  for (const outcome of ["cancelled", "failed"] as const) {
    expect(artifactOperationRefresh(outcome), outcome).toEqual({ invalidate: false, refreshCanvas: false, openChangedTabs: false, notice: null });
  }
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
