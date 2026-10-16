import { MAX_DESIGN_SYSTEM_RULE_CHARS, MAX_DESIGN_SYSTEM_RULES, normalizeDesignSystemRuleText } from "./design-system-rules";

/**
 * One-file design-system Markdown: YAML front matter with tokens, then prose sections. The same shape is accepted as an
 * import source and produced as an export, so a system can move between BurnGuard and a coding agent's project root.
 */
export const MAX_DESIGN_MD_BYTES = 256 * 1024;
export const MAX_DESIGN_MD_TOKENS = 200;
export const DESIGN_MD_TOKEN_GROUPS = ["colors", "typography", "spacing", "radius", "shadows", "tokens"] as const;
export type DesignMdTokenGroup = (typeof DESIGN_MD_TOKEN_GROUPS)[number];

export type DesignMdSection = { readonly heading: string; readonly body: string };

export type DesignMd = {
  readonly name: string;
  readonly description: string | null;
  readonly tokens: Readonly<Record<DesignMdTokenGroup, Readonly<Record<string, string>>>>;
  readonly sections: readonly DesignMdSection[];
  readonly dos: readonly string[];
  readonly donts: readonly string[];
};

/** POST /api/design-systems/import-md */
export type ImportDesignMdRequest = { readonly markdown: string; readonly name?: string };

export class DesignMdError extends Error {
  constructor(readonly code: "design_md_too_large" | "design_md_invalid" | "design_md_empty") {
    super(code);
    this.name = "DesignMdError";
  }
}

const TOKEN_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
const SAFE_VALUE = /^[^;{}<>\\]{1,200}$/u;

function unquote(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    // Double-quoted YAML scalars use JSON-compatible escapes; renderDesignMd writes them with JSON.stringify.
    try { const decoded: unknown = JSON.parse(value); if (typeof decoded === "string") return decoded.trim(); } catch { /* fall through to the raw text */ }
    return value.slice(1, -1).trim();
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/gu, "'").trim();
  return value.replace(/\s+#.*$/u, "").trim();
}

function emptyTokens(): Record<DesignMdTokenGroup, Record<string, string>> {
  return { colors: {}, typography: {}, spacing: {}, radius: {}, shadows: {}, tokens: {} };
}

function isGroup(key: string): key is DesignMdTokenGroup {
  return (DESIGN_MD_TOKEN_GROUPS as readonly string[]).includes(key);
}

/** The YAML subset the format uses: top-level scalars and one level of string maps. Anything else is ignored. */
function parseFrontMatter(lines: readonly string[]): { name: string | null; description: string | null; tokens: Record<DesignMdTokenGroup, Record<string, string>> } {
  const tokens = emptyTokens();
  let name: string | null = null;
  let description: string | null = null;
  let group: DesignMdTokenGroup | null = null;
  let count = 0;
  for (const line of lines) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const top = /^([A-Za-z_][\w-]*):\s*(.*)$/u.exec(line);
    if (top) {
      const [, key, rest] = top as unknown as [string, string, string];
      group = rest.trim() === "" && isGroup(key) ? key : null;
      if (key === "name" && rest.trim()) name = unquote(rest).slice(0, 100);
      if (key === "description" && rest.trim()) description = unquote(rest).slice(0, 500);
      continue;
    }
    const nested = /^\s+([A-Za-z][\w-]*):\s*(.+)$/u.exec(line);
    if (nested && group) {
      const key = nested[1]!;
      const value = unquote(nested[2]!);
      if (!TOKEN_NAME.test(key) || !SAFE_VALUE.test(value)) continue;
      if (++count > MAX_DESIGN_MD_TOKENS) throw new DesignMdError("design_md_invalid");
      tokens[group][key] = value;
    }
  }
  return { name, description, tokens };
}

