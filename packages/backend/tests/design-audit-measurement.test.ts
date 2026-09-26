import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser } from "playwright-core";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { inspectRenderedPage } from "../src/services/design-audit-dom";
import { auditRenderedTree } from "../src/services/design-audit";
import { launchChromium } from "../src/services/export-render-session";

const NOT_APPLICABLE_ON_FIXED = ["narrow_width", "site_nav_mismatch", "site_missing_aria_current", "site_dangling_link", "site_missing_shared_block", "site_root_absolute_asset"];
const DECK_RUNTIME = '<script src="/runtime/deck-stage.js" defer></script>';
const readyDeck = `<!doctype html><html><head><style>:root{--ink:#111;--paper:#fff}body{margin:0;font:32px Arial;color:var(--ink);background:var(--paper)}[data-slide]{position:relative;width:1920px;height:1080px}[data-deck-ready] [data-slide]:not([data-active]){display:none}h1{font:52px Arial;margin:0}.a,.b{position:absolute;top:400px;width:300px;height:60px;margin:0}.a{left:100px}.b{left:600px}</style></head><body><section data-slide><h1 data-bg-node-id="title">Ready deck</h1><p class="a" data-bg-node-id="a">Alpha</p><p class="b" data-bg-node-id="b">Beta</p></section>${DECK_RUNTIME}</body></html>`;
const tokenDeck = `<!doctype html><html><head><style>:root{--ink:#111;--slide-type-caption:24px}body{margin:0;font:32px Arial;color:var(--ink);background:white}[data-slide]{width:1920px;height:1080px}[data-deck-ready] [data-slide]:not([data-active]){display:none}h1{font:52px Arial;margin:0}p{margin:0}</style></head><body><section data-slide><h1 data-bg-node-id="title-1">First</h1></section><section data-slide><h1 data-bg-node-id="title-2">Second</h1><p data-bg-node-id="small" style="font-size:18px">Small caption</p></section>${DECK_RUNTIME}</body></html>`;
const bleedingBanner = '<!doctype html><html><head><style>html,body{margin:0;background:#fff;color:#111}section{position:relative;width:300px;height:250px;overflow:hidden}img{position:absolute;left:-10px;top:0;width:320px;height:250px}</style></head><body><section data-graphic-artboard><img data-bg-node-id="figure" alt="" src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2710%27 height=%2710%27/%3E"><p data-bg-node-id="claim" style="position:absolute;left:20px;top:20px;margin:0;font:14px Arial">Sale</p></section></body></html>';
const resolvablePage = (id: string) => `<!doctype html><html><head><style>:root{--ink:#111}body{margin:0;background:#fff;color:#111}</style></head><body><p data-bg-node-id="${id}">Readable text</p></body></html>`;
const translucentPage = (id: string) => `<!doctype html><html><head><style>:root{--ink:#111}body{margin:0;background:#fff;color:#111}.layer{background:rgba(0,0,0,.2)}</style></head><body><div class="layer"><p data-bg-node-id="${id}">Over a translucent layer</p></div></body></html>`;
const remotePage = '<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><style>body{margin:0;background:#fff;color:#111}</style></head><body><p data-bg-node-id="copy">Local copy</p><iframe data-bg-node-id="embed" title="Embed" src="https://example.com/embed"></iframe></body></html>';

async function auditTree(html: string, options: { readonly deck?: boolean; readonly canvas?: { readonly width: number; readonly height: number } } = {}, extraPages: Readonly<Record<string, string>> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "bg-audit-measure-"));
  try {
    await writeFile(path.join(root, "index.html"), html);
    for (const [name, page] of Object.entries(extraPages)) await writeFile(path.join(root, name), page);
    const manifest = await inspectCanonicalTree(root);
    const report = await auditRenderedTree({ projectId: "measure", projectDir: root, entrypoint: "index.html", revision: 0, digest: manifest.tree_digest, ...options, signal: AbortSignal.timeout(45_000) });
    expect(JSON.stringify(report)).not.toContain(root);
    return report;
  } finally { await rm(root, { recursive: true, force: true }); }
}

