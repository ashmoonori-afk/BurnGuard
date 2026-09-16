import path from "node:path";
import { createHash } from "node:crypto";
import type { ProjectDesignSystemPin } from "@bg/shared/project";
import { surfaceForProjectType } from "@bg/shared";
import { getSqlite } from "../db/sqlite-client";
import { getDesignSystemDetail } from "../db/seed";
import { getProjectDetail } from "../db/project-read-repository";
import { systemsDir, resolveManagedPath } from "../lib/paths";
import { appendDesignSystemContext } from "../harness/prompt-design-system";
import { readDesignSystemSourceFile } from "./design-system-layout";

export type DesignSystemPin = { system_id: string; revision: number; digest: string; context: string; tokens: string };
export class DesignSystemPinError extends Error {
  constructor(readonly code: "pin_unavailable" | "pin_conflict" | "pin_corrupt") { super(code); }
}
const hash = (context: string, tokens: string) => createHash("sha256").update(JSON.stringify([context, tokens])).digest("hex");

export function readProjectDesignSystemPin(projectId: string): DesignSystemPin | null {
  const pin = getSqlite().query<DesignSystemPin, [string]>("SELECT system_id,revision,digest,context,tokens FROM project_design_system_pins WHERE project_id=?").get(projectId);
  if (pin && (pin.context.length > 100_000 || pin.tokens.length > 262_144 || hash(pin.context, pin.tokens) !== pin.digest)) throw new DesignSystemPinError("pin_corrupt");
  return pin;
}

async function candidate(projectId: string): Promise<Omit<DesignSystemPin, "revision"> | null> {
  const project = await getProjectDetail(projectId);
  if (!project) throw new DesignSystemPinError("pin_unavailable");
  if (!project.design_system_id) return null;
  const system = await getDesignSystemDetail(project.design_system_id);
  if (!system || system.archived_at !== null) throw new DesignSystemPinError("pin_unavailable");
  resolveManagedPath(systemsDir, system.dir_path);
  const tokens = system.tokens_css_path ? await readDesignSystemSourceFile(system.dir_path, path.relative(system.dir_path, system.tokens_css_path)) : "";
  const lines: string[] = [];
  await appendDesignSystemContext(lines, system, "full", surfaceForProjectType(project.type), true);
  const context = lines.join("\n");
  if (context.length > 100_000) throw new DesignSystemPinError("pin_unavailable");
  return { system_id: system.id, digest: hash(context, tokens), context, tokens };
}

/** New projects pin at creation; older projects pin on their first use after upgrade. */
export async function ensureProjectDesignSystemPin(projectId: string): Promise<DesignSystemPin | null> {
  const existing = readProjectDesignSystemPin(projectId);
  if (existing) return existing;
  const next = await candidate(projectId);
  if (!next) return null;
  getSqlite().prepare("INSERT OR IGNORE INTO project_design_system_pins(project_id,system_id,revision,digest,context,tokens) VALUES (?,?,1,?,?,?)")
    .run(projectId, next.system_id, next.digest, next.context, next.tokens);
  return readProjectDesignSystemPin(projectId);
}

export async function inspectProjectDesignSystemPin(projectId: string): Promise<ProjectDesignSystemPin | null> {
  const current = await ensureProjectDesignSystemPin(projectId);
  if (!current) return null;
  const next = await candidate(projectId);
  if (!next || next.system_id !== current.system_id) throw new DesignSystemPinError("pin_conflict");
  return { revision: current.revision, digest: current.digest, candidate_digest: next.digest,
    rules_changed: current.context !== next.context, tokens_changed: current.tokens !== next.tokens };
}

export async function refreshProjectDesignSystemPin(projectId: string, expected: string, candidateDigest: string): Promise<void> {
  const next = await candidate(projectId);
  if (!next || next.digest !== candidateDigest) throw new DesignSystemPinError("pin_conflict");
  const changes = getSqlite().prepare(`UPDATE project_design_system_pins SET revision=revision+1,digest=?,context=?,tokens=?
    WHERE project_id=? AND digest=? AND system_id=?
      AND NOT EXISTS (SELECT 1 FROM sessions WHERE project_id=? AND status IN ('running','awaiting_tool'))`)
    .run(next.digest, next.context, next.tokens, projectId, expected, next.system_id, projectId).changes;
  if (changes !== 1) throw new DesignSystemPinError("pin_conflict");
}
