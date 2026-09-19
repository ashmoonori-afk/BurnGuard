import { describe, expect, test } from "bun:test";
import { LOGO_SOURCE_ATTRIBUTE } from "@bg/shared";
import { LogoDeliverableError } from "../src/services/logo-deliverables";
import { logoSvgSource, validateLogoSvg } from "../src/services/logo-svg-validation";

function logoSvg(source: string, body = '<path d="M0 0H512V512H0Z"/>', attributes = 'viewBox="0 0 512 512"'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${attributes} ${LOGO_SOURCE_ATTRIBUTE}="${source}">${body}</svg>`;
}

function svgDetail(text: string): string {
  try {
    validateLogoSvg(text);
  } catch (error) {
    if (error instanceof LogoDeliverableError) return error.detail;
    throw error;
  }
  return "ok";
}

describe("logo svg validator", () => {
  test("Given a namespace-less vector When validated for standalone export Then it is rejected", () => {
    expect(svgDetail('<svg viewBox="0 0 8 8"><path d="M0 0H8V8H0Z"/></svg>')).toBe("svg_namespace_missing");
  });
  test("Given a clean vector mark Then it validates", () => {
    expect(svgDetail(logoSvg("explorations/round-1/candidate-2.png"))).toBe("ok");
    expect(svgDetail(`<?xml version="1.0" encoding="UTF-8"?>\n<!-- generated -->\n${logoSvg("explorations/round-1/candidate-1.png")}`)).toBe("ok");
  });

  test.each([
    ["<html><body><svg viewBox=\"0 0 8 8\"></svg></body></html>", "svg_root_invalid"],
    ['<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H8V8H0Z"/></svg>', "svg_viewbox_missing"],
    ['<svg viewBox="0 0 8 8"><image href="mark.png"/></svg>', "svg_forbidden_element:image"],
    ['<svg viewBox="0 0 8 8"><script>x</script></svg>', "svg_forbidden_element:script"],
    ['<svg viewBox="0 0 8 8"><foreignObject><p>x</p></foreignObject></svg>', "svg_forbidden_element:foreignObject"],
    ['<svg viewBox="0 0 8 8"><text x="0">mark</text></svg>', "svg_forbidden_element:text"],
    ['<svg viewBox="0 0 8 8"><use href="https://evil.test/a.svg#m"/></svg>', "svg_external_reference"],
    ['<svg viewBox="0 0 8 8"><path xlink:href="data:image/png;base64,AAA" d="M0 0"/></svg>', "svg_external_reference"],
    ['<svg viewBox="0 0 8 8"><path fill="url(#grad)" d="M0 0"/></svg>', "svg_url_reference"],
    ['<svg viewBox="0 0 8 8" onload="x()"><path d="M0 0"/></svg>', "svg_event_handler"],
    ['<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 8 8"><path d="M0 0"/></svg>', "svg_doctype"],
  ])("Given %p Then the violation is %p", (text, detail) => {
    expect(svgDetail(text)).toBe(detail);
  });

  test("Given an internal use reference Then it is allowed", () => {
    expect(svgDetail('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><defs><path id="m" d="M0 0"/></defs><use href="#m"/></svg>')).toBe("ok");
  });

  test("Given an SVG above one mebibyte Then it is refused", () => {
    const filler = "0".repeat(1024 * 1024);
    expect(svgDetail(`<svg viewBox="0 0 8 8"><path d="M${filler}"/></svg>`)).toBe("svg_too_large");
  });
});

describe("logo svg validator adversarial payloads", () => {
  test("Given the reviewer's namespaced script Then the prefixed element is refused", () => {
    const payload = [
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 8 8">',
      "<s:script>globalThis.logoExecuted=true</s:script>",
      "</svg>",
    ].join("");
    expect(svgDetail(payload)).toBe("svg_forbidden_element:s:script");
    expect(svgDetail('<svg viewBox="0 0 8 8"><svg:script>x</svg:script></svg>')).toBe("svg_forbidden_element:svg:script");
  });

  test("Given the reviewer's CSS import Then the style element is refused", () => {
    const payload = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><style>@import "https://example.invalid/a.css";</style></svg>';
    expect(svgDetail(payload)).toBe("svg_forbidden_element:style");
  });

  // Documented precedence: the entity gate runs before tokenising, so an encoded payload inside a
  // style attribute reports svg_entity; the same payload spelled without entities reports
  // svg_forbidden_attribute:style.
  test("Given the reviewer's entity-encoded url Then the entity gate fires first", () => {
    expect(svgDetail('<svg viewBox="0 0 8 8"><path style="fill:u&#114;l(#g)" d="M0 0"/></svg>')).toBe("svg_entity");
    expect(svgDetail('<svg viewBox="0 0 8 8"><path style="fill:url(#g)" d="M0 0"/></svg>')).toBe("svg_forbidden_attribute:style");
    expect(svgDetail('<svg viewBox="0 0 8 8"><path d="M0 0" fill="&#35;fff"/></svg>')).toBe("svg_entity");
    expect(svgDetail('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><title>a &amp; b</title><path d="M0 0"/></svg>')).toBe("ok");
  });

  test("Given the reviewer's malformed root Then the document is refused", () => {
    expect(svgDetail('<svg viewBox="bad"><path d="M0 0"/></svg>')).toBe("svg_viewbox_invalid");
    expect(svgDetail('<svg viewBox="0 0 8 8"><path d="M0 0"/>')).toBe("svg_malformed");
  });

  test.each([
    ['<svg xmlns:evil="http://evil.test/ns" viewBox="0 0 8 8"><path d="M0 0"/></svg>', "svg_forbidden_attribute:xmlns:evil"],
    ['<svg xmlns="http://evil.test/ns" viewBox="0 0 8 8"><path d="M0 0"/></svg>', "svg_attribute_invalid:xmlns"],
    ['<svg viewBox="0 0 8 8"><a href="#x"><path d="M0 0"/></a></svg>', "svg_forbidden_element:a"],
    ['<svg viewBox="0 0 8 8"><animate attributeName="x"/><path d="M0 0"/></svg>', "svg_forbidden_element:animate"],
    ['<svg viewBox="0 0 8 8"><linearGradient id="g"/><path d="M0 0"/></svg>', "svg_forbidden_element:linearGradient"],
    ['<svg viewBox="0 0 8 8"><iframe src="x"/></svg>', "svg_forbidden_element:iframe"],
    ['<svg viewBox="0 0 8 8"><g><path d="M0 0"/></svg>', "svg_malformed"],
    ['<svg viewBox="0 0 8 8"><g><defs></g></defs></svg>', "svg_malformed"],
    ['<svg viewBox="0 0 8 8"><path d=M0 /></svg>', "svg_malformed"],
    ['<svg viewBox="0 0 8 8"><path d="M0 0" onload="x()"/></svg>', "svg_event_handler"],
    ['<svg viewBox="0 0 8 8"><path d="M0 0" ONCLICK="x()"/></svg>', "svg_event_handler"],
    ['<svg viewBox="0 0 8 8"><path d="M0 0"/><![CDATA[<script>x</script>]]></svg>', "svg_cdata"],
    ['<?php echo 1; ?><svg viewBox="0 0 8 8"><path d="M0 0"/></svg>', "svg_processing_instruction"],
    ['<?xml version="1.0"?><svg viewBox="0 0 8 8"><?xml-stylesheet href="a.css"?><path d="M0 0"/></svg>', "svg_processing_instruction"],
    ['<svg viewBox="0 0 8 8"><path d="M0 0" filter="url(#f)"/></svg>', "svg_forbidden_attribute:filter"],
    ['<svg viewBox="0 0 8 8"><path d="M0 0" stroke="url(#g)"/></svg>', "svg_url_reference"],
    ['<svg viewBox="0 0 8 8"><path d="M0 0" transform="url(#g)"/></svg>', "svg_url_reference"],
    ['<svg viewBox="0 0 8 8" width="9in"><path d="M0 0"/></svg>', "svg_attribute_invalid:width"],
    ['<svg viewBox="0 0 8 8"><path d="M0 0" fill="red"/></svg>', "svg_attribute_invalid:fill"],
    ['<svg viewBox="0 0 8 8"><path d="M0 0" fill="rgb(1,2,3,4)"/></svg>', "svg_attribute_invalid:fill"],
    ['<svg viewBox="0 0 8 8"><path d="M0 0" id="1bad"/></svg>', "svg_attribute_invalid:id"],
    ['<svg viewBox="0 0 8 8">text</svg>', "svg_text_content"],
    ['<svg viewBox="0 0 8 8"><svg:svg viewBox="0 0 8 8"/></svg>', "svg_forbidden_element:svg:svg"],
    ['<svg:svg viewBox="0 0 8 8"><path d="M0 0"/></svg:svg>', "svg_root_invalid"],
    ['<svg viewBox="0 0 8 8"><path d="M0 0"/></svg><svg viewBox="0 0 8 8"/>', "svg_root_invalid"],
    ['<svg viewBox="0 0 8 8"><use href="#missing"/></svg>', "svg_reference_missing"],
    ['<svg viewBox="0 0 8 8"><g clip-path="url(#missing)"><path d="M0 0"/></g></svg>', "svg_reference_missing"],
    ['<svg viewBox="0 0 8 8"><g clip-path="url(https://evil.test/a#c)"><path d="M0 0"/></g></svg>', "svg_external_reference"],
    ['<svg viewBox="0 0 8 8"><path d="M0 0" d="M1 1"/></svg>', "svg_malformed"],
  ])("Given %p Then the violation is %p", (text, detail) => {
    expect(svgDetail(text)).toBe(detail);
  });

  test("Given a local clip path Then the only permitted url() form is allowed", () => {
    const clipped = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">',
      '<defs><clipPath id="c"><rect x="0" y="0" width="8" height="8"/></clipPath></defs>',
      '<g clip-path="url(#c)"><path d="M0 0H8V8H0Z" fill="#101828"/></g>',
      "</svg>",
    ].join("");
    expect(svgDetail(clipped)).toBe("ok");
  });

  test("Given the full allowed surface Then it validates", () => {
    const mark = [
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1"',
      ' viewBox="0 0 512 512" width="512" height="512" preserveAspectRatio="xMidYMid meet" role="img"',
      ` aria-hidden="true" lang="ko" ${LOGO_SOURCE_ATTRIBUTE}="explorations/round-12/candidate-4.png">`,
      "<title>mark</title><desc>a flat mark</desc>",
      '<defs><mask id="m"><circle cx="256" cy="256" r="200" fill="white"/></mask>',
      '<symbol id="s"><polyline points="0,0 8,8" stroke="currentColor" stroke-width="2"/></symbol></defs>',
      '<g mask="url(#m)" transform="translate(4 4) scale(1.5)" opacity="0.5" fill-rule="evenodd">',
      '<path d="M0 0H512V512H0Z" fill="rgb(16, 24, 40)" stroke="none" stroke-linecap="round" stroke-linejoin="miter"/>',
      '<ellipse cx="10" cy="10" rx="4" ry="2" fill="transparent"/><line x1="0" y1="0" x2="8" y2="8" stroke="#fff"/>',
      '<polygon points="0,0 4,4 8,0" fill="black" fill-opacity="0.25" clip-rule="nonzero"/>',
      '<rect x="0" y="0" width="50%" height="50%" stroke="#010203" stroke-miterlimit="4" stroke-opacity="1"/>',
      '<use xlink:href="#s"/></g></svg>',
    ].join("");
    expect(svgDetail(mark)).toBe("ok");
  });

  test.each([
    ["explorations/round-1/candidate-5.png", "svg_source_invalid"],
    ["explorations/round-100/candidate-1.png", "svg_source_invalid"],
    ["../explorations/round-1/candidate-1.png", "svg_source_invalid"],
    ["explorations/round-1/candidate-1.svg", "svg_source_invalid"],
  ])("Given the source claim %p Then it is refused", (source, detail) => {
    expect(svgDetail(logoSvg(source))).toBe(detail);
  });
});

describe("logo svg source attribute", () => {
  test("Given a mark Then the source claim is read from the root", () => {
    expect(logoSvgSource(logoSvg("explorations/round-2/candidate-3.png"))).toBe("explorations/round-2/candidate-3.png");
    expect(logoSvgSource(`<!-- c -->\n${logoSvg("explorations/round-1/candidate-1.png")}`)).toBe("explorations/round-1/candidate-1.png");
  });

  test("Given an invalid document Then it returns null without throwing", () => {
    expect(logoSvgSource('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path d="M0 0"/></svg>')).toBeNull();
    expect(logoSvgSource('<!DOCTYPE svg><svg viewBox="0 0 8 8"><g>')).toBeNull();
    expect(logoSvgSource("not markup at all")).toBeNull();
    expect(logoSvgSource("<svg")).toBeNull();
  });
});
