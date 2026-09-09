import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { inspectRenderedPage } from "../src/services/design-audit-dom";
import { launchChromium } from "../src/services/export-render-session";
import { auditRenderedTree } from "../src/services/design-audit";

const allPassFixture = `<!doctype html><html><head><style>:root{--ink:#111;--paper:#fff}html,body{margin:0;background:var(--paper);color:var(--ink)}.a,.b{position:absolute;width:100px;height:30px}.a{left:10px;top:10px}.b{left:150px;top:10px}</style></head><body><div class="a" data-bg-node-id="a">Alpha</div><div class="b" data-bg-node-id="b">Beta</div></body></html>`;
const narrowFixture = `<!doctype html><html><head><style>:root{--ink:#111}html,body{margin:0;overflow:hidden;background:#fff;color:#111}.nclip{width:200px;height:30px}.one,.two{position:absolute;top:100px;width:80px;height:30px}.one{left:10px}.two{left:120px}@media(max-width:375px){.nclip{width:40px;height:18px;overflow:hidden;white-space:nowrap}.one,.two{left:10px}}</style></head><body><div class="nclip" data-bg-node-id="nclip">narrow clipping text</div><div class="one" data-bg-node-id="one">One</div><div class="two" data-bg-node-id="two">Two</div></body></html>`;
const geometryFixture = `<!doctype html><html><head><style>:root{--ink:#111}body{margin:0;background:#fff;color:#111}.slide{position:relative;margin:100px 0 0 200px;width:300px;height:200px}.centered{position:absolute;left:20px;top:20px}.escaped{position:absolute;left:-20px;top:80px}</style></head><body><section class="slide" data-slide><div class="centered" data-bg-node-id="centered">Centered</div><div class="escaped" data-bg-node-id="escaped">Escaped</div></section></body></html>`;
const translucentFixture = `<!doctype html><html><head><style>:root{--ink:#111}body{margin:0;background:#fff;color:#111}.layer{background:rgba(0,0,0,.2)}</style></head><body><div class="layer"><p data-bg-node-id="text">Opaque ancestor is not direct</p></div></body></html>`;
const fixture = `<!doctype html><html><head><style>:root{--brand:#123456}body{margin:0;background:#fff;color:#777}.clip{width:40px;height:10px;overflow:hidden}.a,.b{position:absolute;left:20px;top:80px;width:100px;height:40px}.wide{width:500px}</style></head><body><div class="clip" data-bg-node-id="clip">clipped text</div><div class="a" data-bg-node-id="a">alpha</div><div class="b" data-bg-node-id="b">beta</div><p data-bg-node-id="tiny" style="font-size:9px;color:#777">tiny</p><div class="wide" data-bg-node-id="wide">wide</div><div data-bg-node-id="dup">one</div><div data-bg-node-id="dup">two</div><img data-bg-node-id="image" src="missing.png"><div data-bg-node-id="literal" style="color:#ff0000">literal</div><div data-bg-node-id="gradient" style="background:linear-gradient(red,blue);color:white">gradient</div></body></html>`;

