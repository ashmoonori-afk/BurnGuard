import { expect, test } from "bun:test";
import { deriveAutoFixRunning } from "../src/lib/auto-fix-pending";

test("Given a pending auto-fix flag and an idle session with no send pending When derived Then the quality panel is not locked", () => {
  expect(deriveAutoFixRunning({ autoFixPending: true, sendPending: false, sessionStatus: "idle" })).toBe(false);
  expect(deriveAutoFixRunning({ autoFixPending: true, sendPending: false, sessionStatus: undefined })).toBe(false);
});

test("Given a pending auto-fix flag While the send or the turn is running When derived Then the panel stays locked", () => {
  expect(deriveAutoFixRunning({ autoFixPending: true, sendPending: true, sessionStatus: "idle" })).toBe(true);
  expect(deriveAutoFixRunning({ autoFixPending: true, sendPending: false, sessionStatus: "running" })).toBe(true);
});

test("Given no auto-fix request When the session runs for another reason Then the panel is not locked by the auto-fix flag", () => {
  expect(deriveAutoFixRunning({ autoFixPending: false, sendPending: true, sessionStatus: "running" })).toBe(false);
});
