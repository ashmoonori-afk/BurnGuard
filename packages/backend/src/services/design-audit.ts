import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DESIGN_AUDIT_CHECK_CODES, DesignAuditContractError, parseDesignAuditResult, type DesignAuditCheck, type DesignAuditCheckCode, type DesignAuditFinding, type DesignAuditResult } from "@bg/shared";
import { getProjectDetail } from "../db/project-read-repository";
import { projectsDir, resolveManagedPath } from "../lib/paths";
import { PathBoundaryError, resolveWithin } from "../security/path-boundary";
import { CanonicalTreeManifestError, inspectCanonicalTree, type CanonicalTreeManifest } from "./canonical-tree-manifest";
import { inspectRenderedPage, type DomAuditFinding, type DomAuditObservation } from "./design-audit-dom";
import { fingerprintHtmlNode, FilePatchError } from "./file-patch";
import { openRenderSession, RenderSessionError } from "./export-render-session";
import { parseStoredProjectOptions } from "./project-options";

export type AuditRenderedTreeInput = { readonly projectId: string; readonly projectDir: string; readonly entrypoint: string; readonly revision: number; readonly digest: string; readonly treeDigest?: string; readonly safeFix?: boolean; readonly deck?: boolean; readonly canvas?: { readonly width: number; readonly height: number }; readonly signal: AbortSignal };
type SerializedAuditInput = Omit<AuditRenderedTreeInput, "signal">;
type AuditWorkerOutput = { readonly ok: true; readonly result: DesignAuditResult } | { readonly ok: false; readonly message: string };
export const DESIGN_AUDIT_WORKER_ARG = "--burnguard-design-audit-worker";
export class DesignAuditServiceError extends Error {
  readonly name = "DesignAuditServiceError";
  constructor(readonly code: "project_not_found" | "project_path_unavailable" | "stale_artifact_identity" | "audit_unavailable", message: string) { super(message); }
}

export async function auditRenderedTreeForExport(input: AuditRenderedTreeInput): Promise<DesignAuditResult> {
  if (process.env.NODE_ENV === "test") return auditRenderedTree(input);
  if (input.signal.aborted) throw new RenderSessionError("render_aborted", "Render was cancelled");
  const serialized: SerializedAuditInput = {
    projectId: input.projectId,
    projectDir: input.projectDir,
    entrypoint: input.entrypoint,
    revision: input.revision,
    digest: input.digest,
    ...(input.treeDigest === undefined ? {} : { treeDigest: input.treeDigest }),
    ...(input.safeFix === undefined ? {} : { safeFix: input.safeFix }),
    ...(input.deck === undefined ? {} : { deck: input.deck }),
    ...(input.canvas === undefined ? {} : { canvas: input.canvas }),
  };
  const compiled = import.meta.dir.startsWith("/$bunfs/");
  const child = Bun.spawn(compiled
    ? [process.execPath, DESIGN_AUDIT_WORKER_ARG]
    : [process.execPath, new URL("../index.ts", import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/u, ""), DESIGN_AUDIT_WORKER_ARG], {
    stdin: new Blob([JSON.stringify(serialized)]),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, BG_CHROMIUM_ASSUME_USABLE: "1" },
  });
  const onAbort = (): void => { child.kill(); };
  input.signal.addEventListener("abort", onAbort, { once: true });
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (input.signal.aborted) throw new RenderSessionError("render_aborted", "Render was cancelled");
    const output = parseAuditWorkerOutput(stdout);
    if (exitCode !== 0 || !output.ok) throw new DesignAuditServiceError("audit_unavailable", output.ok ? stderr || "Rendered audit worker failed" : output.message);
    return output.result;
  } finally {
    input.signal.removeEventListener("abort", onAbort);
    child.kill();
  }
}

