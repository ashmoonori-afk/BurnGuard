import { readDesignSystemLayout } from "./design-system-layout";
import { readDesignSystemAssetGuide } from "./design-system-assets";
import { buildAssetGuideReadme, paletteTone, toHexColor } from "./extraction-assets";
import { collectSourceEvidence, withoutFunctions, type SourceEvidence } from "./extraction-evidence";
import { buildSectionPatternReadme, measureSourceLayout } from "./extraction-layout";
import { buildPageCoverage, buildPageTemplateReadme, canonicalPagePath, classifyPageType, discoverPages, observedPatterns, pageEvidence, parseRobots, parseSitemap } from "./extraction-pages";
import { readDesignSystemPageCoverage } from "./design-system-pages";
import { measureRenderedLayout, type LayoutMeasureFailure, type LayoutReferenceCapture, type MeasuredPageInput, type RenderedLayoutInput } from "./extraction-rendered-layout";
import type { CssDeclarationEvidence } from "./extraction-css";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { isValidFontData } from "./font-validation";
import { parse } from "node-html-parser";
import {
  APP_VERSION,
  DEFAULT_PAGE_LIMIT,
  LAYOUT_REFERENCE_HERO_FILE,
  MAX_HERO_ASSET_BYTES,
  MAX_HERO_ASSETS,
  MAX_LAYOUT_REFERENCE_BYTES,
  parseDesignSystemLayoutReference,
  parseDesignSystemPageCoverage,
  type DesignSystemPageCoverage,
  type DesignSystemMeasuredLayout,
  type CreateDesignSystemExtractionRequest,
  type CreateDesignSystemExtractionResponse,
  type CreateDesignSystemUploadRequest,
  type DesignSystemDetail,
  type DesignSystemSourceType,
} from "@bg/shared";
import { settleOwnedProcess, spawnOwnedProcess } from "../adapters/owned-process";
import { commitDesignSystemReceipt, getDesignSystemReceiptById, prepareDesignSystemReceipt } from "../db/design-system-repository";
import { getDb } from "../db/client";
import { createDesignSystemRecord, deleteDesignSystemRecord, getDesignSystemDetail } from "../db/seed";
import { resolveManagedPath, systemsDir } from "../lib/paths";
import { resolveWithin } from "../security/path-boundary";
import {
  completeExtractionPublication,
  ExtractionPublicationError,
  publishExtractionBundle,
  reconcileExtractionPublications,
  reserveExtractionBundle,
  rollbackExtractionPublication,
  validateExtractionBundle,
  type ExtractionReservation,
} from "./extraction-publication";
import {
  buildExtractionProvenance,
  discoveriesFromAnalysis,
  selectCanonicalToken,
  type ExtractionProvenanceSidecar,
} from "./extraction-provenance";
import {
  assertInertSourceMarkup,
  ExtractionSafetyError,
  safeSourceReference,
} from "./extraction-safety";

export {
  assertInertSourceMarkup,
  buildExtractionProvenance,
  publishExtractionBundle,
  reconcileExtractionPublications,
  selectCanonicalToken,
  validateExtractionBundle,
};
import { detectComponentSamples } from "./upload-component-detect";
import { DesignSystemAssetEditError } from "./extraction-asset-errors";
import { DesignSystemExtractError, uploadFailureCode } from "./extraction-errors";
import { assertAggregateAssetBytes, assertAssetCount, ExcludedPathError, fetchWebsiteResource } from "./extraction-website";

export { DesignSystemAssetEditError, DesignSystemExtractError };
import { loadConfig } from "../config";
import {
  extractFigmaTokens,
  fetchFigmaFileMeta,
  fetchFigmaNodes,
  fetchFigmaPublishedStyles,
  FigmaApiError,
  parseFigmaUrl,
} from "./figma";
import { UPLOAD_EXTRACTOR_PY } from "./upload-extractor-py";
import { pythonCandidates } from "./python-runtime";
import {
  awaitChildWithAbort,
  createAcquisitionBudget,
  AcquisitionLimitError,
  ExtractionAcquisitionError,
  MAX_CSS_BYTES,
  MAX_HTML_BYTES,
  DEFAULT_ACQUISITION_LIMITS,
  throwIfAcquisitionAborted,
  type AcquisitionLimits,
} from "./extraction-acquisition";
import {
  ensureTokensCssImportsFonts,
  extractCssCustomProperties,
  extractCssStyleSignals,
  fontFamiliesFromDeclarations,
  parseCssSource,
  selectCssCustomProperties,
  styleSignalsFromDeclarations,
  isColorTokenValue,
  NAMED_COLORS,
  upsertCssCustomProperty,
} from "./extraction-css";
import { DESIGN_SURFACE_FILES, DESIGN_SURFACES } from "@bg/shared";
import { DERIVED_SURFACE_README_SECTIONS, renderDerivedSurfaceCss } from "./design-system-surface";
import { renderMeasuredWireframe } from "./design-system-wireframe";
import { collectCandidateWebsitePages, extractHtmlComponentSamples, sanitizeAcquiredWebsiteHtml, sanitizeSourceHtml } from "./extraction-html";
import { analyzeLocalTree, type SourceAnalysis } from "./extraction-local-tree";
import {
  contentTypeForDesignSystemFile,
  inferExtractionSourceType,
  isUnsafeImportHostname,
  parseExtractionSourceUrl,
} from "./extraction-path";
import { isOwnedQaAdapterEntryUrl, isOwnedQaAdapterResourceUrl, qaAdapterConfiguration } from "./extraction-qa-adapter";
import {
  ExtractionUploadManifestError,
  inferUploadKind,
  normalizeUploadPages,
  normalizeUploadStringList,
  assertUploadSize,
  readBoundedUpload,
  readUploadManifest,
  type SupportedUploadKind,
  type UploadManifest,
  type UploadManifestPage,
} from "./extraction-upload";

export {
  contentTypeForDesignSystemFile,
  ensureTokensCssImportsFonts,
  extractCssCustomProperties,
  extractCssStyleSignals,
  extractHtmlComponentSamples,
  inferExtractionSourceType as inferSourceType,
  inferUploadKind,
  isUnsafeImportHostname,
  normalizeUploadPages,
  normalizeUploadStringList,
  readUploadManifest,
  upsertCssCustomProperty,
};
export type { UploadManifest, UploadManifestPage };

const PREVIEW_FILE_IDS = [
  "brand-logos",
  "brand-icons",
  "colors-brand",
  "colors-neutrals",
  "colors-ramps",
  "colors-semantic",
  "colors-charts",
  "type-display",
  "type-headings",
  "type-body",
  "spacing",
  "radii-shadows",
  "components-buttons",
  "components-cards",
  "components-forms",
  "components-badges-table",
] as const;

const MAX_LOGO_BYTES = 2_500_000;
const MAX_TOTAL_DOWNLOAD_BYTES = 8_000_000;
const MAX_FONT_UPLOAD_BYTES = 16_000_000;
const MAX_UPLOAD_UI_KIT_PAGES = 8;
const SUPPORTED_FONT_EXTENSIONS = new Set([".woff2", ".woff", ".ttf", ".otf"]);

type SupportedExtractionSource = Extract<
  DesignSystemSourceType,
  "github" | "website" | "figma" | "upload"
>;
function validateExtractionLineage(
  lineage: CreateDesignSystemExtractionRequest["lineage"],
): NonNullable<CreateDesignSystemExtractionRequest["lineage"]> | null {
  if (lineage === undefined) return null;
  if (
    (lineage.operation !== "override" && lineage.operation !== "re-extraction") ||
    !lineage.parent_receipt_id.trim() ||
    !/^[0-9a-f]{64}$/.test(lineage.parent_content_digest) ||
    !lineage.reason.trim() ||
    Object.entries(lineage.metadata).some(([key, value]) => !key.trim() || !value.trim())
  ) {
    throw new DesignSystemExtractError("invalid_lineage", "Extraction lineage is malformed");
  }
  const parent = getDesignSystemReceiptById(getDb(), lineage.parent_receipt_id);
  if (parent === null || parent.digest !== lineage.parent_content_digest) {
    throw new DesignSystemExtractError("lineage_parent_mismatch", "Extraction lineage parent is missing or stale");
  }
  return {
    operation: lineage.operation,
    parent_receipt_id: lineage.parent_receipt_id,
    parent_content_digest: lineage.parent_content_digest,
    reason: lineage.reason.trim(),
    metadata: Object.fromEntries(Object.entries(lineage.metadata).sort(([left], [right]) => left.localeCompare(right))),
  };
}

