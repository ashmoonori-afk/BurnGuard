import { expect, test } from "bun:test";
import { artifactOperationRefresh } from "../src/lib/artifact-operation-refresh";

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
