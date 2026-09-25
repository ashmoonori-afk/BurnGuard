import { describe, expect, test } from "bun:test";
import postcss from "postcss";
import { flattenStylesheet, rewriteStylesheet } from "../src/services/platform-package-rewrite";

const BASE = "/web/upload/x/";

function importParams(css: string): readonly string[] {
  const params: string[] = [];
  postcss.parse(css).walkAtRules("import", (rule) => { params.push(rule.params); });
  return params;
}

/** Each rule selector with the chain of at-rules around it, outermost first. */
function ruleContexts(css: string): readonly string[] {
  const contexts: string[] = [];
  postcss.parse(css).walkRules((rule) => {
    const chain: string[] = [];
    for (let parent = rule.parent; parent !== undefined && parent.type === "atrule"; parent = parent.parent) chain.unshift(`@${(parent as postcss.AtRule).name} ${(parent as postcss.AtRule).params}`.trim());
    contexts.push([...chain, rule.selector].join(" > "));
  });
  return contexts;
}

describe("conditional @import", () => {
  test("Given conditional imports When the stylesheet is rewritten Then only the url changes and every condition stays", () => {
    // Given
    const css = '@import url("print.css") print;@import "wide.css" screen and (min-width: 900px);@import url( "base.css" );@import "grid.css" layer(base) supports(display: grid);';

    // When
    const rewritten = rewriteStylesheet(css, "css/site.css", (relPath) => `${BASE}${relPath}`);

    // Then
    expect(importParams(rewritten)).toEqual([
      `url("${BASE}css/print.css") print`,
      `url("${BASE}css/wide.css") screen and (min-width: 900px)`,
      `url("${BASE}css/base.css")`,
      `url("${BASE}css/grid.css") layer(base) supports(display: grid)`,
    ]);
  });

  test("Given conditional imports When the stylesheet is flattened Then the inlined rules stay under their supports and media conditions and outside any layer", async () => {
    // Given: a layered widget rule would lose to the unlayered widget reset and host CSS.
    const sources: Readonly<Record<string, string>> = { "css/print.css": "body{color:black}", "css/grid.css": ".w{display:grid}", "css/layer.css": ".l{color:red}", "css/anon.css": ".n{color:green}", "css/base.css": ".b{margin:0}" };
    const css = '@import "print.css" print;@import url(grid.css) supports((display: grid) and (gap: 1rem)) screen and (min-width: 900px);@import "layer.css" layer(base);@import "anon.css" layer screen;@import "base.css";.a{color:blue}';

    // When
    const flattened = await flattenStylesheet(css, "css/site.css", async (relPath) => sources[relPath] ?? null);

    // Then
    expect(importParams(flattened)).toEqual([]);
    expect(ruleContexts(flattened)).toEqual([
      "@media print > body",
      "@supports ((display: grid) and (gap: 1rem)) > @media screen and (min-width: 900px) > .w",
      ".l",
      "@media screen > .n",
      ".b",
      ".a",
    ]);
  });
});