describe("design audit applicability and folding", () => {
  test("Given a one-slide deck without site markers When audited as a deck Then site and narrow checks are not applicable and the deck is still ready", async () => {
    const report = await auditTree(readyDeck, { deck: true });
    expect(report.checks.filter((check) => check.status === "not_applicable").map((check) => check.code)).toEqual(NOT_APPLICABLE_ON_FIXED);
    expect(report.checks.filter((check) => check.status === "not_applicable").every((check) => check.reason === null && check.findings.length === 0)).toBe(true);
    expect(report.overall_status).toBe("ready");
    expect(report.checks.filter((check) => check.status === "pass")).toHaveLength(report.checks.length - NOT_APPLICABLE_ON_FIXED.length);
  }, 60_000);

  test("Given a 300x250 banner whose figure bleeds past both edges When audited at its canvas Then narrow width is not applicable and nothing must be fixed", async () => {
    const report = await auditTree(bleedingBanner, { canvas: { width: 300, height: 250 } });
    const narrow = report.checks.find((check) => check.code === "narrow_width");
    expect(narrow).toMatchObject({ status: "not_applicable", reason: null, findings: [] });
    expect(report.overall_status).not.toBe("must_fix");
  }, 60_000);

  test("Given a two-page site with one translucent page When audited Then contrast folds to unresolvable in either order and passes only when every page resolves", async () => {
    const homeTranslucent = await auditTree(translucentPage("home"), {}, { "about.html": resolvablePage("about") });
    expect(homeTranslucent.checks.find((check) => check.code === "contrast")).toMatchObject({ status: "unmeasurable", reason: "unresolvable_rendering", findings: [] });
    const subTranslucent = await auditTree(resolvablePage("home"), {}, { "about.html": translucentPage("about") });
    expect(subTranslucent.checks.find((check) => check.code === "contrast")).toMatchObject({ status: "unmeasurable", reason: "unresolvable_rendering", findings: [] });
    const resolvable = await auditTree(resolvablePage("home"), {}, { "about.html": resolvablePage("about") });
    expect(resolvable.checks.find((check) => check.code === "contrast")).toMatchObject({ status: "pass", reason: null, findings: [] });
  }, 120_000);

  test("Given a deck exposing --slide-type-caption When an 18px paragraph is found Then the safe fix writes the token instead of a px literal", async () => {
    const report = await auditTree(tokenDeck, { deck: true });
    const small = report.checks.find((check) => check.code === "minimum_text_size")?.findings.find((finding) => finding.source.node_bg_id === "small");
    expect(small?.threshold).toBe(24);
    expect(small?.safe_fix?.request.styles).toEqual({ "font-size": "var(--slide-type-caption)" });
  }, 60_000);

  test("Given a page linking a remote stylesheet and embedding a remote frame When audited Then the frame is must-fix and the stylesheet is recommended, each once", async () => {
    const report = await auditTree(remotePage);
    const remote = report.checks.find((check) => check.code === "remote_resources");
    expect(remote?.status).toBe("fail");
    // Findings sort by node id, so the anchorless stylesheet finding precedes the frame.
    expect(remote?.findings.map((finding) => [finding.severity, finding.source.node_bg_id, finding.targeted_action])).toEqual([["recommended", null, "bundle_remote_resource"], ["must_fix", "embed", "bundle_remote_resource"]]);
    expect(remote?.findings[0]?.evidence).toContain("https://fonts.googleapis.com/css2");
    expect(remote?.findings[1]?.evidence).toContain("https://example.com/embed");
    expect(report.overall_status).toBe("must_fix");
  }, 60_000);
});

