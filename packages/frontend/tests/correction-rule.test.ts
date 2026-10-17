import { describe, expect, test } from "bun:test";
import { MAX_DESIGN_SYSTEM_RULE_CHARS, normalizeDesignSystemRuleText } from "@bg/shared";
import { ruleCandidateFromCorrection } from "../src/lib/correction-rule";

describe("rule candidate from a chat correction", () => {
  test("Given negative corrections in ko, en and zh-CN When drafted Then each becomes a dont rule", () => {
    for (const text of ["세 단계 중 하나만 강조색으로 칠하지 마세요", "Don't put gradients on buttons", "Never use drop shadows", "不要使用渐变"]) {
      expect(ruleCandidateFromCorrection(text).kind).toBe("dont");
    }
  });

  test("Given a positive correction When drafted Then it becomes a do rule with whitespace collapsed", () => {
    expect(ruleCandidateFromCorrection("  라벨 너비는\n  글자에 맞춰 주세요  ")).toEqual({ kind: "do", text: "라벨 너비는 글자에 맞춰 주세요" });
  });

  test("Given a correction longer than a rule may be When drafted Then the draft ends at a sentence and the rule contract accepts it", () => {
    const long = `${"Keep labels inside their cards. ".repeat(6)}${"x".repeat(200)}`;
    const draft = ruleCandidateFromCorrection(long);
    expect(draft.text.length).toBeLessThanOrEqual(MAX_DESIGN_SYSTEM_RULE_CHARS);
    expect(draft.text.endsWith(".")).toBe(true);
    expect(normalizeDesignSystemRuleText(draft.text)).toBe(draft.text);
  });
});
