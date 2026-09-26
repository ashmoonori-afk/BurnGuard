import { describe, expect, test } from "bun:test";
import { MAX_USER_MESSAGE_CHARS } from "@bg/shared";
import { ApiError } from "../src/api/client";
import { composerLengthState, sendFailureTitleKey } from "../src/lib/composer-send";

describe("send failure title", () => {
  test("Given a 409 that is not session_busy When the title key is resolved Then it is the generic send failure", () => {
    for (const code of ["agent_control_files_present", "graphic_requires_authenticated_codex", "active_page_unavailable"]) {
      expect(sendFailureTitleKey(new ApiError(code, "raw", 409))).toBe("workspace.project.sendFailed");
    }
  });

  test("Given session_busy When the title key is resolved Then it is the turn-in-progress title", () => {
    expect(sendFailureTitleKey(new ApiError("session_busy", "raw", 409))).toBe("workspace.project.turnBusy");
  });

  test("Given a plain error When the title key is resolved Then it is the generic send failure", () => {
    expect(sendFailureTitleKey(new Error("fetch failed"))).toBe("workspace.project.sendFailed");
    expect(sendFailureTitleKey(null)).toBe("workspace.project.sendFailed");
  });
});

describe("composer length state", () => {
  test("Given text longer than the shared message limit When the send state is computed Then sending is blocked with the too-long status", () => {
    const state = composerLengthState("a".repeat(MAX_USER_MESSAGE_CHARS + 1));
    expect(state.canSend).toBe(false);
    expect(state.statusKey).toBe("workspace.composer.tooLong");
    expect(state.counter).toEqual({ length: MAX_USER_MESSAGE_CHARS + 1, limit: MAX_USER_MESSAGE_CHARS });
  });

  test("Given short text When the send state is computed Then sending is allowed and no counter shows", () => {
    const state = composerLengthState("hello");
    expect(state).toEqual({ canSend: true, statusKey: null, counter: null });
  });

  test("Given text near the cap When the send state is computed Then the counter shows while sending stays allowed", () => {
    const state = composerLengthState("a".repeat(95), 100);
    expect(state.canSend).toBe(true);
    expect(state.statusKey).toBeNull();
    expect(state.counter).toEqual({ length: 95, limit: 100 });
    expect(composerLengthState("a".repeat(100), 100).canSend).toBe(true);
  });
});