describe("rendered page measurements", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await launchChromium(AbortSignal.timeout(60_000)); });
  afterAll(async () => { await browser?.close(); });

  test("Given white text over an opaque gradient When contrast is inspected Then the worst stop is measured, while a url() background stays unresolvable", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.setContent('<!doctype html><style>body{margin:0;background:#fff;color:#111}.hero{background:linear-gradient(#eee,#fff);color:#fff}.plate{background:radial-gradient(circle, rgb(0,0,0) 0%, #333 100%);color:#fff}</style><h1 class="hero" data-bg-node-id="hero">Hero</h1><p class="plate" data-bg-node-id="plate">On a dark plate</p><p data-bg-node-id="body">Readable</p>');
      const gradient = await inspectRenderedPage(page);
      const hero = gradient.findings.find((finding) => finding.code === "contrast" && finding.nodeId === "hero");
      expect(hero?.threshold).toBe(3);
      expect(hero?.measured).toBeLessThan(3);
      expect(gradient.findings.filter((finding) => finding.code === "contrast").map((finding) => finding.nodeId)).toEqual(["hero"]);
      expect(gradient.measurable.contrast).toBe(true);
      expect(gradient.unknownReasons.contrast).toBeUndefined();
      await page.setContent('<!doctype html><style>body{margin:0;background:#fff;color:#111}.hero{background:url(hero.png) #fff;color:#fff}</style><h1 class="hero" data-bg-node-id="hero">Hero</h1><p data-bg-node-id="body">Readable</p>');
      const image = await inspectRenderedPage(page);
      expect(image.findings.some((finding) => finding.code === "contrast")).toBe(false);
      expect(image.measurable.contrast).toBe(false);
      expect(image.unknownReasons.contrast).toBe("unresolvable_rendering");
    } finally { await page.close(); }
  }, 30_000);

  test("Given a mono metric, a font exception and an odd body family When fonts are inspected Then only the odd family is reported", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.setContent('<!doctype html><style>:root{--font-mono:"Courier New"}body{margin:0;background:#fff;color:#111;font-family:Arial}</style><p data-bg-node-id="p1">Revenue grew to <span data-bg-node-id="metric" style="font-family:var(--font-mono)">1,204</span> units</p><p data-bg-node-id="p2">Second paragraph</p><p data-bg-node-id="odd" style="font-family:Georgia">Odd one out</p><p data-bg-node-id="mark" data-bg-font-exception style="font-family:Impact">WORDMARK</p>');
      const fonts = (await inspectRenderedPage(page)).findings.filter((finding) => finding.code === "font_consistency").map((finding) => finding.nodeId);
      expect(fonts).toEqual(["odd"]);
    } finally { await page.close(); }
  }, 30_000);

  test("Given copy that merely contains todo and copy that is exactly TBD When copy is inspected Then only the bare placeholder is reported", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.setContent('<!doctype html><style>body{margin:0;background:#fff;color:#111}</style><p data-bg-node-id="list">Todo list for the week</p><p data-bg-node-id="tbd">TBD</p><p data-bg-node-id="ph">Placeholder.</p><p data-bg-node-id="lorem">Intro lorem ipsum dolor</p><p data-bg-node-id="hint">Set an input placeholder that explains the format</p>');
      const copy = (await inspectRenderedPage(page)).findings.filter((finding) => finding.code === "copy_review").map((finding) => finding.nodeId).sort();
      expect(copy).toEqual(["lorem", "ph", "tbd"]);
    } finally { await page.close(); }
  }, 30_000);

  test("Given exposed tokens and a stylesheet rule with a literal colour When token usage is inspected Then the rule is reported against its first element and a token-based rule passes", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.setContent('<!doctype html><style>:root{--ink:#111;--paper:#fff}html,body{margin:0;background:var(--paper);color:var(--ink)}@media (min-width:1px){.hero{color:#ff0000}}</style><h1 class="hero" data-bg-node-id="hero">Hero</h1>');
      const literal = await inspectRenderedPage(page);
      const tokens = literal.findings.filter((finding) => finding.code === "token_usage");
      expect(tokens.map((finding) => [finding.nodeId, finding.severity])).toEqual([["hero", "recommended"]]);
      expect(tokens[0]?.evidence).toContain(".hero");
      await page.setContent('<!doctype html><style>:root{--ink:#111;--paper:#fff}html,body{margin:0;background:var(--paper);color:var(--ink)}.hero{color:var(--ink)}</style><h1 class="hero" data-bg-node-id="hero">Hero</h1>');
      const tokenised = await inspectRenderedPage(page);
      expect(tokenised.measurable.token_usage).toBe(true);
      expect(tokenised.findings.some((finding) => finding.code === "token_usage")).toBe(false);
    } finally { await page.close(); }
  }, 30_000);

  test("Given artboards exposing --content-type-caption When a 14px caption is inspected Then the 1080 board enforces the scaled step and the 320x240 board keeps the 12px floor", async () => {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1400 } });
    try {
      await page.setContent('<!doctype html><style>:root{--content-base:1080px;--content-type-caption:24px}html,body{margin:0;background:#fff;color:#111}section{position:relative;overflow:hidden}p{position:absolute;left:40px;top:40px;margin:0;font-family:Arial}</style><section data-graphic-artboard style="width:1080px;height:1080px"><p data-bg-node-id="big" style="font-size:14px">Caption</p></section><section data-graphic-artboard style="width:320px;height:240px"><p data-bg-node-id="small" style="font-size:14px">Caption</p></section>');
      const sizes = (await inspectRenderedPage(page, true)).findings.filter((finding) => finding.code === "minimum_text_size");
      expect(sizes.map((finding) => [finding.nodeId, finding.measured, finding.threshold])).toEqual([["big", 14, 24]]);
    } finally { await page.close(); }
  }, 30_000);
});

