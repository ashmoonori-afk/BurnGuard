import { expect, test } from "bun:test";
import { historyOpensItself } from "../src/components/canvas/ArtifactHistory";

const arrived = { hasComparison: true, previousId: "3:aaa", currentId: "4:bbb", quiet: false, refused: false };

test("Given a new comparison from elsewhere When it arrives Then the history dialog opens by itself", () => {
  expect(historyOpensItself(arrived)).toBe(true);
});

test("Given a new comparison from a direct canvas edit When it arrives Then the dialog stays closed", () => {
  expect(historyOpensItself({ ...arrived, quiet: true })).toBe(false);
});

test("Given a refused out-of-scope change right after a direct canvas edit When it arrives Then the dialog opens", () => {
  // The refusal keeps the revision the hand edit produced, so the dialog is still told to stay quiet.
  expect(historyOpensItself({ ...arrived, currentId: "op-refused", quiet: true, refused: true })).toBe(true);
});

test("Given the first load, an unchanged comparison or no comparison When checked Then the dialog stays closed", () => {
  expect(historyOpensItself({ ...arrived, previousId: null })).toBe(false);
  expect(historyOpensItself({ ...arrived, currentId: "3:aaa" })).toBe(false);
  expect(historyOpensItself({ ...arrived, currentId: null })).toBe(false);
  expect(historyOpensItself({ ...arrived, hasComparison: false })).toBe(false);
});
