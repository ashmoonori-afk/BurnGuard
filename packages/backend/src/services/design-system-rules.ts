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

/** Strict read for edits: a malformed rules.json is reported instead of silently replaced by a rewrite. */
async function readRulesForEdit(dir: string): Promise<DesignSystemRules> {
  const text = await readDesignSystemSourceFile(dir, DESIGN_SYSTEM_RULES_FILE);
  if (!text) return EMPTY_DESIGN_SYSTEM_RULES;
  try { return parseDesignSystemRules(JSON.parse(text)); }
  catch { throw new DesignSystemAssetEditError("rules_file_invalid", "The rule list file is damaged"); }
}

/**
 * Lenient read for generation and display: a damaged rules.json must not stop every generation on the system or hide
 * the panel that repairs it, so it reads as no rules. Rules that still parse one by one are kept.
 */
export async function readDesignSystemRules(system: { readonly dir_path: string }): Promise<DesignSystemRules> {
  let text: string;
  try { text = await readDesignSystemSourceFile(system.dir_path, DESIGN_SYSTEM_RULES_FILE); }
  catch { return EMPTY_DESIGN_SYSTEM_RULES; }
  if (!text) return EMPTY_DESIGN_SYSTEM_RULES;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return EMPTY_DESIGN_SYSTEM_RULES; }
  try { return parseDesignSystemRules(value); } catch { /* keep the rules that are individually valid */ }
  const entries = typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "rules")) ? (Reflect.get(value, "rules") as unknown[]) : [];
  const kept: DesignSystemRule[] = [];
  for (const entry of entries.slice(0, MAX_DESIGN_SYSTEM_RULES)) {
    try { kept.push(...parseDesignSystemRules({ schema_version: 1, rules: [...kept, entry] }).rules.slice(kept.length)); } catch { /* skip this entry */ }
  }
  return { schema_version: 1, rules: kept };
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
    const current = await readRulesForEdit(dir);
    const duplicate = current.rules.find(rule => rule.kind === kind && rule.text.toLowerCase() === text.toLowerCase());
    if (duplicate) return current;
    if (current.rules.length >= MAX_DESIGN_SYSTEM_RULES) throw new DesignSystemAssetEditError("rule_limit_reached", "This design system already holds the most rules it can");
    const rule: DesignSystemRule = { id: `rule_${randomBytes(8).toString("hex")}`, kind, text, origin, created_at: now };
    return writeRules(dir, { schema_version: 1, rules: [...current.rules, rule] });
  });
}

/** Adds several rules in one write, so an import never leaves a half-written list. Duplicates and overflow are skipped. */
export async function addDesignSystemRules(systemId: string, inputs: readonly { readonly kind: "do" | "dont"; readonly text: string }[], origin: DesignSystemRuleOrigin, now = Date.now()): Promise<DesignSystemRules> {
  return serialized(systemId, async () => {
    const dir = await editableSystemDir(systemId);
    const current = await readRulesForEdit(dir);
    const rules = [...current.rules];
    for (const input of inputs) {
      const text = normalizeDesignSystemRuleText(input.text);
      if (text === null || rules.length >= MAX_DESIGN_SYSTEM_RULES) continue;
      if (rules.some(rule => rule.kind === input.kind && rule.text.toLowerCase() === text.toLowerCase())) continue;
      rules.push({ id: `rule_${randomBytes(8).toString("hex")}`, kind: input.kind, text, origin, created_at: now });
    }
    return writeRules(dir, { schema_version: 1, rules });
  });
}

export async function deleteDesignSystemRule(systemId: string, ruleId: string): Promise<DesignSystemRules> {
  return serialized(systemId, async () => {
    const dir = await editableSystemDir(systemId);
    const current = await readRulesForEdit(dir);
    if (!current.rules.some(rule => rule.id === ruleId)) throw new DesignSystemAssetEditError("rule_not_found", "Rule not found");
    return writeRules(dir, { schema_version: 1, rules: current.rules.filter(rule => rule.id !== ruleId) });
  });
}
