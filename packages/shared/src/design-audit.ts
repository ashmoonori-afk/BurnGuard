import type { PatchFileRequest } from "./file-patch";

export const DESIGN_AUDIT_CHECK_CODES = ["text_overflow", "element_overlap", "minimum_text_size", "contrast", "narrow_width", "duplicate_node_id", "missing_image", "token_usage", "site_nav_mismatch", "site_missing_aria_current", "site_dangling_link", "site_missing_shared_block", "site_root_absolute_asset", "font_consistency", "copy_review"] as const;
export type DesignAuditCheckCode = (typeof DESIGN_AUDIT_CHECK_CODES)[number];
export type DesignAuditCheckStatus = "pass" | "fail" | "skipped" | "unmeasurable";
export type DesignAuditOverallStatus = "ready" | "must_fix" | "recommended";
export type DesignAuditUnknownReason = "no_measurable_candidates" | "unresolvable_rendering" | "tokens_not_exposed";
export type DesignAuditSeverity = "must_fix" | "recommended";
export type DesignAuditTargetedAction = "expand_or_reflow_text" | "separate_overlapping_elements" | "set_minimum_font_size" | "increase_color_contrast" | "repair_narrow_layout" | "assign_unique_node_ids" | "restore_image_reference" | "replace_literal_with_token" | "repair_site_navigation" | "mark_current_page" | "create_or_repair_site_link" | "add_shared_blocks" | "relativize_asset_path" | "align_font_roles" | "revise_copy";

export type DesignAuditSafeFix = { readonly kind: "patch_html_node"; readonly rel_path: string; readonly request: PatchFileRequest };
export type DesignAuditFinding = {
  readonly id: string;
  readonly check_code: DesignAuditCheckCode;
  readonly severity: DesignAuditSeverity;
  readonly source: { readonly rel_path: string; readonly node_bg_id: string | null };
  readonly evidence: string;
  readonly measured?: number;
  readonly threshold?: number;
  readonly targeted_action: DesignAuditTargetedAction;
  readonly safe_fix?: DesignAuditSafeFix;
};
export type DesignAuditCheck = { readonly code: DesignAuditCheckCode; readonly status: DesignAuditCheckStatus; readonly reason: DesignAuditUnknownReason | null; readonly findings: readonly DesignAuditFinding[] };
export type DesignAuditResult = { readonly schema_version: 1; readonly project_id: string; readonly artifact_revision: number; readonly artifact_digest: string; readonly created_at: number; readonly overall_status: DesignAuditOverallStatus; readonly checks: readonly DesignAuditCheck[]; readonly shared_change_divergence?: readonly string[] };

const SHA256 = /^[0-9a-f]{64}$/u;
const REL_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[^\0]{1,512}$/u;
const SEVERITIES: Readonly<Record<DesignAuditCheckCode, DesignAuditSeverity>> = { text_overflow: "must_fix", element_overlap: "recommended", minimum_text_size: "recommended", contrast: "must_fix", narrow_width: "must_fix", duplicate_node_id: "must_fix", missing_image: "must_fix", token_usage: "recommended", site_nav_mismatch: "recommended", site_missing_aria_current: "recommended", site_dangling_link: "recommended", site_missing_shared_block: "recommended", site_root_absolute_asset: "recommended", font_consistency: "recommended", copy_review: "recommended" };
const ACTIONS: Readonly<Record<DesignAuditCheckCode, DesignAuditTargetedAction>> = {
  font_consistency: "align_font_roles", copy_review: "revise_copy",
  text_overflow: "expand_or_reflow_text", element_overlap: "separate_overlapping_elements", minimum_text_size: "set_minimum_font_size", contrast: "increase_color_contrast", narrow_width: "repair_narrow_layout", duplicate_node_id: "assign_unique_node_ids", missing_image: "restore_image_reference", token_usage: "replace_literal_with_token", site_nav_mismatch: "repair_site_navigation", site_missing_aria_current: "mark_current_page", site_dangling_link: "create_or_repair_site_link", site_missing_shared_block: "add_shared_blocks", site_root_absolute_asset: "relativize_asset_path",
};

export class DesignAuditContractError extends Error {
  readonly name = "DesignAuditContractError";
  constructor(readonly path: string) { super(`Invalid design audit result at ${path}`); }
}