export async function runDesignAuditWorkerCommand(): Promise<number> {
  try {
    const input = JSON.parse(await Bun.stdin.text()) as SerializedAuditInput;
    const result = await auditRenderedTree({ ...input, signal: new AbortController().signal });
    process.stdout.write(JSON.stringify({ ok: true, result } satisfies AuditWorkerOutput));
    return 0;
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) } satisfies AuditWorkerOutput));
    return 1;
  }
}

function parseAuditWorkerOutput(raw: string): AuditWorkerOutput {
  const value = JSON.parse(raw) as unknown;
  if (typeof value !== "object" || value === null || typeof Reflect.get(value, "ok") !== "boolean") throw new TypeError("Rendered audit worker returned invalid JSON");
  if (Reflect.get(value, "ok") === false) {
    const message = Reflect.get(value, "message");
    if (typeof message !== "string") throw new TypeError("Rendered audit worker returned an invalid error");
    return { ok: false, message };
  }
  return { ok: true, result: parseDesignAuditResult(Reflect.get(value, "result")) };
}

export async function auditRenderedTree(input: AuditRenderedTreeInput): Promise<DesignAuditResult> {
  const manifest = await inspectCanonicalTree(input.projectDir);
  const expectedTreeDigest = input.treeDigest ?? input.digest;
  if (manifest.tree_digest !== expectedTreeDigest) throw new DesignAuditServiceError("stale_artifact_identity", "Artifact identity changed before audit");
  const observations: DomAuditObservation[] = [];
  const viewports = input.canvas === undefined
    ? [{ width: 1280, height: 900, dpr: 1 }, { width: 375, height: 812, dpr: 1 }] as const
    : [{ width: input.canvas.width, height: input.canvas.height, dpr: 1 }] as const;
  for (const viewport of viewports) {
    const session = await openRenderSession({ stagedDir: input.projectDir, entrypoint: input.entrypoint, viewport, deck: input.deck ?? false, strict: false, signal: input.signal });
    try { observations.push(await inspectRenderedPage(session.page)); } finally { await session.close(); }
  }
  const current = await inspectCanonicalTree(input.projectDir);
  if (current.tree_digest !== expectedTreeDigest) throw new DesignAuditServiceError("stale_artifact_identity", "Artifact identity changed during audit");
  const desktop = observations[0]; const narrow = observations[1] ?? desktop;
  if (desktop === undefined || narrow === undefined) throw new DesignAuditServiceError("audit_unavailable", "Rendered audit observations are unavailable");
  const desktopFindings = desktop.findings.filter((finding) => finding.code !== "narrow_width"); const desktopKeys = new Set(desktopFindings.map((finding) => `${finding.code}:${finding.nodeId ?? ""}`));
  const directNarrow = narrow.findings.filter((finding) => finding.code === "narrow_width"); const directNarrowNodes = new Set(directNarrow.flatMap((finding) => finding.nodeId === null ? [] : [finding.nodeId]));
  const narrowDerived = narrow.findings.filter((finding) => (finding.code === "text_overflow" || finding.code === "element_overlap") && !desktopKeys.has(`${finding.code}:${finding.nodeId ?? ""}`) && (finding.nodeId === null || !directNarrowNodes.has(finding.nodeId))).map((finding): DomAuditFinding => ({ ...finding, code: "narrow_width", severity: "must_fix", action: "repair_narrow_layout", evidence: `Narrow viewport: ${finding.evidence}` }));
  const raw = [...desktopFindings, ...directNarrow, ...narrowDerived];
  const findings = await enrichFindings(raw.slice(0, 200), input, manifest);
  const checks = DESIGN_AUDIT_CHECK_CODES.map((code) => buildCheck(code, findings, code === "narrow_width" ? narrow : desktop));
  const overall = findings.some((finding) => finding.severity === "must_fix") ? "must_fix" : checks.every((check) => check.status === "pass") ? "ready" : "recommended";
  return parseDesignAuditResult({ schema_version: 1, project_id: input.projectId, artifact_revision: input.revision, artifact_digest: input.digest, created_at: Date.now(), overall_status: overall, checks });
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
  try { cachePath = resolveWithin(projectDir, ".meta", "audits", `${project.current_revision}-${project.current_digest}.json`); }
  catch (error) { if (error instanceof PathBoundaryError) throw new DesignAuditServiceError("project_path_unavailable", "Project audit cache is outside managed storage"); throw error; }
  if (!force) {
    const cached = await readCache(cachePath);
    if (cached !== null && cached.project_id === projectId && cached.artifact_revision === project.current_revision && cached.artifact_digest === project.current_digest) return cached;
  }
  let result: DesignAuditResult;
  const graphicCanvas = project.type === "graphic"
    ? parseStoredProjectOptions(project.options_json).graphic_canvas ?? undefined
    : undefined;
  try { result = await auditRenderedTree({ projectId, projectDir, entrypoint: project.entrypoint, revision: project.current_revision, digest: project.current_digest, deck: project.type === "slide_deck", ...(graphicCanvas === undefined ? {} : { canvas: graphicCanvas }), signal }); }
  catch (error) { if (error instanceof RenderSessionError || error instanceof CanonicalTreeManifestError) throw new DesignAuditServiceError("audit_unavailable", "Rendered audit is unavailable"); throw error; }
  const after = await getProjectDetail(projectId);
  if (after === null || after.current_revision !== result.artifact_revision || after.current_digest !== result.artifact_digest) throw new DesignAuditServiceError("stale_artifact_identity", "Artifact identity changed during audit");
  await writeCache(cachePath, result);
  return result;
}

