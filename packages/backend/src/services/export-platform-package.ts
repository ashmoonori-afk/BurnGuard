import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PLATFORM_GUIDES, type ExportOptions, type GraphicSetV1, type PlatformGuide, type ProjectDetail } from "@bg/shared";
import type { FileInfo } from "@bg/shared/harness";
import { resolveWithin } from "../security/path-boundary";
import { inspectCanonicalTree } from "./canonical-tree-manifest";
import { resolveStaticClosure } from "./export-closure";
import { ExportError } from "./export-errors";
import { validatePlatformPackage, type PlatformPackageManifest } from "./export-package-validation";
import { canonicalJson, sha256 } from "./export-receipt";
import type { ExportValidation } from "./export-receipt-validation";
import type { RenderSession } from "./export-render-session";
import { hasBlockingFinding, lintForPlatform, type PlatformLintFinding, type PlatformTarget } from "./platform-lint";
import { buildCafe24Package } from "./platform-package-cafe24";
import { encode, type PlatformBuildInput, type PlatformBuildResult, type StagedAsset } from "./platform-package-contract";
import { buildImwebPackage } from "./platform-package-imweb";
import { bucketFor, defaultAssetBaseUrl, normalizeBaseUrl, packageSlug } from "./platform-package-rewrite";
import { GUIDE_PATH, LINT_PATH, PACKAGE_MANIFEST_PATH, PLATFORM_TRANSFORMATION_VERSION } from "./platform-package-roles";
import { isProjectDocumentPath } from "./project-document-paths";
import { buildSiteMap } from "./site-map";
import { zipDirectory } from "./zip";

export { PLATFORM_TRANSFORMATION_VERSION };

export type PlatformPackagePaths = { readonly staged: string; readonly scratch: string; readonly output: string };
export type PlatformPackageProject = { readonly name: string; readonly entrypoint: string; readonly revision: number; readonly digest: string };
export type PlatformPackageBuild = {
  readonly paths: PlatformPackagePaths;
  readonly format: "cafe24_package" | "imweb_package";
  readonly project: PlatformPackageProject;
  readonly options: ExportOptions;
};

export type PlatformPackageContext = {
  readonly stagedDir: string;
  readonly outputPath: string;
  readonly format: "cafe24_package" | "imweb_package";
  readonly project: ProjectDetail;
  readonly graphic_set: GraphicSetV1;
  readonly options: ExportOptions;
  readonly browserSession: RenderSession;
  readonly receiptWriter: (validation: ExportValidation) => Promise<void>;
  readonly signal: AbortSignal;
};

const NOTICE_FILE = /^(?:ofl|license|copyright)/iu;

/** Renders a platform ZIP from the staged tree, project and graphic-set contracts, options, browser session, receipt writer, and cancellation signal. */
export async function renderPlatformPackage(context: PlatformPackageContext): Promise<ExportValidation> {
  if (context.project.current_digest === null) throw new ExportError("platform_package_incomplete");
  context.signal.throwIfAborted();
  return buildPlatformPackage({
    paths: { staged: context.stagedDir, scratch: path.join(path.dirname(context.stagedDir), "platform"), output: context.outputPath },
    format: context.format,
    project: { name: context.project.name, entrypoint: context.project.entrypoint, revision: context.project.current_revision, digest: context.project.current_digest },
    options: context.options,
  });
}