export function parseDesignAuditResult(input: unknown): DesignAuditResult {
  const root = plainRecord(input, "$");
  exact(root, ["schema_version", "project_id", "artifact_revision", "artifact_digest", "created_at", "overall_status", "checks", "shared_change_divergence"], { path: "$", optional: ["shared_change_divergence"] });
  if (root["schema_version"] !== 1) invalid("schema_version");
  const projectId = boundedString(root["project_id"], "project_id", 200);
  const artifactRevision = safeInteger(root["artifact_revision"], "artifact_revision");
  const artifactDigest = hash(root["artifact_digest"], "artifact_digest");
  const createdAt = safeInteger(root["created_at"], "created_at");
  const overallStatus = oneOf(root["overall_status"], "overall_status", ["ready", "must_fix", "recommended"] as const);
  const rawChecks = root["checks"];
  if (!Array.isArray(rawChecks) || rawChecks.length !== DESIGN_AUDIT_CHECK_CODES.length) invalid("checks");
  const checks = DESIGN_AUDIT_CHECK_CODES.map((code, index) => parseCheck(rawChecks[index], code, `checks.${index}`));
  const findings = checks.flatMap((check) => check.findings);
  if (findings.length > 200 || new Set(findings.map((finding) => finding.id)).size !== findings.length) invalid("checks.findings");
  if (findings.some((finding) => finding.safe_fix !== undefined && (finding.safe_fix.request.expected_revision !== artifactRevision || finding.safe_fix.request.expected_artifact_digest !== artifactDigest))) invalid("checks.findings.safe_fix");
  const expected: DesignAuditOverallStatus = findings.some((finding) => finding.severity === "must_fix") ? "must_fix" : checks.every((check) => check.status === "pass") ? "ready" : "recommended";
  if (overallStatus !== expected) invalid("overall_status");
  const divergenceValue = root["shared_change_divergence"];
  let sharedChangeDivergence: readonly string[] | undefined;
  if (divergenceValue !== undefined) {
    if (!Array.isArray(divergenceValue) || divergenceValue.length > 24) invalid("shared_change_divergence");
    sharedChangeDivergence = divergenceValue.map((value, index) => relativePath(value, `shared_change_divergence.${index}`));
    if (new Set(sharedChangeDivergence).size !== sharedChangeDivergence.length) invalid("shared_change_divergence");
  }
  return { schema_version: 1, project_id: projectId, artifact_revision: artifactRevision, artifact_digest: artifactDigest, created_at: createdAt, overall_status: overallStatus, checks, ...(sharedChangeDivergence === undefined ? {} : { shared_change_divergence: sharedChangeDivergence }) };
}

function parseCheck(input: unknown, expectedCode: DesignAuditCheckCode, path: string): DesignAuditCheck {
  const value = record(input, path, ["code", "status", "reason", "findings"]);
  if (value["code"] !== expectedCode) invalid(`${path}.code`);
  const status = oneOf(value["status"], `${path}.status`, ["pass", "fail", "skipped", "unmeasurable"] as const);
  const reasonValue = value["reason"];
  const reason = reasonValue === null ? null : oneOf(reasonValue, `${path}.reason`, ["no_measurable_candidates", "unresolvable_rendering", "tokens_not_exposed"] as const);
  if ((status === "pass" || status === "fail") !== (reason === null)) invalid(`${path}.reason`);
  if (status === "skipped" && (expectedCode !== "token_usage" || reason !== "tokens_not_exposed")) invalid(`${path}.reason`);
  if (status === "unmeasurable" && reason === "tokens_not_exposed") invalid(`${path}.reason`);
  if (!Array.isArray(value["findings"])  || value["findings"].length > 200) invalid(`${path}.findings`);
  const findings = value["findings"].map((finding, index) => parseFinding(finding, expectedCode, `${path}.findings.${index}`));
  if ((status === "fail") !== (findings.length > 0)) invalid(`${path}.status`);
  return { code: expectedCode, status, reason, findings };
}