describe("finding budget", () => {
  test("CSS-05: Given a first page with more recommended literals than the finding budget and a second page with a contrast defect When the site is audited Then the must_fix finding survives the budget", async () => {
    const literals = Array.from({ length: 210 }, (_, index) => `<p data-bg-node-id="l${index}" style="color:#111111">Literal ${index}</p>`).join("");
    const report = await auditTree(`<!doctype html><html><head><style>:root{--ink:#111}body{margin:0;background:#fff;color:#111}p{margin:0}</style></head><body>${literals}</body></html>`, {}, { "about.html": '<!doctype html><html><head><style>:root{--ink:#111}body{margin:0;background:#fff;color:#111}</style></head><body><p data-bg-node-id="faint" style="color:#999">Faint copy</p></body></html>' });
    expect(report.checks.reduce((count, check) => count + check.findings.length, 0)).toBeLessThanOrEqual(200);
    expect(report.checks.find((check) => check.code === "contrast")?.findings.map((finding) => [finding.source.rel_path, finding.source.node_bg_id, finding.severity])).toEqual([["about.html", "faint", "must_fix"]]);
    expect(report.overall_status).toBe("must_fix");
  }, 120_000);

  test("CSS-05: Given exposed tokens and 25 stylesheet rules with literal colours When token usage is inspected Then 20 rules are reported and one anchorless summary stands for the rest", async () => {
    const browser = await launchChromium(AbortSignal.timeout(60_000));
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      const rules = Array.from({ length: 25 }, (_, index) => `.r${index}{color:#111111}`).join("");
      const spans = Array.from({ length: 25 }, (_, index) => `<span class="r${index}" data-bg-node-id="r${index}">x</span>`).join(" ");
      await page.setContent(`<!doctype html><style>:root{--ink:#111;--paper:#fff}html,body{margin:0;background:var(--paper);color:var(--ink)}${rules}</style><p>${spans}</p>`);
      const tokens = (await inspectRenderedPage(page)).findings.filter((finding) => finding.code === "token_usage");
      expect(tokens.map((finding) => finding.nodeId)).toEqual([...Array.from({ length: 20 }, (_, index) => `r${index}`), null]);
      expect(tokens.every((finding) => finding.severity === "recommended" && finding.action === "replace_literal_with_token")).toBe(true);
    } finally { await page.close(); await browser.close(); }
  }, 60_000);
});
