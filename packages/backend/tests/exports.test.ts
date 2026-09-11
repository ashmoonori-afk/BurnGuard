import { beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../src/services/export-render-session";
import { DECK_STAGE_JS } from "../src/runtime/deck-stage";
import { prepareSlideDeckExport } from "../src/services/export-stage";
import { copyBundledFonts } from "../src/data/bundled-fonts";
import JSZip from "jszip";
import { chartSample, renderChart } from "@bg/shared";
import { validatePptxPackage } from "../src/services/export-package-validation";

describe("export path boundary", () => {
  test("rejects an entrypoint outside the staged project", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "bg-export-boundary-"));
    const projectDir = path.join(tempRoot, "staging", "project");
    const outsidePath = path.join(tempRoot, "outside.html");
    await mkdir(projectDir, { recursive: true });
    await writeFile(outsidePath, "outside-original", "utf8");

    try {
      await expect(
        prepareSlideDeckExport(projectDir, "../../outside.html"),
      ).rejects.toThrow("outside boundary root");
      expect(await readFile(outsidePath, "utf8")).toBe("outside-original");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("tutorial HTML contracts", () => {
  test("prototype tutorial is a standalone page with editable anchors", async () => {
    const observation = await tutorialObservation();
    expect(observation.prototypeStandalone).toBe(true); expect(observation.prototypeAnchors).toBe(true); expect(observation.prototypeRemoteAssets).toBe(false);
  }, 30_000);
  test("deck tutorial exposes at least 3 [data-slide] sections with editable text", async () => {
    const observation = await tutorialObservation();
    expect(observation.deckSlides).toBeGreaterThanOrEqual(3); expect(observation.deckAnchors).toBe(true); expect(observation.deckRuntime).toBe(true);
  }, 30_000);
  test("tutorial names carry the reserved prefix so seedTutorialsOnce can match", async () => {
    const observation = await tutorialObservation(); expect(observation.reservedNames).toBe(true);
  }, 30_000);
});

type TutorialObservation = { readonly prototypeStandalone: boolean; readonly prototypeAnchors: boolean; readonly prototypeRemoteAssets: boolean; readonly deckSlides: number; readonly deckAnchors: boolean; readonly deckRuntime: boolean; readonly reservedNames: boolean };
let observedTutorials: Promise<TutorialObservation> | null = null;
function tutorialObservation(): Promise<TutorialObservation> {
  observedTutorials ??= (async () => {
    const moduleUrl = new URL("../src/db/seed-tutorials.ts", import.meta.url).href;
    const script = `import {DECK_TUTORIAL_HTML as d,PROTOTYPE_TUTORIAL_HTML as p,PROTOTYPE_TUTORIAL_NAME as pn,DECK_TUTORIAL_NAME as dn} from ${JSON.stringify(moduleUrl)};console.log(JSON.stringify({prototypeStandalone:p.includes("<!doctype html>"),prototypeAnchors:p.includes('data-bg-node-id="headline"')&&p.includes('data-bg-node-id="body"'),prototypeRemoteAssets:/<(?:link|script)[^>]*(?:href|src)=["']https?:/.test(p),deckSlides:(d.match(/<section\\s+data-slide/g)||[]).length,deckAnchors:d.includes('data-bg-node-id="slide-1-title"')&&d.includes('data-bg-node-id="slide-3-body"'),deckRuntime:/runtime\\/deck-stage\\.js/.test(d),reservedNames:pn.startsWith("[burnguard:tutorial]")&&dn.startsWith("[burnguard:tutorial]")}))`;
    const preload = new URL("../../../scripts/test-preload.ts", import.meta.url);
    const child = Bun.spawn([process.execPath, "--preload", fileURLToPath(preload), "-e", script], { env: { ...process.env }, stdout: "pipe", stderr: "pipe" });
    const deadline = setTimeout(() => child.kill(), 25_000);
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]).finally(() => clearTimeout(deadline));
    if (exit !== 0) throw new TypeError(stderr); const value: unknown = JSON.parse(stdout); if (!isTutorialObservation(value)) throw new TypeError("Invalid tutorial observation"); return value;
  })();
  return observedTutorials;
}
function isTutorialObservation(value: unknown): value is TutorialObservation { return typeof value === "object" && value !== null && typeof Reflect.get(value, "prototypeStandalone") === "boolean" && typeof Reflect.get(value, "deckSlides") === "number"; }

const SMOKE_DECK_HTML = `<!doctype html><html><head><style>html,body{margin:0}.slide{width:1280px;height:720px;box-sizing:border-box;padding:64px;background:white;color:#111}[data-slide]:not([data-active]){display:none}</style></head><body><section class="slide" data-slide><h1 data-bg-node-id="one">One</h1></section><section class="slide" data-slide><h1 data-bg-node-id="two">Two</h1></section><section class="slide" data-slide><h1 data-bg-node-id="three">Three</h1></section><script src="/runtime/deck-stage.js"></script></body></html>`;

/**
 * Deck export pipeline smoke test. Stages the deck tutorial into a temp
 * dir the same way `prepareSlideDeckExport` would (deck-stage.js copied
 * alongside, runtime path rewritten to a relative file), then runs the
 * real renderers. Explicit opt-in requires a usable browser and fails if
 * browser installation or rendering is broken.
 */
let chromiumAvailable = false;
const SMOKE_OPT_IN = process.env.BG_EXPORT_SMOKE === "1";

beforeAll(async () => {
  if (!SMOKE_OPT_IN) return;
  const browser = await launchChromium(AbortSignal.timeout(30000));
  await browser.close();
  chromiumAvailable = true;
}, 35_000);

describe("deck export smoke (chromium-gated)", () => {
  async function stageDeck() {
    const dir = await mkdtemp(path.join(tmpdir(), "burnguard-exports-test-"));
    await copyBundledFonts(dir);
    await mkdir(path.join(dir, "runtime"), { recursive: true });
    await writeFile(
      path.join(dir, "runtime", "deck-stage.js"),
      DECK_STAGE_JS,
      "utf8",
    );
    const source = SMOKE_OPT_IN ? (await import("../src/db/seed-tutorials")).DECK_TUTORIAL_HTML : SMOKE_DECK_HTML;
    const rewritten = source.replaceAll(
      "/runtime/deck-stage.js",
      "runtime/deck-stage.js",
    );
    await writeFile(path.join(dir, "deck.html"), rewritten, "utf8");
    return dir;
  }

  test.skipIf(!SMOKE_OPT_IN)("Given authored important print display When PDF exports Then each slide appears exactly once", async () => {
    expect(chromiumAvailable).toBe(true);
    const dir = await stageDeck();
    const out = path.join(dir, "deck.pdf");
    try {
      const source = await readFile(path.join(dir, "deck.html"), "utf8");
      await writeFile(path.join(dir, "deck.html"), source.replace("</head>", "<style>@media print{body[data-deck-ready] [data-slide]{display:flex!important}}</style></head>"));
      const { renderDeckToPdf } = await import("../src/services/export-pdf");
      const result = await renderDeckToPdf({
        stagedDir: dir,
        entrypoint: "deck.html",
        outputPath: out,
      });
      const info = await stat(out);
      expect(info.size).toBeGreaterThan(1024);
      expect(result.pages).toBe((source.match(/<section\s+data-slide/g) ?? []).length);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test.skipIf(!SMOKE_OPT_IN)("PNG: renderToPng produces validated viewport pixels", async () => {
    expect(chromiumAvailable).toBe(true);
    const dir = await stageDeck(); const out = path.join(dir, "deck.png");
    try {
      const { renderToPng } = await import("../src/services/export-png");
      const result = await renderToPng({ stagedDir: dir, entrypoint: "deck.html", outputPath: out, width: 640, height: 360, dpr: 2, deck: true, signal: new AbortController().signal });
      expect(result.width).toBe(1280); expect(result.height).toBe(720); expect(result.statistics.differing_pixels).toBeGreaterThan(0);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 60_000);

  test.skipIf(!SMOKE_OPT_IN)("PPTX: preserves grid, gradient, images and SVG charts as distinct high-resolution slide captures", async () => {
    expect(chromiumAvailable).toBe(true);
    const dir = await stageDeck();
    const out = path.join(dir, "deck.pptx");
    try {
      const chart = chartSample("bar", "pptx_chart");
      const html = SMOKE_DECK_HTML.replace("</style>", '.slide{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:center;background:linear-gradient(135deg,#dceaff,#f7c9de)}h1{font-size:64px;transform:rotate(-4deg);text-shadow:3px 3px #fff}</style>').replace('<h1 data-bg-node-id="one">One</h1>', `<h1 data-bg-node-id="one">첫 장 · 한국어</h1>${renderChart({ ...chart, width: 600, height: 400 })}`).replace('<h1 data-bg-node-id="two">Two</h1>', '<h1 data-bg-node-id="two">Two</h1><img width="220" height="220" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'220\' height=\'220\'%3E%3Ccircle cx=\'110\' cy=\'110\' r=\'100\' fill=\'%23f06\'/%3E%3C/svg%3E">');
      await writeFile(path.join(dir, "deck.html"), html);
      const { renderDeckToPptx } = await import("../src/services/export-pptx-render");
      await renderDeckToPptx({
        stagedDir: dir,
        entrypoint: "deck.html",
        outputPath: out,
      });
      const info = await stat(out);
      expect(info.size).toBeGreaterThan(1024);
      const bytes = await readFile(out);
      expect(await validatePptxPackage(bytes, 3)).toEqual({ slides: 3, editable_text_nodes: 0, raster_slides: 3 });
      const zip = await JSZip.loadAsync(bytes);
      const media = Object.values(zip.files).filter(file => /^ppt\/media\/.*\.png$/.test(file.name));
      expect(media).toHaveLength(3);
      const images = await Promise.all(media.map(file => file.async("nodebuffer")));
      for (const image of images) { expect(image.readUInt32BE(16)).toBe(2560); expect(image.readUInt32BE(20)).toBe(1440); }
      expect(new Set(images.map(image => image.toString("base64"))).size).toBe(3);
      expect(await zip.file("ppt/notesSlides/notesSlide1.xml")!.async("string")).toContain("한국어");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