export async function extractDesignSystemFromSource(
  input: CreateDesignSystemExtractionRequest,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number; readonly measureLayout?: LayoutMeasurer } = {},
): Promise<CreateDesignSystemExtractionResponse> {
  const sourceUrl = typeof input.source_url === "string" ? input.source_url.trim() : "";
  if (!sourceUrl) {
    throw new DesignSystemExtractError(
      "invalid_source_url",
      "source_url is required",
    );
  }
  try {
    parseExtractionSourceUrl(sourceUrl);
  } catch (error) {
    if (error instanceof ExtractionSafetyError) {
      throw new DesignSystemExtractError("invalid_source_url", error.message);
    }
    throw error;
  }

  const lineage = validateExtractionLineage(input.lineage);
  const inferredSourceType = inferExtractionSourceType(sourceUrl);
  const sourceType = input.source_type ?? inferredSourceType;
  if (input.source_type !== undefined && input.source_type !== inferredSourceType) {
    throw new DesignSystemExtractError("invalid_source_url", "source_type must match the source URL provider");
  }
  if (
    sourceType !== "github" &&
    sourceType !== "website" &&
    sourceType !== "figma"
  ) {
    throw new DesignSystemExtractError(
      "unsupported_source_type",
      `Unsupported extraction source type: ${String(sourceType)}`,
    );
  }

  const configuredTimeout = Number.parseInt(process.env.BG_EXTRACTION_TIMEOUT_MS ?? "30000", 10);
  const adapter = qaAdapterConfiguration();
  const source = new URL(sourceUrl);
  const configuredStallTimeout = Number.parseInt(process.env.BG_EXTRACTION_QA_STALL_TIMEOUT_MS ?? "1000", 10);
  const stallTimeout = Number.isFinite(configuredStallTimeout) && configuredStallTimeout > 0 && configuredStallTimeout <= 5_000
    ? configuredStallTimeout
    : 1_000;
  const timeout = options.timeoutMs ?? (adapter !== null && source.toString() === adapter.stallUrl.toString() ? stallTimeout : configuredTimeout);
  const budget = createAcquisitionBudget(options.signal, timeout);
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "burnguard-ds-extract-"));
  try {
    const ingestDir = path.join(tmpRoot, "ingest");
    await mkdir(ingestDir, { recursive: true });
    const analysis =
      sourceType === "github"
        ? await ingestGitSource(sourceUrl, ingestDir, budget.signal, input.name)
        : sourceType === "figma"
          ? await ingestFigmaSource(sourceUrl, ingestDir, budget.signal, input.name)
          : await ingestWebsiteSource(sourceUrl, ingestDir, budget.signal, input.name, input.page_limit, options.measureLayout ?? defaultLayoutMeasurer(), budget.deadlineAt);

    const brandName = input.name?.trim() || analysis.brandName;
    return await persistCanonicalExtraction({
      requestedId: input.system_id ?? slugify(brandName),
      brandName,
      sourceType,
      sourceReference: isOwnedQaAdapterEntryUrl(source) ? `qa-adapter:${source.pathname}` : safeSourceReference(sourceUrl),
      lineage,
      analysis,
      signal: budget.signal,
    });
  } catch (error) {
    if (error instanceof ExtractionAcquisitionError) throw new DesignSystemExtractError("acquisition_timeout", error.message);
    if (error instanceof AcquisitionLimitError) throw new DesignSystemExtractError("acquisition_limit", error.message);
    // A refused fetched page is a property of the source, not a server fault: report it as a typed 4xx.
    if (error instanceof ExtractionSafetyError) {
      throw new DesignSystemExtractError(
        error.code === "invalid_source_url" ? "invalid_source_url" : sourceType === "website" ? "website_content_refused" : "unsafe_source_content",
        error.message,
      );
    }
    throw error;
  } finally {
    budget.dispose();
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

export async function extractDesignSystemFromUpload(input: {
  file: File;
  body?: CreateDesignSystemUploadRequest;
  signal?: AbortSignal;
  timeoutMs?: number;
  limits?: AcquisitionLimits;
}): Promise<CreateDesignSystemExtractionResponse> {
  const uploadName = input.file.name?.trim();
  if (!uploadName) {
    throw new DesignSystemExtractError(
      "invalid_upload",
      "Uploaded file must have a filename",
    );
  }
  if (input.file.size <= 0) {
    throw new DesignSystemExtractError(
      "invalid_upload",
      "Uploaded file is empty",
    );
  }
  const limits = input.limits ?? DEFAULT_ACQUISITION_LIMITS;
  assertUploadSize(input.file, limits);

  const uploadKind = inferUploadKind(uploadName, input.file.type);
  if (!uploadKind) {
    throw new DesignSystemExtractError(
      "invalid_upload",
      "Only .pptx and .pdf design system uploads are supported",
    );
  }

  const configuredTimeout = Number.parseInt(process.env.BG_EXTRACTION_TIMEOUT_MS ?? "30000", 10);
  const budget = createAcquisitionBudget(input.signal, input.timeoutMs ?? configuredTimeout, limits);
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "burnguard-ds-upload-"));
  try {
    const ingestDir = path.join(tmpRoot, "ingest");
    await mkdir(ingestDir, { recursive: true });
    const sourceFileName = safeFileName(uploadName);
    const sourcePath = path.join(ingestDir, sourceFileName);
    await writeFile(sourcePath, await readBoundedUpload(input.file, budget.signal, limits));

    const analysis = await ingestUploadSource({
      ingestDir,
      sourcePath,
      sourceFileName,
      uploadKind,
      preferredName: input.body?.name,
      signal: budget.signal,
    });

    const brandName = input.body?.name?.trim() || analysis.brandName;
    return await persistCanonicalExtraction({
      requestedId: input.body?.system_id ?? slugify(brandName),
      brandName,
      sourceType: "upload",
      sourceReference: uploadName,
      lineage: null,
      analysis,
      signal: budget.signal,
    });
  } catch (error) {
    if (error instanceof ExtractionAcquisitionError) throw new DesignSystemExtractError("acquisition_timeout", error.message);
    if (error instanceof AcquisitionLimitError) throw new DesignSystemExtractError("acquisition_limit", error.message);
    throw error;
  } finally {
    budget.dispose();
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

type CanonicalExtractionInput = {
  readonly requestedId: string;
  readonly brandName: string;
  readonly sourceType: SupportedExtractionSource;
  readonly sourceReference: string;
  readonly lineage: NonNullable<CreateDesignSystemExtractionRequest["lineage"]> | null;
  readonly analysis: SourceAnalysis;
  readonly signal: AbortSignal;
};

type CanonicalWriteResult = {
  readonly generatedFiles: readonly string[];
  readonly provenance: ExtractionProvenanceSidecar;
};

export async function persistCanonicalExtraction(
  input: CanonicalExtractionInput,
): Promise<CreateDesignSystemExtractionResponse> {
  throwIfAcquisitionAborted(input.signal);
  const reservation = await reserveAvailableSystemId(input.requestedId);
  const analysis = stabilizeSourceAnalysis(input.analysis);
  let rowCreated = false;
  try {
    const written = await writeCanonicalDesignSystem({
      systemDir: reservation.stagingDir,
      systemId: reservation.id,
      brandName: input.brandName,
      sourceType: input.sourceType,
      sourceUrl: input.sourceReference,
      lineage: input.lineage,
      analysis,
      signal: input.signal,
    });
    throwIfAcquisitionAborted(input.signal);
    const validation = await validateExtractionBundle(reservation, input.signal);
    const systemDir = reservation.destinationDir;
    const created = await createDesignSystemRecord({
      id: reservation.id,
      name: input.brandName,
      description: `${capitalize(input.sourceType)} extraction scaffold from ${input.sourceReference}`,
      status: "draft",
      sourceType: input.sourceType,
      sourceUri: input.sourceReference,
      dirPath: systemDir,
      skillMdPath: path.join(systemDir, "SKILL.md"),
      tokensCssPath: path.join(systemDir, "colors_and_type.css"),
      readmeMdPath: path.join(systemDir, "README.md"),
      thumbnailPath: null,
    });
    if (!created) throw new DesignSystemExtractError("publication_failed", "Design system reservation was not persisted");
    rowCreated = true;
    const receiptId = `extraction-${reservation.id}-1-${written.provenance.content_digest.slice(0, 12)}`;
    prepareDesignSystemReceipt(getDb(), {
      id: receiptId,
      designSystemId: reservation.id,
      contentRevision: 1,
      schemaVersion: written.provenance.schema_version,
      digest: written.provenance.content_digest,
      manifest: validation.manifest,
      provenance: written.provenance,
      createdAt: Date.now(),
    });
    throwIfAcquisitionAborted(input.signal);
    await publishExtractionBundle(reservation, input.signal, validation.manifest);
    if (
      process.env.BG_EXTRACTION_FAULT === "after_publish" ||
      process.env.BG_EXTRACTION_FAULT_AFTER_PUBLISH_ID === reservation.id
    ) {
      throw new DesignSystemExtractError("publication_failed", "Injected extraction publication fault");
    }
    commitDesignSystemReceipt(getDb(), { id: receiptId, digest: written.provenance.content_digest, updatedAt: Date.now() });
    await completeExtractionPublication(reservation);
    return {
      system: {
        ...created,
        dir_path: reservation.id,
        skill_md_path: "SKILL.md",
        tokens_css_path: "colors_and_type.css",
        readme_md_path: "README.md",
      } satisfies DesignSystemDetail,
      extraction: {
        inferred_source_type: input.sourceType,
        brand_name: input.brandName,
        generated_files: [...written.generatedFiles],
        copied_logo_count: analysis.logoFiles.length,
        detected_css_var_count: analysis.cssVars.size,
        detected_font_family_count: analysis.fontFamilies.length,
        notes: analysis.notes,
        provenance: written.provenance,
      },
    };
  } catch (error) {
    await Promise.all([
      rollbackExtractionPublication(reservation),
      rowCreated ? deleteDesignSystemRecord(reservation.id) : Promise.resolve(),
    ]);
    if (error instanceof ExtractionPublicationError) {
      throw new DesignSystemExtractError(error.code === "system_id_conflict" ? "system_id_conflict" : "publication_failed", error.message);
    }
    if (error instanceof ExtractionSafetyError) {
      throw new DesignSystemExtractError("unsafe_source_content", error.message);
    }
    throw error;
  }
}

function stabilizeSourceAnalysis(analysis: SourceAnalysis): SourceAnalysis {
  const sorted = (values: readonly string[]): string[] => [...new Set(values)].sort();
  return {
    ...analysis,
    cssDeclarations: [...analysis.cssDeclarations].sort((left, right) => left.fileOrder - right.fileOrder || left.declarationOrder - right.declarationOrder || left.sourceLocator.localeCompare(right.sourceLocator)),
    cssParseIssues: [...analysis.cssParseIssues].sort((left, right) => left.sourceLocator.localeCompare(right.sourceLocator) || left.reason.localeCompare(right.reason)),
    cssVars: new Map([...analysis.cssVars.entries()].sort(([left], [right]) => left.localeCompare(right))),
    fontFamilies: sorted(analysis.fontFamilies),
    colors: sorted(analysis.colors),
    fontSizes: sorted(analysis.fontSizes),
    fontWeights: sorted(analysis.fontWeights),
    spacingValues: sorted(analysis.spacingValues),
    radii: sorted(analysis.radii),
    shadows: sorted(analysis.shadows),
    borders: sorted(analysis.borders),
    notes: sorted(analysis.notes),
    logoFiles: [...analysis.logoFiles].sort((left, right) => left.fileName.localeCompare(right.fileName)),
    uiKitFiles: [...analysis.uiKitFiles].sort((left, right) => left.fileName.localeCompare(right.fileName)),
    rawFiles: sorted(analysis.rawFiles),
    componentSamples: {
      buttons: sorted(analysis.componentSamples.buttons),
      cards: sorted(analysis.componentSamples.cards),
      forms: sorted(analysis.componentSamples.forms),
      tables: sorted(analysis.componentSamples.tables),
      badges: sorted(analysis.componentSamples.badges),
      headings: sorted(analysis.componentSamples.headings),
      body: sorted(analysis.componentSamples.body),
    },
    artifactCopies: [...analysis.artifactCopies].sort((left, right) => left.relPath.localeCompare(right.relPath)),
  };
}

async function reserveAvailableSystemId(baseSlug: string): Promise<ExtractionReservation> {
  const safeBase = slugify(baseSlug || "design-system");
  for (let ordinal = 1; ordinal < 10_000; ordinal += 1) {
    const candidate = ordinal === 1 ? safeBase : `${safeBase}-${ordinal}`;
    if (await getDesignSystemDetail(candidate)) continue;
    try {
      return await reserveExtractionBundle(systemsDir, candidate);
    } catch (error) {
      if (error instanceof ExtractionPublicationError && error.code === "system_id_conflict") continue;
      throw error;
    }
  }
  throw new DesignSystemExtractError("system_id_conflict", "Could not allocate a unique design system id");
}

export async function readDesignSystemTokens(systemId: string) {
  const detail = await getDesignSystemDetail(systemId);
  if (!detail) {
    throw new DesignSystemAssetEditError(
      "design_system_not_found",
      "Design system not found",
    );
  }
  const [layout, assets, pages] = await Promise.all([readDesignSystemLayout(detail), readDesignSystemAssetGuide(detail), readDesignSystemPageCoverage(detail)]);
  const extras = { layout, assets, ...(pages ? { pages } : {}) };
  if (!detail.tokens_css_path) {
    return { ...extras, colors: [], token_file_path: null };
  }

  const tokenPath = resolveDesignSystemRecordPath(systemId, detail.dir_path, detail.tokens_css_path);
  const css = await readFile(tokenPath, "utf8").catch(() => null);
  if (css === null) {
    return { ...extras, colors: [], token_file_path: tokenPath };
  }

  const colors = [...(await extractCssCustomProperties(css)).entries()]
    .filter(([, value]) => isColorTokenValue(value))
    .map(([name, value]) => ({ name, value }));

  return { ...extras, colors, token_file_path: tokenPath };
}

export async function upsertDesignSystemColorToken(
  systemId: string,
  input: { name: string; value: string },
) {
  const detail = await getDesignSystemDetail(systemId);
  if (!detail) {
    throw new DesignSystemAssetEditError(
      "design_system_not_found",
      "Design system not found",
    );
  }
  if (!detail.tokens_css_path) {
    throw new DesignSystemAssetEditError(
      "tokens_file_missing",
      "Design system does not have a colors_and_type.css token file",
    );
  }

  const tokenName = normalizeCssTokenName(input.name);
  if (!tokenName) {
    throw new DesignSystemAssetEditError(
      "invalid_color_token",
      "Color token name must contain letters, numbers, dashes, or underscores",
    );
  }

  const colorValue = input.value.trim();
  if (!isColorTokenValue(colorValue)) {
    throw new DesignSystemAssetEditError(
      "invalid_color_value",
      "Color value must be a safe CSS color value",
    );
  }

  const tokenPath = resolveDesignSystemRecordPath(systemId, detail.dir_path, detail.tokens_css_path);
  const existingCss = await readFile(tokenPath, "utf8").catch(
    () => "",
  );
  const nextCss = upsertCssCustomProperty(existingCss, tokenName, colorValue);
  await writeFile(tokenPath, nextCss, "utf8");
  return await readDesignSystemTokens(systemId);
}

export async function uploadDesignSystemFont(input: {
  systemId: string;
  file: File;
  family?: string;
  role?: "display" | "sans" | "serif" | "mono" | null;
}) {
  const detail = await getDesignSystemDetail(input.systemId);
  if (!detail) {
    throw new DesignSystemAssetEditError(
      "design_system_not_found",
      "Design system not found",
    );
  }

  const originalName = input.file.name?.trim();
  if (!originalName) {
    throw new DesignSystemAssetEditError(
      "invalid_font_upload",
      "Uploaded font must have a filename",
    );
  }
  const ext = path.extname(originalName).toLowerCase();
  if (!SUPPORTED_FONT_EXTENSIONS.has(ext)) {
    throw new DesignSystemAssetEditError(
      "invalid_font_upload",
      "Only .woff2, .woff, .ttf, and .otf font files are supported",
    );
  }
  if (input.file.size <= 0 || input.file.size > MAX_FONT_UPLOAD_BYTES) {
    throw new DesignSystemAssetEditError(
      "invalid_font_upload",
      `Font upload must be between 1 byte and ${MAX_FONT_UPLOAD_BYTES} bytes`,
    );
  }
  const fontBytes = new Uint8Array(await input.file.arrayBuffer());
  if (!(await isValidFontData(fontBytes))) {
    throw new DesignSystemAssetEditError(
      "invalid_font_upload",
      "Uploaded file is not a valid font",
    );
  }

  const managedSystemDir = resolveDesignSystemRecordPath(input.systemId, detail.dir_path, detail.dir_path);
  const fontsDir = resolveWithin(managedSystemDir, "fonts");
  await mkdir(fontsDir, { recursive: true });
  const fileName = safeFileName(originalName);
  const fontPath = path.join(fontsDir, fileName);
  const family = normalizeFontFamily(input.family) || humanizeSlug(path.basename(fileName, ext));
  const role = input.role ?? null;

  await writeFile(fontPath, fontBytes);
  await appendFontFaceRule(path.join(fontsDir, "fonts.css"), family, fileName);

  if (role && detail.tokens_css_path) {
    const tokenPath = resolveDesignSystemRecordPath(input.systemId, detail.dir_path, detail.tokens_css_path);
    const existingCss = await readFile(tokenPath, "utf8").catch(
      () => "",
    );
    const fontsCss = await readFile(path.join(fontsDir, "fonts.css"), "utf8").catch(() => "");
    const tokens = await extractCssCustomProperties(existingCss);
    const fallbackDefined = tokens.has(`font-${role}-fallback`) || (await extractCssCustomProperties(fontsCss)).has(`font-${role}-fallback`);
    // `var(--font-<role>-fallback)` only resolves when a token or fonts.css defines it (extracted
    // systems do); otherwise keep the current stack behind the new family so its fallbacks survive.
    const existingStack = tokens.get(`font-${role}`);
    const [leadingFamily, ...trailingFamilies] = existingStack?.split(",") ?? [];
    const stack = leadingFamily !== undefined && leadingFamily.trim().replace(/^["']|["']$/gu, "") === family
      ? trailingFamilies.join(",").trim()
      : existingStack;
    const fallback = fallbackDefined
      ? `var(--font-${role}-fallback)`
      : stack || `"Pretendard", ${role === "serif" ? "serif" : role === "mono" ? "monospace" : "sans-serif"}`;
    const nextCss = upsertCssCustomProperty(
      ensureTokensCssImportsFonts(existingCss),
      `font-${role}`,
      `${cssString(family)}, ${fallback}`,
    );
    await writeFile(tokenPath, nextCss, "utf8");
  }

  return {
    file_name: fileName,
    family,
    role,
    rel_path: `fonts/${fileName}`,
  };
}

/**
 * Git for Windows rejects the platform null device (`\\.\nul`) while loading configuration and
 * exits 128 before acquisition starts, so the acquisition directory owns an empty configuration
 * file instead. Pointing both config variables at a regular empty file keeps inherited global and
 * system configuration — rewrites, credential helpers, askpass — out of the child on every platform.
 */
async function writeEmptyGitConfig(ingestDir: string): Promise<string> {
  const configPath = path.join(ingestDir, "empty.gitconfig");
  await writeFile(configPath, "", "utf8");
  return configPath;
}

async function ingestGitSource(
  sourceUrl: string,
  ingestDir: string,
  signal: AbortSignal,
  preferredName?: string,
): Promise<SourceAnalysis> {
  const repoDir = path.join(ingestDir, "repo");
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("GIT_") && name.toUpperCase() !== "SSH_ASKPASS"));
  const emptyConfig = await writeEmptyGitConfig(ingestDir);
  const owned = spawnOwnedProcess({
    cmd: ["git", "-c", "credential.helper=", "-c", "http.followRedirects=false", "clone", "--depth=1", sourceUrl, repoDir],
    cwd: ingestDir,
    env: { ...environment, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: emptyConfig, GIT_CONFIG_GLOBAL: emptyConfig, GIT_ALLOW_PROTOCOL: "https", GIT_TERMINAL_PROMPT: "0" },
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });
  const { exitCode } = await awaitChildWithAbort(owned, signal);
  if (exitCode !== 0) {
    throw new DesignSystemExtractError(
      "git_clone_failed",
      "The public repository could not be acquired",
    );
  }

  const analysis = await analyzeLocalTree(
    repoDir,
    preferredName ?? deriveBrandNameFromGitUrl(sourceUrl),
    signal,
  );
  analysis.notes.unshift("Raw source ingested from git clone.");
  analysis.rawFiles.push("uploads/source-url.txt", "uploads/extraction-report.json");
  return analysis;
}

export type LayoutMeasurer = (input: RenderedLayoutInput) => Promise<DesignSystemMeasuredLayout | null>;
const MEASURED_PAGE_LIMIT = 4;
const MEASURE_DEADLINE_MS = 15_000;
/** Budget left for publication after measurement; measurement is skipped when less than MEASURE_MIN_MS would remain. */
const MEASURE_PUBLISH_RESERVE_MS = 6_000;
const MEASURE_MIN_MS = 2_000;

/** Offline rendered measurement is on unless BG_EXTRACTION_MEASURE_LAYOUT=0 (the test preload sets it off). */
function defaultLayoutMeasurer(): LayoutMeasurer | null {
  return process.env.BG_EXTRACTION_MEASURE_LAYOUT === "0" ? null : measureRenderedLayout;
}

/**
 * Measurement gets its own deadline, capped to the acquisition budget left after a publication reserve, so a
 * slow browser drops the tokens instead of exhausting the shared budget and failing the extraction.
 */
async function measureWithDeadline(measure: LayoutMeasurer, input: RenderedLayoutInput, budgetDeadlineAt: number): Promise<{ readonly layout: DesignSystemMeasuredLayout | null; readonly unavailableReason: string | null }> {
  const available = Math.min(MEASURE_DEADLINE_MS, budgetDeadlineAt - Date.now() - MEASURE_PUBLISH_RESERVE_MS);
  if (available < MEASURE_MIN_MS) return { layout: null, unavailableReason: `insufficient_time, ${Math.max(0, available)} ms left for measurement` };
  const controller = new AbortController();
  const forward = () => controller.abort(input.signal.reason);
  input.signal.addEventListener("abort", forward, { once: true });
  let deadlineReached = false;
  const timer = setTimeout(() => { deadlineReached = true; controller.abort(new Error("layout_measure_deadline")); }, available);
  const reported: { failure: LayoutMeasureFailure | null } = { failure: null };
  // The browser start time tells a slow cold launch (probe plus launch eating the deadline) from a slow render.
  const describe = (code: string) => {
    const failure = reported.failure;
    return `${code}${failure?.launchMs != null ? `, browser start ${failure.launchMs} ms` : failure?.stage === "launch" ? ", browser did not start" : ""}`;
  };
  try {
    const measured = await measure({ ...input, signal: controller.signal, reportFailure: (failure) => { reported.failure = failure; } });
    // A partial result can come back after the extraction itself was cancelled; that cancellation still wins.
    input.signal.throwIfAborted();
    return { layout: measured, unavailableReason: measured !== null ? null : describe(deadlineReached ? `deadline of ${available} ms reached` : reported.failure?.code ?? "no_layout") };
  }
  catch (error) {
    if (input.signal.aborted) throw error;
    return { layout: null, unavailableReason: describe(deadlineReached ? `deadline of ${available} ms reached` : "measurer_failed") };
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener("abort", forward);
  }
}

/** Aggregate download budget exhaustion stops acquisition; a single oversized optional resource does not. */
function isBudgetExhausted(error: unknown): boolean {
  return error instanceof AcquisitionLimitError && error.limit === "aggregate_source_bytes";
}

/** Hex colour, with a two-digit alpha suffix when the literal is not fully opaque. */
function colorWithAlpha(literal: string): string | null {
  const hex = toHexColor(literal);
  if (!hex) return null;
  const short = /^#([0-9a-f]{4}|[0-9a-f]{8})$/i.exec(literal.trim())?.[1];
  const functional = /^(?:rgba?|hsla?)\(([^)]*)\)$/i.exec(literal.trim())?.[1]?.split(/[\s,/]+/).filter(Boolean)[3];
  const alpha = short ? Number.parseInt(short.length === 4 ? short[3]!.repeat(2) : short.slice(6), 16) / 255 : functional !== undefined ? (functional.endsWith("%") ? Number.parseFloat(functional) / 100 : Number.parseFloat(functional)) : 1;
  if (!Number.isFinite(alpha) || alpha >= 1) return hex;
  return `${hex}${Math.round(Math.max(0, alpha) * 255).toString(16).padStart(2, "0")}`;
}

