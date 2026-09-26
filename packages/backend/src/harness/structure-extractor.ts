/**
 * Compact structural summaries of the project entrypoint (deck.html / index.html).
 *
 * Why: Claude Code burns most of its prompt cache re-reading the entrypoint —
 * a 130 KB deck.html is ~33 K tokens per Read, and a redesign turn easily
 * triggers 6-8 Reads. Inlining a ~600-token structural map lets the model
 * plan from the summary and fall back to surgical Reads only when it needs
 * exact content, dropping the cached-token bill by an order of magnitude.
 *
 * Output is markdown, sized to fit comfortably in the prompt header on every
 * turn. Anything that would inflate above ~2 KB (long text snippets, full
 * CSS dumps) is truncated or replaced with a count.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "node-html-parser";

const TEXT_SNIPPET_MAX = 60;
const MAX_SLIDES_LISTED = 40;
const MAX_SECTIONS_LISTED = 30;
const MAX_VARS_LISTED = 16;

export interface StyleStats {
  lineCount: number;
  cssVariables: string[];
  selectorCount: number;
}

export async function summarizeDeckHtml(filePath: string): Promise<string | null> {
  const html = await readSafely(filePath);
  if (html == null) return null;

  let root;
  try {
    root = parse(html, { lowerCaseTagName: true });
  } catch {
    return null;
  }

  const slides = root.querySelectorAll("section[data-slide]");
  const styleBlock = root.querySelector("style");
  const styleStats = styleBlock ? collectStyleStats(styleBlock.text) : null;

  const lines: string[] = [];
  lines.push(
    `${path.basename(filePath)} — ${html.length.toLocaleString("en-US")}B, ${slides.length} slide(s)`,
  );
  if (slides.length === 0) {
    lines.push("(no `<section data-slide>` found — file may be empty or non-conforming)");
    return lines.join("\n");
  }

  const shown = slides.slice(0, MAX_SLIDES_LISTED);
  for (const [index, slide] of shown.entries()) {
    const ordinal = index + 1;
    const layout = slide.getAttribute("data-layout");
    const id = slide.getAttribute("data-bg-node-id") ?? `slide-${ordinal}`;
    const classes = (slide.getAttribute("class") ?? "")
      .split(/\s+/)
      .filter((c) => c && c !== "deck-slide");
    const tag = classes.length > 0 ? ` .${classes.join(".")}` : "";
    const layoutTag = layout ? ` [layout=${layout}]` : "";
    const snippet = firstMeaningfulText(slide);
    const text = snippet ? ` "${snippet}"` : "";
    lines.push(`- ${ordinal}. ${id}${tag}${layoutTag}${text}`);
  }
  if (slides.length > MAX_SLIDES_LISTED) {
    lines.push(`- ... and ${slides.length - MAX_SLIDES_LISTED} more slide(s)`);
  }
  appendChartCount(lines, root);

  if (styleStats) {
    lines.push("");
    lines.push(renderStyleStats(styleStats));
  }

  return lines.join("\n");
}

export async function summarizePrototypeHtml(
  filePath: string,
): Promise<string | null> {
  const html = await readSafely(filePath);
  if (html == null) return null;

  let root;
  try {
    root = parse(html, { lowerCaseTagName: true });
  } catch {
    return null;
  }

  const sections = root.querySelectorAll("[data-section]");
  const styleBlock = root.querySelector("style");
  const styleStats = styleBlock ? collectStyleStats(styleBlock.text) : null;

  const lines: string[] = [];
  lines.push(
    `${path.basename(filePath)} — ${html.length.toLocaleString("en-US")}B, ${sections.length} section(s)`,
  );
  if (sections.length === 0) {
    // Fall back to top-level semantic landmarks so Claude still gets a map.
    const body = root.querySelector("body");
    const landmarks = body
      ? body.childNodes.filter(
          (n) =>
            n.nodeType === 1 &&
            ["header", "main", "section", "footer", "nav", "aside", "article"].includes(
              ("tagName" in n ? (n as { tagName: string }).tagName : "").toLowerCase(),
            ),
        )
      : [];
    if (landmarks.length === 0) {
      lines.push("(no `[data-section]` and no semantic landmarks found)");
      return lines.join("\n");
    }
    for (const [index, node] of landmarks.entries()) {
      const ordinal = index + 1;
      // We know these are HTMLElement-shaped; cast to access getAttribute/text.
      const el = node as unknown as {
        tagName: string;
        getAttribute(name: string): string | null;
        text: string;
      };
      const id = el.getAttribute("id");
      const idTag = id ? `#${id}` : "";
      const snippet = firstMeaningfulText(el);
      const text = snippet ? ` "${snippet}"` : "";
      lines.push(`- ${ordinal}. <${el.tagName.toLowerCase()}>${idTag}${text}`);
    }
    appendChartCount(lines, root);
    if (styleStats) {
      lines.push("");
      lines.push(renderStyleStats(styleStats));
    }
    return lines.join("\n");
  }

  const shown = sections.slice(0, MAX_SECTIONS_LISTED);
  for (const [index, section] of shown.entries()) {
    const ordinal = index + 1;
    const id =
      section.getAttribute("data-section") ??
      section.getAttribute("data-bg-node-id") ??
      `section-${ordinal}`;
    const tag = section.tagName.toLowerCase();
    const snippet = firstMeaningfulText(section);
    const text = snippet ? ` "${snippet}"` : "";
    lines.push(`- ${ordinal}. <${tag}> ${id}${text}`);
  }
  if (sections.length > MAX_SECTIONS_LISTED) {
    lines.push(`- ... and ${sections.length - MAX_SECTIONS_LISTED} more section(s)`);
  }
  appendChartCount(lines, root);

  if (styleStats) {
    lines.push("");
    lines.push(renderStyleStats(styleStats));
  }

  return lines.join("\n");
}

/** Native chart figures already in the entrypoint; the prompt gates the chart contract on this line. */
function appendChartCount(lines: string[], root: { querySelectorAll: (selector: string) => readonly unknown[] }): void {
  const charts = root.querySelectorAll("[data-bg-chart]").length;
  if (charts > 0) lines.push(`Charts: ${charts} data-bg-chart figure(s)`);
}

