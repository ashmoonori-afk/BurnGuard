import { expect, test } from "bun:test";
import { composerSendLabels, noAiToolInstalled } from "../src/components/chat/Composer";

test("Given a send that is being retried When the button labels are derived Then the tooltip and the accessible name share one shortcut key", () => {
  expect(composerSendLabels(true)).toEqual({ label: "workspace.composer.retrySend", shortcut: "workspace.composer.retrySendShortcut" });
  expect(composerSendLabels(false)).toEqual({ label: "workspace.composer.send", shortcut: "workspace.composer.sendShortcut" });
});

test("Given the composer source When scanned Then the shortcut hint is not a literal", async () => {
  const source = await Bun.file(new URL("../src/components/chat/Composer.tsx", import.meta.url)).text();
  expect(source).not.toContain("Ctrl / ⌘ + Enter");
  expect(source).toContain('"workspace.composer.shortcutHint"');
});

test("Given every detected AI tool is missing When the send gate is derived Then Send is blocked", () => {
  expect(noAiToolInstalled({ backends: [{ id: "claude-code", found: false }, { id: "codex", found: false }] })).toBe(true);
});

test("Given at least one installed tool, no answer yet, or an empty list When the send gate is derived Then Send is not blocked", () => {
  expect(noAiToolInstalled({ backends: [{ id: "claude-code", found: false }, { id: "codex", found: true }] })).toBe(false);
  expect(noAiToolInstalled(undefined)).toBe(false);
  expect(noAiToolInstalled({ backends: [] })).toBe(false);
});

test("Given the composer source When scanned Then the blocked Send points at Settings through its reason", async () => {
  const source = await Bun.file(new URL("../src/components/chat/Composer.tsx", import.meta.url)).text();
  expect(source).toContain('data-bg-send-blocked="no-ai-tool"');
  expect(source).toContain('"workspace.composer.noAiTool"');
  expect(source).toMatch(/!noAiTool/);
});
