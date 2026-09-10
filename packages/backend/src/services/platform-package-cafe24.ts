import path from "node:path";
import { ExportError } from "./export-errors";
import { CONTENTS_MARKER, LAYOUT_DIRECTIVE, LAYOUT_PATH } from "./platform-package-roles";
import type { HTMLElement } from "node-html-parser";
import { encode, type PackageEntry, type PackageEntryRole, type PlatformBuildInput, type PlatformBuildResult } from "./platform-package-contract";
import type { PlatformLintDocument, PlatformLintFinding } from "./platform-lint";
import { defaultAssetBaseUrl, extractPageContent, normalizeBaseUrl, parseDocument, planAssetDestinations, resolveLocalReference, rewriteHtmlReferences, rewriteStylesheet, splitStyleBlocks, bucketFor } from "./platform-package-rewrite";

const CONTENTS_TOKEN = "@@BURNGUARD_CAFE24_CONTENTS@@";

/** Builds the classic Smart Design package: one dedicated layout, one fragment per page, and the rewritten asset tree. */
export function buildCafe24Package(input: PlatformBuildInput): PlatformBuildResult {
  const baseUrl = normalizeBaseUrl(input.options.asset_base_url ?? defaultAssetBaseUrl(input.slug));
  const destinations = planAssetDestinations(input.staged.assets.map((asset) => asset.rel_path), baseUrl, input.slug);
  const resolve = (relPath: string): string | null => destinations.get(relPath)?.url ?? null;
  const pagePaths = new Set(input.staged.pages.map((page) => page.rel_path));
  const entries: PackageEntry[] = [];
  const roles: PackageEntryRole[] = [];
  const documents: PlatformLintDocument[] = [];
  const findings: PlatformLintFinding[] = [];

  for (const page of input.staged.pages) {
    const { doctype, document } = parseDocument(page.html);
    rewriteHtmlReferences(document, page.rel_path, resolve);
    const styles = splitStyleBlocks(document);
    const content = extractPageContent(document);
    for (const anchor of document.querySelectorAll("a")) {
      const target = resolveLocalReference(anchor.getAttribute("href") ?? "", page.rel_path);
      if (target !== null && pagePaths.has(target)) findings.push({ code: "cafe24_unresolved_link", severity: "info", path: page.rel_path, evidence: `Inter-page link ${anchor.getAttribute("href") ?? ""} keeps its relative form; the new-screen URL pattern differs per skin.` });
    }
    const fragmentPath = `pages/${page.rel_path}`;
    const fragment = `${LAYOUT_DIRECTIVE}\n${content.html}${styles.page.trim() === "" ? "" : `\n<style>${styles.page}</style>`}\n`;
    entries.push({ path: fragmentPath, bytes: encode(fragment) });
    roles.push({ path: fragmentPath, role: "page_fragment" });
    documents.push({ path: fragmentPath, text: fragment, role: "page_fragment" });
    if (page.rel_path !== input.entrypoint) continue;
    if (content.element === null) throw new ExportError("platform_package_incomplete");
    const layout = renderLayout({ doctype, document, sharedCss: styles.shared, landmark: content.element });
    entries.push({ path: LAYOUT_PATH, bytes: encode(layout) });
    roles.push({ path: LAYOUT_PATH, role: "layout" });
    documents.push({ path: LAYOUT_PATH, text: layout, role: "layout" });
  }

  for (const asset of input.staged.assets) {
    const destination = destinations.get(asset.rel_path);
    if (destination === undefined) continue;
    const bytes = destination.bucket === "css" ? encode(rewriteStylesheet(new TextDecoder().decode(asset.bytes), asset.rel_path, resolve)) : asset.bytes;
    entries.push({ path: destination.package_path, bytes });
    roles.push({ path: destination.package_path, role: "asset" });
  }
  const shipsFonts = input.staged.assets.some((asset) => bucketFor(asset.rel_path) === "fonts");
  if (shipsFonts) for (const notice of input.staged.notices) {
    const noticePath = `web/${input.slug}/fonts/${path.posix.basename(notice.rel_path)}`;
    entries.push({ path: noticePath, bytes: notice.bytes });
    roles.push({ path: noticePath, role: "asset" });
  }
  return { entries, roles, documents, assets: entries.filter((entry) => entry.path.startsWith(`web/${input.slug}/`)).map((entry) => ({ path: entry.path, bytes: entry.bytes.byteLength })), findings, external_urls: [baseUrl] };
}

type LayoutInput = { readonly doctype: string; readonly document: HTMLElement; readonly sharedCss: string; readonly landmark: HTMLElement };

function renderLayout(input: LayoutInput): string {
  // The landmark element and its attributes stay so page CSS and scripts keep their hooks; only its children become the injection point.
  input.landmark.set_content(CONTENTS_TOKEN);
  const styles = input.document.querySelectorAll("style");
  const first = styles[0];
  if (first !== undefined) first.set_content(input.sharedCss);
  for (const extra of styles.slice(1)) extra.remove();
  return `${input.doctype}${input.document.toString()}`.replace(CONTENTS_TOKEN, CONTENTS_MARKER);
}