const DO_HEADING = /^(?:do|dos|do's|always)$/iu;
const DONT_HEADING = /^(?:don't|dont|don'ts|donts|do not|never|avoid)$/iu;
const COMBINED_HEADING = /^(?:do'?s?\s+(?:and|&)\s+don'?t'?s?|rules)$/iu;

function bullets(body: string): string[] {
  return body.split("\n").map((line) => /^\s*[-*]\s+(.+)$/u.exec(line)?.[1] ?? null).filter((item): item is string => item !== null);
}

function ruleText(text: string): string | null {
  const plain = text.replace(/\*\*|__|`/gu, "").trim();
  return normalizeDesignSystemRuleText(plain.length > MAX_DESIGN_SYSTEM_RULE_CHARS ? plain.slice(0, MAX_DESIGN_SYSTEM_RULE_CHARS) : plain);
}

export function parseDesignMd(markdown: string, fallbackName = "Imported design"): DesignMd {
  if (new TextEncoder().encode(markdown).length > MAX_DESIGN_MD_BYTES) throw new DesignMdError("design_md_too_large");
  const text = markdown.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  const lines = text.split("\n");
  let body = lines;
  let front: ReturnType<typeof parseFrontMatter> = { name: null, description: null, tokens: emptyTokens() };
  if (lines[0]?.trim() === "---") {
    const end = lines.indexOf("---", 1);
    if (end === -1) throw new DesignMdError("design_md_invalid");
    front = parseFrontMatter(lines.slice(1, end));
    body = lines.slice(end + 1);
  }
  const title = body.find((line) => /^#\s+\S/u.test(line))?.replace(/^#\s+/u, "").trim() ?? null;
  const sections: DesignMdSection[] = [];
  let current: { heading: string; lines: string[] } | null = null;
  for (const line of body) {
    const heading = /^##\s+(.+?)\s*#*\s*$/u.exec(line);
    if (heading) { if (current) sections.push({ heading: current.heading, body: current.lines.join("\n").trim() }); current = { heading: heading[1]!, lines: [] }; continue; }
    current?.lines.push(line);
  }
  if (current) sections.push({ heading: current.heading, body: current.lines.join("\n").trim() });
  const dos: string[] = [];
  const donts: string[] = [];
  for (const section of sections) {
    if (DO_HEADING.test(section.heading)) dos.push(...bullets(section.body));
    else if (DONT_HEADING.test(section.heading)) donts.push(...bullets(section.body));
    else if (COMBINED_HEADING.test(section.heading)) {
      let target: string[] | null = null;
      for (const line of section.body.split("\n")) {
        const sub = /^###\s+(.+?)\s*$/u.exec(line);
        if (sub) { target = DO_HEADING.test(sub[1]!) ? dos : DONT_HEADING.test(sub[1]!) ? donts : null; continue; }
        const item = /^\s*[-*]\s+(.+)$/u.exec(line)?.[1];
        if (!item) continue;
        const prefixed = /^(do(?:n'?t| not)?)\s*:\s*(.+)$/iu.exec(item);
        if (prefixed) (/^do$/iu.test(prefixed[1]!) ? dos : donts).push(prefixed[2]!);
        else target?.push(item);
      }
    }
  }
  const unique = (items: readonly string[]) => [...new Map(items.map(ruleText).filter((item): item is string => item !== null).map((item) => [item.toLowerCase(), item])).values()];
  const keptDos = unique(dos);
  const keptDonts = unique(donts).slice(0, Math.max(0, MAX_DESIGN_SYSTEM_RULES - keptDos.length));
  const tokenCount = Object.values(front.tokens).reduce((sum, group) => sum + Object.keys(group).length, 0);
  if (tokenCount === 0 && sections.length === 0) throw new DesignMdError("design_md_empty");
  return {
    name: (front.name ?? title ?? fallbackName).slice(0, 100),
    description: front.description,
    tokens: front.tokens,
    sections: sections.slice(0, 40).map((section) => ({ heading: section.heading.slice(0, 120), body: section.body.slice(0, 8000) })),
    dos: keptDos.slice(0, MAX_DESIGN_SYSTEM_RULES),
    donts: keptDonts,
  };
}

function yamlValue(value: string): string {
  // Bare only when a YAML reader sees the same string: no "#" (comment), ":" (mapping) or leading digit-only ambiguity.
  return /^[A-Za-z_][\w.%(),\s/-]*$/u.test(value) && !/\s$/u.test(value) ? value : JSON.stringify(value);
}

/** Front matter, then the given prose sections, then Do / Don't lists; parseDesignMd(renderDesignMd(x)) keeps every token and rule. */
export function renderDesignMd(input: DesignMd): string {
  const lines = ["---", `name: ${yamlValue(input.name)}`];
  if (input.description) lines.push(`description: ${yamlValue(input.description)}`);
  for (const group of DESIGN_MD_TOKEN_GROUPS) {
    const entries = Object.entries(input.tokens[group]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (entries.length === 0) continue;
    lines.push(`${group}:`, ...entries.map(([key, value]) => `  ${key}: ${yamlValue(value)}`));
  }
  lines.push("---", "", `# ${input.name}`, "");
  if (input.description) lines.push(input.description, "");
  for (const section of input.sections) {
    if (DO_HEADING.test(section.heading) || DONT_HEADING.test(section.heading) || COMBINED_HEADING.test(section.heading)) continue;
    lines.push(`## ${section.heading}`, "", section.body, "");
  }
  if (input.dos.length) lines.push("## Do", "", ...input.dos.map((rule) => `- ${rule}`), "");
  if (input.donts.length) lines.push("## Don't", "", ...input.donts.map((rule) => `- ${rule}`), "");
  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd()}\n`;
}
