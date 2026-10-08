export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export interface BaseFacts {
  readonly mergeBase: string | null;
  readonly parent: string | null;
  readonly head: string;
  readonly rootCommits: readonly string[];
  readonly shallow: boolean;
}

export type BaseChoice = { readonly kind: "range"; readonly base: string } | { readonly kind: "skip"; readonly notice: string };

/** Picks the left side of the `git diff --check <base>..HEAD` range, or says the range check cannot be done reliably. */
export function selectBase(facts: BaseFacts): BaseChoice {
  if (facts.mergeBase) return { kind: "range", base: facts.mergeBase };
  if (facts.parent) return { kind: "range", base: facts.parent };
  if (!facts.shallow && facts.rootCommits.length === 1 && facts.rootCommits[0] === facts.head) return { kind: "range", base: EMPTY_TREE };
  return {
    kind: "skip",
    notice: "check:whitespace: shallow clone without origin/main or HEAD~1; skipping the commit-range check (fetch origin/main or unshallow to enable it).",
  };
}
