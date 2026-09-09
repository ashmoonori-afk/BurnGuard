import postcss, { CssSyntaxError, type Declaration } from "postcss";

type ParseRequest = {
  readonly content: string;
  readonly sourceId: string;
  readonly fileOrder: number;
  readonly declarationLimit: number;
  readonly issueLimit: number;
};

type CssParseIssue = {
  readonly key: string;
  readonly reason: "malformed_css" | "unsupported_css_value" | "css_declaration_limit" | "css_issue_limit";
  readonly sourceLocator: string;
};

type CssDeclarationEvidence = {
  readonly property: string;
  readonly value: string;
  readonly sourceLocator: string;
  readonly fileOrder: number;
  readonly declarationOrder: number;
  readonly parseStatus: "observed";
};

self.onmessage = (event: MessageEvent<ParseRequest>): void => {
  const request = event.data;
  try {
    // `map: false` keeps PostCSS from following a `sourceMappingURL` comment to
    // a file on this host; the CSS is untrusted and only its declarations matter.
    const root = postcss.parse(request.content, { from: request.sourceId, map: false });
    const declarations: CssDeclarationEvidence[] = [];
    const issues: CssParseIssue[] = [];
    let declarationOrder = 0;
    root.walkDecls((declaration) => {
      declarationOrder += 1;
      const locator = locatorFor(declaration, request.sourceId);
      if (declarationOrder > request.declarationLimit) {
        if (issues.every((issue) => issue.reason !== "css_declaration_limit")) {
          issues.push({ key: "css-declarations", reason: "css_declaration_limit", sourceLocator: locator });
        }
        return;
      }
      const property = declaration.prop.trim().toLowerCase();
      const value = declaration.value.trim();
      if (!property || !value) return;
      if (!isSafeExtractedCssValue(value)) {
        if (issues.length < request.issueLimit) {
          issues.push({ key: property.replace(/^--/, "") || "unsupported", reason: "unsupported_css_value", sourceLocator: locator });
        } else if (issues.every((issue) => issue.reason !== "css_issue_limit")) {
          issues.push({ key: "css-issues", reason: "css_issue_limit", sourceLocator: locator });
        }
        return;
      }
      declarations.push({ property, value, sourceLocator: locator, fileOrder: request.fileOrder, declarationOrder, parseStatus: "observed" });
    });
    postMessage({ kind: "result", result: { declarations, issues } });
  } catch (error) {
    if (error instanceof CssSyntaxError) {
      postMessage({
        kind: "result",
        result: {
          declarations: [],
          issues: [{ key: "css-parse", reason: "malformed_css", sourceLocator: `${request.sourceId}:${error.line ?? 1}:${error.column ?? 1}` }],
        },
      });
    } else {
      postMessage({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    close();
  }
};

function locatorFor(declaration: Declaration, sourceId: string): string {
  return `${sourceId}:${declaration.source?.start?.line ?? 1}:${declaration.source?.start?.column ?? 1}`;
}

function isSafeExtractedCssValue(value: string): boolean {
  return value.length <= 140 && !/[{}<>\n\r]/.test(value) && !/(?:url\s*\(|@import|expression\s*\(|javascript:|data:)/i.test(value);
}
