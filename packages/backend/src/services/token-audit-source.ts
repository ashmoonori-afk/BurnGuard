import { MAX_CSS_BYTES, MAX_CSS_DECLARATIONS, MAX_CSS_ISSUES, MAX_HTML_BYTES, MAX_LOCAL_DEPTH, MAX_PARSED_ITEMS } from "./extraction-acquisition";
import { collectCssSource } from "./token-audit-source-css";
import { collectHtmlSource } from "./token-audit-source-html";

/** Internal source IR, not an audit verdict, transport DTO, or replacement authorization. */
export type TokenAuditSourceInput = {
  readonly file: string;
  readonly kind: "css" | "html";
  readonly text: string;
};
/** Zero-based UTF-16 offsets, end exclusive; line and column are one-based UTF-16. */
export type SourceSpan = { readonly start: number; readonly end: number; readonly line: number; readonly column: number };
export type SourceContext = {
  readonly kind: "selector" | "at-rule" | "element";
  readonly name: string;
  readonly params: string;
  readonly span: SourceSpan;
};
export type SourceDeclaration = {
  readonly file: string;
  readonly origin: "stylesheet" | "style-element" | "style-attribute";
  readonly order: number;
  readonly property: string;
  readonly value: string;
  readonly important: boolean;
  /** The immediate authored rule, never a guessed expansion of nesting. Null for inline styles. */
  readonly selector: string | null;
  readonly context: readonly SourceContext[];
  readonly span: SourceSpan;
  readonly propertySpan: SourceSpan;
  readonly valueSpan: SourceSpan;
};
export type SourceUnresolvedReason =
  | "source-budget" | "item-budget" | "depth-budget" | "malformed-css" | "malformed-html"
  | "unresolvable-location" | "html-entity" | "dynamic-source" | "unsupported-syntax"
  | "external-stylesheet" | "script";
export type SourceUnresolved = {
  readonly file: string;
  readonly reason: SourceUnresolvedReason;
  /** Only a known enclosing source region; never a value replacement span. */
  readonly region: SourceSpan | null;
};
export type TokenAuditSource = {
  readonly declarations: readonly SourceDeclaration[];
  readonly unresolved: readonly SourceUnresolved[];
};

export const SOURCE_LIMITS = {
  cssBytes: MAX_CSS_BYTES, htmlBytes: MAX_HTML_BYTES, declarations: MAX_CSS_DECLARATIONS,
  issues: MAX_CSS_ISSUES, items: MAX_PARSED_ITEMS, depth: MAX_LOCAL_DEPTH,
} as const;

/** Private mutable collector shared by the two parsers; all budgets apply to one complete file. */
export class SourceCollector {
  readonly declarations: SourceDeclaration[] = [];
  readonly unresolved: SourceUnresolved[] = [];
  private readonly lines = [0];
  private items = 0;
  constructor(readonly input: TokenAuditSourceInput) {
    for (let i = 0; i < input.text.length; i += 1) {
      if (input.text[i] === "\r") {
        if (input.text[i + 1] === "\n") i += 1;
        this.lines.push(i + 1);
      } else if (input.text[i] === "\n") this.lines.push(i + 1);
    }
  }
  span(start: number, end: number): SourceSpan {
    let low = 0;
    let high = this.lines.length;
    while (low + 1 < high) {
      const mid = Math.floor((low + high) / 2);
      if ((this.lines[mid] ?? 0) <= start) low = mid;
      else high = mid;
    }
    return { start, end, line: low + 1, column: start - (this.lines[low] ?? 0) + 1 };
  }
  issue(reason: SourceUnresolvedReason, region: SourceSpan | null): void {
    if (this.unresolved.length < SOURCE_LIMITS.issues) this.unresolved.push({ file: this.input.file, reason, region });
  }
  consume(): boolean {
    this.items += 1;
    if (this.items <= SOURCE_LIMITS.items) return true;
    this.issue("item-budget", null);
    return false;
  }
  add(declaration: Omit<SourceDeclaration, "file" | "order">): void {
    if (this.declarations.length >= SOURCE_LIMITS.declarations) {
      this.issue("item-budget", null);
      return;
    }
    this.declarations.push({ ...declaration, file: this.input.file, order: this.declarations.length });
  }
}

/** Parses supplied original text only. No filesystem reads, resource fetching, or script execution. */
export function parseTokenAuditSource(input: TokenAuditSourceInput): TokenAuditSource {
  const maximum = input.kind === "css" ? SOURCE_LIMITS.cssBytes : SOURCE_LIMITS.htmlBytes;
  if (input.text.length > maximum || Buffer.byteLength(input.text, "utf8") > maximum) {
    return { declarations: [], unresolved: [{ file: input.file, reason: "source-budget", region: null }] };
  }
  const collector = new SourceCollector(input);
  switch (input.kind) {
    case "css":
      collectCssSource(collector, { start: 0, end: input.text.length, origin: "stylesheet", context: [] });
      break;
    case "html":
      collectHtmlSource(collector);
      break;
    default: {
      const exhaustive: never = input.kind;
      return exhaustive;
    }
  }
  return { declarations: collector.declarations, unresolved: collector.unresolved };
}
