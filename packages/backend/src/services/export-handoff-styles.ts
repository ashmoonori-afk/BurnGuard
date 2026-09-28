import type { HandoffManifest } from "@bg/shared";
import type { HTMLElement } from "node-html-parser";
import { redactSensitiveText } from "./export-handoff-privacy";

export function handoffTokenRefs(
  element: HTMLElement,
  cssText: string,
): readonly string[] {
  const declarations = [element.getAttribute("style") ?? ""];
  for (const match of cssText.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const selector = match[1] ?? "";
    if (selectorMatchesElement(selector, element)) {
      declarations.push(match[2] ?? "");
    }
  }
  return [...new Set(
    declarations.flatMap((text) =>
      [...text.matchAll(/var\(\s*(--[\w-]+)/gu)].map((match) => match[1] ?? "")
    ),
  )].filter(Boolean);
}

export function responsiveRules(
  filePath: string,
  cssText: string,
): readonly HandoffManifest["responsive_rules"][number][] {
  const withoutComments = cssText.replace(/\/\*[\s\S]*?\*\//gu, "");
  return [...withoutComments.matchAll(/@media\s*([^{]+)\{/giu)].map((match) => ({
    source_file: `source/${filePath}`,
    condition: redactSensitiveText((match[1] ?? "").trim()),
  }));
}

function selectorMatchesElement(
  selector: string,
  element: HTMLElement,
): boolean {
  return selector.split(",").some((branch) => {
    const compounds = branch.trim().split(/[\s>+~]+/u).filter(Boolean);
    const target = compounds.at(-1);
    return target !== undefined && compoundMatchesElement(target, element);
  });
}

function compoundMatchesElement(
  selector: string,
  element: HTMLElement,
): boolean {
  const nodeId = element.getAttribute("data-bg-node-id") ?? null;
  if (
    nodeId !== null &&
    new RegExp(
      String.raw`\[data-bg-node-id\s*=\s*(["'])${escapeRegex(nodeId)}\1\]`,
      "u",
    ).test(selector)
  ) return true;
  const id = element.getAttribute("id") ?? null;
  if (
    id !== null &&
    new RegExp(String.raw`#${escapeRegex(id)}(?![\w-])`, "u").test(selector)
  ) return true;
  const classes = element.getAttribute("class")?.split(/\s+/u).filter(Boolean) ??
    [];
  if (
    classes.some((name) =>
      new RegExp(String.raw`\.${escapeRegex(name)}(?![\w-])`, "u").test(selector)
    )
  ) return true;
  return new RegExp(
    `^${escapeRegex(element.tagName.toLowerCase())}(?=[.#[:]|$)`,
    "u",
  ).test(selector);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