type ElementLike = {
  text: string;
  querySelectorAll?: (selector: string) => Array<{ text: string }>;
};

function firstMeaningfulText(el: ElementLike): string {
  // Prefer headings — slide bodies usually open with a brand bar / page
  // indicator that is the same on every slide and would otherwise dominate
  // the snippet. h1-h3 carry the actual meaning Claude needs to plan from.
  const headings = el.querySelectorAll?.("h1, h2, h3") ?? [];
  if (headings.length > 0) {
    const headingText = headings
      .map((h) => (h.text ?? "").replace(/\s+/g, " ").trim())
      .filter((t) => t.length > 0)
      .join(" / ");
    if (headingText.length > 0) return truncateSnippet(headingText);
  }
  const text = (el.text ?? "").replace(/\s+/g, " ").trim();
  if (text.length === 0) return "";
  return truncateSnippet(text);
}

function truncateSnippet(text: string): string {
  return text.length > TEXT_SNIPPET_MAX
    ? `${text.slice(0, TEXT_SNIPPET_MAX - 3)}...`
    : text;
}

function collectStyleStats(css: string): StyleStats {
  const lineCount = css.split(/\r?\n/).length;
  const variables = new Set<string>();
  // Match both definitions (`--name:`) and usages (`var(--name)`).
  const varRegex = /--([A-Za-z0-9_-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = varRegex.exec(css)) !== null) {
    variables.add(`--${match[1]}`);
  }
  // Rough selector count: lines whose first non-whitespace char isn't `}`/`/`/`*`/`@`
  // and that end with `{`. Good enough for an order-of-magnitude estimate.
  const selectorCount = (css.match(/^[^@}\n]+\{/gm) ?? []).length;
  return {
    lineCount,
    cssVariables: [...variables].sort((a, b) => a.localeCompare(b)),
    selectorCount,
  };
}

function renderStyleStats(stats: StyleStats): string {
  const varsShown = stats.cssVariables.slice(0, MAX_VARS_LISTED).join(", ");
  const overflow =
    stats.cssVariables.length > MAX_VARS_LISTED
      ? `, +${stats.cssVariables.length - MAX_VARS_LISTED} more`
      : "";
  const lines = [
    `Style block: ${stats.lineCount} line(s), ~${stats.selectorCount} selector(s), ${stats.cssVariables.length} CSS variable(s)`,
  ];
  if (stats.cssVariables.length > 0) {
    lines.push(`CSS variables: ${varsShown}${overflow}`);
  }
  return lines.join("\n");
}

async function readSafely(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}
