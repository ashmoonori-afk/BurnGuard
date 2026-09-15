import { isRecord, UpgradeContractError } from "./contract-parser";

export const LAYOUT_SECTION_KINDS = ["layout", "composition", "responsive", "family", "navigation", "hero", "footer"] as const;
export const REQUIRED_LAYOUT_TOKENS = ["--layout-max", "--layout-measure", "--layout-columns", "--layout-gutter", "--layout-margin", "--layout-section-y", "--layout-bp-md", "--layout-hero"] as const;
export type DesignSystemLayout = {
  readonly schema_version: 1;
  readonly tokens: Readonly<Record<string, string>>;
  readonly sections: readonly { readonly kind: (typeof LAYOUT_SECTION_KINDS)[number]; readonly text: string }[];
  readonly supplemented: boolean;
};

const TOKEN_NAME = /^--(?:layout|family)-[a-z0-9-]{1,70}$/;
const TOKEN_VALUE = /^[a-zA-Z0-9\s.,%()+*/"'-]{1,160}$/;

export function extractDesignSystemLayout(css: string, readme: string): DesignSystemLayout {
  const tokens: Record<string, string> = {};
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--(?:layout|family)-[a-z0-9-]+)\s*:\s*([^;{}]+);/gi)) {
    const name = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if ((name in tokens || Object.keys(tokens).length < 64) && TOKEN_NAME.test(name) && TOKEN_VALUE.test(value) && !/url\s*\(/i.test(value)) tokens[name] = value;
  }
  const sections: DesignSystemLayout["sections"][number][] = [];
  for (const match of readme.replace(/```[\s\S]*?```/g, "").matchAll(/^##\s+(Layout|Composition|Responsive[^\r\n]*|Family tokens|Navigation|Hero|Footer)\s*\r?\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/gim)) {
    const kind = match[1]!.toLowerCase().split(" ")[0] as DesignSystemLayout["sections"][number]["kind"];
    const text = match[2]!.replace(/^\|.*$/gm, "").trim().slice(0, 1800);
    if (text && !sections.some(section => section.kind === kind)) sections.push({ kind, text });
  }
  return { schema_version: 1, tokens, sections, supplemented: false };
}

export function supplementDesignSystemLayout(local: DesignSystemLayout, bundled: DesignSystemLayout): DesignSystemLayout {
  const tokens = Object.fromEntries([...Object.entries(local.tokens), ...Object.entries(bundled.tokens).filter(([key]) => !(key in local.tokens))].slice(0, 64));
  const sections = LAYOUT_SECTION_KINDS.flatMap(kind => {
    const section = local.sections.find(section => section.kind === kind) ?? bundled.sections.find(section => section.kind === kind);
    return section ? [section] : [];
  });
  return { schema_version: 1, tokens, sections, supplemented: Object.keys(tokens).length > Object.keys(local.tokens).length || sections.length > local.sections.length };
}

export function missingDesignSystemLayout(layout: DesignSystemLayout): readonly string[] {
  return [...REQUIRED_LAYOUT_TOKENS.filter(name => !layout.tokens[name]), ...LAYOUT_SECTION_KINDS.slice(0, 3).filter(kind => !layout.sections.some(section => section.kind === kind))];
}

export function parseDesignSystemLayout(input: unknown): DesignSystemLayout {
  const invalid = (): never => { throw new UpgradeContractError("invalid_field", "design_system_layout"); };
  if (!isRecord(input) || Object.keys(input).some(key => !["schema_version", "tokens", "sections", "supplemented"].includes(key)) || input.schema_version !== 1 || typeof input.supplemented !== "boolean" || !isRecord(input.tokens) || !Array.isArray(input.sections)) return invalid();
  const tokens: Record<string, string> = {};
  if (Object.keys(input.tokens).length > 64 || input.sections.length > LAYOUT_SECTION_KINDS.length) return invalid();
  for (const [key, value] of Object.entries(input.tokens)) {
    if (!TOKEN_NAME.test(key) || typeof value !== "string" || !TOKEN_VALUE.test(value) || /url\s*\(/i.test(value)) return invalid();
    tokens[key] = value;
  }
  const sections = input.sections.map(section => {
    if (!isRecord(section) || Object.keys(section).length !== 2 || !LAYOUT_SECTION_KINDS.some(kind => kind === section.kind) || typeof section.text !== "string" || section.text.length === 0 || section.text.length > 1800) return invalid();
    return { kind: section.kind as DesignSystemLayout["sections"][number]["kind"], text: section.text };
  });
  if (new Set(sections.map(section => section.kind)).size !== sections.length) return invalid();
  return { schema_version: 1, tokens, sections, supplemented: input.supplemented };
}