/** Transforms the staged canonical tree into the platform package, lints it, zips it, and validates the archive independently. */
export async function buildPlatformPackage(input: PlatformPackageBuild): Promise<ExportValidation> {
  const platform: PlatformTarget = input.format === "cafe24_package" ? "cafe24" : "imweb";
  const slug = packageSlug(input.project.name);
  const staged = await stageSources(input.paths.staged, input.project.entrypoint);
  const buildInput: PlatformBuildInput = { entrypoint: input.project.entrypoint, slug, options: input.options, staged };
  const built: PlatformBuildResult = platform === "cafe24" ? buildCafe24Package(buildInput) : await buildImwebPackage(buildInput);
  const findings: readonly PlatformLintFinding[] = [...built.findings, ...lintForPlatform({ platform, assets: built.assets, documents: built.documents })];
  if (hasBlockingFinding(findings)) throw new ExportError("platform_lint_failed");

  const guide = PLATFORM_GUIDES[platform];
  const entries = [
    ...built.entries,
    { path: GUIDE_PATH, bytes: encode(renderGuideHtml(guide)) },
    { path: LINT_PATH, bytes: encode(`${JSON.stringify({ schema_version: 1, platform, transformation_version: PLATFORM_TRANSFORMATION_VERSION, verification_status: "documentation_tested", findings }, null, 2)}\n`) },
  ];
  const manifest: PlatformPackageManifest = {
    schema_version: 1,
    transformation_version: PLATFORM_TRANSFORMATION_VERSION,
    platform,
    entrypoint: input.project.entrypoint,
    project_revision: input.project.revision,
    project_digest: input.project.digest,
    options_digest: sha256(canonicalJson(input.options)),
    asset_base_url: platform === "cafe24" ? normalizeBaseUrl(input.options.asset_base_url ?? defaultAssetBaseUrl(slug)) : input.options.asset_base_url ?? null,
    external_urls: [...built.external_urls].sort(),
    roles: [...built.roles, { path: GUIDE_PATH, role: "guide" as const }, { path: LINT_PATH, role: "guide" as const }].sort((left, right) => compare(left.path, right.path)),
    entries: entries.map((entry) => ({ path: entry.path, size: entry.bytes.byteLength, sha256: sha256(entry.bytes) })).sort((left, right) => compare(left.path, right.path)),
  };

  await rm(input.paths.scratch, { recursive: true, force: true });
  await mkdir(input.paths.scratch, { recursive: true });
  for (const entry of [...entries, { path: PACKAGE_MANIFEST_PATH, bytes: encode(canonicalJson(manifest)) }]) {
    const target = resolveWithin(input.paths.scratch, entry.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.bytes);
  }
  await zipDirectory(input.paths.scratch, input.paths.output);
  await validatePlatformPackage(new Uint8Array(await readFile(input.paths.output)), manifest);
  await rm(input.paths.scratch, { recursive: true, force: true });
  return { entries: manifest.entries.length };
}

async function stageSources(stagedDir: string, entrypoint: string): Promise<PlatformBuildInput["staged"]> {
  const tree = await inspectCanonicalTree(stagedDir);
  const closure = await resolveStaticClosure(stagedDir, entrypoint, tree);
  const files: readonly FileInfo[] = tree.files.map((file) => ({ rel_path: file.path, category: /\.html?$/iu.test(file.path) ? "html" : "other" }));
  const read = async (relPath: string): Promise<Uint8Array> => new Uint8Array(await readFile(resolveWithin(stagedDir, relPath)));
  const siteMap = await buildSiteMap(files, entrypoint, async (relPath) => readFile(resolveWithin(stagedDir, relPath), "utf8"));
  const pagePaths = new Set(siteMap.pages.map((page) => page.rel_path));
  const pages = await Promise.all(siteMap.pages.map(async (page) => ({ rel_path: page.rel_path, html: await readFile(resolveWithin(stagedDir, page.rel_path), "utf8") })));
  const assetPaths = closure.referenced_paths.filter((relPath) => !pagePaths.has(relPath) && !isProjectDocumentPath(relPath));
  const assets: readonly StagedAsset[] = await Promise.all(assetPaths.map(async (relPath) => ({ rel_path: relPath, bytes: await read(relPath) })));
  const fontDirectories = new Set(assets.filter((asset) => bucketFor(asset.rel_path) === "fonts").map((asset) => path.posix.dirname(asset.rel_path)));
  const noticePaths = tree.files.map((file) => file.path).filter((relPath) => fontDirectories.has(path.posix.dirname(relPath)) && NOTICE_FILE.test(path.posix.basename(relPath)) && !isProjectDocumentPath(relPath));
  const notices: readonly StagedAsset[] = await Promise.all(noticePaths.map(async (relPath) => ({ rel_path: relPath, bytes: await read(relPath) })));
  return { pages, assets, notices };
}

/** Renders the static Korean installation guide; the archive never carries prose authored anywhere else. */
function renderGuideHtml(guide: PlatformGuide): string {
  const list = (items: readonly string[]): string => `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  const steps = guide.steps.map((step) => `<li><h3>${escapeHtml(step.title)}</h3><p>${escapeHtml(step.body)}</p><p class="status">확인 상태: ${escapeHtml(step.status)}</p></li>`).join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(guide.title)}</title></head><body>`
    + `<h1>${escapeHtml(guide.title)}</h1><p>${escapeHtml(guide.summary)}</p>`
    + `<h2>준비</h2>${list(guide.prerequisites)}<h2>설치 순서</h2><ol>${steps}</ol>`
    + `<h2>되돌리기</h2>${list(guide.rollback)}<h2>지원하지 않는 것</h2>${list(guide.unsupported)}`
    + `<h2>검증</h2><p>${escapeHtml(guide.verification_note)}</p><p>${escapeHtml(guide.checked_on)}</p></body></html>\n`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
