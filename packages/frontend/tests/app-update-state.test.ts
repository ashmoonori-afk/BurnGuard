import { describe, expect, test } from "bun:test";
import type { AppUpdateStatus } from "@bg/shared";
import { appUpdateView } from "../src/lib/app-update-state";

const status: AppUpdateStatus = {
  supported: true, unsupported_reason: null, state: "idle",
  current_version: "1.0.0", available_version: null, progress: null,
  checked_at: null, error: null,
};

describe("application update view", () => {
  test("Given the Windows shell When mapping status Then the card is hidden and actions are disabled", () => {
    const view = appUpdateView({ ...status, supported: false, unsupported_reason: "windows_shell", state: "unsupported" });
    expect(view.visible).toBe(false);
    expect(view.canCheck).toBe(false);
    expect(view.canApply).toBe(false);
  });

  test.each(["platform", "not_installed"] as const)("Given unsupported reason %s When mapping status Then the card is visible with disabled actions", (unsupported_reason) => {
    const view = appUpdateView({ ...status, supported: false, unsupported_reason, state: "unsupported" });
    expect(view.visible).toBe(true);
    expect(view.canCheck).toBe(false);
    expect(view.canApply).toBe(false);
    expect(view.busy).toBe(false);
  });

  test.each(["checking", "downloading"] as const)("Given state %s When mapping status Then checking is disabled and the card is busy", (state) => {
    const view = appUpdateView({ ...status, state });
    expect(view.canCheck).toBe(false);
    expect(view.canApply).toBe(false);
    expect(view.busy).toBe(true);
  });

  test.each(["unsupported", "idle", "checking", "downloading", "ready", "error"] as const)("Given state %s When mapping status Then applying is available only when ready", (state) => {
    const view = appUpdateView({ ...status, state, supported: state !== "unsupported", available_version: "1.1.0" });
    expect(view.canApply).toBe(state === "ready");
    expect(view.busy).toBe(state === "checking" || state === "downloading");
  });

  test.each(["idle", "ready", "error"] as const)("Given supported state %s When mapping status Then checking is available", (state) => {
    const view = appUpdateView({ ...status, state });
    expect(view.visible).toBe(true);
    expect(view.canCheck).toBe(true);
    expect(view.busy).toBe(false);
  });
});