/**
 * A page's colour evidence led by its own ground and text colour as explicit roles, so card and section
 * colours further down the list are never mistaken for the page background.
 */
function pageColorRoles(declarations: readonly CssDeclarationEvidence[]): string[] {
  const { ground, ink } = pageGroundAndInk(declarations);
  const roles = [...(ground ? [`page-background: ${ground}`] : []), ...(ink ? [`page-color: ${ink}`] : [])];
  return [...roles, ...pageColorEvidence(declarations)];
}

/** Property-aware colour literals of a page ("background-color: #ff0000"), normalised to hex where possible. */
function pageColorEvidence(declarations: readonly CssDeclarationEvidence[]): string[] {
  const properties = new Set(["color", "background", "background-color", "border-color", "outline-color", "fill", "stroke"]);
  const values: string[] = [];
  for (const declaration of declarations) {
    const property = declaration.property.toLowerCase();
    if (!properties.has(property)) continue;
    // A colour function with an unresolved channel or alpha is not an observed colour at all.
    if (/(?:rgba?|hsla?)\((?:[^()]|\([^()]*\))*(?:var|env|attr|calc)\(/i.test(declaration.value)) continue;
    // Substitution fallbacks may never apply, so only independently written literals count.
    const literal = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?)\([^()]*\)/i.exec(withoutFunctions(declaration.value, ["var", "env", "attr"]))?.[0];
    const color = literal ? colorWithAlpha(literal) : null;
    if (!color) continue;
    const entry = `${property}: ${color}`;
    if (!values.includes(entry)) values.push(entry);
  }
  return values;
}

async function ingestWebsiteSource(
  sourceUrl: string,
  ingestDir: string,
  signal: AbortSignal,
  preferredName?: string,
  pageLimit: number = DEFAULT_PAGE_LIMIT,
  measureLayout: LayoutMeasurer | null = null,
  deadlineAt: number = Number.POSITIVE_INFINITY,
): Promise<SourceAnalysis> {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new DesignSystemExtractError(
      "invalid_source_url",
      `Invalid website URL: ${sourceUrl}`,
    );
  }
  const ownedQaAdapter = isOwnedQaAdapterEntryUrl(url);
  if (url.protocol !== "https:" && !ownedQaAdapter) {
    throw new DesignSystemExtractError("invalid_source_url", "Website URL must use HTTPS");
  }

  let totalDownloadedBytes = 0;
  let assetBytes = 0;
  const noteBytes = (bytes: number) => {
    totalDownloadedBytes += bytes;
    if (totalDownloadedBytes > MAX_TOTAL_DOWNLOAD_BYTES) {
      throw new AcquisitionLimitError("aggregate_source_bytes", MAX_TOTAL_DOWNLOAD_BYTES, totalDownloadedBytes);
    }
  };

  const homepage = await fetchWebsiteResource(url, {
    maxBytes: MAX_HTML_BYTES,
    kind: "html",
    noteBytes,
    signal,
    userAgent: `BurnGuard/${APP_VERSION} design-system-import`,
  });
  url = homepage.finalUrl;
  const html = homepage.text;
  const storedHomepageHtml = sanitizeAcquiredWebsiteHtml(html);

  const websiteDir = path.join(ingestDir, "website");
  const uploadsDir = path.join(websiteDir, "uploads", "linked-css");
  const pagesDir = path.join(websiteDir, "uploads", "pages");
  await mkdir(uploadsDir, { recursive: true });
  await mkdir(pagesDir, { recursive: true });
  await writeFile(path.join(websiteDir, "index.html"), storedHomepageHtml, "utf8");

  const cssDeclarations: import("./extraction-css").CssDeclarationEvidence[] = [];
  const cssParseIssues: import("./extraction-css").CssParseIssue[] = [];
  let cssFileOrder = 0;
  const fontFamilies = new Set<string>();
  const colors = new Set<string>();
  const fontSizes = new Set<string>();
  const fontWeights = new Set<string>();
  const spacingValues = new Set<string>();
  const radii = new Set<string>();
  const shadows = new Set<string>();
  const notes: string[] = ["Homepage HTML fetched from website URL."];
  const logoFiles: Array<{ absolutePath: string; fileName: string }> = [];
  const pageHtmlByUrl = new Map<string, string>([[url.toString(), html]]);
  const fetchText = async (target: URL, maxBytes: number): Promise<string | null> => {
    try {
      const fetched = await fetchWebsiteResource(target, { maxBytes, kind: "html", noteBytes, signal, userAgent: `BurnGuard/${APP_VERSION} design-system-import`, allowedOrigin: url.origin });
      return fetched.finalUrl.origin === url.origin ? fetched.text : null;
    } catch (error) {
      if (error instanceof ExtractionAcquisitionError || isBudgetExhausted(error)) throw error;
      return null;
    }
  };
  const robots = parseRobots((await fetchText(new URL("/robots.txt", url), 64 * 1024)) ?? "");
  const sitemapUrls: string[] = [];
  for (const sitemap of [...robots.sitemaps, new URL("/sitemap.xml", url).toString()].slice(0, 4)) {
    let target: URL;
    try { target = new URL(sitemap, url); } catch { continue; }
    if (target.origin !== url.origin) continue;
    const xml = await fetchText(target, 1024 * 1024);
    if (xml === null) continue;
    const parsed = parseSitemap(xml);
    if (!parsed.isIndex) { sitemapUrls.push(...parsed.urls); break; }
    for (const nested of parsed.urls.slice(0, 3)) {
      let nestedUrl: URL;
      try { nestedUrl = new URL(nested, url); } catch { continue; }
      if (nestedUrl.origin !== url.origin) continue;
      const nestedXml = await fetchText(nestedUrl, 1024 * 1024);
      if (nestedXml !== null) sitemapUrls.push(...parseSitemap(nestedXml).urls);
    }
    break;
  }
  const discovery = discoverPages({ base: url, homepageHtml: html, sitemapUrls: sitemapUrls.slice(0, 500), robots, limit: pageLimit });
  const pageSource = new Map<string, (typeof discovery.selected)[number]["source"]>([[url.toString(), "entry"]]);
  const extractedKeys = new Set([canonicalPagePath(url.toString(), url) ?? "/"]);
  const failedPages: { path: string; source: (typeof discovery.selected)[number]["source"]; reason: "fetch_failed" | "robots" | "budget" }[] = [];

  const remainingCandidates = discovery.selected.slice(1);
  for (const [index, candidate] of remainingCandidates.entries()) {
    throwIfAcquisitionAborted(signal);
    // Keep room in the aggregate budget for stylesheets; later pages are recorded instead of fetched.
    if (totalDownloadedBytes > MAX_TOTAL_DOWNLOAD_BYTES * 0.6) {
      for (const skipped of remainingCandidates.slice(index)) failedPages.push({ ...skipped, reason: "budget" });
      notes.push(`Stopped page discovery at ${pageHtmlByUrl.size} pages to stay within the download budget.`);
      break;
    }
    const page = new URL(candidate.fetchPath, url);
    try {
      const pageFetch = await fetchWebsiteResource(page, {
        maxBytes: MAX_HTML_BYTES,
        kind: "html",
        noteBytes,
        signal,
        userAgent: `BurnGuard/${APP_VERSION} design-system-import`,
        allowedOrigin: url.origin,
        allowsPath: robots.allows,
      });
      // A redirect may land on a page that is already extracted.
      const finalKey = canonicalPagePath(pageFetch.finalUrl.toString(), url);
      if (finalKey === null || extractedKeys.has(finalKey)) continue;
      extractedKeys.add(finalKey);
      pageSource.set(pageFetch.finalUrl.toString(), candidate.source);
      const storedPageHtml = sanitizeAcquiredWebsiteHtml(pageFetch.text);
      pageHtmlByUrl.set(pageFetch.finalUrl.toString(), pageFetch.text);
      const fileName = `page-${pageHtmlByUrl.size}.html`;
      await writeFile(path.join(pagesDir, fileName), storedPageHtml, "utf8");
    } catch (error) {
      if (error instanceof ExtractionAcquisitionError || isBudgetExhausted(error)) throw error;
      if (error instanceof ExcludedPathError) { failedPages.push({ ...candidate, reason: "robots" }); continue; }
      failedPages.push({ ...candidate, reason: "fetch_failed" });
      notes.push(`Skipped linked page: ${page.toString()} (${error instanceof Error ? error.message : "fetch failed"})`);
    }
  }
  const pageDeclarations = new Map<string, CssDeclarationEvidence[]>();
  const stylesheetDeclarations = new Map<string, readonly CssDeclarationEvidence[]>();

  const componentSamples = {
    buttons: [] as string[],
    cards: [] as string[],
    forms: [] as string[],
    tables: [] as string[],
    badges: [] as string[],
    headings: [] as string[],
    body: [] as string[],
  };
  const seenStylesheets = new Set<string>();
  const stylesheetText = new Map<string, string>();
  let stylesheetIndex = 1;

  for (const [pageUrl, pageHtml] of pageHtmlByUrl) {
    throwIfAcquisitionAborted(signal);
    const ownDeclarations: CssDeclarationEvidence[] = [];
    pageDeclarations.set(pageUrl, ownDeclarations);
    // Page-local cascade order: this page's linked sheets in link order, then its inline styles, so a
    // stylesheet cached from another page never carries that page's order into this one.
    const root = parse(pageHtml);
    // Document order of <style> blocks and stylesheet links decides which one wins for this page.
    const cascadeNodes = root.querySelectorAll("*").filter((node) => node.tagName === "STYLE" || (node.tagName === "LINK" && (node.getAttribute("rel") ?? "").toLowerCase() === "stylesheet"));
    const cascadeOrder = (node: unknown) => { const index = cascadeNodes.indexOf(node as (typeof cascadeNodes)[number]); return index === -1 ? cascadeNodes.length : index; };
    const withOrder = (declarations: readonly CssDeclarationEvidence[], order: number) => declarations.map((declaration) => ({ ...declaration, fileOrder: order }));
    let currentLinkOrder = 0;
    const addLinked = (declarations: readonly CssDeclarationEvidence[]) => { ownDeclarations.push(...withOrder(declarations, currentLinkOrder)); };
    throwIfAcquisitionAborted(signal);
    const sampleSet = extractHtmlComponentSamples(pageHtml, signal);
    mergeStringSamples(componentSamples.buttons, sampleSet.buttons, 6);
    mergeStringSamples(componentSamples.cards, sampleSet.cards, 6);
    mergeStringSamples(componentSamples.forms, sampleSet.forms, 6);
    mergeStringSamples(componentSamples.tables, sampleSet.tables, 6);
    mergeStringSamples(componentSamples.badges, sampleSet.badges, 6);
    mergeStringSamples(componentSamples.headings, sampleSet.headings, 6);
    mergeStringSamples(componentSamples.body, sampleSet.body, 6);

    const pageSourceUrl = new URL(pageUrl);
    const pageSourceId = isOwnedQaAdapterResourceUrl(pageSourceUrl) ? `qa-adapter:${pageSourceUrl.pathname}` : pageUrl;
    // Parse each bounded style block once: joining a page's blocks can exceed the CSS parser's
    // per-input limit even when every individual block is valid.
    for (const style of root.querySelectorAll("style")) {
      const block = await parseCssSource({ content: style.textContent, sourceId: `${pageSourceId}#style`, fileOrder: cssFileOrder, signal });
      cssFileOrder += 1;
      cssDeclarations.push(...block.declarations);
      cssParseIssues.push(...block.issues);
      ownDeclarations.push(...withOrder(block.declarations, cascadeOrder(style)));
      mergeSignals({ colors, fontSizes, fontWeights, spacingValues, radii, shadows }, styleSignalsFromDeclarations(block.declarations));
      for (const family of fontFamiliesFromDeclarations(block.declarations)) fontFamilies.add(family);
    }
    // Newlines are CSS whitespace; flatten them so the worker's single-line value check keeps multiline attributes.
    // Each attribute ends with ";" so a last declaration without one cannot run into the next attribute.
    const attributes = root.querySelectorAll("[style]").map((node) => (node.getAttribute("style") ?? "").replaceAll("\n", " ")).filter(Boolean).join(";\n");
    if (attributes) {
      const parsed = await parseCssSource({ content: attributes, sourceId: `${pageSourceId}#style-attribute`, fileOrder: cssFileOrder, signal });
      cssFileOrder += 1;
      cssDeclarations.push(...parsed.declarations);
      cssParseIssues.push(...parsed.issues);
      ownDeclarations.push(...withOrder(parsed.declarations, cascadeNodes.length + 1));
      mergeSignals({ colors, fontSizes, fontWeights, spacingValues, radii, shadows }, styleSignalsFromDeclarations(parsed.declarations));
      for (const family of fontFamiliesFromDeclarations(parsed.declarations)) fontFamilies.add(family);
    }

    const pageBase = new URL(pageUrl);
    const links = root.querySelectorAll('link[rel="stylesheet"]');
    for (let idx = 0; idx < links.length; idx += 1) {
      throwIfAcquisitionAborted(signal);
      const href = links[idx].getAttribute("href");
      if (!href) continue;
      currentLinkOrder = cascadeOrder(links[idx]);
      try {
        const cssUrl = new URL(href, pageBase);
        if (cssUrl.origin !== url.origin) {
          notes.push(`Skipped cross-origin stylesheet: ${href}`);
          continue;
        }
        // A stylesheet shared by several pages is fetched and parsed once but counts for every page.
        const cached = stylesheetDeclarations.get(cssUrl.toString());
        if (cached) { addLinked(cached); continue; }
        const cssFetch = await fetchWebsiteResource(cssUrl, {
          maxBytes: MAX_CSS_BYTES,
          kind: "css",
          noteBytes,
          signal,
          userAgent: `BurnGuard/${APP_VERSION} design-system-import`,
        });
        const seenDeclarations = stylesheetDeclarations.get(cssFetch.finalUrl.toString());
        if (seenStylesheets.has(cssFetch.finalUrl.toString())) { addLinked(seenDeclarations ?? []); continue; }
        seenStylesheets.add(cssFetch.finalUrl.toString());
        const cssText = cssFetch.text;
        stylesheetText.set(cssUrl.toString(), cssText);
        stylesheetText.set(cssFetch.finalUrl.toString(), cssText);
        const fileName = `linked-${stylesheetIndex}.css`;
        stylesheetIndex += 1;
        const absolute = path.join(uploadsDir, fileName);
        await writeFile(absolute, cssText, "utf8");
        const cssSourceId = isOwnedQaAdapterResourceUrl(cssFetch.finalUrl) ? `qa-adapter:${cssFetch.finalUrl.pathname}` : cssFetch.finalUrl.toString();
        // Only same-origin stylesheets linked from the page are fetched; @import targets are recorded, not followed.
        const imports = [...cssText.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)].map((match) => match[1]).slice(0, 8);
        if (imports.length > 0) notes.push(`Skipped @import in ${cssSourceId}: ${imports.join(", ")}`);
        const parsedCss = await parseCssSource({ content: cssText, sourceId: cssSourceId, fileOrder: cssFileOrder, signal });
        cssFileOrder += 1;
        cssDeclarations.push(...parsedCss.declarations);
        addLinked(parsedCss.declarations);
        stylesheetDeclarations.set(cssUrl.toString(), parsedCss.declarations);
        stylesheetDeclarations.set(cssFetch.finalUrl.toString(), parsedCss.declarations);
        cssParseIssues.push(...parsedCss.issues);
        mergeSignals(
          { colors, fontSizes, fontWeights, spacingValues, radii, shadows },
          styleSignalsFromDeclarations(parsedCss.declarations),
        );
        for (const family of fontFamiliesFromDeclarations(parsedCss.declarations)) {
          fontFamilies.add(family);
        }
      } catch (error) {
        if (error instanceof ExtractionAcquisitionError || isBudgetExhausted(error)) throw error;
        notes.push(`Skipped linked stylesheet: ${href} (${error instanceof Error ? error.message : "fetch failed"})`);
      }
    }

    const images = root.querySelectorAll("img");
    assertAssetCount(images.length);
    for (const image of images) {
      throwIfAcquisitionAborted(signal);
      const src = image.getAttribute("src");
      if (!src || !/logo|brand/i.test(src)) continue;
      try {
        const logoUrl = new URL(src, pageBase);
        const dedupedName = safeFileName(
          path.basename(logoUrl.pathname) || "logo.png",
        );
        if (logoFiles.some((logo) => logo.fileName === dedupedName)) continue;
        const logoFetch = await fetchWebsiteResource(logoUrl, {
          maxBytes: MAX_LOGO_BYTES,
          kind: "asset",
          noteBytes,
          signal,
          userAgent: `BurnGuard/${APP_VERSION} design-system-import`,
        });
        assetBytes += logoFetch.buffer.byteLength;
        assertAggregateAssetBytes(assetBytes);
        const absolutePath = path.join(websiteDir, dedupedName);
        await writeFile(absolutePath, logoFetch.buffer);
        logoFiles.push({ absolutePath, fileName: dedupedName });
      } catch (error) {
        if (error instanceof ExtractionAcquisitionError || isBudgetExhausted(error)) throw error;
        notes.push(`Skipped logo candidate: ${src} (${error instanceof Error ? error.message : "fetch failed"})`);
      }
    }
  }

  // Opening-region media of the entry page: images before the first h2/h3 become hero assets; script-drawn
  // canvases cannot be captured statically, so only their presence is recorded.
  const heroImages: Array<{ absolutePath: string; fileName: string }> = [];
  const opening = openingRegionMedia(html);
  for (const src of opening.images.slice(0, 2)) {
    throwIfAcquisitionAborted(signal);
    try {
      const heroUrl = new URL(src, url);
      const fileName = safeFileName(path.basename(heroUrl.pathname) || "hero.png");
      // Names that differ only by case are one file on macOS and Windows, so they are one image everywhere.
      if (heroImages.some((image) => image.fileName.toLowerCase() === fileName.toLowerCase())) continue;
      const heroFetch = await fetchWebsiteResource(heroUrl, { maxBytes: MAX_LOGO_BYTES, kind: "asset", noteBytes, signal, userAgent: `BurnGuard/${APP_VERSION} design-system-import` });
      assetBytes += heroFetch.buffer.byteLength;
      assertAggregateAssetBytes(assetBytes);
      const absolutePath = path.join(websiteDir, `hero-${fileName}`);
      await writeFile(absolutePath, heroFetch.buffer);
      heroImages.push({ absolutePath, fileName });
    } catch (error) {
      if (error instanceof ExtractionAcquisitionError || isBudgetExhausted(error)) throw error;
      notes.push(`Skipped hero image: ${src} (${error instanceof Error ? error.message : "fetch failed"})`);
    }
  }

  if (componentSamples.buttons.length > 0) {
    notes.push(
      `Detected component candidates: ${componentSamples.buttons.length} buttons, ${componentSamples.cards.length} cards, ${componentSamples.forms.length} forms.`,
    );
  }
  if (fontSizes.size > 0 || colors.size > 0) {
    notes.push(
      `Style signals extracted from website CSS/HTML: ${colors.size} colors, ${fontSizes.size} font sizes, ${spacingValues.size} spacing values.`,
    );
  }

  // The entry page plus the first page of each other type is rendered offline and measured.
  const measurable: MeasuredPageInput[] = [];
  for (const [pageUrl, pageHtml] of pageHtmlByUrl) {
    const pagePath = canonicalPagePath(pageUrl, url) ?? "/";
    const pageType = classifyPageType(pagePath, pageHtml);
    if (measurable.length === 0 || (measurable.length < MEASURED_PAGE_LIMIT && !measurable.some((page) => page.pageType === pageType))) measurable.push({ path: pagePath, pageType, url: pageUrl, html: pageHtml });
  }
  const shots: LayoutReferenceCapture[] = [];
  const captureReference = (shot: LayoutReferenceCapture) => { if (shot.jpeg.byteLength <= MAX_LAYOUT_REFERENCE_BYTES) shots.push(shot); };
  const measurement = measureLayout ? await measureWithDeadline(measureLayout, { pages: measurable, stylesheets: stylesheetText, signal, captureReference }, deadlineAt) : null;
  const measuredLayout = measurement?.layout ?? null;
  if (measurement && measuredLayout === null) notes.push(`Rendered layout measurement was unavailable (reason: ${measurement.unavailableReason ?? "unknown"}); measured layout tokens were not recorded.`);
  else if (measuredLayout && measuredLayout.pages.length < measurable.length) notes.push(`Rendered layout measurement reached its deadline after ${measuredLayout.pages.length} of ${measurable.length} pages; the remaining pages were not measured.`);
  // A screenshot of a page that did not make it into the measured layout has nothing to be paired with.
  const layoutReferenceShots = measuredLayout ? shots.filter((shot) => measuredLayout.pages.some((page) => page.path === shot.path)) : [];
  if (measuredLayout && layoutReferenceShots.length < measuredLayout.pages.length * 2) notes.push(`Layout reference screenshots were captured for ${layoutReferenceShots.length} of ${measuredLayout.pages.length * 2} measured page views.`);

  return {
    measuredLayout,
    layoutReferenceShots,
    brandName: preferredName?.trim() || deriveBrandNameFromHtml(url, html),
    cssDeclarations,
    cssParseIssues,
    cssVars: selectCssCustomProperties(cssDeclarations),
    fontFamilies: [...fontFamilies],
    colors: [...colors],
    fontSizes: [...fontSizes],
    fontWeights: [...fontWeights],
    spacingValues: [...spacingValues],
    radii: [...radii],
    shadows: [...shadows],
    borders: [...new Set(cssDeclarations.filter((item) => item.property === "border" || item.property.startsWith("border-")).map((item) => item.value))],
    notes,
    logoFiles: logoFiles.slice(0, 8),
    uiKitFiles: [...pageHtmlByUrl.keys()].map((_pageUrl, index) => ({
      absolutePath:
        index === 0
          ? path.join(websiteDir, "index.html")
          : path.join(pagesDir, `page-${index + 1}.html`),
      fileName: index === 0 ? "index.html" : `page-${index + 1}.html`,
    })),
    rawFiles: [
      "uploads/source-url.txt",
      "uploads/source.html",
      "uploads/extraction-report.json",
      "uploads/pages/",
      "uploads/linked-css/",
    ],
    homepageHtml: storedHomepageHtml,
    fetchedPageCount: pageHtmlByUrl.size,
    componentSamples,
    artifactCopies: [],
    // Read before sanitization strips image sources; only typed counts and flags leave this scope.
    sourceEvidence: collectSourceEvidence([...pageHtmlByUrl.values()], cssDeclarations),
    heroAssets: { images: heroImages, canvases: opening.canvases },
    pageColors: {
      ...pageGroundAndInk(pageDeclarations.get(url.toString()) ?? []),
      // The entry page carries the brand; counting every acquired page lets article or demo pages outvote it.
      accent: mostUsedAccent(pageDeclarations.get(url.toString()) ?? [], selectCssCustomProperties(cssDeclarations)),
    },
    pageCoverage: buildPageCoverage({
      limit: pageLimit,
      discovered: discovery.discovered,
      extracted: [...pageHtmlByUrl].map(([pageUrl, pageHtml]) => {
        const path = canonicalPagePath(pageUrl, url) ?? "/";
        const declarations = pageDeclarations.get(pageUrl) ?? [];
        const signals = styleSignalsFromDeclarations(declarations);
        const evidence = collectSourceEvidence([pageHtml], declarations);
        const customProperties = Object.fromEntries([...selectCssCustomProperties(declarations)]
          .map(([name, value]) => [`--${name}`, value.trim()] as const)
          .filter(([name, value]) => /^--[a-zA-Z0-9_-]{1,80}$/.test(name) && value.length > 0 && value.length <= 160 && !/[<>]|url\s*\(/i.test(value) && !/\p{Cc}/u.test(value))
          .slice(0, 48));
        return {
          path,
          source: pageSource.get(pageUrl) ?? "link",
          pageType: classifyPageType(path, pageHtml),
          layoutTokens: measureSourceLayout(declarations, signals.spacingValues).tokens,
          patterns: observedPatterns(evidence),
          colors: pageColorRoles(declarations),
          fonts: fontFamiliesFromDeclarations(declarations).slice(0, 3),
          customProperties,
          evidence: pageEvidence(evidence),
        };
      }),
      skipped: [
        ...discovery.skipped.map((page) => ({ ...page, pageType: classifyPageType(page.path, "") })),
        ...failedPages.map((page) => ({ ...page, pageType: classifyPageType(page.path, "") })),
      ],
    }),
  };
}

