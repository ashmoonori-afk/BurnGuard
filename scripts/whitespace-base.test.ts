import { describe, expect, test } from "bun:test";
import { EMPTY_TREE, selectBase, type BaseFacts } from "./whitespace-base";

const HEAD = "a".repeat(40);
const facts = (overrides: Partial<BaseFacts>): BaseFacts => ({ mergeBase: null, parent: null, head: HEAD, rootCommits: [], shallow: false, ...overrides });

describe("selectBase", () => {
  test("Given a merge-base with origin/main, When selecting, Then it is the range base", () => {
    expect(selectBase(facts({ mergeBase: "b".repeat(40), parent: "c".repeat(40) }))).toEqual({ kind: "range", base: "b".repeat(40) });
  });

  test("Given no origin/main but a parent commit, When selecting, Then the parent is the range base", () => {
    expect(selectBase(facts({ parent: "c".repeat(40) }))).toEqual({ kind: "range", base: "c".repeat(40) });
  });

  test("Given a full-history root commit, When selecting, Then the empty tree is the range base", () => {
    expect(selectBase(facts({ rootCommits: [HEAD] }))).toEqual({ kind: "range", base: EMPTY_TREE });
  });

  test("Given a depth-1 shallow clone whose HEAD looks like a root, When selecting, Then the range check is skipped with a notice", () => {
    const choice = selectBase(facts({ rootCommits: [HEAD], shallow: true }));
    expect(choice.kind).toBe("skip");
    if (choice.kind === "skip") expect(choice.notice.length).toBeGreaterThan(0);
  });

  test("Given no base and HEAD is not a root, When selecting, Then the range check is skipped", () => {
    expect(selectBase(facts({ rootCommits: ["d".repeat(40)] })).kind).toBe("skip");
  });
});
