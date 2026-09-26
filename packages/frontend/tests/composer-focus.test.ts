import { expect, mock, test } from "bun:test";
import { focusComposerOrReveal } from "../src/lib/composer-focus";

function textarea(disabled: boolean) {
  const scrollIntoView = mock(() => {});
  const focus = mock(() => {});
  const element = { disabled, focus, closest: () => ({ scrollIntoView }) };
  return { element, focus, scrollIntoView };
}

test("Given a disabled composer textarea When the recovery action runs Then it scrolls the composer into view instead of a silent no-op focus", () => {
  const { element, focus, scrollIntoView } = textarea(true);

  focusComposerOrReveal(element);

  expect(focus).not.toHaveBeenCalled();
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
  expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
});

test("Given an enabled composer textarea When the recovery action runs Then it receives focus", () => {
  const { element, focus, scrollIntoView } = textarea(false);

  focusComposerOrReveal(element);

  expect(focus).toHaveBeenCalledTimes(1);
  expect(scrollIntoView).not.toHaveBeenCalled();
});

test("Given no composer on the page When the recovery action runs Then nothing throws", () => {
  expect(() => focusComposerOrReveal(null)).not.toThrow();
});
