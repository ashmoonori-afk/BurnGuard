import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DESIGN_AUDIT_CHECK_CODES, DesignAuditContractError, LOGO_PAGE, parseDesignAuditResult, type DesignAuditCheck, type DesignAuditCheckCode, type DesignAuditFinding, type DesignAuditResult, type ProjectType } from "@bg/shared";
import { getProjectDetail } from "../db/project-read-repository";
import { projectsDir, resolveManagedPath } from "../lib/paths";
import { PathBoundaryError, resolveWithin } from "../security/path-boundary";
import { CanonicalTreeManifestError, inspectCanonicalTree, type CanonicalTreeManifest } from "./canonical-tree-manifest";
import { inspectRenderedPage, type DomAuditFinding, type DomAuditObservation } from "./design-audit-dom";
import { fingerprintHtmlNode, FilePatchError } from "./file-patch";
import { launchChromium, openRenderSession, RenderSessionError, type RenderSession } from "./export-render-session";
import { registerExportBrowser } from "./export-browser-registry";
import { parseStoredProjectOptions } from "./project-options";
import { buildSiteMap } from "./site-map";
import { auditSiteStructure, type SiteStructureFinding } from "./site-shared-blocks";

/** Part of the on-demand audit cache key; bumped when the viewport or check policy changes (v4: remote resources, not-applicable checks, site-wide folding). */
export const DESIGN_AUDIT_POLICY_VERSION = "site-deck-copy-v4";

/**
 * The fixed page a project renders into, or undefined for a responsive website audit. A logo
 * project has no stored canvas: its candidate sheet and every guidelines page are the constant
 * LOGO_PAGE, so auditing it at website viewports only produces spurious narrow-width findings.
 */
export function designAuditCanvas(type: ProjectType, optionsJson: string | null): { readonly width: number; readonly height: number } | undefined {
  if (type === "logo") return LOGO_PAGE;
  if (type === "graphic") return parseStoredProjectOptions(optionsJson).graphic_canvas ?? undefined;
  return undefined;
}

export type AuditRenderedTreeInput = { readonly projectId: string; readonly projectDir: string; readonly entrypoint: string; readonly revision: number; readonly digest: string; readonly treeDigest?: string; readonly safeFix?: boolean; readonly deck?: boolean; readonly canvas?: { readonly width: number; readonly height: number }; readonly signal: AbortSignal };
export class DesignAuditServiceError extends Error {
  readonly name = "DesignAuditServiceError";
  constructor(readonly code: "project_not_found" | "project_path_unavailable" | "stale_artifact_identity" | "audit_unavailable", message: string) { super(message); }
}

