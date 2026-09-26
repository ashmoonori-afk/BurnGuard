import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import {
  summarizeDeckHtml,
  summarizePrototypeHtml,
} from "../src/harness/structure-extractor";

async function makeTempFile(name: string, contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-struct-"));
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, name);
  await writeFile(filePath, contents, "utf8");
  return filePath;
}

const sampleDeck = `<!doctype html>
<html><head><style>
:root {
  --color-primary: #001a4d;
  --color-accent: #ff5722;
  --font-heading: "Pretendard", sans-serif;
}
.deck-slide { padding: 4rem; background: var(--color-primary); }
.deck-cover h1 { color: var(--color-accent); font-family: var(--font-heading); }
.kpi { font-size: 6rem; }
</style></head>
<body>
<script src="/runtime/deck-stage.js" defer></script>
<section data-slide class="deck-slide deck-cover" data-bg-node-id="slide-1">
  <h1 data-bg-node-id="slide-1-title">제일기획 비전 2030</h1>
  <p data-bg-node-id="slide-1-sub">Asymmetric brand reset</p>
</section>
<section data-slide class="deck-slide" data-layout="kpi-grid" data-bg-node-id="slide-2">
  <h2 data-bg-node-id="slide-2-title">시장 현황</h2>
</section>
<section data-slide class="deck-slide" data-bg-node-id="slide-3">
  <h2>Closing</h2>
</section>
</body></html>`;

const samplePrototype = `<!doctype html>
<html><head><style>
:root { --space-md: 16px; --color-bg: #fff; }
header { padding: var(--space-md); }
main { background: var(--color-bg); }
</style></head>
<body>
<header data-section="hero" data-bg-node-id="hero">
  <h1>Marketing site</h1>
  <p>Lorem ipsum dolor sit amet.</p>
</header>
<main data-section="features" data-bg-node-id="features">
  <article>Feature 1</article>
</main>
<footer data-section="cta" data-bg-node-id="cta">
  <a href="#">Sign up</a>
</footer>
</body></html>`;

describe("summarizeDeckHtml", () => {
  test("renders slide map with id, classes, layout, and snippet", async () => {
    const filePath = await makeTempFile("deck.html", sampleDeck);
    const summary = await summarizeDeckHtml(filePath);
    expect(summary).not.toBeNull();
    const text = summary!;
    expect(text).toContain("deck.html");
    expect(text).toContain("3 slide(s)");
    // Slide 1 has an extra class beyond deck-slide
    expect(text).toContain("1. slide-1 .deck-cover");
    expect(text).toContain("제일기획 비전 2030");
    // Slide 2 has data-layout
    expect(text).toContain("[layout=kpi-grid]");
    // Slide 3 has no extras
    expect(text).toContain("3. slide-3");
  });

  test("includes style block stats and CSS variable list", async () => {
    const filePath = await makeTempFile("deck.html", sampleDeck);
    const summary = await summarizeDeckHtml(filePath);
    expect(summary).not.toBeNull();
    const text = summary!;
    expect(text).toContain("Style block:");
    expect(text).toContain("CSS variable(s)");
    expect(text).toContain("--color-accent");
    expect(text).toContain("--color-primary");
    expect(text).toContain("--font-heading");
  });

  test("PH-07: Given native chart figures When summarized Then the map reports their count so the chart contract can be gated on it", async () => {
    const deck = await makeTempFile("deck.html", '<!doctype html><html><body><section data-slide data-bg-node-id="slide-1"><figure data-bg-chart="a"></figure><figure data-bg-chart="b"></figure></section></body></html>');
    expect(await summarizeDeckHtml(deck)).toContain("Charts: 2 data-bg-chart figure(s)");
    const site = await makeTempFile("index.html", '<!doctype html><html><body><main data-section="stats"><figure data-bg-chart="a"></figure></main></body></html>');
    expect(await summarizePrototypeHtml(site)).toContain("Charts: 1 data-bg-chart figure(s)");
    const landmarks = await makeTempFile("index.html", '<!doctype html><html><body><main><figure data-bg-chart="a"></figure></main></body></html>');
    expect(await summarizePrototypeHtml(landmarks)).toContain("Charts: 1 data-bg-chart figure(s)");
    expect(await summarizeDeckHtml(await makeTempFile("deck.html", sampleDeck))).not.toContain("data-bg-chart");
  });

  test("returns null when the file is missing", async () => {
    const summary = await summarizeDeckHtml("/no/such/path/deck.html");
    expect(summary).toBeNull();
  });

  test("flags empty / non-conforming deck instead of crashing", async () => {
    const filePath = await makeTempFile(
      "deck.html",
      "<!doctype html><html><body><div>no slides here</div></body></html>",
    );
    const summary = await summarizeDeckHtml(filePath);
    expect(summary).not.toBeNull();
    expect(summary!).toContain("0 slide(s)");
    expect(summary!).toContain("no `<section data-slide>` found");
  });

  test("output stays compact for a deck with many slides", async () => {
    const slides = Array.from(
      { length: 60 },
      (_, i) =>
        `<section data-slide class="deck-slide" data-bg-node-id="slide-${i + 1}"><h2>Slide ${i + 1} title text</h2></section>`,
    ).join("\n");
    const html = `<!doctype html><html><body><style>:root{--c:#000;}</style>${slides}</body></html>`;
    const filePath = await makeTempFile("deck.html", html);
    const summary = await summarizeDeckHtml(filePath);
    expect(summary).not.toBeNull();
    // Pinning the worst-case envelope so a future change can't silently
    // re-bloat the prompt header by listing all 60 slides verbatim.
    expect(summary!.length).toBeLessThan(4_000);
    expect(summary!).toContain("and 20 more slide(s)");
  });
});

describe("summarizePrototypeHtml", () => {
  test("lists data-section landmarks with text snippets", async () => {
    const filePath = await makeTempFile("index.html", samplePrototype);
    const summary = await summarizePrototypeHtml(filePath);
    expect(summary).not.toBeNull();
    const text = summary!;
    expect(text).toContain("index.html");
    expect(text).toContain("3 section(s)");
    expect(text).toContain("<header> hero");
    expect(text).toContain("Marketing site");
    expect(text).toContain("<main> features");
    expect(text).toContain("<footer> cta");
    expect(text).toContain("Style block:");
    expect(text).toContain("--color-bg");
    expect(text).toContain("--space-md");
  });

  test("falls back to semantic landmarks when data-section is absent", async () => {
    const html = `<!doctype html><html><body>
      <header><h1>Hello</h1></header>
      <main><p>Body content</p></main>
      <footer><small>Footer</small></footer>
    </body></html>`;
    const filePath = await makeTempFile("index.html", html);
    const summary = await summarizePrototypeHtml(filePath);
    expect(summary).not.toBeNull();
    const text = summary!;
    expect(text).toContain("0 section(s)");
    expect(text).toContain("<header>");
    expect(text).toContain("<main>");
    expect(text).toContain("<footer>");
    expect(text).toContain("Hello");
  });
});
