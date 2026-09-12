import { describe, expect, test } from "bun:test";
import {
  applyHtmlNodePatch,
  FilePatchError,
  parseInlineStyle,
  serializeInlineStyle,
  htmlWithEditableIds,
  fingerprintHtmlNode,
} from "../src/services/file-patch";

const FIXTURE = `<!doctype html>
<html>
<body>
  <h1 data-bg-node-id="hero-title" class="hero">Original title</h1>
  <p data-bg-node-id="hero-sub">Sub</p>
  <div id="other">untouched</div>
</body>
</html>`;

describe("applyHtmlNodePatch", () => {
  test("Given an older slide without leaf IDs, When preview anchors are patched, Then only that element changes", () => {
    const html = '<section data-bg-node-id="slide"><h1>Title</h1><p>Body</p><img src="photo.png"></section>';
    const preview = htmlWithEditableIds(html);
    const id = preview.match(/<h1 data-bg-node-id="([^"]+)"/)![1]!;
    expect(htmlWithEditableIds(preview)).toBe(preview);
    expect(fingerprintHtmlNode(html, id).start).toBe(html.indexOf("<h1>"));
    const patched = applyHtmlNodePatch(html, { node_bg_id: id, text: "New title" });
    expect(patched).toContain('>New title</h1><p>Body</p><img src="photo.png">');
    expect(() => applyHtmlNodePatch(html, { node_bg_id: "slide", text: "Flattened" })).toThrow(FilePatchError);
    const imageId = preview.match(/<img data-bg-node-id="([^"]+)"/)![1]!;
    const imagePatched = applyHtmlNodePatch(html, { node_bg_id: imageId, attributes: { src: "other.png", alt: "Updated description" } });
    expect(imagePatched).toContain('src="other.png"');
    expect(imagePatched).toContain('alt="Updated description"');
    expect(imagePatched).toContain('<h1>Title</h1><p>Body</p>');
  });

  test("Given an authored automatic-looking ID, When missing IDs are assigned, Then anchors remain unique", () => {
    const html = '<h1>Title</h1><p data-bg-node-id="bg-auto-0">Body</p>';
    expect(htmlWithEditableIds(html)).toContain('<h1 data-bg-node-id="bg-auto-0-">');
    expect(applyHtmlNodePatch(html, { node_bg_id: "bg-auto-0-", text: "New" })).toContain('>New</h1>');
    expect(applyHtmlNodePatch('<h1 data-bg-node-id="title">Hello<br><em>world</em></h1>', { node_bg_id: "title", text: "Updated" })).toContain('>Updated</h1>');
  });

  test("rewrites text of the targeted node only", () => {
    const out = applyHtmlNodePatch(FIXTURE, {
      node_bg_id: "hero-title",
      text: "New title",
    });
    expect(out).toContain(
      '<h1 data-bg-node-id="hero-title" class="hero">New title</h1>',
    );
    expect(out).toContain('<p data-bg-node-id="hero-sub">Sub</p>');
    expect(out).toContain('<div id="other">untouched</div>');
  });

  test("escapes HTML special characters in text", () => {
    const out = applyHtmlNodePatch(FIXTURE, {
      node_bg_id: "hero-title",
      text: "<script>alert(1)</script> & done",
    });
    expect(out).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt; &amp; done",
    );
    expect(out).not.toContain("<script>alert(1)</script>");
  });

  test("escapes quotes too so a future caller cannot inject into an attribute", () => {
    // Defense-in-depth — the current call site (set_content) treats
    // quotes as plain text, but the helper is named generically and
    // could be reused on an attribute path later.
    const out = applyHtmlNodePatch(FIXTURE, {
      node_bg_id: "hero-title",
      text: `He said "hi" and 'bye'`,
    });
    expect(out).toContain("&quot;hi&quot;");
    expect(out).toContain("&#39;bye&#39;");
    expect(out).not.toContain('"hi"');
    expect(out).not.toContain("'bye'");
  });

  test("blocks the classic xss payload via raw event handler injection", () => {
    // node-html-parser parses set_content output as HTML, so any
    // unescaped tag / attribute would survive into the resulting tree.
    // The escape pass turns < > " ' into entities so an attribute like
    // `onerror="..."` becomes inert text. The 'onerror=' substring may
    // still appear in the visible text — what matters is that there
    // is no real onerror attribute on any element.
    const xssPayload = `" onerror="alert('xss')" x="`;
    const out = applyHtmlNodePatch(FIXTURE, {
      node_bg_id: "hero-title",
      text: xssPayload,
    });
    // Quotes are escaped → no real attribute is parsed onto the h1.
    expect(out).not.toMatch(/<h1[^>]*\sonerror\s*=/);
    expect(out).toContain("&quot;");
    expect(out).toContain("&#39;xss&#39;");
    // And the payload script tag analogue — `<img src=x onerror=...>` —
    // also survives only as inert text because `<` is escaped.
    const imgPayload = `<img src=x onerror="alert(1)">`;
    const out2 = applyHtmlNodePatch(FIXTURE, {
      node_bg_id: "hero-title",
      text: imgPayload,
    });
    expect(out2).not.toMatch(/<img\s/);
    expect(out2).toContain("&lt;img");
  });

  test.each([
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", " \u0000\tjavascript:alert(1)",
    "java\tscript:alert(1)", "java\nscript:alert(1)", "java\rscript:alert(1)",
    "&#106;avascript:alert(1)", "javascript&colon;alert(1)", "java&#x09;script:alert(1)",
    "vbscript:msgbox(1)", "data:text/html,<h1>active</h1>",
    "DATA:TEXT/HTML;charset=utf-8;base64,PGgxPmFjdGl2ZTwvaDE+",
    "data:application/xhtml+xml,<html/>",
  ])("rejects browser-interpreted unsafe URL %j before producing a patch", (value) => {
    for (const name of ["href", "HREF", "src", "SRC", "xlink:href", "action", "formaction", "poster"]) {
      expect(() => applyHtmlNodePatch(FIXTURE, {
        node_bg_id: "hero-title", text: "Must not change", styles: { color: "red" },
        attributes: { title: "Must not change", [name]: value },
      })).toThrow(expect.objectContaining({ code: "invalid_attribute_url" }));
    }
  });

  test.each([
    "", "#details", "../images/photo.svg", "/pages/home.html", "//example.test/path",
    "https://example.test/path?x=1&y=2", "http://example.test/path", "mailto:a@example.test", "tel:+1234",
    "ftp://example.test/file", "blob:https://example.test/id", "data:text/plain,download",
    "java%73cript:relative.html", "./javascript:relative.html", "#javascript:fragment",
  ])("preserves legitimate URL %j without rewriting surrounding HTML", (value) => {
    const html = '<!-- keep -->\r\n<a data-bg-node-id="link" href="old">Link</a>\r\n<script>untouched()</script>';
    const patched = applyHtmlNodePatch(html, { node_bg_id: "link", attributes: { href: value } });
    expect(patched).toStartWith('<!-- keep -->\r\n<a data-bg-node-id="link"');
    expect(patched).toEndWith('</a>\r\n<script>untouched()</script>');
    expect(patched).toContain(value);
  });

  test("preserves safe image data sources, attribute removals and non-URL text", () => {
    const html = '<img data-bg-node-id="image" src="old.svg" alt="Old">';
    for (const src of ["data:image/png;base64,aGVsbG8=", "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"]) {
      const patched = applyHtmlNodePatch(html, { node_bg_id: "image", attributes: { src, alt: "javascript: is text" } });
      expect(patched).toContain(src);
      expect(patched).toContain('alt="javascript: is text"');
    }
    expect(applyHtmlNodePatch(html, { node_bg_id: "image", attributes: { src: null } })).not.toContain("src=");
  });

  test("sets, updates, and removes attributes", () => {
    const out = applyHtmlNodePatch(FIXTURE, {
      node_bg_id: "hero-title",
      attributes: {
        class: "hero hero--big",
        "data-role": "headline",
        title: null,
      },
    });
    expect(out).toContain('class="hero hero--big"');
    expect(out).toContain('data-role="headline"');
  });

  test("silently ignores edits to the data-bg-node-id anchor", () => {
    const out = applyHtmlNodePatch(FIXTURE, {
      node_bg_id: "hero-title",
      attributes: { "data-bg-node-id": "hijacked" },
    });
    expect(out).toContain('data-bg-node-id="hero-title"');
    expect(out).not.toContain("hijacked");
  });

  test("Given duplicate node IDs When patching Then ambiguous source is rejected", () => {
    // Given
    const duplicate = `${FIXTURE}<div data-bg-node-id="hero-title">duplicate</div>`;

    // When / Then
    expect(() => applyHtmlNodePatch(duplicate, { node_bg_id: "hero-title", text: "x" })).toThrow("ambiguous_node_id");
  });

  test("Given byte-sensitive surrounding source When patching Then unrelated bytes remain exact", () => {
    // Given
    const source = `<!DOCTYPE html>\r\n<!--keep-->\r\n<script>const x = \"<div>\";</script>\r\n<div  class='hero' data-bg-node-id="hero-title">Old</div>\r\n<style>.x::after { content: \"<\"; }</style>\r\n`;
    const expected = source.replace(">Old</div>", ">New</div>");

    // When
    const output = applyHtmlNodePatch(source, { node_bg_id: "hero-title", text: "New" });

    // Then
    expect(output).toBe(expected);
  });

  test("throws FilePatchError(node_not_found) when the anchor is missing", () => {
    expect(() =>
      applyHtmlNodePatch(FIXTURE, { node_bg_id: "does-not-exist", text: "x" }),
    ).toThrow(FilePatchError);
  });

  test("no-op when neither text nor attributes are provided", () => {
    const out = applyHtmlNodePatch(FIXTURE, { node_bg_id: "hero-title" });
    expect(out).toContain(
      '<h1 data-bg-node-id="hero-title" class="hero">Original title</h1>',
    );
  });

  test("styles: adds inline style to a bare element", () => {
    const out = applyHtmlNodePatch(FIXTURE, {
      node_bg_id: "hero-sub",
      styles: { "font-size": "24px", color: "red" },
    });
    expect(out).toContain('style="font-size: 24px; color: red"');
  });

  test("styles: merges into existing style without losing siblings", () => {
    const withStyle = FIXTURE.replace(
      '<p data-bg-node-id="hero-sub">Sub</p>',
      '<p data-bg-node-id="hero-sub" style="color: blue; line-height: 1.4">Sub</p>',
    );
    const out = applyHtmlNodePatch(withStyle, {
      node_bg_id: "hero-sub",
      styles: { "font-size": "24px", color: "red" },
    });
    // color updated, line-height preserved, font-size appended.
    expect(out).toMatch(/color:\s*red/);
    expect(out).toMatch(/line-height:\s*1\.4/);
    expect(out).toMatch(/font-size:\s*24px/);
    expect(out).not.toMatch(/color:\s*blue/);
  });

  test("styles: null removes a property; removing all drops the attribute", () => {
    const withStyle = FIXTURE.replace(
      '<p data-bg-node-id="hero-sub">Sub</p>',
      '<p data-bg-node-id="hero-sub" style="color: blue">Sub</p>',
    );
    const out = applyHtmlNodePatch(withStyle, {
      node_bg_id: "hero-sub",
      styles: { color: null },
    });
    expect(out).toContain('<p data-bg-node-id="hero-sub">Sub</p>');
    expect(out).not.toContain("style=");
  });

  test("styles: coexist with attributes patch in the same call", () => {
    const out = applyHtmlNodePatch(FIXTURE, {
      node_bg_id: "hero-title",
      attributes: { class: "hero hero--xl" },
      styles: { "font-size": "96px" },
    });
    expect(out).toContain('class="hero hero--xl"');
    expect(out).toMatch(/font-size:\s*96px/);
  });
});