/**
 * Pulls published color + text styles from a Figma file via the REST API
 * and packages them into the same SourceAnalysis shape that the github
 * and website ingests use, so the rest of the pipeline (writeCanonical-
 * DesignSystem, etc.) is unchanged. Reads the PAT from
 * ~/.burnguard/config.json.
 *
 * Out of scope at MVP: effect / grid styles, component thumbnail
 * download as logos, and image asset extraction (those need image
 * exports which require an extra Playwright-grade fetch loop).
 */
async function ingestFigmaSource(
  sourceUrl: string,
  ingestDir: string,
  signal: AbortSignal,
  preferredName?: string,
): Promise<SourceAnalysis> {
  void ingestDir;
  const config = await loadConfig();
  const token = config.figmaPersonalAccessToken;
  if (!token || token.trim().length === 0) {
    throw new DesignSystemExtractError(
      "figma_token_missing",
      'Figma personal access token is not set. Add it in Settings → "Figma access" then re-run the import.',
    );
  }

  let fileKey: string;
  try {
    fileKey = parseFigmaUrl(sourceUrl).fileKey;
  } catch (err) {
    if (err instanceof FigmaApiError) {
      throw new DesignSystemExtractError("invalid_source_url", err.message);
    }
    throw err;
  }

  try {
    const meta = await fetchFigmaFileMeta(fileKey, token, signal);
    const styles = await fetchFigmaPublishedStyles(fileKey, token, signal);
    const nodes = await fetchFigmaNodes(
      fileKey,
      styles.map((s) => s.nodeId),
      token,
      signal,
    );
    const tokens = extractFigmaTokens(styles, nodes, { signal });

    const cssVars = new Map<string, string>();
    for (const [name, hex] of tokens.colors) {
      cssVars.set(name, `#${hex}`);
    }

    const colors = [...tokens.colors.values()].map((hex) => `#${hex}`);
    const fontSizes: string[] = [];
    const fontWeights: string[] = [];
    for (const ts of tokens.textStyles) {
      if (typeof ts.fontSizePx === "number") fontSizes.push(`${ts.fontSizePx}px`);
      if (typeof ts.fontWeight === "number") fontWeights.push(String(ts.fontWeight));
    }

    const brandName =
      preferredName?.trim() || meta.name?.trim() || `Figma file ${fileKey}`;

    const notes: string[] = [
      `Imported from Figma file "${meta.name}" (key=${fileKey}, lastModified=${meta.lastModified}).`,
      `${tokens.colors.size} color token(s) and ${tokens.textStyles.length} text style(s) extracted from ${styles.length} published style(s).`,
    ];
    if (tokens.colors.size === 0 && tokens.textStyles.length === 0) {
      notes.push(
        "No published styles found — make sure the file's color / text styles are published to your team library, then re-run the import.",
      );
    }

    return {
      brandName,
      cssDeclarations: [],
      cssParseIssues: [],
      cssVars,
      fontFamilies: tokens.fontFamilies,
      colors,
      fontSizes: dedupeOrderedStrings(fontSizes),
      fontWeights: dedupeOrderedStrings(fontWeights),
      spacingValues: [],
      radii: [],
      shadows: [],
      borders: [],
      notes,
      logoFiles: [],
      uiKitFiles: [],
      rawFiles: [],
      homepageHtml: null,
      fetchedPageCount: 0,
      componentSamples: {
        buttons: [],
        cards: [],
        forms: [],
        tables: [],
        badges: [],
        headings: [],
        body: [],
      },
      artifactCopies: [],
    };
  } catch (err) {
    if (err instanceof DesignSystemExtractError || err instanceof ExtractionAcquisitionError || err instanceof AcquisitionLimitError) throw err;
    if (err instanceof FigmaApiError) {
      throw new DesignSystemExtractError(
        "figma_fetch_failed",
        err.message,
      );
    }
    throw new DesignSystemExtractError(
      "figma_fetch_failed",
      err instanceof Error ? err.message : String(err),
    );
  }
}

function dedupeOrderedStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

async function ingestUploadSource(input: {
  ingestDir: string;
  sourcePath: string;
  sourceFileName: string;
  uploadKind: SupportedUploadKind;
  preferredName?: string;
  signal: AbortSignal;
}): Promise<SourceAnalysis> {
  const manifestPath = path.join(input.ingestDir, "upload-manifest.json");
  await runPythonUploadExtractor({
    sourcePath: input.sourcePath,
    manifestPath,
    signal: input.signal,
  });

  let manifest: UploadManifest;
  try {
    manifest = await readUploadManifest(manifestPath, input.signal);
  } catch (error) {
    if (error instanceof ExtractionUploadManifestError) {
      throw new DesignSystemExtractError("upload_extract_failed", error.message);
    }
    throw error;
  }
  if (manifest.kind !== input.uploadKind) {
    throw new DesignSystemExtractError(
      "upload_extract_failed",
      `Upload parser returned ${manifest.kind} for a ${input.uploadKind} file`,
    );
  }

  const uiKitDir = path.join(input.ingestDir, "ui-kit");
  const uiKitFiles = await buildUploadUiKitFiles({
    uiKitDir,
    brandName:
      input.preferredName?.trim() ||
      manifest.brand_name?.trim() ||
      humanizeSlug(path.basename(input.sourceFileName, path.extname(input.sourceFileName))),
    pages: manifest.pages,
  });

  const notes = [
    `Token-optimized ${manifest.kind.toUpperCase()} upload summary generated via Python extractor.`,
    `Parsed ${manifest.page_count} page(s)/slide(s) from upload.`,
    ...manifest.notes,
  ];
  if (manifest.page_count > MAX_UPLOAD_UI_KIT_PAGES) {
    notes.push(
      `Only the first ${MAX_UPLOAD_UI_KIT_PAGES} of ${manifest.page_count} pages are kept as preview cards; re-upload a trimmed export if you need more.`,
    );
  }

  return {
    brandName:
      input.preferredName?.trim() ||
      manifest.brand_name?.trim() ||
      humanizeSlug(path.basename(input.sourceFileName, path.extname(input.sourceFileName))),
    cssDeclarations: [],
    cssParseIssues: [],
    cssVars: new Map<string, string>(),
    fontFamilies: normalizeUploadStringList(manifest.fonts, 8),
    colors: normalizeUploadStringList(manifest.colors, 24),
    fontSizes: normalizeUploadStringList(manifest.font_sizes, 16),
    fontWeights: normalizeUploadStringList(manifest.font_weights, 12),
    spacingValues: normalizeUploadStringList(manifest.spacing_values, 24),
    radii: normalizeUploadStringList(manifest.radii, 12),
    shadows: normalizeUploadStringList(manifest.shadows, 12),
    borders: [],
    notes,
    logoFiles: [],
    uiKitFiles,
    rawFiles: [
      `uploads/${safeFileName(input.sourceFileName)}`,
      "uploads/upload-manifest.json",
      ...uiKitFiles.map((file) => `ui_kits/website/${safeFileName(file.fileName)}`),
    ],
    homepageHtml: null,
    fetchedPageCount: manifest.page_count,
    componentSamples: detectComponentSamples(
      manifest.headings,
      manifest.bodies,
      manifest.misc_lines,
    ),
    artifactCopies: [
      {
        absolutePath: input.sourcePath,
        relPath: path.join("uploads", safeFileName(input.sourceFileName)),
      },
      {
        absolutePath: manifestPath,
        relPath: path.join("uploads", "upload-manifest.json"),
      },
    ],
  };
}

