import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  EMPTY_DESIGN_SYSTEM_RULES,
  isDesignSystemRuleKind,
  MAX_DESIGN_SYSTEM_RULES,
  normalizeDesignSystemRuleText,
  parseDesignSystemRuleOrigin,
  parseDesignSystemRules,
  type DesignSystemRule,
  type DesignSystemRuleOrigin,
  type DesignSystemRules,
} from "@bg/shared";
import { getDesignSystemDetail } from "../db/seed";
import { resolveManagedPath, systemsDir } from "../lib/paths";
import { writeTextFileAtomically } from "./atomic-text-file";
import { readDesignSystemSourceFile } from "./design-system-layout";
import { DesignSystemAssetEditError } from "./extraction-asset-errors";

export const DESIGN_SYSTEM_RULES_FILE = "rules.json";

export async function readDesignSystemRules(system: { readonly dir_path: string }): Promise<DesignSystemRules> {
  const text = await readDesignSystemSourceFile(system.dir_path, DESIGN_SYSTEM_RULES_FILE);
  return text ? parseDesignSystemRules(JSON.parse(text)) : EMPTY_DESIGN_SYSTEM_RULES;
}

const queues = new Map<string, Promise<unknown>>();

/** One profile has one backend process, so serializing per system id makes read-modify-write safe. */
function serialized<T>(systemId: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(systemId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  queues.set(systemId, next);
  return next.finally(() => { if (queues.get(systemId) === next) queues.delete(systemId); });
}

async function editableSystemDir(systemId: string): Promise<string> {
  const detail = await getDesignSystemDetail(systemId);
  if (!detail) throw new DesignSystemAssetEditError("design_system_not_found", "Design system not found");
  if (detail.archived_at !== null) throw new DesignSystemAssetEditError("design_system_archived", "Archived design systems cannot be edited");
  const dir = resolveManagedPath(systemsDir, detail.dir_path);
  if (dir !== path.join(systemsDir, systemId)) throw new DesignSystemAssetEditError("unsafe_managed_path", "Design system path is outside its canonical managed directory");
  return dir;
}

async function writeRules(dir: string, rules: DesignSystemRules): Promise<DesignSystemRules> {
  const checked = parseDesignSystemRules(rules);
  await writeTextFileAtomically(path.join(dir, DESIGN_SYSTEM_RULES_FILE), `${JSON.stringify(checked, null, 2)}\n`);
  return checked;
}

export type AddDesignSystemRuleInput = { readonly kind: unknown; readonly text: unknown; readonly origin?: unknown };

export async function addDesignSystemRule(systemId: string, input: AddDesignSystemRuleInput, now = Date.now()): Promise<DesignSystemRules> {
  if (!isDesignSystemRuleKind(input.kind)) throw new DesignSystemAssetEditError("invalid_rule_kind", "Rule kind must be do or dont");
  const text = normalizeDesignSystemRuleText(input.text);
  if (text === null) throw new DesignSystemAssetEditError("invalid_rule_text", "Rule text is empty, too long or contains control characters");
  let origin: DesignSystemRuleOrigin = { type: "manual" };
  if (input.origin !== undefined) {
    try { origin = parseDesignSystemRuleOrigin(input.origin); }
    catch { throw new DesignSystemAssetEditError("invalid_rule_origin", "Rule origin is invalid"); }
  }
  const kind = input.kind;
  return serialized(systemId, async () => {
    const dir = await editableSystemDir(systemId);
    const current = await readDesignSystemRules({ dir_path: dir });
    const duplicate = current.rules.find(rule => rule.kind === kind && rule.text.toLowerCase() === text.toLowerCase());
    if (duplicate) return current;
    if (current.rules.length >= MAX_DESIGN_SYSTEM_RULES) throw new DesignSystemAssetEditError("rule_limit_reached", "This design system already holds the most rules it can");
    const rule: DesignSystemRule = { id: `rule_${randomBytes(8).toString("hex")}`, kind, text, origin, created_at: now };
    return writeRules(dir, { schema_version: 1, rules: [...current.rules, rule] });
  });
}

export async function deleteDesignSystemRule(systemId: string, ruleId: string): Promise<DesignSystemRules> {
  return serialized(systemId, async () => {
    const dir = await editableSystemDir(systemId);
    const current = await readDesignSystemRules({ dir_path: dir });
    if (!current.rules.some(rule => rule.id === ruleId)) throw new DesignSystemAssetEditError("rule_not_found", "Rule not found");
    return writeRules(dir, { schema_version: 1, rules: current.rules.filter(rule => rule.id !== ruleId) });
  });
}
