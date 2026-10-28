import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseTokenAuditSource, SOURCE_LIMITS } from "../src/services/token-audit-source";
import colours from "./fixtures/theme-engine/audit/expected-colours.json";
import radius from "./fixtures/theme-engine/audit/expected-radius.json";
import spacing from "./fixtures/theme-engine/audit/expected-spacing.json";
import fontSize from "./fixtures/theme-engine/audit/expected-font-size.json";
import shadows from "./fixtures/theme-engine/audit/expected-shadows.json";

const audit = path.join(import.meta.dir, "fixtures/theme-engine/audit");

describe("authored token audit source IR", () => {
  test("Given immutable labels, When original CSS and HTML are parsed, Then all 135 backend source assertions retain their known literals", async () => {
    // Given: hand-authored labels predate this parser; expected positions come from their source lines.
    const files = new Map<string, string>();
    let checked = 0;
    for (const expected of [colours, radius, spacing, fontSize, shadows]) {
      for (const [id, file, line, , property, value, literal] of expected.cases) {
        if (typeof id !== "string" || typeof file !== "string" || typeof line !== "number"
          || typeof property !== "string" || typeof value !== "string" || typeof literal !== "string") {
          throw new TypeError("Invalid immutable fixture label");
        }
        if (file.endsWith(".tsx.txt")) continue;
        const text = files.get(file) ?? await readFile(path.join(audit, file), "utf8");
        files.set(file, text);
        const lines = text.split("\n");
        const authoredLine = lines[line - 1] ?? "";
        expect(authoredLine, id).toContain(literal);
        const lineStart = lines.slice(0, line - 1).reduce((sum, entry) => sum + entry.length + 1, 0);
        const propertyColumn = authoredLine.indexOf(`${property}:`);
        expect(propertyColumn, id).toBeGreaterThanOrEqual(0);
        const valueColumn = authoredLine.indexOf(value, propertyColumn + property.length + 1);
        expect(valueColumn, id).toBeGreaterThanOrEqual(0);
        // When: never parse a reconstructed declaration or parser-generated text.
        const result = parseTokenAuditSource({ file, kind: file.endsWith(".html") ? "html" : "css", text });
        // Then: cycles stay syntactically located, with semantics deliberately left to later analysis.
        expect(result.unresolved, id).toEqual([]);
        const declarations = result.declarations.filter(d => d.property === property && d.valueSpan.line === line);
        expect(declarations, id).toHaveLength(1);
        const declaration = declarations[0];
        expect(declaration?.value, id).toBe(value);
        expect(declaration?.valueSpan, id).toEqual({
          start: lineStart + valueColumn, end: lineStart + valueColumn + value.length, line, column: valueColumn + 1,
        });
        expect(declaration?.propertySpan, id).toEqual({
          start: lineStart + propertyColumn, end: lineStart + propertyColumn + property.length, line, column: propertyColumn + 1,
        });
        checked += 1;
      }
    }
    expect(checked).toBe(135);
  });

  test("Given CRLF and astral characters, When nested CSS is parsed, Then UTF16 spans and authored contexts preserve duplicate order", () => {
    // Given
    const text = '/* \u{1f600} */\r\n@media (prefers-color-scheme: dark) {\r\n.a { & .child { color: red; color: blue !important; } }\r\n}';
    // When
    const result = parseTokenAuditSource({ file: "styles\\authored.css", kind: "css", text });
    // Then: offsets are independently counted from these fixed input literals, not parser positions.
    expect(result.unresolved).toEqual([]);
    expect(result.declarations.map(d => [d.order, d.property, d.value, d.important, d.selector])).toEqual([
      [0, "color", "red", false, "& .child"], [1, "color", "blue", true, "& .child"],
    ]);
    expect(result.declarations.map(d => d.valueSpan)).toEqual([
      { start: text.indexOf("red"), end: text.indexOf("red") + "red".length, line: 3, column: 24 },
      { start: text.indexOf("blue"), end: text.indexOf("blue") + "blue".length, line: 3, column: 36 },
    ]);
    expect(result.declarations[0]?.context.map(c => [c.kind, c.name, c.params])).toEqual([
      ["at-rule", "media", "(prefers-color-scheme: dark)"], ["selector", ".a", ""], ["selector", "& .child", ""],
    ]);
    expect(result.declarations.every(d => d.file === "styles\\authored.css")).toBe(true);
    for (const declaration of result.declarations) {
      expect(text.slice(declaration.valueSpan.start, declaration.valueSpan.end)).toBe(declaration.value);
      expect(text.slice(declaration.propertySpan.start, declaration.propertySpan.end)).toBe("color");
    }
  });

  test("Given HTML with raw text and quoted angle brackets, When parsed, Then style blocks and attributes use original offsets", () => {
    // Given
    const text = '<div title=">" hidden style="color: red; color: blue">\r\n<style>.a { padding: 8px; }</style></div>';
    // When
    const result = parseTokenAuditSource({ file: "page.html", kind: "html", text });
    // Then
    expect(result.unresolved).toEqual([]);
    expect(result.declarations.map(d => [d.origin, d.value, d.valueSpan])).toEqual([
      ["style-attribute", "red", { start: text.indexOf("red"), end: text.indexOf("red") + 3, line: 1, column: '<div title=">" hidden style="color: '.length + 1 }],
      ["style-attribute", "blue", { start: text.indexOf("blue"), end: text.indexOf("blue") + 4, line: 1, column: '<div title=">" hidden style="color: red; color: '.length + 1 }],
      ["style-element", "8px", { start: text.indexOf("8px"), end: text.indexOf("8px") + 3, line: 2, column: "<style>.a { padding: ".length + 1 }],
    ]);
    expect(result.declarations[0]?.selector).toBeNull();
    expect(result.declarations[0]?.context[0]?.params).toBe('<div title=">" hidden style="color: red; color: blue">');
    expect(result.declarations[2]?.context.map(c => c.name)).toEqual(["div", "style", ".a"]);
  });

  test.each([
    ['<div style="color: &#35;446688"></div>', "html-entity"],
    ['<div style="color: &bogus;"></div>', "html-entity"],
    ['<div style="color: red" style="color: blue"></div>', "malformed-html"],
    ['<div style="color: red"></span>', "malformed-html"],
    ['<div style="color: red>', "malformed-html"],
    ['<style>.a { color: red; }', "malformed-html"],
    ['<style type="text/scss">$x: red;</style>', "unsupported-syntax"],
    ['<plaintext><div style="color: red"></div>', "unsupported-syntax"],
    ['<svg><style>.a { color: red; }</style></svg>', "unsupported-syntax"],
    ['<div style="color: ${theme}"></div>', "dynamic-source"],
    ['<link rel="stylesheet" href="https://invalid.test/a.css">', "external-stylesheet"],
    ['<script>throw new Error("must not execute");</script>', "script"],
  ])("Given unsupported HTML %s, When parsed, Then %s is unresolved without declarations", (text, reason) => {
    // Given / When
    const result = parseTokenAuditSource({ file: "input.html", kind: "html", text });
    // Then
    expect(result.declarations).toEqual([]);
    expect(result.unresolved.some(item => item.reason === reason)).toBe(true);
  });

  test.each([
    [".a { color: red", "malformed-css"],
    [".a { color red; }", "malformed-css"],
    ["color: red;", "unsupported-syntax"],
    ["@media screen { color: red; }", "unsupported-syntax"],
    [".a { color: 'red; }", "malformed-css"],
    [".a { color: ${theme}; }", "dynamic-source"],
    ["$selector { color: red; }", "dynamic-source"],
    ["@unknown { .a { color: red; } }", "unsupported-syntax"],
    ['@import "https://invalid.test/a.css";', "external-stylesheet"],
    [".a { _color: red; }", "unresolvable-location"],
    [".a { color: expression(window.colour); }", "unsupported-syntax"],
    [".a {".repeat(SOURCE_LIMITS.depth + 1) + "}".repeat(SOURCE_LIMITS.depth + 1), "depth-budget"],
    [".a { color: " + "url(".repeat(40_000) + "; }", "depth-budget"],
  ])("Given unsupported CSS, When parsed, Then the boundary is unresolved without safe spans", (text, reason) => {
    // Given / When
    const result = parseTokenAuditSource({ file: "input.css", kind: "css", text });
    // Then
    expect(result.declarations).toEqual([]);
    expect(result.unresolved.some(item => item.reason === reason)).toBe(true);
  });

  test("Given comments and escaped strings, When parsed, Then raw values include comments but exclude important and delimiters", () => {
    // Given
    const text = '@media screen/**/and (color) { .a/**/.b { color /*x*/ : /*lead*/ red/**/ blue ! IMPORTANT; content: "a;}:\\\"b"; } }';
    // When
    const result = parseTokenAuditSource({ file: "a.css", kind: "css", text });
    // Then
    expect(result.unresolved).toEqual([]);
    expect(result.declarations.map(d => [d.value, d.important])).toEqual([["red/**/ blue", true], ['"a;}:\\\"b"', false]]);
    expect(result.declarations[0]?.selector).toBe(".a/**/.b");
    expect(result.declarations[0]?.context[0]?.params).toBe("screen/**/and (color)");
    for (const d of result.declarations) expect(text.slice(d.valueSpan.start, d.valueSpan.end)).toBe(d.value);
  });

  test("Given non-ASCII and astral selectors, When parsed, Then same-line columns count original UTF16 units", () => {
    // Given
    const prefix = ".\u00e9\u{1f600} { color: ";
    const text = prefix + "red; }";
    // When
    const result = parseTokenAuditSource({ file: "unicode.css", kind: "css", text });
    // Then
    expect(result.unresolved).toEqual([]);
    expect(result.declarations[0]?.valueSpan).toEqual({
      start: prefix.length, end: prefix.length + 3, line: 1, column: prefix.length + 1,
    });
    expect(result.declarations[0]?.selector).toBe(".\u00e9\u{1f600}");
  });

  test("Given a multibyte source over the byte budget, When parsed, Then no truncated source is accepted", () => {
    // Given
    const text = "\u00e9".repeat(Math.floor(SOURCE_LIMITS.cssBytes / 2) + 1);
    // When
    const result = parseTokenAuditSource({ file: "large.css", kind: "css", text });
    // Then
    expect(result).toEqual({ declarations: [], unresolved: [{ file: "large.css", reason: "source-budget", region: null }] });
  });

  test("Given too many declarations, When parsed, Then the bounded prefix carries an explicit unresolved remainder", () => {
    // Given
    const text = ".a{" + "color:red;".repeat(SOURCE_LIMITS.items + 1) + "}";
    // When
    const result = parseTokenAuditSource({ file: "many.css", kind: "css", text });
    // Then
    expect(result.declarations).toHaveLength(SOURCE_LIMITS.items - 1);
    expect(result.unresolved.map(item => item.reason)).toContain("item-budget");
  });
});
