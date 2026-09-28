import type { HandoffManifest } from "@bg/shared";
import type { HTMLElement } from "node-html-parser";
import postcss, { CssSyntaxError } from "postcss";
import { compareCodeUnits } from "./export-handoff-order";
import { sanitizeHandoffText } from "./export-handoff-privacy";

export const HANDOFF_STYLE_LIMITS = {
  rulesPerStylesheet: 2_000,
  ruleMatchesPerPage: 4_000,
  responsiveRulesPerStylesheet: 200,
  tokensPerRegion: 32,
} as const;

export type HandoffStyleRule = {
  readonly selector: string;
  readonly tokens: readonly string[];
};

export type HandoffStylesheet = {
  readonly rules: readonly HandoffStyleRule[];
  readonly responsive: readonly HandoffManifest["responsive_rules"][number][];
};

const TOKEN_REFERENCE = /var\(\s*(--[\w-]+)/gu;
const UNMATCHABLE_PSEUDO =
  /::?(?:before|after|placeholder|selection|marker|first-line|first-letter|backdrop|file-selector-button)\b|:(?:hover|focus|focus-visible|focus-within|active|visited|link|target)\b/giu;

export function parseHandoffStylesheet(sourceFile: string, cssText: string): HandoffStylesheet {
  let root: postcss.Root;
  // `map: false`: project CSS is untrusted, so a sourceMappingURL comment must not make PostCSS read host files.
  try { root = postcss.parse(cssText, { from: undefined, map: false }); }
  catch (error) {
    if (error instanceof CssSyntaxError) return { rules: [], responsive: [] };
    throw error;
  }
  const responsive: HandoffManifest["responsive_rules"][number][] = [];
  root.walkAtRules("media", (rule) => {
    if (responsive.length >= HANDOFF_STYLE_LIMITS.responsiveRulesPerStylesheet) return false;
    const condition = sanitizeHandoffText(rule.params);
    if (condition !== "") responsive.push({ source_file: sourceFile, condition });
    return undefined;
  });
  const rules: HandoffStyleRule[] = [];
  root.walkRules((rule) => {
    if (rules.length >= HANDOFF_STYLE_LIMITS.rulesPerStylesheet) return false;
    if (rule.parent?.type === "atrule" && /keyframes$/iu.test((rule.parent as postcss.AtRule).name)) return undefined;
    const tokens = new Set<string>();
    rule.each((node) => {
      if (node.type !== "decl") return;
      for (const match of node.value.matchAll(TOKEN_REFERENCE)) if (match[1] !== undefined) tokens.add(match[1]);
    });
    if (tokens.size > 0) rules.push({ selector: rule.selector, tokens: [...tokens].sort(compareCodeUnits) });
    return undefined;
  });
  return { rules, responsive };
}

export function mapPageTokens(
  document: HTMLElement,
  stylesheets: readonly HandoffStylesheet[],
  tokenNames: ReadonlySet<string>,
): ReadonlyMap<string, readonly string[]> {
  const byNode = new Map<string, Set<string>>();
  let budget: number = HANDOFF_STYLE_LIMITS.ruleMatchesPerPage;
  for (const sheet of stylesheets) {
    for (const rule of sheet.rules) {
      if (budget <= 0) return finalizeTokens(byNode);
      budget -= 1;
      const pinned = rule.tokens.filter((token) => tokenNames.has(token));
      if (pinned.length === 0) continue;
      for (const element of matchSelector(document, rule.selector)) {
        const nodeId = element.getAttribute("data-bg-node-id")?.trim();
        if (nodeId === undefined || nodeId === "") continue;
        const current = byNode.get(nodeId) ?? new Set<string>();
        for (const token of pinned) current.add(token);
        byNode.set(nodeId, current);
      }
    }
  }
  return finalizeTokens(byNode);
}

export function inlineTokenRefs(element: HTMLElement): readonly string[] {
  const style = element.getAttribute("style") ?? "";
  return [...style.matchAll(TOKEN_REFERENCE)].flatMap((match) => match[1] === undefined ? [] : [match[1]]);
}

function matchSelector(document: HTMLElement, selector: string): readonly HTMLElement[] {
  const matchable = selector.replace(UNMATCHABLE_PSEUDO, "").trim();
  if (matchable === "") return [];
  try { return document.querySelectorAll(matchable); }
  catch (error) {
    if (error instanceof Error) return [];
    throw error;
  }
}

function finalizeTokens(byNode: ReadonlyMap<string, ReadonlySet<string>>): ReadonlyMap<string, readonly string[]> {
  return new Map([...byNode].map(([nodeId, tokens]) => [
    nodeId,
    [...tokens].sort(compareCodeUnits).slice(0, HANDOFF_STYLE_LIMITS.tokensPerRegion),
  ]));
}
