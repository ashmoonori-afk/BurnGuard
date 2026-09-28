import { describe, expect, test } from "bun:test";
import { parse } from "node-html-parser";
import { sanitizeAcquiredWebsiteHtml, sanitizeSourceHtml } from "../src/services/extraction-html";
import { assertInertSourceMarkup } from "../src/services/extraction-safety";

const NBSP = String.fromCharCode(0xa0);
const BACKSLASH = String.fromCharCode(0x5c);
const page = (body: string, head = "") => "<!doctype html><html><head>" + head + "</head><body>" + body + "</body></html>";

describe("url() outside style contexts in acquired and source HTML", () => {
  test("Given SVG presentation attributes with fragment references, then the page is accepted and those attributes are removed", () => {
    const stored = sanitizeAcquiredWebsiteHtml(page('<svg><defs><linearGradient id="g"/></defs><path d="M0 0" fill="url(#g)" stroke="url( \'#g\' )" filter="url(&quot;#glow&quot;)" class="x y y z"/></svg>'));
    const path = parse(stored).querySelector("path")!.attributes;
    expect(path).toEqual({ d: "M0 0", class: "x y y z" });
    expect(() => assertInertSourceMarkup(stored, "html")).not.toThrow();
  });

  test("Given attributes carrying network or disguised url() values, then website acquisition removes them and source sanitization still rejects them as on main", () => {
    const body = '<svg><path d="M0 0" fill="url(https://evil.test/a.svg#g)" stroke="url(' + NBSP + '#g)" mask="&#117;rl(https://evil.test/m)" data-bg="url(//evil.test/b)"/></svg>';
    const stored = sanitizeAcquiredWebsiteHtml(page(body));
    expect(stored).not.toMatch(/evil\.test|&#117;rl/);
    expect(() => assertInertSourceMarkup(stored, "html")).not.toThrow();
    expect(() => sanitizeSourceHtml(page(body))).toThrow();
  });

  test("Given the payloads from review, then the inert gate rejects every one, including duplicates and entity-encoded values", () => {
    for (const markup of [
      '<svg><path fill="url(#g)"/></svg>',
      '<svg><path fill="&#117;rl(https://evil.test/a.svg#g)"/></svg>',
      '<svg><path fill="&#117;rl(https://evil.test/a.svg#g)" fill="url(#g)"/></svg>',
      '<svg><path FILL="x" fill="y"/></svg>',
      "<style>body{background-image:image-set('https://evil.test/ fill=\"url(#g)\"' 1x)}</style>",
      '<svg><path fill="url(#g)"/></svg><style>body{background-image:image-set("https://evil.test/pixel" 1x)}</style>',
      "<style>.a{background-image:url(#g)," + BACKSLASH + "75 rl(https://evil.test/pixel)}</style>",
      "<style>@" + BACKSLASH + "69mport 'https://evil.test/a.css'; .a{fill:url(#g)}</style>",
      "<style>body{background:url(&quot;#g&quot;)}</style>",
      "<style>.a{mask:url(" + NBSP + "#g)}</style>",
      '<p style="fill:url(#g)">x</p>',
    ]) expect(() => assertInertSourceMarkup(page(markup), "html")).toThrow();
  });

  test("Given a sanitized page with duplicate attributes, then publication validation still refuses it", () => {
    expect(() => sanitizeSourceHtml(page('<svg><path fill="&#117;rl(https://evil.test/a.svg#g)" fill="url(#g)"/></svg>'))).toThrow();
  });
});

describe("CSS contexts and attribute bounds", () => {
  const mixed = [
    '<svg><path fill="url(#g)"/></svg><style>body{background-image:image-set("https://evil.test/pixel" 1x)}</style>',
    '<svg><path fill="url(#g)"/></svg><style>.a{background:' + BACKSLASH + '75 rl(https://evil.test/pixel)}</style>',
    '<svg><path fill="url(#g)"/></svg><style>@' + BACKSLASH + '69mport "https://evil.test/a.css";</style>',
    '<svg><path fill="url(#g)"/></svg><p style="background:-webkit-image-set(' + "'https://evil.test/x' 1x)" + '">x</p>',
    '<svg><path fill="url(#g)"/></svg><svg><rect cursor="&#92;75 rl(https://evil.test/cursor.png), auto"/></svg>',
    '<svg><path fill="url(#g)"/></svg><style>body{background:' + BACKSLASH + '75\r\nrl(https://evil.test/pixel)}</style>',
    '<svg><path fill="url(#g)"/></svg><style>@' + BACKSLASH + '69\r\nmport "https://evil.test/a.css";</style>',
    '<svg><path fill="url(#g)"/></svg><style>body{background:' + BACKSLASH + '75\frl(https://evil.test/pixel)}</style>',
  ];

  test("Given an escaped cursor url() beside a fragment reference on one SVG element, then website sanitization removes both and source sanitization rejects the page", () => {
    const markup = '<svg><rect width="100" height="100" fill="url(#g)" cursor="&#92;75 rl(https://evil.test/cursor.png), auto"/></svg>';
    const stored = sanitizeAcquiredWebsiteHtml(page(markup));
    expect(parse(stored).querySelector("rect")!.attributes).toEqual({ width: "100", height: "100" });
    expect(() => assertInertSourceMarkup(stored, "html")).not.toThrow();
    expect(() => sanitizeSourceHtml(page(markup))).toThrow();
  });

  test("Given prose attributes that mention CSS function names, then they are kept and accepted", () => {
    const markup = '<img alt="image (1)" title="src (draft)"><p aria-label="cross-fade (demo)">x</p>';
    const stored = sanitizeAcquiredWebsiteHtml(page(markup));
    expect(parse(stored).querySelector("img")!.getAttribute("alt")).toBe("image (1)");
    expect(() => assertInertSourceMarkup(page(markup), "html")).not.toThrow();
  });

  test("Given a fragment attribute next to resource-loading CSS, then website sanitization removes both and the stored copy passes the gate", () => {
    for (const markup of mixed) {
      const stored = sanitizeAcquiredWebsiteHtml(page(markup));
      expect(stored).not.toContain("evil.test");
      expect(() => assertInertSourceMarkup(stored, "html")).not.toThrow();
      expect(() => assertInertSourceMarkup(page(markup.replace('<svg><path fill="url(#g)"/></svg>', "")), "html")).toThrow();
    }
  });

  test("Given ordinary CSS escapes and unquoted attribute values, then they are accepted unchanged", () => {
    const markup = '<style>.q::before{content:"' + BACKSLASH + '201C"}</style><div id= x class= x>quote</div>';
    const stored = sanitizeAcquiredWebsiteHtml(page(markup));
    expect(stored).toContain(BACKSLASH + "201C");
    expect(() => assertInertSourceMarkup(page(markup), "html")).not.toThrow();
    expect(() => assertInertSourceMarkup(page('<div FILL="a" fill="b"></div>'), "html")).toThrow();
  });

  test("Given an element with thousands of url() attributes, then stripping stays bounded and drops the element", () => {
    const attributes = Array.from({ length: 8000 }, (_, i) => "data-x" + i + '="url(#g)"').join(" ");
    const started = performance.now();
    const stored = sanitizeAcquiredWebsiteHtml(page("<p>keep</p><div " + attributes + ">drop</div>"));
    expect(performance.now() - started).toBeLessThan(3000);
    expect(stored).toContain("keep");
    expect(stored).not.toContain("drop");
  });
});
