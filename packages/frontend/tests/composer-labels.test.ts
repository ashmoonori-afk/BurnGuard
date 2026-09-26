import { expect, test } from "bun:test";
import { composerSendLabels } from "../src/components/chat/Composer";

test("Given a send that is being retried When the button labels are derived Then the tooltip and the accessible name share one shortcut key", () => {
  expect(composerSendLabels(true)).toEqual({ label: "workspace.composer.retrySend", shortcut: "workspace.composer.retrySendShortcut" });
  expect(composerSendLabels(false)).toEqual({ label: "workspace.composer.send", shortcut: "workspace.composer.sendShortcut" });
});

test("Given the composer source When scanned Then the shortcut hint is not a literal", async () => {
  const source = await Bun.file(new URL("../src/components/chat/Composer.tsx", import.meta.url)).text();
  expect(source).not.toContain("Ctrl / ⌘ + Enter");
  expect(source).toContain('"workspace.composer.shortcutHint"');
});
