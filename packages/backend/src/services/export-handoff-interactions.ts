import type { HandoffManifest } from "@bg/shared";
import type { HTMLElement } from "node-html-parser";
import {
  redactPrivatePaths,
  safeHandoffTarget,
} from "./export-handoff-privacy";

export function analyzeHandoffInteractions(
  document: HTMLElement,
  sourceFile: string,
): Pick<HandoffManifest, "interactions" | "unresolved_backend_work"> {
  const interactions: HandoffManifest["interactions"][number][] = [];
  const unresolved: HandoffManifest["unresolved_backend_work"][number][] = [];
  const elements = document.querySelectorAll("a,button,form");
  for (const [index, element] of elements.entries()) {
    const tag = element.tagName.toLowerCase();
    const kind = tag === "a" ? "link" : tag === "form" ? "form" : "button";
    const rawTarget =
      kind === "link"
        ? element.getAttribute("href")?.trim() ?? null
        : kind === "form"
          ? element.getAttribute("action")?.trim() ?? null
          : null;
    const target = safeHandoffTarget(rawTarget);
    const mocked =
      kind === "link"
        ? target === null || target === "" || target === "#" ||
          target.toLowerCase().startsWith("javascript:")
        : kind === "form"
          ? !isExternalBackend(target)
          : buttonIsMocked(element);
    const id = `${sourceFile}#${kind}-${index + 1}`;
    const nodeId = nearestNodeId(element);
    interactions.push({
      id,
      kind,
      label: boundedLabel(element),
      source_file: sourceFile,
      node_id: nodeId,
      target,
      status: mocked ? "mocked" : "implemented",
    });
    if (!mocked || kind === "link") continue;
    unresolved.push({
      id: `backend-${unresolved.length + 1}`,
      interaction_id: id,
      source_file: sourceFile,
      node_id: nodeId,
      reason: kind === "form" ? "form_without_backend" : "button_without_handler",
    });
  }
  return {
    interactions,
    unresolved_backend_work: unresolved,
  };
}

function buttonIsMocked(element: HTMLElement): boolean {
  if (element.hasAttribute("onclick")) return false;
  const type = element.getAttribute("type")?.toLowerCase() ?? "submit";
  if (type !== "submit") return true;
  const form = element.closest("form");
  if (form === null) return true;
  return !isExternalBackend(
    safeHandoffTarget(form.getAttribute("action")?.trim() ?? null),
  );
}

function isExternalBackend(target: string | null): boolean {
  return target?.startsWith("https://") === true ||
    target?.startsWith("http://") === true;
}

function nearestNodeId(element: HTMLElement): string | null {
  return element.closest("[data-bg-node-id]")?.getAttribute("data-bg-node-id") ??
    null;
}

function boundedLabel(element: HTMLElement): string | null {
  const value =
    element.getAttribute("aria-label")?.trim() ??
    element.getAttribute("title")?.trim() ??
    element.text.trim().replace(/\s+/gu, " ");
  return value === "" ? null : redactPrivatePaths(value).slice(0, 160);
}
