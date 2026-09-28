import { createHash } from "node:crypto";
import type { DesignSystemExtractionLineageRequest } from "@bg/shared";
import type { ExtractionDomain } from "@bg/shared/extraction-domain";
import type { CssDeclarationEvidence, CssParseIssue } from "./extraction-css";

export const EXTRACTION_PROVENANCE_SCHEMA_VERSION = 1 as const;

export const EXTRACTION_DOMAINS = [
  "token", "typography", "spacing", "border", "layout", "component", "asset",
  "breakpoint", "responsiveness", "animation", "interaction", "accessibility", "state",
] as const satisfies readonly ExtractionDomain[];
export type { ExtractionDomain };
export type ExtractionState = "observed" | "inferred" | "defaulted" | "unknown" | "conflicted";

export type ExtractionDiscovery = {
  readonly domain: ExtractionDomain;
  readonly key: string;
  readonly value: string | null;
  readonly sourceLocator: string;
  readonly confidence: number;
  readonly state?: Exclude<ExtractionState, "conflicted">;
  readonly unknownReason?: string;
  readonly lineage?: readonly string[];
};

type Candidate = {
  readonly value: string;
  readonly source_locator: string;
  readonly confidence: number;
};

export type ExtractionProvenanceEntry = {
  readonly domain: ExtractionDomain;
  readonly key: string;
  readonly state: ExtractionState;
  readonly confidence: number;
  readonly source_locators: readonly string[];
  readonly candidates: readonly Candidate[];
  readonly conflicts: readonly string[];
  readonly unknown_reason: string | null;
  readonly lineage: readonly string[];
};

type StableContent = { readonly entries: readonly ExtractionProvenanceEntry[] };
export type ExtractionProvenanceSidecar = {
  readonly schema_version: typeof EXTRACTION_PROVENANCE_SCHEMA_VERSION;
  readonly digest_algorithm: "sha256";
  readonly content_digest: string;
  readonly content: StableContent;
  readonly generated_at: number;
  readonly lineage: DesignSystemExtractionLineageRequest | null;
};

export type ExtractionAnalysisEvidence = {
  readonly cssDeclarations?: readonly CssDeclarationEvidence[];
  readonly cssParseIssues?: readonly CssParseIssue[];
  readonly cssVars: ReadonlyMap<string, string>;
  readonly fontFamilies: readonly string[];
  readonly colors: readonly string[];
  readonly fontSizes: readonly string[];
  readonly fontWeights: readonly string[];
  readonly spacingValues: readonly string[];
  readonly radii: readonly string[];
  readonly shadows: readonly string[];
  readonly borders?: readonly string[];
  readonly assets?: readonly string[];
  readonly components?: Readonly<Record<string, readonly string[]>>;
  /** Layout tokens measured from the source CSS, keyed by custom-property name. */
  readonly layout?: Readonly<Record<string, string>>;
};

export function discoveriesFromAnalysis(analysis: ExtractionAnalysisEvidence): readonly ExtractionDiscovery[] {
  const discoveries: ExtractionDiscovery[] = [];
  const add = (domain: ExtractionDomain, key: string, value: string, locator: string, confidence: number): void => {
    discoveries.push({ domain, key, value, sourceLocator: locator, confidence, state: "observed", lineage: ["source-extraction"] });
  };
  const declarations = analysis.cssDeclarations ?? [];
  if (declarations.length > 0) {
    for (const declaration of declarations) addCssDeclaration(discoveries, declaration);
  } else {
    for (const [key, value] of analysis.cssVars) add("token", key, value, `css-custom-property:${key}`, 1);
    analysis.fontSizes.forEach((value, index) => add("typography", `font-size-${index + 1}`, value, `css:font-size:${index + 1}`, 0.85));
    analysis.fontWeights.forEach((value, index) => add("typography", `font-weight-${index + 1}`, value, `css:font-weight:${index + 1}`, 0.85));
    analysis.spacingValues.forEach((value, index) => add("spacing", `spacing-${index + 1}`, value, `css:spacing:${index + 1}`, 0.8));
    analysis.radii.forEach((value, index) => add("border", `radius-${index + 1}`, value, `css:border-radius:${index + 1}`, 0.8));
    analysis.shadows.forEach((value, index) => add("layout", `shadow-${index + 1}`, value, `css:box-shadow:${index + 1}`, 0.8));
    analysis.colors.forEach((value, index) => add("token", `raw-color-${index + 1}`, value, `css:color:${index + 1}`, 0.75));
    analysis.borders?.forEach((value, index) => add("border", `border-${index + 1}`, value, `css:border:${index + 1}`, 0.85));
  }
  for (const issue of analysis.cssParseIssues ?? []) {
    discoveries.push({ domain: issue.key.startsWith("border") ? "border" : "token", key: issue.key, value: null, sourceLocator: issue.sourceLocator, confidence: 0, state: "unknown", unknownReason: issue.reason, lineage: ["css-parser"] });
  }
  analysis.fontFamilies.forEach((value, index) => add("typography", `font-family-${index + 1}`, value, `css:font-family:${index + 1}`, 0.9));
  analysis.assets?.forEach((value) => add("asset", value, value, `asset:${value}`, 1));
  for (const [name, value] of Object.entries(analysis.layout ?? {})) {
    const key = name.replace(/^--/, "");
    add(key.startsWith("layout-bp-") ? "breakpoint" : "layout", key, value, `css:measured:${key}`, 0.7);
  }
  for (const [kind, samples] of Object.entries(analysis.components ?? {})) {
    samples.forEach((value, index) => add("component", `${kind}-${index + 1}`, value, `html:${kind}:${index + 1}`, 0.7));
  }
  return discoveries;
}

