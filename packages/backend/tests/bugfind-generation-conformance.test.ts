import { describe, expect, test } from "bun:test";
import { MEASURED_PAGE_DECLARATION } from "../src/services/design-system-conformance";
import { entrypointBuiltAgainstSystem } from "../src/services/design-system-starter";

const pageWith = (meta: string): string => `<!doctype html><html><head>${meta}<link rel="stylesheet" href="design-system/system.css"></head><body class="bg-page"><h1>Built</h1></body></html>`;

describe("bugfind generation: measured page declaration", () => {
  test("Given a page whose bg-measured-page meta lists content before name, When the conformance review reads the declared page, Then it finds the declared path the starter CSS already applies", () => {
    const html = pageWith('<meta content="/about" name="bg-measured-page">');
    expect(MEASURED_PAGE_DECLARATION.exec(html)?.[1] ?? null).toBe("/about");
    expect(entrypointBuiltAgainstSystem(html, false)).toBe(true);
  });

  test("Given a bg-measured-page meta with an extra attribute between name and content, When the conformance review reads the declared page, Then it finds the declared path", () => {
    const html = pageWith('<meta name="bg-measured-page" data-bg-node-id="meta-1" content="/pricing">');
    expect(MEASURED_PAGE_DECLARATION.exec(html)?.[1] ?? null).toBe("/pricing");
  });
});
