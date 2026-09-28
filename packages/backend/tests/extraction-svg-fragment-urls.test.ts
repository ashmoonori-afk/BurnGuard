import { describe, expect, test } from "bun:test";
import { sanitizeAcquiredWebsiteHtml } from "../src/services/extraction-html";
import { assertInertSourceMarkup } from "../src/services/extraction-safety";

const page = (body: string, head = "") => "<!doctype html><html><head>" + head + "</head><body>" + body + "</body></html>";

describe("In-document fragment references in acquired website HTML", () => {
  test("Given inline SVG presentation attributes that reference in-document fragments, then the page is accepted and the references are kept", () => {
    const svg = '<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0"/></linearGradient><filter id="glow"/></defs><path d="M0 0" fill="url(#g)" stroke="url( \'#g\' )" filter="url(&quot;#glow&quot;)"/></svg>';
    const stored = sanitizeAcquiredWebsiteHtml(page(svg));
    expect(stored).toContain('fill="url(#g)"');
    expect(stored).toContain("filter=");
    expect(() => assertInertSourceMarkup(stored, "html")).not.toThrow();
  });

  test("Given a style block that only references fragments, then it is kept, while a block with a remote url is emptied", () => {
    const stored = sanitizeAcquiredWebsiteHtml(page("<p>x</p>", "<style>.a{clip-path:url(#clip);fill:url( #g )}</style><style>.b{background:url(https://evil.test/x.png)}</style>"));
    expect(stored).toContain("url(#clip)");
    expect(stored).not.toContain("evil.test");
  });

  test("Given non-style attributes carrying network urls, then those attributes are removed instead of rejecting the page", () => {
    const stored = sanitizeAcquiredWebsiteHtml(page('<svg><path fill="url(https://evil.test/a.svg#g)" stroke="url(//evil.test/b)" filter="url()" data-bg="url(http://evil.test/c.png)" d="M0 0"/></svg>'));
    expect(stored).not.toMatch(/evil\.test|url\(\)/);
    expect(stored).toContain('d="M0 0"');
  });

  test("Given remote style references, then the inert gate still rejects them", () => {
    for (const markup of [
      "<style>body{background:url(https://evil.test/image.png)}</style>",
      "<style>@import 'https://evil.test/a.css';</style>",
      '<div style="background:url( //evil.test/x )"></div>',
      '<svg><path fill="url(https://evil.test/a.svg#g)"/></svg>',
      "<style>.a{background:url()}</style>",
    ]) expect(() => assertInertSourceMarkup(page(markup), "html")).toThrow();
    expect(() => assertInertSourceMarkup(page('<svg><path fill="url(#g)"/></svg><style>.a{mask:url(#m)}</style>'), "html")).not.toThrow();
  });
});
