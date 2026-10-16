import type { DesignSystemRule, DesignSystemRules } from "@bg/shared";

export type DesignSystemRuleGroups = { readonly do: readonly DesignSystemRule[]; readonly dont: readonly DesignSystemRule[] };

/** Splits a system's rules into the two lists the overview shows, newest last, the order the prompt receives them. */
export function groupDesignSystemRules(rules: DesignSystemRules | undefined): DesignSystemRuleGroups {
  const all = rules?.rules ?? [];
  return { do: all.filter(rule => rule.kind === "do"), dont: all.filter(rule => rule.kind === "dont") };
}
