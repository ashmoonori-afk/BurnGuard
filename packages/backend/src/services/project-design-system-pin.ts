import path from "node:path";
import { createHash } from "node:crypto";
import type { ProjectDesignSystemPin } from "@bg/shared/project";
import { canonicalPinContent, parseCanonicalPinContent, type CanonicalPinSelection } from "@bg/shared/canonical-pin";
import { UpgradeContractError } from "@bg/shared/contract-parser";
import type { ProjectBundleDesignSystemPin } from "@bg/shared/project-bundle";
import { surfaceForProjectType } from "@bg/shared";
import { getSqlite } from "../db/sqlite-client";
import { getDesignSystemDetail } from "../db/seed";
import { getProjectDetail } from "../db/project-read-repository";
import { systemsDir, resolveManagedPath } from "../lib/paths";
import { appendDesignSystemContext } from "../harness/prompt-design-system";
import { readDesignSystemSourceFile } from "./design-system-layout";
import { assertSystemContentLease, type SystemContentLease } from "./system-content-access";
import { withCatalogSnapshot, type CatalogAccessEvents } from "./catalog-snapshot";
import { SystemContentError } from "./system-content-format";
import { readOwnedCanonical } from "./design-system-canonical";
import { paletteContentEnvironment } from "./design-system-palette";
import { observeSystemContent } from "./system-content-publication";

export type DesignSystemPin = {
  readonly system_id: string; readonly revision: number; readonly digest: string;
  readonly context: string; readonly tokens: string; readonly format?: "canonical-v1";
};
export class DesignSystemPinError extends Error {
  constructor(readonly code: "pin_unavailable" | "pin_conflict" | "pin_corrupt") { super(code); }
}
export function designSystemPinDigest(pin: { readonly context: string; readonly tokens: string; readonly format?: "canonical-v1" }): string {
  if (pin.context.length > 100_000 || pin.tokens.length > 262_144) throw new DesignSystemPinError("pin_corrupt");
  if (pin.format === "canonical-v1") {
    try { parseCanonicalPinContent(pin); }
    catch (error) { if (error instanceof UpgradeContractError) throw new DesignSystemPinError("pin_corrupt"); throw error; }
  }
  return createHash("sha256").update(JSON.stringify(pin.format === "canonical-v1"
    ? ["burnguard-canonical-pin-v1", pin.context, pin.tokens] : [pin.context, pin.tokens])).digest("hex");
}

export function readProjectDesignSystemPin(projectId: string): DesignSystemPin | null {
  const statement = getSqlite().prepare<Omit<DesignSystemPin, "format"> & { readonly format: unknown }, [string]>(
    "SELECT system_id,revision,digest,context,tokens,format FROM project_design_system_pins WHERE project_id=?",
  );
  try {
    const row = statement.get(projectId);
    if (row === null) return null;
    if (row.format !== null && row.format !== "canonical-v1") throw new DesignSystemPinError("pin_corrupt");
    const { format, ...legacy } = row;
    const pin: DesignSystemPin = format === null ? legacy : { ...legacy, format };
    if (!Number.isSafeInteger(pin.revision) || pin.revision < 1 || typeof pin.context !== "string" ||
      typeof pin.tokens !== "string" || designSystemPinDigest(pin) !== pin.digest) throw new DesignSystemPinError("pin_corrupt");
    return pin;
  } finally { statement.finalize(); }
}

async function candidate(projectId: string, lease?: SystemContentLease, events: CatalogAccessEvents = {},
  selection?: CanonicalPinSelection): Promise<Omit<DesignSystemPin, "revision"> | null> {
  const project = await getProjectDetail(projectId);
  if (!project) throw new DesignSystemPinError("pin_unavailable");
  if (!project.design_system_id) return null;
  if (lease === undefined) {
    try {
      return await withCatalogSnapshot(getSqlite(), systemsDir, project.design_system_id,
        owned => candidate(projectId, owned, events, selection), events);
    } catch (error) {
      if (error instanceof SystemContentError || error instanceof UpgradeContractError) throw new DesignSystemPinError("pin_unavailable");
      throw error;
    }
  }
  assertSystemContentLease(lease, systemsDir, project.design_system_id);
  const system = await getDesignSystemDetail(project.design_system_id);
  if (!system || system.archived_at !== null) throw new DesignSystemPinError("pin_unavailable");
  resolveManagedPath(systemsDir, system.dir_path);
  if (selection !== undefined) {
    const environment = paletteContentEnvironment();
    const snapshot = await readOwnedCanonical(environment, await observeSystemContent(environment, system.id, lease), lease);
    if (snapshot === null) throw new DesignSystemPinError("pin_unavailable");
    const content = { ...canonicalPinContent(snapshot.theme, selection.mode), format: "canonical-v1" as const };
    return { system_id: system.id, ...content, digest: designSystemPinDigest(content) };
  }
  const tokens = system.tokens_css_path ? await readDesignSystemSourceFile(system.dir_path, path.relative(system.dir_path, system.tokens_css_path)) : "";
  const lines: string[] = [];
  await appendDesignSystemContext(lines, system, "full", surfaceForProjectType(project.type), true, lease);
  const context = lines.join("\n");
  if (context.length > 100_000) throw new DesignSystemPinError("pin_unavailable");
  return { system_id: system.id, digest: designSystemPinDigest({ context, tokens }), context, tokens };
}

