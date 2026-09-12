import { parse } from "node-html-parser";
import { AcquisitionLimitError, DEFAULT_ACQUISITION_LIMITS, throwIfAcquisitionAborted, type AcquisitionLimits } from "./extraction-acquisition";
import { assertAcquirableSourceMarkup, assertInertSourceMarkup, ExtractionSafetyError, removeSourceMarkupReferences } from "./extraction-safety";

export function sanitizeSourceHtml(html: string): string {
  // Do not let parser serialization repair a source the acquisition gate rejects.
  const normalized = html.toLowerCase();
  if (!["<html", "<body", "</body>", "</html>"].every(tag => normalized.includes(tag))) {
    throw new ExtractionSafetyError("unsafe_source_content", "Malformed html source is not accepted");
  }
  const root = parse(html, { lowerCaseTagName: true });
  // Public HTTPS navigation is text evidence, not a resource to fetch or ship.
  // Leave other schemes and all resource URLs for the strict acquisition gate.
  for (const anchor of root.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href") ?? "";
    if (!URL.canParse(href)) continue;
    const url = new URL(href);
    if (url.protocol === "https:" && url.username === "" && url.password === "") anchor.removeAttribute("href");
  }
  assertAcquirableSourceMarkup(root.toString(), "html");
  const stored = removeSourceMarkupReferences(root.toString());
  assertInertSourceMarkup(stored, "html");
  return stored;
}

export type HtmlComponentSamples = {
  readonly buttons: string[];
  readonly cards: string[];
  readonly forms: string[];
  readonly tables: string[];
  readonly badges: string[];
  readonly headings: string[];
  readonly body: string[];
};

export function extractHtmlComponentSamples(
  html: string,
  signal?: AbortSignal,
  limits: AcquisitionLimits = DEFAULT_ACQUISITION_LIMITS,
): HtmlComponentSamples {
  throwIfAcquisitionAborted(signal);
  const bytes = Buffer.byteLength(html);
  if (bytes > limits.htmlBytes) throw new AcquisitionLimitError("html_bytes", limits.htmlBytes, bytes);
  const root = parse(html);
  const itemCount = root.querySelectorAll("*").length;
  if (itemCount > limits.parsedItems) throw new AcquisitionLimitError("parsed_items", limits.parsedItems, itemCount);
  const samples = {
    buttons: collectHtmlTextSamples(root, ["button", 'a[class*="btn"]', '[role="button"]', 'input[type="button"]', 'input[type="submit"]'], signal),
    cards: collectHtmlTextSamples(root, ["article", 'section[class*="card"]', 'div[class*="card"]', "[data-card]"], signal),
    forms: collectHtmlTextSamples(root, ["form", "label", "input", "select", "textarea"], signal),
    tables: collectHtmlTextSamples(root, ["table"], signal),
    badges: collectHtmlTextSamples(root, ['[class*="badge"]', '[class*="pill"]', '[class*="tag"]', '[class*="label"]'], signal),
    headings: collectHtmlTextSamples(root, ["h1", "h2", "h3"], signal),
    body: collectHtmlTextSamples(root, ["p", "li", "blockquote"], signal),
  };
  throwIfAcquisitionAborted(signal);
  return samples;
}

export function collectCandidateWebsitePages(
  baseUrl: URL,
  html: string,
  signal: AbortSignal,
  limits: AcquisitionLimits = DEFAULT_ACQUISITION_LIMITS,
): URL[] {
  throwIfAcquisitionAborted(signal);
  const bytes = Buffer.byteLength(html);
  if (bytes > limits.htmlBytes) throw new AcquisitionLimitError("html_bytes", limits.htmlBytes, bytes);
  const root = parse(html);
  const anchors = root.querySelectorAll("a[href]");
  if (anchors.length > limits.parsedItems) throw new AcquisitionLimitError("parsed_items", limits.parsedItems, anchors.length);
  const candidates: URL[] = [];
  const seen = new Set<string>([baseUrl.toString()]);
  for (const anchor of anchors) {
    throwIfAcquisitionAborted(signal);
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    try {
      const next = new URL(href, baseUrl);
      if (next.origin !== baseUrl.origin || seen.has(next.toString())) continue;
      if (/\.(pdf|png|jpg|jpeg|svg|zip)$/i.test(next.pathname)) continue;
      seen.add(next.toString());
      candidates.push(next);
      if (candidates.length >= 4) break;
    } catch {
      // A malformed page link is not an acquisition failure.
    }
  }
  return candidates;
}

function collectHtmlTextSamples(
  root: ReturnType<typeof parse>,
  selectors: readonly string[],
  signal?: AbortSignal,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const selector of selectors) {
    throwIfAcquisitionAborted(signal);
    for (const node of root.querySelectorAll(selector)) {
      throwIfAcquisitionAborted(signal);
      const text = node.text.replace(/\s+/g, " ").trim();
      if (!text || text.length < 2 || text.length > 140 || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
      if (out.length >= 6) return out;
    }
  }
  return out;
}