function addCssDeclaration(target: ExtractionDiscovery[], declaration: CssDeclarationEvidence): void {
  const property = declaration.property;
  let domain: ExtractionDomain | null = null;
  if (property.startsWith("--") || property === "color" || property === "background" || property === "background-color") domain = "token";
  else if (property === "font-family" || property === "font-size" || property === "font-weight") domain = "typography";
  else if (["margin", "padding", "gap", "column-gap", "row-gap"].includes(property)) domain = "spacing";
  else if (property === "box-shadow") domain = "layout";
  else if (property === "border" || property === "border-radius" || property.startsWith("border-")) domain = "border";
  if (domain === null) return;
  target.push({
    domain,
    key: property.replace(/^--/, ""),
    value: declaration.value,
    sourceLocator: declaration.sourceLocator,
    confidence: property.startsWith("--") ? 1 : 0.85,
    state: "observed",
    lineage: ["css-parser"],
  });
}

export function normalizeProvenanceKey(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, "-").toLowerCase();
}

export function buildExtractionProvenance(
  discoveries: readonly ExtractionDiscovery[],
  generatedAt = Date.now(),
  lineage: DesignSystemExtractionLineageRequest | null = null,
): ExtractionProvenanceSidecar {
  const groups = new Map<string, ExtractionDiscovery[]>();
  for (const discovery of discoveries) {
    const key = normalizeProvenanceKey(discovery.key);
    const identity = `${discovery.domain}\u0000${key}`;
    const current = groups.get(identity) ?? [];
    current.push({ ...discovery, key });
    groups.set(identity, current);
  }
  for (const domain of EXTRACTION_DOMAINS) {
    const identity = `${domain}\u0000unknown`;
    if (![...groups.keys()].some((key) => key.startsWith(`${domain}\u0000`))) {
      groups.set(identity, [{
        domain,
        key: "unknown",
        value: null,
        sourceLocator: `domain:${domain}`,
        confidence: 0,
        state: "unknown",
        unknownReason: "no_supported_evidence",
        lineage: ["extraction"],
      }]);
    }
  }

  const entries = [...groups.values()].map(buildEntry).sort(compareEntries);
  const content = { entries } satisfies StableContent;
  return {
    schema_version: EXTRACTION_PROVENANCE_SCHEMA_VERSION,
    digest_algorithm: "sha256",
    content_digest: digestStableProvenance(content),
    content,
    generated_at: generatedAt,
    lineage,
  };
}

export function digestStableProvenance(content: { readonly entries: readonly unknown[] }): string {
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

export function selectCanonicalToken(
  discoveries: readonly ExtractionDiscovery[],
  aliases: readonly string[],
  fallback: string,
): { readonly value: string; readonly state: ExtractionState; readonly candidates: readonly Candidate[] } {
  const normalizedAliases = aliases.map(normalizeProvenanceKey);
  const candidates = discoveries
    .filter((item) => item.value !== null && normalizedAliases.some((alias) => {
      const key = normalizeProvenanceKey(item.key);
      return key === alias || key.endsWith(`-${alias}`) || key.endsWith(`/${alias}`);
    }))
    .map(toCandidate)
    .sort(compareCandidates);
  if (candidates.length === 0) return { value: fallback, state: "defaulted", candidates: [] };
  const bestConfidence = candidates[0]?.confidence ?? 0;
  const best = candidates.filter((item) => item.confidence === bestConfidence);
  const values = [...new Set(best.map((item) => item.value))].sort(compareText);
  return { value: values[0] ?? fallback, state: values.length > 1 ? "conflicted" : "observed", candidates };
}

function buildEntry(group: readonly ExtractionDiscovery[]): ExtractionProvenanceEntry {
  const sorted = [...group].sort((left, right) => compareText(left.sourceLocator, right.sourceLocator));
  const candidates = sorted.filter((item) => item.value !== null).map(toCandidate).sort(compareCandidates);
  const distinctValues = [...new Set(candidates.map((item) => item.value))].sort(compareText);
  const declared = sorted[0]?.state ?? "observed";
  const state: ExtractionState = candidates.length === 0
    ? "unknown"
    : distinctValues.length > 1
      ? "conflicted"
      : declared;
  return {
    domain: sorted[0]?.domain ?? "token",
    key: sorted[0]?.key ?? "unknown",
    state,
    confidence: candidates.length === 0 ? 0 : Math.max(...candidates.map((item) => item.confidence)),
    source_locators: [...new Set(sorted.map((item) => item.sourceLocator))].sort(compareText),
    candidates,
    conflicts: state === "conflicted" ? distinctValues : [],
    unknown_reason: state === "unknown" ? sorted.find((item) => item.unknownReason)?.unknownReason ?? "unsupported_or_unavailable" : null,
    lineage: [...new Set(sorted.flatMap((item) => item.lineage ?? ["extraction"]))].sort(compareText),
  };
}

function toCandidate(item: ExtractionDiscovery): Candidate {
  return { value: item.value ?? "", source_locator: item.sourceLocator, confidence: item.confidence };
}

function compareEntries(left: ExtractionProvenanceEntry, right: ExtractionProvenanceEntry): number {
  return compareText(`${left.domain}\u0000${left.key}\u0000${left.source_locators.join("\u0000")}`, `${right.domain}\u0000${right.key}\u0000${right.source_locators.join("\u0000")}`);
}

function compareCandidates(left: Candidate, right: Candidate): number {
  return right.confidence - left.confidence || compareText(`${left.value}\u0000${left.source_locator}`, `${right.value}\u0000${right.source_locator}`);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