export async function auditRenderedTree(input: AuditRenderedTreeInput): Promise<DesignAuditResult> {
  const manifest = await inspectCanonicalTree(input.projectDir);
  const expectedTreeDigest = input.treeDigest ?? input.digest;
  if (manifest.tree_digest !== expectedTreeDigest) throw new DesignAuditServiceError("stale_artifact_identity", "Artifact identity changed before audit");
  const observations: DomAuditObservation[] = [];
  let auditEntrypoints: readonly string[] = [input.entrypoint];
  let siteFindings: readonly DesignAuditFinding[] = [];
  let sharedChangeDivergence: readonly string[] = [];
  if (!(input.deck ?? false) && input.canvas === undefined) {
    const htmlFiles = manifest.files.filter((file) => /\.html?$/iu.test(file.path)).map((file) => ({ rel_path: file.path, category: "html" as const }));
    const siteMap = await buildSiteMap(htmlFiles, input.entrypoint, (relPath) => readFile(resolveWithin(input.projectDir, relPath), "utf8"));
    const pages = await Promise.all(siteMap.pages.map(async (page) => ({ rel_path: page.rel_path, html: await readFile(resolveWithin(input.projectDir, page.rel_path), "utf8") })));
    auditEntrypoints = siteMap.pages.map((page) => page.rel_path);
    const siteAudit = auditSiteStructure(siteMap, pages);
    sharedChangeDivergence = siteAudit.divergent_pages;
    siteFindings = siteAudit.findings.map((finding, index) => buildSiteFinding(finding, index));
  }
  const fixedCanvas = input.canvas !== undefined || Boolean(input.deck);
  const viewports = input.deck ? [{ width: 1920, height: 1080, dpr: 1 } as const] : input.canvas === undefined
    ? [{ width: 1280, height: 900, dpr: 1 }, { width: 375, height: 812, dpr: 1 }] as const
    : [{ width: input.canvas.width, height: input.canvas.height, dpr: 1 }] as const;
  const browser = await launchChromium(input.signal);
  const owner = registerExportBrowser(() => browser.close());
  try {
    for (const entrypoint of auditEntrypoints) for (const viewport of viewports) {
      const session = await openRenderSession({ stagedDir: input.projectDir, entrypoint, viewport, deck: input.deck ?? false, strict: false, signal: input.signal, browser });
      // Inspect every artboard in print order, including slides hidden by navigation.
      if (input.deck) await session.page.addStyleTag({ content: "html,body{height:auto!important;overflow:visible!important} [data-slide]{display:block!important;position:relative!important;inset:auto!important;transform:none!important;margin:0!important;width:1920px!important;height:1080px!important}" });
      try {
        const observation = await inspectRenderedPage(session.page, fixedCanvas);
        const remote = await remoteResourceFindings(session);
        observations.push(remote.length === 0 ? observation : { ...observation, findings: [...observation.findings, ...remote] });
      } finally { await session.close(); }
    }
  } finally { await owner.close(); }
  const current = await inspectCanonicalTree(input.projectDir);
  if (current.tree_digest !== expectedTreeDigest) throw new DesignAuditServiceError("stale_artifact_identity", "Artifact identity changed during audit");
  const renderedFindings: DesignAuditFinding[] = [];
  const desktops: DomAuditObservation[] = []; const narrows: DomAuditObservation[] = [];
  for (let index = 0; index < auditEntrypoints.length; index += 1) {
    const pageDesktop = observations[index * viewports.length];
    const pageNarrow = observations[index * viewports.length + 1] ?? pageDesktop;
    const relPath = auditEntrypoints[index];
    if (pageDesktop === undefined || pageNarrow === undefined || relPath === undefined) throw new DesignAuditServiceError("audit_unavailable", "Rendered page audit observations are unavailable");
    desktops.push(pageDesktop); narrows.push(pageNarrow);
    const available = 200 - siteFindings.length - renderedFindings.length;
    if (available > 0) renderedFindings.push(...await enrichFindings(renderedRawFindings(pageDesktop, pageNarrow).slice(0, available), input, manifest, relPath));
  }
  if (desktops.length === 0) throw new DesignAuditServiceError("audit_unavailable", "Rendered audit observations are unavailable");
  const findings = [...renderedFindings, ...siteFindings].slice(0, 200);
  // Site structure is never audited on a fixed canvas and a fixed canvas is never rendered narrow, so those checks cannot pass or fail there.
  const applicable = (code: DesignAuditCheckCode): boolean => !(fixedCanvas && (code === "narrow_width" || code.startsWith("site_")));
  const checks = DESIGN_AUDIT_CHECK_CODES.map((code) => buildCheck(code, findings, code === "narrow_width" ? narrows : desktops, applicable(code)));
  const overall = findings.some((finding) => finding.severity === "must_fix") ? "must_fix" : checks.every((check) => check.status === "pass" || check.status === "not_applicable") ? "ready" : "recommended";
  return parseDesignAuditResult({ schema_version: 1, project_id: input.projectId, artifact_revision: input.revision, artifact_digest: input.digest, created_at: Date.now(), overall_status: overall, checks, shared_change_divergence: sharedChangeDivergence });
}