describe("rendered design auditor", () => {
  test("Given measurable defects When audited Then all eight checks are truthful and ordered", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-audit-render-"));
    try {
      await mkdir(root, { recursive: true }); await writeFile(path.join(root, "index.html"), fixture);
      const manifest = await inspectCanonicalTree(root);
      const result = await auditRenderedTree({ projectId: "fixture", projectDir: root, entrypoint: "index.html", revision: 0, digest: manifest.tree_digest, signal: new AbortController().signal });
      expect(result.checks.map((check) => check.code)).toEqual(["text_overflow", "element_overlap", "minimum_text_size", "contrast", "narrow_width", "duplicate_node_id", "missing_image", "token_usage"]);
      expect(result.overall_status).toBe("must_fix");
      expect(result.checks.map((check) => [check.code, check.status])).toEqual([
        ["text_overflow", "fail"], ["element_overlap", "fail"], ["minimum_text_size", "fail"], ["contrast", "fail"], ["narrow_width", "fail"], ["duplicate_node_id", "fail"], ["missing_image", "fail"], ["token_usage", "fail"],
      ]);
      const fix = result.checks[2]?.findings.find((finding) => finding.source.node_bg_id === "tiny")?.safe_fix;
      expect(fix?.request.styles).toEqual({ "font-size": "12px" });
      expect(JSON.stringify(result)).not.toContain(root);
      expect(result.checks[3]?.findings.some((finding) => finding.source.node_bg_id === "gradient")).toBeFalse();
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 60_000);

  test("Given narrow-only clipping and overlap When audited Then narrow width fails without document overflow", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-audit-narrow-"));
    try {
      await writeFile(path.join(root, "index.html"), narrowFixture); const manifest = await inspectCanonicalTree(root);
      const result = await auditRenderedTree({ projectId: "narrow", projectDir: root, entrypoint: "index.html", revision: 0, digest: manifest.tree_digest, signal: new AbortController().signal }); const narrow = result.checks[4];
      expect(narrow?.status).toBe("fail"); expect(narrow?.findings.map((finding) => finding.source.node_bg_id).sort()).toEqual(["nclip", "one"]); expect(narrow?.findings.every((finding) => finding.targeted_action === "repair_narrow_layout" && finding.severity === "must_fix")).toBeTrue(); expect(narrow?.findings.some((finding) => finding.source.node_bg_id === null)).toBeFalse();
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 60_000);

  test("Given an offset canvas When text is inside or escapes its edges Then geometry uses the canvas rect", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-audit-geometry-"));
    try {
      await writeFile(path.join(root, "index.html"), geometryFixture); const manifest = await inspectCanonicalTree(root);
      const result = await auditRenderedTree({ projectId: "geometry", projectDir: root, entrypoint: "index.html", revision: 0, digest: manifest.tree_digest, signal: new AbortController().signal }); const overflow = result.checks[0];
      expect(overflow?.findings.some((finding) => finding.source.node_bg_id === "centered")).toBeFalse(); expect(overflow?.findings.some((finding) => finding.source.node_bg_id === "escaped")).toBeTrue();
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 60_000);

  test("Given a translucent intermediate background When contrast is audited Then it is explicitly unresolvable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-audit-translucent-"));
    try {
      await writeFile(path.join(root, "index.html"), translucentFixture); const manifest = await inspectCanonicalTree(root);
      const result = await auditRenderedTree({ projectId: "translucent", projectDir: root, entrypoint: "index.html", revision: 0, digest: manifest.tree_digest, signal: new AbortController().signal }); const contrast = result.checks[3];
      expect(contrast).toMatchObject({ status: "unmeasurable", reason: "unresolvable_rendering", findings: [] });
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 60_000);

  test("Given a fully measurable valid page When audited Then it is ready", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-audit-pass-"));
    try {
      await writeFile(path.join(root, "index.html"), allPassFixture); const manifest = await inspectCanonicalTree(root);
      const result = await auditRenderedTree({ projectId: "pass", projectDir: root, entrypoint: "index.html", revision: 0, digest: manifest.tree_digest, signal: new AbortController().signal });
      expect(result.overall_status).toBe("ready"); expect(result.checks.every((check) => check.status === "pass")).toBeTrue();
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 60_000);
  test("Given visible tight text and clipped or off-canvas text When inspected Then only lost text fails", async () => {
  const browser = await launchChromium(AbortSignal.timeout(60_000));
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
    await page.setContent('<!doctype html><style>body{margin:40px}h1{font:100px/.82 Arial;margin:40px 0}#clip{overflow:hidden;height:20px}#parent{overflow:hidden;height:20px}#below{margin-top:1500px}</style><h1 data-bg-node-id="visible">VISIBLE</h1><h1 id="clip" data-bg-node-id="clip">CLIPPED</h1><div id="parent"><div data-bg-node-id="ancestor" style="height:60px">First<br>Second<br>Third</div></div><p id="below" data-bg-node-id="below">Below the fold</p>');
    const overflow = (await inspectRenderedPage(page)).findings.filter((finding) => finding.code === "text_overflow").map((finding) => finding.nodeId);
    expect(overflow).not.toContain("visible"); expect(overflow).not.toContain("below");
    expect(overflow).toContain("clip"); expect(overflow).toContain("ancestor");
    expect((await inspectRenderedPage(page, true)).findings.some((finding) => finding.code === "text_overflow" && finding.nodeId === "below")).toBeTrue();
  } finally { await browser.close(); }
 }, 60_000);

});