function buildCheck(code: DesignAuditCheckCode, all: readonly DesignAuditFinding[], observation: DomAuditObservation): DesignAuditCheck {
  const findings = all.filter((finding) => finding.check_code === code);
  const status = findings.length > 0 ? "fail" : observation.measurable[code] ? "pass" : code === "token_usage" ? "skipped" : "unmeasurable";
  const reason = status === "pass" || status === "fail" ? null : observation.unknownReasons[code] ?? "no_measurable_candidates";
  return { code, status, reason, findings };
}

async function enrichFindings(raw: readonly DomAuditFinding[], input: AuditRenderedTreeInput, manifest: CanonicalTreeManifest): Promise<readonly DesignAuditFinding[]> {
  const sorted = [...raw].sort((left, right) => `${DESIGN_AUDIT_CHECK_CODES.indexOf(left.code)}:${left.nodeId ?? ""}:${left.evidence}`.localeCompare(`${DESIGN_AUDIT_CHECK_CODES.indexOf(right.code)}:${right.nodeId ?? ""}:${right.evidence}`));
  const htmlEntry = manifest.files.find((file) => file.path === input.entrypoint);
  const html = htmlEntry === undefined ? null : await readFile(resolveWithin(input.projectDir, input.entrypoint), "utf8");
  return sorted.map((finding, index) => {
    const source = { rel_path: input.entrypoint, node_bg_id: finding.nodeId };
    const base = { id: `${finding.code}:${createHash("sha256").update(`${input.entrypoint}\0${finding.nodeId ?? ""}\0${finding.evidence}\0${index}`).digest("hex").slice(0, 24)}`, check_code: finding.code, severity: finding.severity, source, evidence: finding.evidence, ...(finding.measured === undefined ? {} : { measured: finding.measured }), ...(finding.threshold === undefined ? {} : { threshold: finding.threshold }), targeted_action: finding.action };
    if (input.safeFix === false || finding.code !== "minimum_text_size" || finding.nodeId === null || html === null || htmlEntry === undefined) return base;
    try {
      const node = fingerprintHtmlNode(html, finding.nodeId);
      return { ...base, safe_fix: { kind: "patch_html_node" as const, rel_path: input.entrypoint, request: { expected_revision: input.revision, expected_artifact_digest: input.digest, expected_file_hash: htmlEntry.sha256, node_bg_id: finding.nodeId, node_fingerprint: node.fingerprint, styles: { "font-size": "12px" } } } };
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