export async function runPythonUploadExtractor(input: {
  sourcePath: string;
  manifestPath: string;
  signal?: AbortSignal;
}) {
  // Write the embedded Python source to a per-call tmp dir so the
  // script path resolves cleanly in dev AND inside a `bun build
  // --compile` binary (where `resolveRepoRoot()` has no source tree
  // to point at). Self-contained so multiple callers — including the
  // chat-attachment pipeline that runs extractions in parallel — don't
  // race on a shared scratch location.
  const scriptDir = await mkdtemp(path.join(tmpdir(), "burnguard-ds-py-"));
  try {
    const scriptPath = path.join(scriptDir, "extract.py");
    await writeFile(scriptPath, UPLOAD_EXTRACTOR_PY, "utf8");
    const candidates = pythonCandidates();

    let lastFailure = "Python executable was not found";
    for (const prefix of candidates) {
      try {
        const owned = spawnOwnedProcess({
          cmd: [
            ...prefix,
            scriptPath,
            "--input",
            input.sourcePath,
            "--output",
            input.manifestPath,
          ],
          stdout: "pipe",
          stderr: "pipe",
          stdin: "ignore",
        });
        const proc = owned.proc;
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          input.signal === undefined
            ? proc.exited.then(async (code) => { await settleOwnedProcess(owned, code); return code; })
            : awaitChildWithAbort(owned, input.signal).then((receipt) => receipt.exitCode),
        ]);
        if (exitCode === 0) {
          return;
        }
        lastFailure = [stderr.trim(), stdout.trim()]
          .filter(Boolean)
          .join("\n")
          .trim() || `Python extractor exited with code ${exitCode}`;
        // The command existed but the extractor failed; don't mask it
        // with later fallbacks.
        break;
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
      }
    }

    throw new DesignSystemExtractError(uploadFailureCode(lastFailure), lastFailure);
  } finally {
    await rm(scriptDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function buildUploadUiKitFiles(input: {
  uiKitDir: string;
  brandName: string;
  pages: UploadManifestPage[];
}) {
  await mkdir(input.uiKitDir, { recursive: true });
  const files: Array<{ absolutePath: string; fileName: string }> = [];
  const pages =
    input.pages.length > 0
      ? input.pages.slice(0, MAX_UPLOAD_UI_KIT_PAGES)
      : [
          {
            index: 1,
            title: `${input.brandName} upload`,
            summary: "No structured page previews were recovered from the upload.",
            text_excerpt:
              "The canonical draft was still created, but this upload needs manual review.",
          },
        ];

  for (const page of pages) {
    const fileName = `page-${page.index}.html`;
    const absolutePath = path.join(input.uiKitDir, fileName);
    await writeFile(
      absolutePath,
      buildUploadPageHtml(input.brandName, page),
      "utf8",
    );
    files.push({ absolutePath, fileName });
  }

  return files;
}

function buildUploadPageHtml(brandName: string, page: UploadManifestPage): string {
  const title = escapeHtml(page.title || `Page ${page.index}`);
  const summary = escapeHtml(page.summary || "Token-optimized upload summary");
  const excerpt = escapeHtml(page.text_excerpt || "No compact excerpt was available.");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(brandName)} upload preview</title>
  <style>
    :root {
      --bg: #f6f7fb;
      --card: #ffffff;
      --fg: #111827;
      --muted: #6b7280;
      --border: rgba(17, 24, 39, 0.12);
      --accent: #2563eb;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top right, rgba(37,99,235,0.14), transparent 34%),
        var(--bg);
      color: var(--fg);
      padding: 24px;
    }
    .card {
      max-width: 960px;
      margin: 0 auto;
      border: 1px solid var(--border);
      border-radius: 20px;
      background: var(--card);
      padding: 28px;
      box-shadow: 0 20px 60px rgba(15, 23, 42, 0.08);
    }
    .eyebrow {
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--accent);
      font-weight: 700;
    }
    h1 {
      margin: 10px 0 8px;
      font-size: 32px;
      line-height: 1.1;
    }
    p {
      margin: 0;
      color: var(--muted);
      line-height: 1.65;
    }
    .excerpt {
      margin-top: 22px;
      white-space: pre-wrap;
      border-top: 1px solid var(--border);
      padding-top: 18px;
      color: var(--fg);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="eyebrow">Upload preview · Page ${page.index}</div>
    <h1>${title}</h1>
    <p>${summary}</p>
    <p class="excerpt">${excerpt}</p>
  </div>
</body>
</html>`;
}

async function writeCanonicalDesignSystem(input: {
  systemDir: string;
  systemId: string;
  brandName: string;
  sourceType: SupportedExtractionSource;
  sourceUrl: string;
  lineage: NonNullable<CreateDesignSystemExtractionRequest["lineage"]> | null;
  analysis: SourceAnalysis;
  signal: AbortSignal;
}): Promise<CanonicalWriteResult> {
  throwIfAcquisitionAborted(input.signal);
  const generated = new Set<string>();
  const measuredLayout = measureSourceLayout(input.analysis.cssDeclarations, input.analysis.spacingValues).tokens;
  const layoutTokens = { ...DEFAULT_LAYOUT_TOKENS, ...measuredLayout };
  const fontsDir = path.join(input.systemDir, "fonts");
  const logosDir = path.join(input.systemDir, "assets", "logos");
  const previewDir = path.join(input.systemDir, "preview");
  const uiKitDir = path.join(input.systemDir, "ui_kits", "website");
  const uploadsDir = path.join(input.systemDir, "uploads");
  await Promise.all([
    mkdir(fontsDir, { recursive: true }),
    mkdir(logosDir, { recursive: true }),
    mkdir(previewDir, { recursive: true }),
    mkdir(uiKitDir, { recursive: true }),
    mkdir(uploadsDir, { recursive: true }),
  ]);
  throwIfAcquisitionAborted(input.signal);

  await writeText(
    path.join(input.systemDir, "README.md"),
    buildReadme(input.brandName, input.sourceType, input.sourceUrl, input.analysis, layoutTokens, input.analysis.sourceEvidence ?? collectSourceEvidence([], input.analysis.cssDeclarations)) + DERIVED_SURFACE_README_SECTIONS,
    generated,
    input.systemDir,
  );
  if (input.analysis.measuredLayout) await writeText(path.join(input.systemDir, "layout-measured.json"), `${JSON.stringify(input.analysis.measuredLayout, null, 2)}\n`, generated, input.systemDir);
  if (input.analysis.measuredLayout && (input.analysis.layoutReferenceShots ?? []).length > 0) await writeLayoutReference(input.systemDir, input.analysis.measuredLayout, input.analysis.layoutReferenceShots ?? [], generated, input.analysis.notes, input.analysis.heroAssets?.images ?? []);
  if (input.analysis.pageCoverage) {
    // Publish only what the strict reader accepts, so a malformed record can never make the system unreadable.
    let coverage: DesignSystemPageCoverage | null = null;
    try { coverage = parseDesignSystemPageCoverage(JSON.parse(JSON.stringify(input.analysis.pageCoverage))); }
    catch { input.analysis.notes.push("Per-page coverage was omitted because it did not pass validation."); }
    if (coverage) await writeText(path.join(input.systemDir, "pages.json"), `${JSON.stringify(coverage, null, 2)}\n`, generated, input.systemDir);
  }
  await writeText(
    path.join(input.systemDir, "SKILL.md"),
    buildSkill(input.brandName),
    generated,
    input.systemDir,
  );
  await writeText(
    path.join(input.systemDir, "colors_and_type.css"),
    buildTokensCss(input.brandName, input.analysis, layoutTokens),
    generated,
    input.systemDir,
  );
  for (const surface of DESIGN_SURFACES) {
    await writeText(
      path.join(input.systemDir, DESIGN_SURFACE_FILES[surface].split("/").join(path.sep)),
      renderDerivedSurfaceCss(surface),
      generated,
      input.systemDir,
    );
  }
  await writeText(
    path.join(fontsDir, "fonts.css"),
    buildFontsCss(fontRoles(input.analysis)),
    generated,
    input.systemDir,
  );
  await writeText(
    path.join(uiKitDir, "README.md"),
    buildUiKitReadme(input.brandName, input.sourceType, input.sourceUrl),
    generated,
    input.systemDir,
  );
  await writeText(
    path.join(uploadsDir, "source-url.txt"),
    `${input.sourceUrl}\n`,
    generated,
    input.systemDir,
  );
  const provenance = buildExtractionProvenance(input.analysis.discoveries ?? discoveriesFromAnalysis({
    cssDeclarations: input.analysis.cssDeclarations,
    cssParseIssues: input.analysis.cssParseIssues,
    cssVars: input.analysis.cssVars,
    fontFamilies: input.analysis.fontFamilies,
    colors: input.analysis.colors,
    fontSizes: input.analysis.fontSizes,
    fontWeights: input.analysis.fontWeights,
    spacingValues: input.analysis.spacingValues,
    radii: input.analysis.radii,
    shadows: input.analysis.shadows,
    borders: input.analysis.borders,
    assets: input.analysis.logoFiles.map((item) => `assets/logos/${safeFileName(item.fileName)}`),
    components: input.analysis.componentSamples,
    layout: measuredLayout,
  }), Date.now(), input.lineage);
  await writeText(
    path.join(input.systemDir, "extraction-provenance.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
    generated,
    input.systemDir,
  );
  await writeText(
    path.join(uploadsDir, "extraction-report.json"),
    JSON.stringify(
        {
          system_id: input.systemId,
          brand_name: input.brandName,
        source_type: input.sourceType,
          source_url: input.sourceUrl,
          detected_css_vars: [...input.analysis.cssVars.entries()],
          detected_font_families: input.analysis.fontFamilies,
          detected_colors: input.analysis.colors,
          detected_font_sizes: input.analysis.fontSizes,
          detected_spacing_values: input.analysis.spacingValues,
          detected_radii: input.analysis.radii,
          detected_shadows: input.analysis.shadows,
          component_samples: input.analysis.componentSamples,
          fetched_page_count: input.analysis.fetchedPageCount,
          notes: input.analysis.notes,
        },
      null,
      2,
    ),
    generated,
    input.systemDir,
  );

  if (input.analysis.homepageHtml) {
    await writeText(
      path.join(uploadsDir, "source.html"),
      input.analysis.homepageHtml,
      generated,
      input.systemDir,
    );
  }

  for (const artifact of input.analysis.artifactCopies) {
    throwIfAcquisitionAborted(input.signal);
    const normalizedRelPath = artifact.relPath.replaceAll("\\", "/");
    const dest = path.join(input.systemDir, normalizedRelPath);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(artifact.absolutePath, dest);
    generated.add(toSystemRelPath(input.systemDir, dest));
  }

  for (const fileId of PREVIEW_FILE_IDS) {
    throwIfAcquisitionAborted(input.signal);
    await writeText(
      path.join(previewDir, `${fileId}.html`),
      buildPreviewHtml(fileId, input.brandName, input.analysis),
      generated,
      input.systemDir,
    );
  }

  if (input.analysis.uiKitFiles.length === 0) {
    await writeText(
      path.join(uiKitDir, "index.html"),
      buildUiKitPlaceholderHtml(input.brandName),
      generated,
      input.systemDir,
    );
  } else {
    for (const file of input.analysis.uiKitFiles.slice(0, MAX_UPLOAD_UI_KIT_PAGES)) {
      throwIfAcquisitionAborted(input.signal);
      const dest = path.join(uiKitDir, safeFileName(file.fileName));
      if (input.sourceType === "github" && path.extname(dest).toLowerCase() === ".html") {
        await writeFile(dest, sanitizeSourceHtml(await readFile(file.absolutePath, "utf8")), "utf8");
      } else {
        await copyFile(file.absolutePath, dest);
      }
      generated.add(toSystemRelPath(input.systemDir, dest));
    }
  }

  const heroDir = path.join(input.systemDir, "assets", "hero");
  for (const image of input.analysis.heroAssets?.images ?? []) {
    throwIfAcquisitionAborted(input.signal);
    await mkdir(heroDir, { recursive: true });
    const dest = path.join(heroDir, safeFileName(image.fileName));
    await copyFile(image.absolutePath, dest);
    generated.add(toSystemRelPath(input.systemDir, dest));
  }

  for (const logo of input.analysis.logoFiles.slice(0, 8)) {
    throwIfAcquisitionAborted(input.signal);
    const dest = path.join(logosDir, safeFileName(logo.fileName));
    await copyFile(logo.absolutePath, dest);
    generated.add(toSystemRelPath(input.systemDir, dest));
  }

  return { generatedFiles: [...generated].sort(), provenance };
}

function buildReadme(
  brandName: string,
  sourceType: SupportedExtractionSource,
  sourceUrl: string,
  analysis: SourceAnalysis,
  layout: Readonly<Record<string, string>>,
  evidence: SourceEvidence,
): string {
  const { primary, action } = brandColors(analysis);
  const caveats = [
    analysis.cssVars.size === 0
      ? "- No native CSS custom properties were detected. Canonical token defaults were synthesized."
      : "- Canonical token names were synthesized from detected source variables and safe defaults.",
    analysis.logoFiles.length === 0
      ? "- No explicit logo asset was found during ingestion."
      : `- ${analysis.logoFiles.length} logo-like asset(s) were copied into assets/logos.`,
    analysis.fetchedPageCount > 1
      ? `- ${analysis.fetchedPageCount} same-origin pages were analyzed for broader component coverage.`
      : "- Only the landing page was analyzed; deeper site coverage may still be needed.",
    ...(sourceType === "website"
      ? ["- Only same-origin stylesheets linked from the fetched pages were read; cross-origin stylesheets and @import targets are listed below and were not fetched."]
      : []),
    analysis.fontFamilies.length === 0
      ? "- No source font-family declarations were detected; fallback stacks were used."
      : `- Font family candidates detected: ${analysis.fontFamilies.join(", ")}.`,
    analysis.componentSamples.buttons.length === 0 &&
    analysis.componentSamples.cards.length === 0
      ? "- No strong component samples were extracted from the website HTML."
      : `- Extracted component samples: ${analysis.componentSamples.buttons.length} buttons, ${analysis.componentSamples.cards.length} cards, ${analysis.componentSamples.forms.length} forms.`,
    ...analysis.notes.map((note) => `- ${note}`),
  ];

  return `# ${brandName} Design System

## Index
| File | Contents |
|---|---|
| README.md | Brand narrative, rules, caveats |
| SKILL.md | Claude Code compatible brand skill |
| colors_and_type.css | Canonical token file |
| fonts/fonts.css | Font-face and fallback declarations |
| assets/logos/ | Copied logo candidates |
| preview/ | 16 preview cards |
| ui_kits/website/ | Captured or synthesized UI kit files |
| uploads/ | Extraction source records and manifest |

## Brand snapshot
This draft design system was scaffolded from a ${sourceType} source at ${sourceUrl}.
The goal is to normalize raw styles, assets, and component clues into the BurnGuard
canonical format so the system can be reviewed, edited, and later published.

## CONTENT FUNDAMENTALS
- Voice: clear, institutional, confident
- Tone: concise, directive, low-hype
- Casing: title case for headlines, sentence case for body
- Numerals: prefer tabular, data-friendly formatting
- Emoji: avoid by default
- Vibe: premium, trustworthy, structured
- Examples: short headers, restrained claims, evidence-backed labels

## VISUAL FOUNDATIONS
- Colors: use the canonical tokens in colors_and_type.css first
- Type: prefer the detected brand families when available, otherwise use the fallbacks in fonts/fonts.css
- Spacing: 4px grid via --sp-1 through --sp-20
- Backgrounds: flat surfaces with restrained contrast shifts
- Animation: subtle, short, useful only
- Hover: emphasize with contrast and border, not novelty
- Press: compress slightly and darken accent colors
- Borders: clean separators, low visual noise
- Shadows: shallow elevation only
- Layout: modular, grid-first, presentation friendly
- Transparency: minimal and purposeful
- Imagery: editorial, sparse, brand-safe
- Cards: clean surfaces with clear grouping

## ICONOGRAPHY
- Logo lockups live in assets/logos when extraction found them
- UI icons should stay geometric and quiet
- Avoid decorative icon overload or novelty illustration styles

## Layout
Use the ${layout["--layout-columns"]}-column grid, ${layout["--layout-max"]} content maximum, ${layout["--layout-measure"]} reading measure and ${layout["--layout-gutter"]} gutters declared by the --layout-* tokens in colors_and_type.css. Page margins and section rhythm come from --layout-margin and --layout-section-y (${layout["--layout-section-y"]}); --layout-hero is the opening media ratio. Breakpoints: --layout-bp-md ${layout["--layout-bp-md"]}, --layout-bp-lg ${layout["--layout-bp-lg"]}.${layout["--layout-spacing-scale"] ? ` Spacing scale observed in the source: ${layout["--layout-spacing-scale"]} (--layout-spacing-scale); pick component and section spacing from it.` : " Space components on the --sp-* 4px scale."}

## Composition
Open with a restrained hero, follow with aligned evidence rows on flat surfaces, and close with a compact footer. Keep the neutral canvas quiet so the brand and accent tokens carry emphasis.

## Responsive
Below --layout-bp-md stack columns in reading order, keep navigation bounded to the viewport and let labels and actions wrap. At 200% zoom no meaningful text or control may clip. Fixed slide and graphic artboards keep their dimensions and adapt content inside the canvas.

${buildSectionPatternReadme(evidence, { images: (analysis.heroAssets?.images ?? []).map((image) => `assets/hero/${safeFileName(image.fileName)}`), canvases: analysis.heroAssets?.canvases ?? 0 })}${analysis.pageCoverage ? buildPageTemplateReadme(analysis.pageCoverage) : ""}${buildAssetGuideReadme({ brandName, primary, action, colors: analysis.colors, fontFamilies: analysis.fontFamilies, radii: analysis.radii, logoPaths: analysis.logoFiles.slice(0, 8).map((item) => `assets/logos/${safeFileName(item.fileName)}`), evidence })}
## Caveats & substitutions
${caveats.join("\n")}
`;
}

function buildSkill(brandName: string): string {
  const skillName = `${slugify(brandName)}-design`;
  return `---
name: ${skillName}
description: Use this skill to generate ${brandName}-aligned interfaces and artifacts.
user-invocable: true
---

Read README.md first, then apply the visual and content rules from this design system.

## Quick reference
- Tokens: colors_and_type.css
- Fonts: fonts/fonts.css
- Logos: assets/logos/
- Preview cards: preview/
- UI kit: ui_kits/website/
- Layout: README.md Layout, Section patterns and Alignment
- Assets: README.md Asset usage and Asset generation prompts
- Voice: concise, premium, low-hype
- Visual rules: structured layouts, restrained accents, token-first styling
`;
}

const MONOSPACE_FAMILY = /\b(?:mono|monospace|code|courier|consolas|menlo|monaco)\b|sfmono/i;

/** Leading family name of a font-family value, or null when it starts with a function such as var(). */
function leadingFamily(value: string | undefined): string | null {
  const match = /^\s*(?:"([^"(),]+)"|'([^'(),]+)'|([^"'(),]+?))\s*(?:,|$)/.exec(value ?? "");
  return match?.slice(1).find(Boolean)?.trim() || null;
}

/**
 * Font roles from source evidence. Declared Framer body/code families win; otherwise the observed families
 * (collected alphabetically) are split so a monospace family never leads the sans or display stacks.
 */
function fontRoles(analysis: SourceAnalysis): { readonly sans: string; readonly display: string; readonly mono: string } {
  // Observed entries are the text before the first comma, so var() expressions arrive as fragments; only plain names count.
  const families = analysis.fontFamilies.filter((family) => !/[()]/.test(family));
  const text = families.filter((family) => !MONOSPACE_FAMILY.test(family));
  const declaredSans = leadingFamily(analysis.cssVars.get("framer-font-family"));
  const sans = cssString(declaredSans ?? text[0] ?? families[0] ?? "Inter");
  const display = declaredSans !== null ? sans : cssString(text[1] ?? text[0] ?? families[0] ?? "Inter");
  const mono = cssString(leadingFamily(analysis.cssVars.get("framer-code-font-family")) ?? families.find((family) => MONOSPACE_FAMILY.test(family)) ?? "IBM Plex Mono");
  return { sans, display, mono };
}

function buildFontsCss(roles: { readonly sans: string; readonly display: string }): string {
  const preferredSans = roles.sans;
  const preferredDisplay = roles.display;
  return `:root {
  --font-sans-fallback: ${preferredSans}, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-display-fallback: ${preferredDisplay}, ${preferredSans}, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-serif-fallback: "Iowan Old Style", "Times New Roman", serif;
  --font-mono-fallback: "IBM Plex Mono", "Pretendard", monospace;
}
`;
}

const DEFAULT_LAYOUT_TOKENS: Readonly<Record<string, string>> = {
  "--layout-max": "1200px",
  "--layout-measure": "60ch",
  "--layout-columns": "12",
  "--layout-gutter": "24px",
  "--layout-margin": "clamp(20px, 4vw, 64px)",
  "--layout-section-y": "clamp(56px, 8vw, 112px)",
  "--layout-bp-md": "760px",
  "--layout-bp-lg": "1120px",
  "--layout-hero": "16 / 10",
};

/** Mid-tone chromatic colours only: saturated enough to read as a brand hue, neither near-black nor near-white. */
function isAccentHex(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
  return saturation >= 0.35 && lightness >= 0.25 && lightness <= 0.85;
}

const STATE_SELECTOR = /error|invalid|danger|alert|warning|success|disabled|:(?:hover|focus|focus-visible|focus-within|active|visited|disabled|invalid)\b/i;

/** WCAG relative luminance of a six-digit hex colour. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** White or dark ink, whichever contrasts more with the brand fill; white when the fill is not a literal colour. */
function onBrandInk(primary: string, cssVars: ReadonlyMap<string, string>): string {
  const hex = pageHex(resolvedColor(primary, cssVars));
  if (hex === null) return "#ffffff";
  const fill = relativeLuminance(hex);
  const white = 1.05 / (fill + 0.05);
  const dark = (fill + 0.05) / (relativeLuminance("#0f172a") + 0.05);
  return dark > white ? "#0f172a" : "#ffffff";
}

/**
 * The accent a page actually applies most among its mid-tone chromatic colour declarations, preferring
 * colours applied through custom properties. First seen wins ties.
 */
function mostUsedAccent(declarations: readonly CssDeclarationEvidence[], cssVars: ReadonlyMap<string, string>): string | null {
  // Colours applied through custom properties are the site's design tokens; literal colours repeated by an
  // embedded widget or card list would otherwise outvote them, so literals only decide when no token applies.
  const tokens = new Map<string, number>();
  const literals = new Map<string, number>();
  for (const declaration of declarations) {
    if (!["color", "background", "background-color", "border-color", "fill", "stroke"].includes(declaration.property)) continue;
    // Validation, alert and interaction-state rules carry semantic colours (error red, success green), not the brand.
    if (STATE_SELECTOR.test(declaration.selector ?? "")) continue;
    const hex = pageHex(resolvedColor(declaration.value, cssVars));
    if (hex === null || !isAccentHex(hex)) continue;
    const counts = /\bvar\(/.test(declaration.value) ? tokens : literals;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const counts = tokens.size > 0 ? tokens : literals;
  let best: string | null = null;
  for (const [hex, count] of counts) if (best === null || count > counts.get(best)!) best = hex;
  return best;
}

function brandColors(analysis: SourceAnalysis): { readonly primary: string; readonly action: string } {
  const primary = firstValue(
    analysis.cssVars,
    ["primary-blue", "brand-primary", "color-primary", "primary", "accent"],
    analysis.pageColors?.accent ?? "#0057B8",
  );
  return { primary, action: firstValue(analysis.cssVars, ["action-blue", "interactive", "link", "brand-action"], primary) };
}

/** A literal colour: hex, named, or a colour function without unresolved substitutions. CSS-wide keywords and other words are not colours. */
function isLiteralColor(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (/\b(?:var|env|attr)\(/.test(trimmed)) return false;
  return toHexColor(trimmed) !== null || NAMED_COLORS.has(trimmed) || /^(?:oklch|oklab|lab|lch|hwb|color|color-mix)\([^;{}]*\)$/.test(trimmed);
}

/** A literal colour value, or the literal colour a single `var(--name, fallback)` resolves to. */
function resolvedColor(value: string, cssVars: ReadonlyMap<string, string>, depth = 0): string | null {
  const reference = /^var\(\s*--([a-zA-Z0-9_-]+)\s*(?:,\s*(.+))?\)$/.exec(value.trim());
  if (!reference) return isLiteralColor(value) ? value.trim() : null;
  if (depth >= 3) return null;
  const own = cssVars.get(reference[1]!);
  if (own !== undefined) return resolvedColor(own, cssVars, depth + 1);
  return reference[2] !== undefined ? resolvedColor(reference[2], cssVars, depth + 1) : null;
}

/** Scaffold neutrals for a light or a dark observed ground, so default text keeps contrast on either. */
const NEUTRALS = {
  light: { ink: "#0f172a", bgSubtle: "#f8fafc", bgMuted: "#eef2f7", surfaceInverse: "#0f172a", fg2: "#334155", fg3: "#64748b", fg4: "#94a3b8", border: "#dbe4ee", borderStrong: "#94a3b8" },
  dark: { ink: "#f8fafc", bgSubtle: "#111827", bgMuted: "#1f2937", surfaceInverse: "#f8fafc", fg2: "#cbd5e1", fg3: "#94a3b8", fg4: "#64748b", border: "#334155", borderStrong: "#64748b" },
} as const;

/** Hex form of a literal colour; the named extremes are mapped too, other names and modern functions are not converted. */
function pageHex(color: string | null): string | null {
  if (color === null) return null;
  const named = ({ black: "#000000", white: "#ffffff" } as Record<string, string>)[color.trim().toLowerCase()];
  return named ?? toHexColor(color);
}

/** True for html, body, :root and chains of them (`html body`, `:root body`), in any selector of a list. */
function isPageSelector(selector: string): boolean {
  return selector.split(",").some((part) => {
    const compounds = part.trim().toLowerCase().split(/\s+/);
    return compounds[0] !== "" && compounds.every((compound) => compound === "html" || compound === "body" || compound === ":root");
  });
}

/**
 * The entry page's own ground and ink: declarations in that page's document cascade order, restricted to
 * page-level selectors outside any at-rule, with var() resolved only through custom properties declared in
 * the same page-level context. Conditional and component-scoped overrides therefore never leak in.
 */
/** Image sources and canvas count in document order from the start of the page up to the first h2 or h3, skipping logos and icons. */
function openingRegionMedia(html: string): { readonly images: readonly string[]; readonly canvases: number } {
  const images: string[] = [];
  let canvases = 0;
  for (const node of parse(html).querySelectorAll("h2, h3, img, canvas")) {
    if (node.tagName === "H2" || node.tagName === "H3") break;
    if (node.tagName === "CANVAS") { canvases += 1; continue; }
    const src = (node.getAttribute("src") ?? node.getAttribute("srcset")?.split(",")[0]?.trim().split(/\s+/)[0] ?? "").trim();
    if (!src || /^data:/i.test(src) || /logo|brand|icon|favicon|avatar/i.test(src) || node.closest("nav, header") !== null) continue;
    if (!images.includes(src)) images.push(src);
  }
  return { images, canvases };
}

function pageGroundAndInk(declarations: readonly CssDeclarationEvidence[]): { readonly ground: string | null; readonly ink: string | null } {
  const page = [...declarations]
    .sort((left, right) => left.fileOrder - right.fileOrder || left.declarationOrder - right.declarationOrder)
    .filter((declaration) => declaration.context === "" && isPageSelector(declaration.selector ?? ""));
  const vars = new Map<string, string>();
  let ground: string | null = null;
  let ink: string | null = null;
  for (const declaration of page) if (declaration.property.startsWith("--")) vars.set(declaration.property.slice(2), declaration.value);
  for (const declaration of page) {
    if (declaration.property === "background" || declaration.property === "background-color") ground = pageHex(resolvedColor(declaration.value, vars)) ?? ground;
    if (declaration.property === "color") ink = pageHex(resolvedColor(declaration.value, vars)) ?? ink;
  }
  return { ground, ink };
}

function buildTokensCss(brandName: string, analysis: SourceAnalysis, layout: Readonly<Record<string, string>>): string {
  const { primary, action } = brandColors(analysis);
  const ground = analysis.pageColors?.ground ?? "#ffffff";
  const neutrals = NEUTRALS[paletteTone([ground]) === "dark" ? "dark" : "light"];
  const framerInk = analysis.cssVars.get("framer-text-color");
  const ink = analysis.pageColors?.ink ?? pageHex(framerInk !== undefined ? resolvedColor(framerInk, analysis.cssVars) : null) ?? neutrals.ink;
  // Only a plain leading family name is used; function expressions such as var() fall back to the observed family.
  const { sans, display, mono } = fontRoles(analysis);
  const sourceAliases =
    analysis.cssVars.size === 0
      ? ""
      : `\n  /* Source-derived aliases */\n${[...analysis.cssVars.entries()]
          .sort((left, right) => Number(isLiteralColor(right[1])) - Number(isLiteralColor(left[1])))
          .slice(0, 48)
          .map(([key, value]) => `  --src-${key}: ${value};`)
          .join("\n")}`;
  const extractedColorAliases =
    analysis.colors.length === 0
      ? ""
      : `\n  /* Sampled source colors; see extraction provenance for evidence */\n${analysis.colors
          .filter(isLiteralColor)
          .slice(0, 16)
          .map((value, index) => `  --src-color-${index + 1}: ${value};`)
          .join("\n")}`;

  return `/* ${brandName} canonical token file */
@import url('./fonts/fonts.css');

:root {
  /* Neutrals: --gray-100 is the page white, --gray-90 the darkest ink, --gray-80..--gray-10 lighten */
  --gray-100: #ffffff;
  --gray-90: #0f172a;
  --gray-80: #1f2937;
  --gray-70: #374151;
  --gray-60: #4b5563;
  --gray-50: #6b7280;
  --gray-40: #9ca3af;
  --gray-30: #cbd5e1;
  --gray-20: #e2e8f0;
  --gray-10: #f1f5f9;

  /* Brand: neutral names, whatever the hue (existing systems keep their stored names) */
  --brand-primary: ${primary};
  --brand-action: ${action};

  /* Accent ramps */
  --red-60: #dc2626;
  --orange-50: #ea580c;
  --yellow-30: #facc15;
  --green-60: #16a34a;
  --teal-50: #0f766e;
  --aqua-60: #0891b2;
  --blue-40: #60a5fa;
  --blue-60: #2563eb;
  --blue-80: #1d4ed8;
  --ultramarine-60: #4338ca;
  --purple-60: #7c3aed;
  --pink-60: #db2777;

  /* Semantic */
  --success: #15803d;
  --warning-yellow: #eab308;
  --warning-orange: #f97316;
  --error: #dc2626;
  --info: ${action};

  /* Surface & text */
  --bg: ${ground};
  --bg-subtle: ${neutrals.bgSubtle};
  --bg-muted: ${neutrals.bgMuted};
  --surface: ${ground};
  --surface-inverse: ${neutrals.surfaceInverse};
  --fg-1: ${ink};
  --fg-2: ${neutrals.fg2};
  --fg-3: ${neutrals.fg3};
  --fg-4: ${neutrals.fg4};
  --fg-on-dark: #f8fafc;
  --fg-on-brand: ${onBrandInk(primary, analysis.cssVars)};
  --border: ${neutrals.border};
  --border-strong: ${neutrals.borderStrong};
  --focus-ring: ${action};

  /* Paired text colors for the semantic fills */
  --fg-on-success: #ffffff;
  --fg-on-warning: #0f172a;
  --fg-on-error: #ffffff;
  --fg-on-info: #ffffff;

  /* Charts */
  --chart-1: #1d4ed8;
  --chart-2: #0891b2;
  --chart-3: #0f766e;
  --chart-4: #16a34a;
  --chart-5: #ca8a04;
  --chart-6: #ea580c;
  --chart-7: #dc2626;
  --chart-8: #c026d3;
  --chart-9: #7c3aed;
  --chart-10: #4338ca;

  /* Type families */
  --font-display: ${display}, var(--font-display-fallback);
  --font-serif: "Iowan Old Style", "Times New Roman", serif;
  --font-sans: ${sans}, var(--font-sans-fallback);
  --font-mono: ${mono}, var(--font-mono-fallback);

  /* Type scale */
  --fs-12: 12px;
  --fs-14: 14px;
  --fs-16: 16px;
  --fs-18: 18px;
  --fs-20: 20px;
  --fs-24: 24px;
  --fs-32: 32px;
  --fs-40: 40px;
  --fs-48: 48px;
  --fs-64: 64px;
  --fs-80: 80px;

  /* Weight / leading / tracking */
  --fw-light: 300;
  --fw-regular: 400;
  --fw-medium: 500;
  --fw-semibold: 600;
  --fw-bold: 700;
  --fw-black: 800;
  --lh-tight: 1.05;
  --lh-snug: 1.2;
  --lh-normal: 1.5;
  --lh-relaxed: 1.7;
  --ls-tight: -0.03em;
  --ls-normal: 0;
  --ls-wide: 0.04em;
  --ls-eyebrow: 0.12em;

  /* Spacing */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 20px;
  --sp-6: 24px;
  --sp-8: 32px;
  --sp-10: 40px;
  --sp-12: 48px;
  --sp-16: 64px;
  --sp-20: 80px;

  /* Radii */
  --r-0: 0;
  --r-2: 2px;
  --r-4: 4px;
  --r-8: 8px;
  --r-pill: 999px;

  /* Elevation */
  --shadow-1: 0 1px 2px rgba(15, 23, 42, 0.06);
  --shadow-2: 0 6px 16px rgba(15, 23, 42, 0.08);
  --shadow-3: 0 12px 28px rgba(15, 23, 42, 0.12);
  --shadow-4: 0 20px 40px rgba(15, 23, 42, 0.16);

  /* Motion */
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-emphasis: cubic-bezier(0.2, 0.9, 0.2, 1);
  --dur-fast: 120ms;
  --dur-base: 200ms;
  --dur-slow: 320ms;${sourceAliases}${extractedColorAliases}
}

/* Layout is part of the design-system contract; measured source values replace the scaffold defaults. */
:root {
${Object.entries(layout).map(([name, value]) => `  ${name}: ${value};`).join("\n")}
}
`;
}

function buildUiKitReadme(
  brandName: string,
  sourceType: SupportedExtractionSource,
  sourceUrl: string,
): string {
  return `# ${brandName} UI Kit

This folder contains copied or synthesized UI implementation files captured from the ${sourceType} source:

- Source: ${sourceUrl}
- Goal: preserve a few representative building blocks alongside the canonical token file
- Status: draft scaffold, review before publishing
`;
}

function buildUiKitPlaceholderHtml(brandName: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(brandName)} UI Kit</title>
  <style>
    body { font-family: Inter, sans-serif; margin: 0; padding: 40px; background: #f8fafc; color: #0f172a; }
    .card { max-width: 960px; margin: 0 auto; background: white; border: 1px solid #dbe4ee; border-radius: 16px; padding: 32px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(brandName)} UI Kit</h1>
    <p>No source component files were copied automatically. This placeholder marks the UI kit slot in the canonical design-system structure.</p>
  </div>
</body>
</html>`;
}

function buildPreviewHtml(
  fileId: (typeof PREVIEW_FILE_IDS)[number],
  brandName: string,
  analysis: SourceAnalysis,
): string {
  const body = previewBody(fileId, analysis);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(brandName)} ${escapeHtml(fileId)}</title>
  <link rel="stylesheet" href="../colors_and_type.css">
  <style>
    :root {
      --fg: var(--fg-1);
      --muted: var(--fg-3);
      --accent: var(--brand-primary);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font-sans);
      background: var(--bg);
      color: var(--fg);
      padding: 14px;
    }
    .frame {
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      min-height: 220px;
      background: linear-gradient(180deg, var(--surface), var(--bg-subtle));
    }
    .bar {
      height: 10px;
      background: linear-gradient(90deg, var(--accent), var(--aqua-60));
    }
    .content { padding: 14px; }
    .eyebrow {
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 8px;
    }
    .title {
      font-family: var(--font-display);
      font-size: 18px;
      font-weight: 600;
      line-height: 1.2;
      margin-bottom: 8px;
    }
    .muted { color: var(--muted); font-size: 12px; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .chip { border: 1px solid var(--border); border-radius: 999px; padding: 4px 8px; font-size: 11px; }
    .stack { display: grid; gap: 10px; }
    .swatch { height: 28px; border-radius: 8px; border: 1px solid rgba(15,23,42,0.06); }
    .btn { font-family: inherit; display: inline-flex; align-items: center; justify-content: center; min-height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid transparent; font-size: 12px; font-weight: 600; }
    .btn-primary { background: var(--brand-action); color: var(--fg-on-brand); }
    .btn-secondary { background: var(--surface); color: var(--fg); border-color: var(--border); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .field { border: 1px solid var(--border); border-radius: 8px; padding: 8px; font-size: 12px; background: var(--surface); }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    td, th { border-top: 1px solid var(--border); padding: 6px 4px; text-align: left; }
  </style>
</head>
<body>
  <div class="frame">
    <div class="bar"></div>
    <div class="content">
      ${body}
    </div>
  </div>
</body>
</html>`;
}

function previewBody(
  fileId: (typeof PREVIEW_FILE_IDS)[number],
  analysis: SourceAnalysis,
): string {
  const firstFont = escapeHtml(analysis.fontFamilies[0] ?? "Inter");
  const sampleButton = escapeHtml(analysis.componentSamples.buttons[0] ?? "Primary");
  const sampleCardTitle = escapeHtml(analysis.componentSamples.cards[0] ?? "Insight card");
  const sampleForm = escapeHtml(analysis.componentSamples.forms[0] ?? "Email");
  const sampleBadge = escapeHtml(analysis.componentSamples.badges[0] ?? "Published");
  const sampleTable = escapeHtml(analysis.componentSamples.tables[0] ?? "Row 1");
  const sampleHeading = escapeHtml(analysis.componentSamples.headings[0] ?? "Display sample");
  const sampleBody = escapeHtml(
    analysis.componentSamples.body[0] ??
      "Design systems work best when everyday copy feels calm and readable.",
  );
  const sampleSpacing = analysis.spacingValues.slice(0, 6);
  const sampleColors = analysis.colors.slice(0, 6).map((_, index) => `var(--src-color-${index + 1})`);
  const sampleFontSizes = analysis.fontSizes.slice(0, 3);
  const sampleFontWeights = analysis.fontWeights.slice(0, 2);
  const sampleRadius = analysis.radii[0] ?? "4px";
  const sampleShadow =
    analysis.shadows[0] ?? "0 1px 2px rgba(15,23,42,0.08)";
  switch (fileId) {
    case "brand-logos":
      return `<div class="eyebrow">Brand</div><div class="title">Logo inventory</div><div class="muted">${analysis.logoFiles.length} asset(s) copied into assets/logos.</div><div class="chips">${(analysis.logoFiles.length ? analysis.logoFiles : [{ fileName: "No logos detected", absolutePath: "" }]).slice(0, 6).map((logo) => `<div class="chip">${escapeHtml(logo.fileName)}</div>`).join("")}</div>`;
    case "brand-icons":
      return `<div class="eyebrow">Brand</div><div class="title">Icon direction</div><div class="muted">Quiet, geometric, interface-safe iconography.</div><div class="chips"><div class="chip">1.5px stroke</div><div class="chip">Low ornament</div><div class="chip">Grid aligned</div></div>`;
    case "colors-brand":
      return `<div class="eyebrow">Color</div><div class="title">Brand colors</div><div class="stack">${(sampleColors.length > 0 ? sampleColors.slice(0, 3) : ["var(--brand-primary)", "var(--blue-60)", "var(--aqua-60)"]).map((value) => `<div class="swatch" style="background:${escapeHtml(value)}"></div>`).join("")}</div><div class="muted">${sampleColors.length > 0 ? "Source-derived swatches" : "Fallback swatches"}</div>`;
    case "colors-neutrals":
      return `<div class="eyebrow">Color</div><div class="title">Neutral scale</div><div class="stack">${(sampleColors.length >= 6 ? sampleColors.slice(3, 6) : ["var(--gray-90)", "var(--fg-3)", "var(--gray-100)"]).map((value) => `<div class="swatch" style="background:${escapeHtml(value)}"></div>`).join("")}</div>`;
    case "colors-ramps":
      return `<div class="eyebrow">Color</div><div class="title">Accent ramps</div><div class="grid">${(sampleColors.length > 0 ? sampleColors.slice(0, 4) : ["var(--red-60)", "var(--orange-50)", "var(--green-60)", "var(--purple-60)"]).map((value) => `<div class="swatch" style="background:${escapeHtml(value)}"></div>`).join("")}</div>`;
    case "colors-semantic":
      return `<div class="eyebrow">Color</div><div class="title">Semantic roles</div><div class="chips"><div class="chip">Success</div><div class="chip">Warning</div><div class="chip">Error</div><div class="chip">Info</div></div>`;
    case "colors-charts":
      return `<div class="eyebrow">Color</div><div class="title">Chart palette</div><div class="grid">${(sampleColors.length > 0 ? sampleColors.slice(0, 4) : ["var(--chart-1)", "var(--chart-2)", "var(--chart-4)", "var(--chart-6)"]).map((value) => `<div class="swatch" style="background:${escapeHtml(value)}"></div>`).join("")}</div>`;
    case "type-display":
      return `<div class="eyebrow">Typography</div><div class="title" style="font-size:${escapeHtml(sampleFontSizes[0] ?? "26px")};font-weight:${escapeHtml(sampleFontWeights[0] ?? "700")}">${sampleHeading}</div><div class="muted">Primary display family candidate: ${firstFont}</div>`;
    case "type-headings":
      return `<div class="eyebrow">Typography</div><div class="title">Heading hierarchy</div><div class="stack" style="font-family:var(--font-display)"><div style="font-size:${escapeHtml(sampleFontSizes[0] ?? "20px")};font-weight:${escapeHtml(sampleFontWeights[0] ?? "700")}">H1 Heading</div><div style="font-size:${escapeHtml(sampleFontSizes[1] ?? "16px")};font-weight:${escapeHtml(sampleFontWeights[1] ?? "600")}">H2 Heading</div><div class="muted">Structured, low-hype hierarchy.</div></div>`;
    case "type-body":
      return `<div class="eyebrow">Typography</div><div class="title">Body copy</div><div class="muted">${sampleBody}</div>`;
    case "spacing":
      return `<div class="eyebrow">Foundations</div><div class="title">Spacing scale</div><div class="chips">${(sampleSpacing.length > 0 ? sampleSpacing : ["4px", "8px", "12px", "16px", "24px", "32px"]).map((value) => `<div class="chip">${escapeHtml(value)}</div>`).join("")}</div>`;
    case "radii-shadows":
      return `<div class="eyebrow">Foundations</div><div class="title">Radii & shadows</div><div class="grid"><div class="field" style="border-radius:${escapeHtml(sampleRadius)};box-shadow:${escapeHtml(sampleShadow)}">Small radius</div><div class="field" style="border-radius:12px;box-shadow:0 12px 24px rgba(15,23,42,0.12)">Large radius</div></div>`;
    case "components-buttons":
      return `<div class="eyebrow">Components</div><div class="title">Buttons</div><div class="chips"><button class="btn btn-primary">${sampleButton}</button><button class="btn btn-secondary">Secondary</button></div>`;
    case "components-cards":
      return `<div class="eyebrow">Components</div><div class="title">Cards</div><div class="stack"><div class="field"><strong>${sampleCardTitle}</strong><div class="muted">${sampleBody}</div></div><div class="field"><strong>Editorial card</strong><div class="muted">Quiet frame, clear grouping.</div></div></div>`;
    case "components-forms":
      return `<div class="eyebrow">Components</div><div class="title">Forms</div><div class="stack"><div class="field">Label<br>${sampleForm}</div><div class="field">${sampleBody}</div></div>`;
    case "components-badges-table":
      return `<div class="eyebrow">Components</div><div class="title">Badges & table</div><div class="chips"><div class="chip">${sampleBadge}</div><div class="chip">Draft</div></div><table><thead><tr><th>Item</th><th>Status</th></tr></thead><tbody><tr><td>${sampleTable}</td><td>Ready</td></tr><tr><td>Preview cards</td><td>Draft</td></tr></tbody></table>`;
  }
}

/**
 * Stores the reference screenshots next to the measured layout as layout-reference/p<page index>-<viewport>.jpg
 * with an index recording each file's measured page, size and digest. Only what the strict reader accepts is
 * published; a rejected index drops the screenshots with a note.
 */
async function writeLayoutReference(systemDir: string, measured: DesignSystemMeasuredLayout, shots: readonly LayoutReferenceCapture[], generated: Set<string>, notes: string[], heroImages: readonly { readonly absolutePath: string; readonly fileName: string }[]): Promise<void> {
  const entries = shots.flatMap((shot) => {
    const index = measured.pages.findIndex((page) => page.path === shot.path);
    return index === -1 ? [] : [{ shot, index }];
  }).sort((a, b) => a.index - b.index || a.shot.viewport.localeCompare(b.shot.viewport));
  const heroAssets: { file: string; size: number; sha256: string }[] = [];
  for (const image of heroImages.slice(0, MAX_HERO_ASSETS)) {
    const file = `assets/hero/${safeFileName(image.fileName)}`;
    const bytes = await readFile(image.absolutePath).catch(() => null);
    if (bytes !== null && LAYOUT_REFERENCE_HERO_FILE.test(file) && bytes.byteLength > 0 && bytes.byteLength <= MAX_HERO_ASSET_BYTES) heroAssets.push({ file, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const wireframes = entries.map(({ shot, index }) => renderMeasuredWireframe(measured.pages[index]!.viewports[shot.viewport]));
  let reference;
  try {
    reference = parseDesignSystemLayoutReference({ schema_version: 1, ...(heroAssets.length > 0 ? { hero_assets: heroAssets } : {}), shots: entries.map(({ shot, index }, position) => ({
      path: shot.path, viewport: shot.viewport, file: `layout-reference/p${index}-${shot.viewport}.jpg`, width: shot.width, height: shot.height,
      size: shot.jpeg.byteLength, sha256: createHash("sha256").update(shot.jpeg).digest("hex"),
      wireframe: { file: `layout-reference/p${index}-${shot.viewport}.svg`, size: Buffer.byteLength(wireframes[position]!), sha256: createHash("sha256").update(wireframes[position]!).digest("hex") },
    })) });
  } catch {
    notes.push("Layout reference screenshots were omitted because their index did not pass validation.");
    return;
  }
  await mkdir(path.join(systemDir, "layout-reference"), { recursive: true });
  for (const [position, entry] of reference.shots.entries()) {
    const dest = path.join(systemDir, ...entry.file.split("/"));
    await writeFile(dest, entries[position]!.shot.jpeg);
    generated.add(toSystemRelPath(systemDir, dest));
    await writeText(path.join(systemDir, ...entry.wireframe!.file.split("/")), wireframes[position]!, generated, systemDir);
  }
  await writeText(path.join(systemDir, "layout-reference.json"), `${JSON.stringify(reference, null, 2)}\n`, generated, systemDir);
}

async function writeText(
  absolutePath: string,
  content: string,
  generated: Set<string>,
  rootDir: string,
) {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
  generated.add(toSystemRelPath(rootDir, absolutePath));
}

function toSystemRelPath(rootDir: string, absolutePath: string): string {
  return path.relative(rootDir, absolutePath).replaceAll("\\", "/");
}

function mergeSignals(
  target: {
    colors: Set<string>;
    fontSizes: Set<string>;
    fontWeights: Set<string>;
    spacingValues: Set<string>;
    radii: Set<string>;
    shadows: Set<string>;
  },
  next: {
    colors: string[];
    fontSizes: string[];
    fontWeights: string[];
    spacingValues: string[];
    radii: string[];
    shadows: string[];
  },
) {
  for (const value of next.colors) target.colors.add(value);
  for (const value of next.fontSizes) target.fontSizes.add(value);
  for (const value of next.fontWeights) target.fontWeights.add(value);
  for (const value of next.spacingValues) target.spacingValues.add(value);
  for (const value of next.radii) target.radii.add(value);
  for (const value of next.shadows) target.shadows.add(value);
}

function mergeStringSamples(target: string[], next: string[], limit: number) {
  const seen = new Set(target);
  for (const value of next) {
    if (seen.has(value)) continue;
    target.push(value);
    seen.add(value);
    if (target.length >= limit) return;
  }
}

function firstValue(
  vars: Map<string, string>,
  candidates: string[],
  fallback: string,
): string {
  return selectCanonicalToken(
    [...vars.entries()].map(([key, value]) => ({
      domain: "token",
      key,
      value,
      sourceLocator: `css-custom-property:${key}`,
      confidence: 1,
      state: "observed",
    })),
    candidates,
    fallback,
  ).value;
}

function deriveBrandNameFromGitUrl(sourceUrl: string): string {
  const trimmed = sourceUrl.replace(/\.git(?:[#?].*)?$/i, "");
  const tail = trimmed.split(/[/:]/).filter(Boolean).pop() ?? "Design System";
  return humanizeSlug(tail);
}

function deriveBrandNameFromHtml(url: URL, html: string): string {
  const root = parse(html);
  const title = root.querySelector("title")?.text.trim();
  if (title) return normalizeBrandName(title.split(/[|\-–—]/)[0] ?? title);
  return normalizeBrandName(url.hostname.replace(/^www\./, "").split(".")[0] ?? "Website");
}

function normalizeBrandName(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim();
}

function humanizeSlug(value: string): string {
  return normalizeBrandName(
    value
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase()),
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "design-system";
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

function cssString(value: string): string {
  return value.includes(" ") ? `"${value}"` : value;
}

function safeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function normalizeCssTokenName(value: string): string | null {
  const normalized = value.trim().replace(/^--/, "");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(normalized)) return null;
  return normalized;
}

function normalizeFontFamily(value: string | undefined): string | null {
  const normalized = (value ?? "")
    .replace(/[;{}<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length > 80) return null;
  return normalized;
}

async function appendFontFaceRule(
  fontsCssPath: string,
  family: string,
  fileName: string,
) {
  const existing = await readFile(fontsCssPath, "utf8").catch(() => "");
  const safeFamily = family.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const safeUrl = fileName.replace(/\\/g, "/").replace(/'/g, "%27");
  // A single static face declares one weight; a 100 900 range would make the browser reuse these
  // outlines for bold instead of synthesizing it.
  const rule = `@font-face {
  font-family: '${safeFamily}';
  src: url('./${safeUrl}') format('${fontFormatForFile(fileName)}');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
`;
  const next =
    existing.includes(`url('./${safeUrl}')`) || existing.includes(`url("${safeUrl}")`)
      ? existing
      : `${existing.trimEnd()}\n\n${rule}`.trimStart();
  await mkdir(path.dirname(fontsCssPath), { recursive: true });
  await writeFile(fontsCssPath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
}

function fontFormatForFile(fileName: string): string {
  switch (path.extname(fileName).toLowerCase()) {
    case ".woff2":
      return "woff2";
    case ".woff":
      return "woff";
    case ".otf":
      return "opentype";
    default:
      return "truetype";
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function resolveDesignSystemRecordPath(systemId: string, dirPath: string, target: string): string {
  const managedDir = resolveManagedPath(systemsDir, dirPath);
  const expectedDir = path.join(systemsDir, systemId);
  if (managedDir !== expectedDir) {
    throw new DesignSystemAssetEditError("unsafe_managed_path", "Design system path is outside its canonical managed directory");
  }
  const managedTarget = resolveManagedPath(systemsDir, target);
  const relative = path.relative(managedDir, managedTarget);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new DesignSystemAssetEditError("unsafe_managed_path", "Design system asset path escapes its managed directory");
  }
  return managedTarget;
}

export async function resolveDesignSystemFile(
  systemId: string,
  relPath: string,
): Promise<string | null> {
  const detail = await getDesignSystemDetail(systemId);
  if (!detail) return null;
  const normalized = relPath.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.includes("..") ||
    normalized.startsWith("/") ||
    path.isAbsolute(normalized)
  ) {
    return null;
  }
  const managedDir = resolveDesignSystemRecordPath(systemId, detail.dir_path, detail.dir_path);
  const absolute = resolveWithin(managedDir, ...normalized.split("/"));
  const info = await stat(absolute).catch(() => null);
  if (!info?.isFile()) return null;
  return absolute;
}