function parseFinding(input: unknown, code: DesignAuditCheckCode, path: string): DesignAuditFinding {
  const raw = plainRecord(input, path);
  const allowed = ["id", "check_code", "severity", "source", "evidence", "measured", "threshold", "targeted_action", "safe_fix"];
  exact(raw, allowed, { path, optional: ["measured", "threshold", "safe_fix"] });
  const id = boundedString(raw["id"], `${path}.id`, 240);
  if (raw["check_code"] !== code) invalid(`${path}.check_code`);
  const severity = oneOf(raw["severity"], `${path}.severity`, ["must_fix", "recommended"] as const);
  if (severity !== SEVERITIES[code]) invalid(`${path}.severity`);
  const sourceRaw = record(raw["source"], `${path}.source`, ["rel_path", "node_bg_id"]);
  const relPath = relativePath(sourceRaw["rel_path"], `${path}.source.rel_path`);
  const nodeValue = sourceRaw["node_bg_id"];
  const nodeBgId = nodeValue === null ? null : boundedString(nodeValue, `${path}.source.node_bg_id`, 200);
  const evidence = boundedString(raw["evidence"], `${path}.evidence`, 500);
  if (raw["targeted_action"] !== ACTIONS[code]) invalid(`${path}.targeted_action`);
  const measured = optionalFinite(raw["measured"], `${path}.measured`);
  const threshold = optionalFinite(raw["threshold"], `${path}.threshold`);
  const safeFix = raw["safe_fix"] === undefined ? undefined : parseSafeFix({ input: raw["safe_fix"], code, relPath, nodeBgId, path: `${path}.safe_fix` });
  return { id, check_code: code, severity, source: { rel_path: relPath, node_bg_id: nodeBgId }, evidence, ...(measured === undefined ? {} : { measured }), ...(threshold === undefined ? {} : { threshold }), targeted_action: ACTIONS[code], ...(safeFix === undefined ? {} : { safe_fix: safeFix }) };
}

function parseSafeFix(context: { readonly input: unknown; readonly code: DesignAuditCheckCode; readonly relPath: string; readonly nodeBgId: string | null; readonly path: string }): DesignAuditSafeFix {
  const { input, code, relPath, nodeBgId, path } = context;
  if (code !== "minimum_text_size" || nodeBgId === null) invalid(path);
  const raw = record(input, path, ["kind", "rel_path", "request"]);
  if (raw["kind"] !== "patch_html_node" || raw["rel_path"] !== relPath) invalid(path);
  const request = record(raw["request"], `${path}.request`, ["expected_revision", "expected_artifact_digest", "expected_file_hash", "node_bg_id", "node_fingerprint", "styles"]);
  const styles = record(request["styles"], `${path}.request.styles`, ["font-size"]);
  if (request["node_bg_id"] !== nodeBgId || (styles["font-size"] !== "12px" && styles["font-size"] !== "24px")) invalid(`${path}.request`);
  const parsed: PatchFileRequest = { expected_revision: safeInteger(request["expected_revision"], `${path}.request.expected_revision`), expected_artifact_digest: hash(request["expected_artifact_digest"], `${path}.request.expected_artifact_digest`), expected_file_hash: hash(request["expected_file_hash"], `${path}.request.expected_file_hash`), node_bg_id: nodeBgId, node_fingerprint: hash(request["node_fingerprint"], `${path}.request.node_fingerprint`), styles: { "font-size": styles["font-size"] } };
  return { kind: "patch_html_node", rel_path: relPath, request: parsed };
}

function record(value: unknown, path: string, keys: readonly string[]): Readonly<Record<string, unknown>> { const output = plainRecord(value, path); exact(output, keys, { path, optional: [] }); return output; }
function plainRecord(value: unknown, path: string): Readonly<Record<string, unknown>> { if (!isObjectRecord(value)) invalid(path); return value; }
function isObjectRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Readonly<Record<string, unknown>>, keys: readonly string[], options: { readonly path: string; readonly optional: readonly string[] }): void { const actual = Object.keys(value).sort(); const expected = keys.filter((key) => !options.optional.includes(key) || Object.hasOwn(value, key)).sort(); if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(options.path); }
function boundedString(value: unknown, path: string, max: number): string { if (typeof value !== "string" || value.length === 0 || value.length > max || value.includes("\0")) invalid(path); return value; }
function relativePath(value: unknown, path: string): string { const output = boundedString(value, path, 512); if (!REL_PATH.test(output)) invalid(path); return output; }
function hash(value: unknown, path: string): string { if (typeof value !== "string" || !SHA256.test(value)) invalid(path); return value; }
function safeInteger(value: unknown, path: string): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid(path); return value; }
function optionalFinite(value: unknown, path: string): number | undefined { if (value === undefined) return undefined; if (typeof value !== "number" || !Number.isFinite(value)) invalid(path); return value; }
function oneOf<const T extends readonly string[]>(value: unknown, path: string, choices: T): T[number] { if (typeof value !== "string" || !choices.includes(value)) invalid(path); return value;
}
function invalid(path: string): never { throw new DesignAuditContractError(path); }
