import { open, stat } from "node:fs/promises";
import path from "node:path";
import {
  parseCssSource,
  selectCssCustomProperties,
  styleSignalsFromDeclarations,
  type CssDeclarationEvidence,
  type CssParseIssue,
} from "./extraction-css";
import { AcquisitionLimitError, DEFAULT_ACQUISITION_LIMITS, throwIfAcquisitionAborted, type AcquisitionLimits } from "./extraction-acquisition";
import { collectSourceEvidence } from "./extraction-evidence";
import { listFilesRecursive } from "./extraction-path";

const TEXT_FILE_EXTENSIONS = new Set([".css", ".scss", ".sass", ".less", ".json", ".html", ".htm", ".js", ".jsx", ".ts", ".tsx", ".md"]);
const UI_KIT_EXTENSIONS = new Set([".html", ".jsx", ".tsx", ".css"]);
const LOGO_EXTENSIONS = new Set([".svg", ".png", ".jpg", ".jpeg", ".webp"]);
const READ_CHUNK_BYTES = 64 * 1024;

export type SourceArtifact = { readonly absolutePath: string; readonly relPath: string };
export type SourceAnalysis = {
  readonly discoveries?: readonly import("./extraction-provenance").ExtractionDiscovery[];
  readonly brandName: string;
  readonly cssDeclarations: readonly CssDeclarationEvidence[];
  readonly cssParseIssues: readonly CssParseIssue[];
  readonly cssVars: Map<string, string>;
  readonly fontFamilies: string[];
  readonly colors: string[];
  readonly fontSizes: string[];
  readonly fontWeights: string[];
  readonly spacingValues: string[];
  readonly radii: string[];
  readonly shadows: string[];
  readonly borders: string[];
  readonly notes: string[];
  readonly logoFiles: Array<{ readonly absolutePath: string; readonly fileName: string }>;
  readonly uiKitFiles: Array<{ readonly absolutePath: string; readonly fileName: string }>;
  readonly rawFiles: string[];
  readonly homepageHtml: string | null;
  readonly fetchedPageCount: number;
  readonly componentSamples: {
    readonly buttons: string[]; readonly cards: string[]; readonly forms: string[];
    readonly tables: string[]; readonly badges: string[]; readonly headings: string[]; readonly body: string[];
  };
  readonly artifactCopies: SourceArtifact[];
  /** Evidence read from the original source before sanitization; absent for sources without HTML. */
  readonly sourceEvidence?: import("./extraction-evidence").SourceEvidence;
  /** Per-page discovery and extraction results; website sources only. */
  readonly pageCoverage?: import("@bg/shared").DesignSystemPageCoverage;
  /** Entry-page opening-region images copied as hero assets and script-drawn canvases seen there; website sources only. */
  readonly heroAssets?: { readonly images: ReadonlyArray<{ readonly absolutePath: string; readonly fileName: string }>; readonly canvases: number };
  /** Offline rendered layout measurements; website sources only, null when Chromium could not measure. */
  readonly measuredLayout?: import("@bg/shared").DesignSystemMeasuredLayout | null;
  /** Screenshots of the measured pages from the same offline render; only pages kept in measuredLayout. */
  readonly layoutReferenceShots?: readonly import("./extraction-rendered-layout").LayoutReferenceCapture[];
  /**
   * Entry-page ground and text colour (hex) from page-level rules in document order, and the entry page's
   * most used mid-tone chromatic colour; website sources only.
   */
  readonly pageColors?: { readonly ground: string | null; readonly ink: string | null; readonly accent?: string | null };
};

export async function analyzeLocalTree(
  rootDir: string,
  fallbackBrandName: string,
  signal: AbortSignal,
  limits: AcquisitionLimits = DEFAULT_ACQUISITION_LIMITS,
): Promise<SourceAnalysis> {
  const allFiles = await listFilesRecursive(rootDir, signal, limits);
  const cssDeclarations: CssDeclarationEvidence[] = [];
  const cssParseIssues: CssParseIssue[] = [];
  const fontFamilies = new Set<string>();
  const logoFiles: Array<{ absolutePath: string; fileName: string }> = [];
  const uiKitFiles: Array<{ absolutePath: string; fileName: string }> = [];
  const notes: string[] = [];
  let aggregateBytes = 0;
  let cssFileOrder = 0;
  const htmlSources: string[] = [];

  for (const absolutePath of allFiles) {
    throwIfAcquisitionAborted(signal);
    const base = path.basename(absolutePath);
    const extension = path.extname(base).toLowerCase();
    if (LOGO_EXTENSIONS.has(extension) && /logo|brand/i.test(base)) logoFiles.push({ absolutePath, fileName: base });
    if (UI_KIT_EXTENSIONS.has(extension) && uiKitFiles.length < 8) uiKitFiles.push({ absolutePath, fileName: base });
    if (!TEXT_FILE_EXTENSIONS.has(extension)) continue;
    const bytes = (await stat(absolutePath)).size;
    if (bytes > limits.sourceFileBytes) throw new AcquisitionLimitError("source_file_bytes", limits.sourceFileBytes, bytes);
    aggregateBytes += bytes;
    if (aggregateBytes > limits.aggregateSourceBytes) {
      throw new AcquisitionLimitError("aggregate_source_bytes", limits.aggregateSourceBytes, aggregateBytes);
    }
    if ((extension === ".html" || extension === ".htm") && htmlSources.length < 8) htmlSources.push(await readBoundedText(absolutePath, bytes, signal));
    if (extension !== ".css") continue;
    const content = await readBoundedText(absolutePath, bytes, signal);
    const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join("/");
    const parsed = await parseCssSource({ content, sourceId: relativePath, fileOrder: cssFileOrder, signal, limits });
    cssFileOrder += 1;
    cssDeclarations.push(...parsed.declarations);
    cssParseIssues.push(...parsed.issues);
    for (const declaration of parsed.declarations) {
      if (declaration.property !== "font-family") continue;
      const first = declaration.value.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "");
      if (first) fontFamilies.add(first);
    }
  }
  const cssVars = selectCssCustomProperties(cssDeclarations);
  const signals = styleSignalsFromDeclarations(cssDeclarations);
  if (cssParseIssues.length > 0) notes.push(`${cssParseIssues.length} CSS parse or support issue(s) retained as provenance evidence.`);
  return {
    brandName: fallbackBrandName, cssDeclarations, cssParseIssues, cssVars, fontFamilies: [...fontFamilies],
    colors: signals.colors, fontSizes: signals.fontSizes, fontWeights: signals.fontWeights,
    spacingValues: signals.spacingValues, radii: signals.radii, shadows: signals.shadows, borders: signals.borders, notes,
    logoFiles: logoFiles.slice(0, 8), uiKitFiles, rawFiles: ["uploads/source-url.txt", "uploads/extraction-report.json"],
    homepageHtml: null, fetchedPageCount: 0,
    componentSamples: { buttons: [], cards: [], forms: [], tables: [], badges: [], headings: [], body: [] }, artifactCopies: [],
    sourceEvidence: collectSourceEvidence(htmlSources, cssDeclarations),
  };
}

async function readBoundedText(absolutePath: string, bytes: number, signal: AbortSignal): Promise<string> {
  const handle = await open(absolutePath, "r");
  try {
    const chunks: Buffer[] = [];
    let offset = 0;
    while (offset < bytes) {
      throwIfAcquisitionAborted(signal);
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, bytes - offset));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      offset += bytesRead;
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await handle.close();
  }
}
