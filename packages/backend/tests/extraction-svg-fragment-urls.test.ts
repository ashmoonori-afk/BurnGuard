import { describe, expect, test } from "bun:test";
import { parse } from "node-html-parser";
import { sanitizeAcquiredWebsiteHtml } from "../src/services/extraction-html";
import { assertInertSourceMarkup } from "../src/services/extraction-safety";

const NBSP = String.fromCharCode(0xa0);
const BACKSLASH = String.fromCharCode(0x5c);
const page = (body: string, head = "") => "<!doctype html><html><head>" + head + "</head><body>" + body + "</body></html>";
const attributes = (html: string) => parse(html).querySelector("path")!.attributes;

describe("In-document fragment references in acquired website HTML", () => {
  test("Given SVG presentation attributes whose whole value is a fragment reference, then the page is accepted with canonical references", () => {
    const stored = sanitizeAcquiredWebsiteHtml(page('<svg><defs><linearGradient id="g"/><filter id="glow"/></defs><path d="M0 0" fill="url(#g)" stroke="url(\'#g\')" filter="url(&quot;#glow&quot;)" marker-end="url(#g)"/></svg>'));
    expect(attributes(stored)).toMatchObject({ fill: "url(#g)", stroke: "url(#g)", filter: "url(#glow)", "marker-end": "url(#g)" });
    expect(() => assertInertSourceMarkup(stored, "html")).not.toThrow();
  });

  test("Given fragment-like values that are not exact references, then the attributes are removed and the page stays inert", () => {
    const stored = sanitizeAcquiredWebsiteHtml(page('<svg><path d="M0 0" fill="url( #g )" stroke="url(' + NBSP + '#g)" filter="url(#g),url(https://evil.test/x)" mask="url(https://evil.test/a.svg#g)" data-bg="url(#g)" clip-path="url(//evil.test/b)"/></svg>'));
    const kept = attributes(stored);
    for (const name of ["fill", "stroke", "filter", "mask", "data-bg", "clip-path"]) expect(kept[name]).toBeUndefined();
    expect(kept.d).toBe("M0 0");
    expect(() => assertInertSourceMarkup(stored, "html")).not.toThrow();
  });

  test("Given CSS contexts, then every url() is treated as network-capable as before, fragments included", () => {
    const stored = sanitizeAcquiredWebsiteHtml(page('<p style="clip-path:url(#c)">x</p>', "<style>.a{clip-path:url(#clip)}</style><style>.b{background:url(https://evil.test/x.png)}</style>"));
    expect(stored).not.toContain("url(");
    for (const markup of [
      "<style>body{background:url(&quot;#g&quot;)}</style>",
      "<style>.a{background-image:url(#g)," + BACKSLASH + "75 rl(https://evil.test/pixel)}</style>",
      '<style>.a{background-image:url(#g),image-set("https://evil.test/pixel" 1x)}</style>',
      "<style>@" + BACKSLASH + "69mport 'https://evil.test/a.css'; .a{fill:url(#g)}</style>",
      "<style>.a{mask:url(" + NBSP + "#g)}</style>",
      '<p style="fill:url(#g)">x</p>',
      '<svg><path fill="url(https://evil.test/a.svg#g)"/></svg>',
      '<svg><path fill="url(#g)" data-x="url(https://evil.test/x)"/></svg>',
    ]) expect(() => assertInertSourceMarkup(page(markup), "html")).toThrow();
  });
});
