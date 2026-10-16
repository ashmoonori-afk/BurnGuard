import { MAX_DESIGN_SYSTEM_RULE_CHARS, type DesignSystemRuleKind } from "@bg/shared";

export type RuleCandidate = { readonly kind: DesignSystemRuleKind; readonly text: string };

/** Negative wording in the three app languages; a correction that forbids something becomes a "don't" rule. */
const NEGATION = /(\bdon'?t\b|\bdo not\b|\bnever\b|\bavoid\b|\bstop\b|\bwithout\b|\bno\s+\w|하지\s?마|하지\s?말|말아|말고|빼\s?줘|빼\s?주|빼고|없애|금지|쓰지\s?마|넣지\s?마|不要|别|禁止|避免|去掉)/iu;

/**
 * A first draft of a standing rule from the text of one chat correction: whitespace collapsed, cut at the last sentence
 * end that fits, kind guessed from negative wording. The user edits and approves it before anything is saved.
 */
export function ruleCandidateFromCorrection(message: string): RuleCandidate {
  const text = message.replace(/\s+/gu, " ").trim();
  let draft = text;
  if (draft.length > MAX_DESIGN_SYSTEM_RULE_CHARS) {
    const head = draft.slice(0, MAX_DESIGN_SYSTEM_RULE_CHARS);
    const end = Math.max(...[". ", "! ", "? ", "。", "다. ", "요. "].map((mark) => head.lastIndexOf(mark)));
    draft = (end > 40 ? head.slice(0, end + 1) : head).trim();
  }
  return { kind: NEGATION.test(draft) ? "dont" : "do", text: draft };
}