export async function getProjectDesignAudit(projectId: string, force = false, signal: AbortSignal = new AbortController().signal): Promise<DesignAuditResult> {
  const project = await getProjectDetail(projectId);
  if (project === null) throw new DesignAuditServiceError("project_not_found", "Project not found");
  let projectDir: string;
  try { projectDir = resolveManagedPath(projectsDir, project.dir_path); }
  catch (error) { if (error instanceof PathBoundaryError) throw new DesignAuditServiceError("project_path_unavailable", "Project directory is outside managed storage"); throw error; }
  let manifest: CanonicalTreeManifest;
  try { manifest = await inspectCanonicalTree(projectDir); }
  catch (error) { if (error instanceof CanonicalTreeManifestError) throw new DesignAuditServiceError("project_path_unavailable", "Project tree is unavailable for audit"); throw error; }
  if (project.current_digest === null || project.current_revision < 0 || manifest.tree_digest !== project.current_digest) throw new DesignAuditServiceError("stale_artifact_identity", "Current artifact identity is unavailable or stale");
  let cachePath: string;
  try { cachePath = resolveWithin(projectDir, ".meta", "audits", `${project.current_revision}-${project.current_digest}-${DESIGN_AUDIT_POLICY_VERSION}.json`); }
  catch (error) { if (error instanceof PathBoundaryError) throw new DesignAuditServiceError("project_path_unavailable", "Project audit cache is outside managed storage"); throw error; }
  if (!force) {
    const cached = await readCache(cachePath);
    if (cached !== null && cached.project_id === projectId && cached.artifact_revision === project.current_revision && cached.artifact_digest === project.current_digest) return cached;
  }
  let result: DesignAuditResult;
  const graphicCanvas = designAuditCanvas(project.type, project.options_json);
  try { result = await auditRenderedTree({ projectId, projectDir, entrypoint: project.entrypoint, revision: project.current_revision, digest: project.current_digest, deck: project.type === "slide_deck", ...(graphicCanvas === undefined ? {} : { canvas: graphicCanvas }), signal }); }
  catch (error) { if (error instanceof RenderSessionError || error instanceof CanonicalTreeManifestError) throw new DesignAuditServiceError("audit_unavailable", "Rendered audit is unavailable"); throw error; }
  const after = await getProjectDetail(projectId);
  if (after === null || after.current_revision !== result.artifact_revision || after.current_digest !== result.artifact_digest) throw new DesignAuditServiceError("stale_artifact_identity", "Artifact identity changed during audit");
  await writeCache(cachePath, result);
  return result;
}

function buildSiteFinding(finding: SiteStructureFinding, index: number): DesignAuditFinding {
  const action = siteTargetedAction(finding.code);
  return {
    id: `${finding.code}:${createHash("sha256").update(`${finding.rel_path}\0${finding.evidence}\0${index}`).digest("hex").slice(0, 24)}`,
    check_code: finding.code,
    severity: finding.severity,
    source: { rel_path: finding.rel_path, node_bg_id: null },
    evidence: finding.evidence,
    targeted_action: action,
  };
}

function siteTargetedAction(code: SiteStructureFinding["code"]): DesignAuditFinding["targeted_action"] {
  switch (code) {
    case "site_nav_mismatch": return "repair_site_navigation";
    case "site_missing_aria_current": return "mark_current_page";
    case "site_dangling_link": return "create_or_repair_site_link";
    case "site_missing_shared_block": return "add_shared_blocks";
    case "site_root_absolute_asset": return "relativize_asset_path";
  }
}

/** Folds every page's observation into one verdict: an unresolvable page wins, otherwise any measured page counts, and an unknown reason survives only when no page could measure. */
function buildCheck(code: DesignAuditCheckCode, all: readonly DesignAuditFinding[], pages: readonly DomAuditObservation[], applicable: boolean): DesignAuditCheck {
  const findings = all.filter((finding) => finding.check_code === code);
  const unresolved = pages.some((page) => page.unknownReasons[code] === "unresolvable_rendering");
  const measurable = !unresolved && pages.some((page) => page.measurable[code]);
  const status = findings.length > 0 ? "fail" : !applicable ? "not_applicable" : measurable ? "pass" : code === "token_usage" ? "skipped" : "unmeasurable";
  const reason = status === "pass" || status === "fail" || status === "not_applicable" ? null : unresolved ? "unresolvable_rendering" : pages[0]?.unknownReasons[code] ?? "no_measurable_candidates";
  return { code, status, reason, findings };
}

/** Resources the render session had to block. Exports open the same session strictly, so a remote frame fails them outright; any other remote URL is advisory. */
async function remoteResourceFindings(session: RenderSession): Promise<readonly DomAuditFinding[]> {
  const frames = await session.page.evaluate(() => [...document.querySelectorAll("iframe[src]")].flatMap((frame) => { try { const url = new URL(frame.getAttribute("src") ?? "", location.href); return url.protocol === "file:" ? [] : [{ path: `${url.protocol}//${url.host}${url.pathname}`, nodeId: frame.getAttribute("data-bg-node-id") }]; } catch { return []; } }));
  const seen = new Set<string>(); const findings: DomAuditFinding[] = [];
  for (const finding of session.findings) {
    if (finding.path === null || seen.has(finding.path) || finding.path === "popup:blocked") continue;
    if (finding.code === "request_failed" ? !isRemoteUrl(finding.path) : finding.code !== "remote_request") continue;
    seen.add(finding.path);
    const frame = frames.find((candidate) => candidate.path === finding.path);
    findings.push(frame === undefined
      ? { code: "remote_resources", severity: "recommended", nodeId: null, evidence: `Remote resource ${finding.path} is blocked in exports; bundle it locally or remove it`, action: "bundle_remote_resource" }
      : { code: "remote_resources", severity: "must_fix", nodeId: frame.nodeId, evidence: `Remote frame ${finding.path}: exports block remote frames and fail`, action: "bundle_remote_resource" });
  }
  return findings;
}

