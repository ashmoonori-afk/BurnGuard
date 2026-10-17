import { isRecord, UpgradeContractError } from "./contract-parser";

/**
 * Explicit "Do / Don't" rules of one design system, stored as `rules.json` in the system directory and injected
 * verbatim into every generation that uses the system. A rule written from a chat correction records where it came from.
 */
export const DESIGN_SYSTEM_RULE_KINDS = ["do", "dont"] as const;
export type DesignSystemRuleKind = (typeof DESIGN_SYSTEM_RULE_KINDS)[number];

/** Most rules one system may hold; a longer list stops being read by the model as rules. */
export const MAX_DESIGN_SYSTEM_RULES = 60;
/** Longest rule text in characters after whitespace is collapsed. */
export const MAX_DESIGN_SYSTEM_RULE_CHARS = 280;

export type DesignSystemRuleOrigin =
  | { readonly type: "manual" }
  | { readonly type: "imported" }
  | { readonly type: "correction"; readonly project_id: string; readonly message_id: string | null };

export type DesignSystemRule = {
  readonly id: string;
  readonly kind: DesignSystemRuleKind;
  readonly text: string;
  readonly origin: DesignSystemRuleOrigin;
  readonly created_at: number;
};

export type DesignSystemRules = {
  readonly schema_version: 1;
  readonly rules: readonly DesignSystemRule[];
};

/** POST /api/design-systems/:id/rules */
export type AddDesignSystemRuleRequest = {
  readonly kind: DesignSystemRuleKind;
  readonly text: string;
  readonly origin?: DesignSystemRuleOrigin;
};

export const EMPTY_DESIGN_SYSTEM_RULES: DesignSystemRules = { schema_version: 1, rules: [] };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

/** Collapses whitespace; null when the text is empty, too long or carries control characters. */
export function normalizeDesignSystemRuleText(input: unknown): string | null {
  if (typeof input !== "string") return null;
  if ([...input].some(isForbiddenControlCharacter)) return null;
  const text = input.replace(/\s+/gu, " ").trim();
  return text === "" || text.length > MAX_DESIGN_SYSTEM_RULE_CHARS ? null : text;
}

function isForbiddenControlCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code < 0x20 && char !== "\t" && char !== "\n" && char !== "\r") || code === 0x7f;
}

export function isDesignSystemRuleKind(value: unknown): value is DesignSystemRuleKind {
  return value === "do" || value === "dont";
}

export function parseDesignSystemRuleOrigin(input: unknown, at = "$.origin"): DesignSystemRuleOrigin {
  if (!isRecord(input)) throw new UpgradeContractError("expected_object", at);
  if (input.type === "manual" || input.type === "imported") return { type: input.type };
  if (input.type !== "correction") throw new UpgradeContractError("unknown_discriminant", `${at}.type`);
  if (typeof input.project_id !== "string" || !ID_PATTERN.test(input.project_id)) throw new UpgradeContractError("invalid_field", `${at}.project_id`);
  const messageId = input.message_id ?? null;
  if (messageId !== null && (typeof messageId !== "string" || !ID_PATTERN.test(messageId))) throw new UpgradeContractError("invalid_field", `${at}.message_id`);
  return { type: "correction", project_id: input.project_id, message_id: messageId };
}

/** Strict parser for `rules.json`; an unknown schema, a duplicate id or an over-long list is rejected, never trimmed. */
export function parseDesignSystemRules(input: unknown): DesignSystemRules {
  if (!isRecord(input)) throw new UpgradeContractError("expected_object", "$");
  if (input.schema_version !== 1) throw new UpgradeContractError("invalid_field", "$.schema_version");
  if (!Array.isArray(input.rules)) throw new UpgradeContractError("missing_required_field", "$.rules");
  if (input.rules.length > MAX_DESIGN_SYSTEM_RULES) throw new UpgradeContractError("invalid_field", "$.rules");
  const seen = new Set<string>();
  const rules = input.rules.map((value: unknown, index: number): DesignSystemRule => {
    const at = `$.rules[${index}]`;
    if (!isRecord(value)) throw new UpgradeContractError("expected_object", at);
    if (typeof value.id !== "string" || !ID_PATTERN.test(value.id) || seen.has(value.id)) throw new UpgradeContractError("invalid_field", `${at}.id`);
    seen.add(value.id);
    if (!isDesignSystemRuleKind(value.kind)) throw new UpgradeContractError("invalid_field", `${at}.kind`);
    const text = normalizeDesignSystemRuleText(value.text);
    if (text === null) throw new UpgradeContractError("invalid_field", `${at}.text`);
    if (typeof value.created_at !== "number" || !Number.isFinite(value.created_at)) throw new UpgradeContractError("invalid_field", `${at}.created_at`);
    return { id: value.id, kind: value.kind, text, origin: parseDesignSystemRuleOrigin(value.origin, `${at}.origin`), created_at: value.created_at };
  });
  return { schema_version: 1, rules };
}
