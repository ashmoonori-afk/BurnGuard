import path from "node:path";
import {
  DESIGN_MD_TOKEN_GROUPS,
  DesignMdError,
  parseDesignMd,
  renderDesignMd,
  type CreateDesignSystemExtractionResponse,
  type DesignMd,
  type DesignMdTokenGroup,
} from "@bg/shared";
import { getDesignSystemDetail } from "../db/seed";
import { extractCssCustomProperties } from "./extraction-css";
import { readDesignSystemLayout, readDesignSystemSourceFile } from "./design-system-layout";
import { addDesignSystemRules, readDesignSystemRules } from "./design-system-rules";
import { persistCanonicalExtraction } from "./design-system-extract";
import { DesignSystemAssetEditError } from "./extraction-asset-errors";
import type { ExtractionDiscovery } from "./extraction-provenance";
import type { SourceAnalysis } from "./extraction-local-tree";

const COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([^)]*\))$/iu;

function tokenGroup(name: string, value: string): DesignMdTokenGroup {
  if (COLOR.test(value.trim())) return "colors";
  if (/font|type|leading|tracking|line-height|letter/iu.test(name)) return "typography";
  if (/radius|rounded/iu.test(name)) return "radius";
  if (/shadow|elevation/iu.test(name)) return "shadows";
  if (/space|spacing|gap|gutter|pad|margin/iu.test(name)) return "spacing";
  return "tokens";
}

const LAYOUT_HEADINGS: Readonly<Record<string, string>> = {
  layout: "Layout", composition: "Composition", responsive: "Responsive behaviour", navigation: "Navigation", hero: "Hero",
  footer: "Footer", patterns: "Section patterns", alignment: "Alignment", family: "Family", slides: "Slides", imagery: "Imagery",
};

/** Any registered system, bundled themes included, as one portable Markdown file. */
export async function exportDesignMd(systemId: string): Promise<{ readonly filename: string; readonly markdown: string }> {
  const detail = await getDesignSystemDetail(systemId);
  if (!detail) throw new DesignSystemAssetEditError("design_system_not_found", "Design system not found");
  const tokens = Object.fromEntries(DESIGN_MD_TOKEN_GROUPS.map((group) => [group, {} as Record<string, string>])) as Record<DesignMdTokenGroup, Record<string, string>>;
  const css = detail.tokens_css_path ? await readDesignSystemSourceFile(detail.dir_path, path.relative(detail.dir_path, detail.tokens_css_path)) : "";
  let count = 0;
  for (const [rawName, value] of await extractCssCustomProperties(css)) {
    const name = rawName.replace(/^--/u, "");
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(name) || !/^[^;{}<>\\]{1,200}$/u.test(value.trim()) || count >= 200) continue;
    tokens[tokenGroup(name, value)][name] = value.trim();
    count += 1;
  }
  const layout = await readDesignSystemLayout(detail);
  const rules = await readDesignSystemRules(detail);
  const doc: DesignMd = {
    name: detail.name,
    description: detail.description,
    tokens,
    sections: layout.sections.map((section) => ({ heading: LAYOUT_HEADINGS[section.kind] ?? section.kind, body: section.text })),
    dos: rules.rules.filter((rule) => rule.kind === "do").map((rule) => rule.text),
    donts: rules.rules.filter((rule) => rule.kind === "dont").map((rule) => rule.text),
  };
  const slug = detail.name.normalize("NFKD").replace(/[^\w-]+/gu, "-").replace(/^-+|-+$/gu, "").toLowerCase() || "design-system";
  return { filename: `${slug}.DESIGN.md`, markdown: renderDesignMd(doc) };
}

function analysisFromDesignMd(doc: DesignMd): SourceAnalysis {
  const locator = "DESIGN.md#front-matter";
  const discoveries: ExtractionDiscovery[] = [];
  const cssVars = new Map<string, string>();
  for (const group of DESIGN_MD_TOKEN_GROUPS) {
    for (const [name, value] of Object.entries(doc.tokens[group])) {
      cssVars.set(name, value);
      discoveries.push({ domain: group === "typography" ? "typography" : group === "colors" ? "token" : "layout", key: name, value, sourceLocator: locator, confidence: 0.9, state: "observed", lineage: ["design-md-front-matter"] });
    }
  }
  const colors = Object.values(doc.tokens.colors).filter((value) => /^#[0-9a-f]{6}$/iu.test(value)).map((value) => value.toLowerCase());
  const fontFamilies = Object.entries(doc.tokens.typography).filter(([name]) => /font|family|face/iu.test(name)).map(([, value]) => value);
  const notes = [
    "Imported from a single design Markdown file; tokens come from its front matter and are not verified against a live source.",
    ...doc.sections.slice(0, 20).map((section) => `${section.heading}: ${section.body.replace(/\s+/gu, " ").slice(0, 600)}`),
  ];
  return {
    brandName: doc.name, discoveries, colors, cssDeclarations: [], cssParseIssues: [], cssVars, fontFamilies,
    fontSizes: [], fontWeights: [], spacingValues: Object.values(doc.tokens.spacing), radii: Object.values(doc.tokens.radius), shadows: Object.values(doc.tokens.shadows), borders: [],
    notes, logoFiles: [], uiKitFiles: [], rawFiles: [], homepageHtml: null, fetchedPageCount: 0,
    componentSamples: { buttons: [], cards: [], forms: [], tables: [], badges: [], headings: [], body: [] }, artifactCopies: [],
  };
}

export type ImportDesignMdInput = { readonly markdown: unknown; readonly name?: unknown };

/** Creates a draft system from a design Markdown file through the canonical extraction path; Do / Don't lists become its rules. */
export async function importDesignMd(input: ImportDesignMdInput, signal: AbortSignal): Promise<CreateDesignSystemExtractionResponse & { readonly rules_imported: number }> {
  if (typeof input.markdown !== "string") throw new DesignMdError("design_md_invalid");
  if (input.name !== undefined && (typeof input.name !== "string" || !input.name.trim() || input.name.length > 100)) throw new DesignMdError("design_md_invalid");
  const parsed = parseDesignMd(input.markdown);
  const doc = typeof input.name === "string" ? { ...parsed, name: input.name.trim() } : parsed;
  const result = await persistCanonicalExtraction({ requestedId: doc.name, brandName: doc.name, sourceType: "upload", sourceReference: "DESIGN.md", lineage: null, analysis: analysisFromDesignMd(doc), signal });
  const rules = await addDesignSystemRules(result.system.id, [...doc.dos.map((text) => ({ kind: "do" as const, text })), ...doc.donts.map((text) => ({ kind: "dont" as const, text }))], { type: "imported" });
  const imported = rules.rules.length;
  return { ...result, rules_imported: imported };
}