/** New projects pin at creation; older projects pin on their first use after upgrade. */
export async function ensureProjectDesignSystemPin(projectId: string, lease?: SystemContentLease, events: CatalogAccessEvents = {}): Promise<DesignSystemPin | null> {
  const existing = readProjectDesignSystemPin(projectId);
  if (existing) return existing;
  const next = await candidate(projectId, lease, events);
  if (!next) return null;
  const statement = getSqlite().prepare("INSERT OR IGNORE INTO project_design_system_pins(project_id,system_id,revision,digest,context,tokens) VALUES (?,?,1,?,?,?)");
  try { statement.run(projectId, next.system_id, next.digest, next.context, next.tokens); }
  finally { statement.finalize(); }
  return readProjectDesignSystemPin(projectId);
}

/** Authorized bundle import supplies only the validated closed machine block, never archived prose. */
export function installImportedCanonicalPin(projectId: string, systemId: string, pin: ProjectBundleDesignSystemPin): void {
  if (pin.format !== "canonical-v1" || pin.schema_version !== 2 || pin.revision < 1 ||
    designSystemPinDigest(pin) !== pin.digest) throw new DesignSystemPinError("pin_corrupt");
  const parsed = parseCanonicalPinContent(pin);
  const content = canonicalPinContent(parsed.theme, parsed.mode);
  const statement = getSqlite().prepare(`INSERT INTO project_design_system_pins
    (project_id,system_id,revision,digest,context,tokens,format) VALUES (?,?,?,?,?,?,'canonical-v1')`);
  try { statement.run(projectId, systemId, pin.revision, pin.digest, content.context, content.tokens); }
  finally { statement.finalize(); }
}

function selectedMode(pin: DesignSystemPin): CanonicalPinSelection | undefined {
  return pin.format === "canonical-v1" ? { format: "canonical-v1", mode: parseCanonicalPinContent(pin).mode } : undefined;
}

/** The context without the Do / Don't rule block and its REQUIRED line, to tell a rule-only change apart. */
function withoutRuleBlock(context: string): string {
  return context.replace(/<selected_design_system_rules>\n[^\n]*\n<\/selected_design_system_rules>\n[^\n]*\n\n?/gu, "");
}

export async function inspectProjectDesignSystemPin(projectId: string, events: CatalogAccessEvents = {},
  selection?: CanonicalPinSelection): Promise<ProjectDesignSystemPin | null> {
  const current = await ensureProjectDesignSystemPin(projectId);
  if (!current) return null;
  const currentSelection = selectedMode(current);
  const nextSelection = selection ?? currentSelection;
  const next = await candidate(projectId, undefined, events, nextSelection);
  if (!next || next.system_id !== current.system_id) throw new DesignSystemPinError("pin_conflict");
  return { revision: current.revision, digest: current.digest, candidate_digest: next.digest,
    ...(currentSelection === undefined ? {} : currentSelection),
    ...(nextSelection === undefined ? {} : { candidate_format: nextSelection.format, candidate_mode: nextSelection.mode }),
    rules_changed: current.context !== next.context, tokens_changed: current.tokens !== next.tokens,
    rules_only_changed: current.format === undefined && next.format === undefined &&
      current.context !== next.context && current.tokens === next.tokens && withoutRuleBlock(current.context) === withoutRuleBlock(next.context) };
}

export async function refreshProjectDesignSystemPin(projectId: string, expected: string, candidateDigest: string,
  selection?: CanonicalPinSelection): Promise<void> {
  const current = readProjectDesignSystemPin(projectId);
  if (current === null || current.digest !== expected) throw new DesignSystemPinError("pin_conflict");
  const next = await candidate(projectId, undefined, {}, selection ?? selectedMode(current));
  if (!next || next.digest !== candidateDigest) throw new DesignSystemPinError("pin_conflict");
  const statement = getSqlite().prepare(`UPDATE project_design_system_pins SET revision=revision+1,digest=?,context=?,tokens=?,format=?
    WHERE project_id=? AND digest=? AND system_id=?
      AND NOT EXISTS (SELECT 1 FROM sessions WHERE project_id=? AND status IN ('running','awaiting_tool'))`);
  try {
    const changes = statement.run(next.digest, next.context, next.tokens, next.format ?? null, projectId, expected, next.system_id, projectId).changes;
    if (changes !== 1) throw new DesignSystemPinError("pin_conflict");
  } finally { statement.finalize(); }
}
