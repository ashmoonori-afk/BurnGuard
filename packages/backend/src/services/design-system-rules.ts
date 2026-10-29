import { randomBytes } from "node:crypto";
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
import { authoringContentEnvironment, publishAuthoringFiles, withEditableSystemContent, type AuthoringEnvironment } from "./design-system-authoring";
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

async function editRules(
  systemId: string, env: AuthoringEnvironment,
  transform: (current: DesignSystemRules) => DesignSystemRules,
): Promise<DesignSystemRules> {
  return withEditableSystemContent(env, systemId, async (base, lease) => {
    const current = await readRulesForEdit(base.live);
    const next = transform(current);
    if (next === current) return current;
    const checked = parseDesignSystemRules(next);
    const result = await publishAuthoringFiles(env, base, lease, "rules", [
      { path: DESIGN_SYSTEM_RULES_FILE, bytes: `${JSON.stringify(checked, null, 2)}\n` },
    ]);
    return readRulesForEdit(result.observation.live);
  });
}

export type AddDesignSystemRuleInput = { readonly kind: unknown; readonly text: unknown; readonly origin?: unknown };

export async function addDesignSystemRule(systemId: string, input: AddDesignSystemRuleInput, now = Date.now(), env: AuthoringEnvironment = authoringContentEnvironment()): Promise<DesignSystemRules> {
  if (!isDesignSystemRuleKind(input.kind)) throw new DesignSystemAssetEditError("invalid_rule_kind", "Rule kind must be do or dont");
  const text = normalizeDesignSystemRuleText(input.text);
  if (text === null) throw new DesignSystemAssetEditError("invalid_rule_text", "Rule text is empty, too long or contains control characters");
  let origin: DesignSystemRuleOrigin = { type: "manual" };
  if (input.origin !== undefined) {
    try { origin = parseDesignSystemRuleOrigin(input.origin); }
    catch { throw new DesignSystemAssetEditError("invalid_rule_origin", "Rule origin is invalid"); }
  }
  const kind = input.kind;
  return editRules(systemId, env, current => {
    const duplicate = current.rules.find(rule => rule.kind === kind && rule.text.toLowerCase() === text.toLowerCase());
    if (duplicate) return current;
    if (current.rules.length >= MAX_DESIGN_SYSTEM_RULES) throw new DesignSystemAssetEditError("rule_limit_reached", "This design system already holds the most rules it can");
    const rule: DesignSystemRule = { id: `rule_${randomBytes(8).toString("hex")}`, kind, text, origin, created_at: now };
    return { schema_version: 1, rules: [...current.rules, rule] };
  });
}

/** Adds several rules in one write, so an import never leaves a half-written list. Duplicates and overflow are skipped. */
export async function addDesignSystemRules(systemId: string, inputs: readonly { readonly kind: "do" | "dont"; readonly text: string }[], origin: DesignSystemRuleOrigin, now = Date.now(), env: AuthoringEnvironment = authoringContentEnvironment()): Promise<DesignSystemRules> {
  return editRules(systemId, env, current => {
    const rules = [...current.rules];
    for (const input of inputs) {
      const text = normalizeDesignSystemRuleText(input.text);
      if (text === null || rules.length >= MAX_DESIGN_SYSTEM_RULES) continue;
      if (rules.some(rule => rule.kind === input.kind && rule.text.toLowerCase() === text.toLowerCase())) continue;
      rules.push({ id: `rule_${randomBytes(8).toString("hex")}`, kind: input.kind, text, origin, created_at: now });
    }
    return rules.length === current.rules.length ? current : { schema_version: 1, rules };
  });
}

export async function deleteDesignSystemRule(systemId: string, ruleId: string, env: AuthoringEnvironment = authoringContentEnvironment()): Promise<DesignSystemRules> {
  return editRules(systemId, env, current => {
    if (!current.rules.some(rule => rule.id === ruleId)) throw new DesignSystemAssetEditError("rule_not_found", "Rule not found");
    return { schema_version: 1, rules: current.rules.filter(rule => rule.id !== ruleId) };
  });
}