function isRemoteUrl(value: string): boolean { return /^[a-z][a-z\d+.-]*:\/\//iu.test(value) && !value.startsWith("file:"); }

function renderedRawFindings(desktop: DomAuditObservation, narrow: DomAuditObservation): readonly DomAuditFinding[] {
  const desktopFindings = desktop.findings.filter((finding) => finding.code !== "narrow_width");
  const desktopKeys = new Set(desktopFindings.map((finding) => `${finding.code}:${finding.nodeId ?? ""}`));
  const directNarrow = narrow.findings.filter((finding) => finding.code === "narrow_width");
  const directNarrowNodes = new Set(directNarrow.flatMap((finding) => finding.nodeId === null ? [] : [finding.nodeId]));
  const narrowDerived = narrow.findings.filter((finding) => (finding.code === "text_overflow" || finding.code === "element_overlap") && !desktopKeys.has(`${finding.code}:${finding.nodeId ?? ""}`) && (finding.nodeId === null || !directNarrowNodes.has(finding.nodeId))).map((finding): DomAuditFinding => ({ ...finding, code: "narrow_width", severity: "must_fix", action: "repair_narrow_layout", evidence: `Narrow viewport: ${finding.evidence}` }));
  return [...desktopFindings, ...directNarrow, ...narrowDerived];
}

async function enrichFindings(raw: readonly DomAuditFinding[], input: AuditRenderedTreeInput, manifest: CanonicalTreeManifest, relPath: string): Promise<readonly DesignAuditFinding[]> {
  const sorted = [...raw].sort((left, right) => `${DESIGN_AUDIT_CHECK_CODES.indexOf(left.code)}:${left.nodeId ?? ""}:${left.evidence}`.localeCompare(`${DESIGN_AUDIT_CHECK_CODES.indexOf(right.code)}:${right.nodeId ?? ""}:${right.evidence}`));
  const htmlEntry = manifest.files.find((file) => file.path === relPath);
  const html = htmlEntry === undefined ? null : await readFile(resolveWithin(input.projectDir, relPath), "utf8");
  return sorted.map((finding, index) => {
    const source = { rel_path: relPath, node_bg_id: finding.nodeId };
    const base = { id: `${finding.code}:${createHash("sha256").update(`${relPath}\0${finding.nodeId ?? ""}\0${finding.evidence}\0${index}`).digest("hex").slice(0, 24)}`, check_code: finding.code, severity: finding.severity, source, evidence: finding.evidence, ...(finding.measured === undefined ? {} : { measured: finding.measured }), ...(finding.threshold === undefined ? {} : { threshold: finding.threshold }), targeted_action: finding.action };
    if (input.safeFix === false || finding.code !== "minimum_text_size" || finding.nodeId === null || finding.fix === undefined || html === null || htmlEntry === undefined) return base;
    try {
      const node = fingerprintHtmlNode(html, finding.nodeId);
      return { ...base, safe_fix: { kind: "patch_html_node" as const, rel_path: relPath, request: { expected_revision: input.revision, expected_artifact_digest: input.digest, expected_file_hash: htmlEntry.sha256, node_bg_id: finding.nodeId, node_fingerprint: node.fingerprint, styles: { "font-size": finding.fix } } } };
    } catch (error) { if (error instanceof FilePatchError) return base; throw error; }
  });
}

async function readCache(cachePath: string): Promise<DesignAuditResult | null> {
  try { return parseDesignAuditResult(JSON.parse(await readFile(cachePath, "utf8"))); }
  catch (error) { if (error instanceof SyntaxError || error instanceof DesignAuditContractError || error instanceof Error && Reflect.get(error, "code") === "ENOENT") return null; throw error; }
}
async function writeCache(cachePath: string, result: DesignAuditResult): Promise<void> {
  await mkdir(path.dirname(cachePath), { recursive: true }); const temporary = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(result)); await rename(temporary, cachePath); }
  finally { await rm(temporary, { force: true }); }
}
