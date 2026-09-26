import { expect, test } from "bun:test";
import { composerPlaceholderKey } from "../src/components/chat/useComposerPlaceholder";

test("Given each reason the composer can be disabled for When the placeholder key is chosen Then a lost connection and loading directions never blame a running task", () => {
  expect(composerPlaceholderKey("disconnected")).toBe("chat.composer.placeholderDisconnected");
  expect(composerPlaceholderKey("directions")).toBe("chat.composer.placeholderDirections");
  expect(composerPlaceholderKey("busy")).toBe("chat.composer.placeholderDisabled");
  expect(composerPlaceholderKey(null)).toBe("chat.composer.placeholder");
  expect(composerPlaceholderKey("disconnected")).not.toBe("chat.composer.placeholderDisabled");
});