describe("parseInlineStyle / serializeInlineStyle", () => {
  test("round-trips key/value pairs", () => {
    const map = parseInlineStyle("font-size: 24px; color: red; line-height: 1.4");
    expect(map).toEqual({
      "font-size": "24px",
      color: "red",
      "line-height": "1.4",
    });
    expect(serializeInlineStyle(map)).toBe(
      "font-size: 24px; color: red; line-height: 1.4",
    );
  });

  test("parse tolerates trailing semicolons and whitespace", () => {
    expect(parseInlineStyle("; color: red ;  ")).toEqual({ color: "red" });
  });

  test("parse ignores declarations without a colon", () => {
    expect(parseInlineStyle("garbage; color: red")).toEqual({ color: "red" });
  });

  test("serialize empty map yields empty string", () => {
    expect(serializeInlineStyle({})).toBe("");
  });

  test("does not split on `;` inside parens — url(), linear-gradient()", () => {
    const map = parseInlineStyle(
      "background: url(data:image/png;base64,abc==); color: red",
    );
    expect(map).toEqual({
      background: "url(data:image/png;base64,abc==)",
      color: "red",
    });
  });

  test("does not split on `,` inside parens — gradient stops, var() fallbacks", () => {
    const map = parseInlineStyle(
      "background: linear-gradient(90deg, red 0%, blue 100%); color: var(--brand, #333)",
    );
    expect(map).toEqual({
      background: "linear-gradient(90deg, red 0%, blue 100%)",
      color: "var(--brand, #333)",
    });
  });

  test("respects single-quoted and double-quoted strings inside values", () => {
    const map = parseInlineStyle(
      `font-family: "Helvetica Neue, sans"; content: 'a; b'`,
    );
    expect(map).toEqual({
      "font-family": '"Helvetica Neue, sans"',
      content: "'a; b'",
    });
  });

  test("nested parens do not corrupt depth tracking", () => {
    const map = parseInlineStyle(
      "filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2)); margin: 4px",
    );
    expect(map).toEqual({
      filter: "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2))",
      margin: "4px",
    });
  });
});
