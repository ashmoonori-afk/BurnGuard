#!/usr/bin/env bun
/**
 * Generate one website preview per bundled design system.
 *
 * A preview is not a swatch sheet. It is the kind of site the system would actually produce, so the
 * section structure is chosen from the theme's own design family and its `--family-*` tokens, read
 * here at build time: a data system gets a filter rail and a dense table, a commerce system gets the
 * gallery pattern its token names, a culture system gets the rotation and overlap it declares. Every
 * visual property resolves to one of the theme's tokens; this file introduces no palette of its own.
 *
 * Each page inlines its theme's tokens with the per-theme fonts `@import` stripped - that import
 * resolves against a seeded workspace, not the repository - and links the bundled fonts directly, so
 * a preview opens from disk with no network.
 *
 * Previews live beside the theme directories rather than inside them, because a theme directory is
 * exactly three files. Run with `bun run previews`.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { bundledDesignSystems } from "../packages/backend/src/data/bundled-design-systems";

const repoRoot = path.resolve(import.meta.dir, "..");
const themesRoot = path.join(repoRoot, "design system themes");
const outputRoot = path.join(themesRoot, "previews");

type Archetype = "marketing" | "article" | "shop" | "poster" | "workspace" | "place";

/**
 * Content genre is authored here; layout, navigation, proportions and breakpoints come from tokens.
 */
const ARCHETYPE: Record<string, Archetype> = {
  // Donor palettes.
  light: "marketing", dark: "workspace", cupcake: "marketing", retro: "article",
  cyberpunk: "workspace", synthwave: "marketing", luxury: "article", dracula: "article",
  nord: "article", business: "workspace",
  // Earlier originals, by the composition each one documents.
  "cobalt-atelier": "poster", "signal-reel": "poster", "daylight-press": "article",
  "blueprint-manual": "article", "ledger-index": "workspace", "dune-editorial": "article",
  "archive-folio": "workspace",
  // Family systems.
  "signal-console": "marketing", "paper-instrument": "marketing",
  "quiet-runtime": "workspace", "graphite-spec": "marketing",
  "long-form-press": "article", "wide-gutter-review": "article",
  "quarterly-folio": "article", "night-edition": "article",
  "studio-counter": "shop", "atelier-counter": "shop", "market-stack": "shop", "vitrine-mono": "shop",
  "night-marquee": "poster", "stencil-field": "poster", "press-riso": "poster", "exhibit-wall": "poster",
  "index-table": "workspace", "facet-archive": "workspace",
  "console-ledger": "workspace", "field-register": "workspace",
  "warm-vestibule": "place", "stone-court": "place", "linen-retreat": "place", "timber-hall": "place",
};

type Theme = {
  readonly slug: string;
  readonly name: string;
  readonly archetype: Archetype;
  readonly css: string;
  readonly token: (name: string, fallback?: string) => string;
};

function scopedTokens(css: string): string {
  return css
    .replaceAll("\r\n", "\n")
    .replace(/@import\s+url\([^)]*\);\s*/g, "")
    .trim();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

/**
 * Art direction stands in as geometry drawn from the theme's own chart ramp, so a preview carries
 * composition and colour without shipping a photograph or reaching for the network.
 */
function figure(kind: "wide" | "portrait" | "square" | "band", seed: number, tone: "data" | "neutral" = "data"): string {
  const a = tone === "neutral" ? "var(--bg-muted)" : `var(--chart-${(seed % 10) + 1})`;
  const b = tone === "neutral" ? "var(--gray-60)" : `var(--chart-${((seed + 3) % 10) + 1})`;
  const c = tone === "neutral" ? "var(--gray-40)" : `var(--chart-${((seed + 6) % 10) + 1})`;
  const box = { wide: "0 0 160 90", portrait: "0 0 90 120", square: "0 0 100 100", band: "0 0 240 90" }[kind];
  const shapes = kind === "portrait"
    ? `<rect x="0" y="0" width="90" height="120" fill="${a}"/>
       <circle cx="45" cy="52" r="30" fill="${b}" opacity="0.85"/>
       <rect x="0" y="92" width="90" height="28" fill="${c}" opacity="0.9"/>`
    : kind === "square"
      ? `<rect x="0" y="0" width="100" height="100" fill="${a}"/>
         <rect x="18" y="18" width="64" height="64" fill="${b}" opacity="0.9"/>
         <circle cx="50" cy="50" r="18" fill="${c}"/>`
      : kind === "band"
        ? `<rect x="0" y="0" width="240" height="90" fill="${a}"/>
           <ellipse cx="70" cy="46" rx="90" ry="54" fill="${b}" opacity="0.75"/>
           <ellipse cx="185" cy="40" rx="70" ry="44" fill="${c}" opacity="0.7"/>`
        : `<rect x="0" y="0" width="160" height="90" fill="${a}"/>
           <path d="M0 90 L54 30 L96 72 L132 40 L160 62 L160 90 Z" fill="${b}" opacity="0.9"/>
           <circle cx="122" cy="24" r="14" fill="${c}"/>`;
  return `<svg class="fig" viewBox="${box}" preserveAspectRatio="xMidYMid slice" role="presentation" focusable="false">${shapes}</svg>`;
}

/** Primitives every archetype shares. Each declaration resolves to a theme token. */
function baseCss(theme: Theme): string {
  return `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg-1);
  font-family:var(--font-body);font-size:var(--fs-16);line-height:var(--lh-relaxed);
  font-feature-settings:"tnum" 0}
img,svg{display:block;max-width:100%}
a{color:inherit}
.wrap{max-width:var(--layout-max,1200px);margin-inline:auto;
  padding-inline:var(--layout-margin,24px)}
.bleed{width:100%}
.eyebrow{font-family:var(--font-mono);font-size:var(--fs-12);
  letter-spacing:var(--ls-eyebrow,.12em);text-transform:uppercase;color:var(--fg-3);margin:0}
.display{font-family:var(--font-display);line-height:var(--lh-display,var(--lh-tight));
  letter-spacing:var(--ls-display,var(--ls-tight));color:var(--fg-1);margin:0;
  font-size:clamp(var(--fs-32),6vw,var(--fs-64))}
.lede{font-family:var(--font-serif);font-size:var(--fs-20);color:var(--fg-2);
  max-width:var(--layout-measure,60ch);margin:0}
.body{font-size:var(--fs-16);color:var(--fg-2);max-width:var(--layout-measure,60ch)}
.rule{border:0;border-top:var(--layout-rule,1px) solid var(--border);margin:0}
.btn{display:inline-block;font-family:var(--font-sans);font-size:var(--fs-14);
  font-weight:var(--fw-medium,500);padding:var(--sp-3) var(--sp-5);border:0;
  border-radius:var(--r-4);background:var(--primary-blue);color:var(--fg-on-brand);
  text-decoration:none;transition:opacity var(--dur-fast) var(--ease-standard)}
.btn:hover{opacity:.88}
.btn.ghost{background:transparent;color:var(--fg-1);
  border:var(--layout-rule,1px) solid var(--border-strong)}
.btn.pill{border-radius:var(--r-pill)}
.tag{display:inline-block;font-family:var(--font-mono);font-size:var(--fs-12);
  padding:var(--sp-1) var(--sp-2);border-radius:var(--r-2);
  background:var(--bg-muted);color:var(--fg-2)}
.fig{width:100%;height:100%;object-fit:cover}
.media{overflow:hidden;background:var(--bg-muted);border-radius:var(--r-8)}
.nav{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-4);
  min-height:var(--layout-nav-h,64px);border-bottom:var(--layout-rule,1px) solid var(--border)}
.nav .mark{font-family:var(--font-display);font-size:var(--fs-18);
  letter-spacing:var(--ls-tight);color:var(--fg-1)}
.nav ul{display:flex;gap:var(--sp-5);list-style:none;margin:0;padding:0;
  font-family:var(--font-sans);font-size:var(--fs-14);color:var(--fg-2)}
.foot{border-top:var(--layout-rule,1px) solid var(--border);
  padding-block:var(--sp-8);margin-top:var(--sp-10);
  font-family:var(--font-mono);font-size:var(--fs-12);color:var(--fg-4);
  display:flex;justify-content:space-between;gap:var(--sp-4);flex-wrap:wrap}
.section{padding-block:var(--layout-section-y,64px)}
.grid{display:grid;gap:var(--layout-gutter,24px)}
.cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}
.cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}
.cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}
.stack{display:flex;flex-direction:column;gap:var(--sp-4)}
.row{display:flex;gap:var(--sp-3);flex-wrap:wrap;align-items:center}
dl.facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--sp-4);margin:0}
dl.facts dt{font-family:var(--font-mono);font-size:var(--fs-12);color:var(--fg-4);
  letter-spacing:.06em;text-transform:uppercase}
dl.facts dd{margin:var(--sp-1) 0 0;font-family:var(--font-body);font-size:var(--fs-14);color:var(--fg-2)}
@media (max-width:${theme.token("layout-bp-md", "820px")}){
  .cols-2,.cols-3,.cols-4,dl.facts{grid-template-columns:1fr}
  .nav ul{display:none}
}`;
}

/**
 * The hero slot takes a real photograph when one has been produced for the theme from its own
 * `## Image direction`, and falls back to the drawn figure otherwise. Secondary slots always use the
 * figure, so a page never repeats the same generated asset. Themes whose direction forbids
 * photography receive generated illustration or diagram artwork rather than a photograph.
 */
const MEDIA_EXTENSIONS = ["webp", "png", "jpg", "jpeg"] as const;

function heroMedia(theme: Theme, kind: "wide" | "portrait" | "square" | "band", seed: number, tone: "data" | "neutral" = "data"): string {
  for (const extension of MEDIA_EXTENSIONS) {
    const file = `${theme.slug}.${extension}`;
    if (existsSync(path.join(outputRoot, "media", file))) {
      return `<img class="fig" src="./media/${file}" alt="" loading="lazy" decoding="async">`;
    }
  }
  return figure(kind, seed, tone);
}

type Ctx = Theme & {
  fam: (name: string, fallback: string) => string;
  hero: (kind: "wide" | "portrait" | "square" | "band", seed: number, tone?: "data" | "neutral") => string;
};

// CSS grid needs two dimensioned tracks, not the aspect-ratio syntax used by the tokens.
function mediaTracks(value: string): string {
  const parts = value.split("/").map(Number);
  const [media = 1, text = 1] = parts;
  if (parts.length > 2 || ![media, text].every(n => Number.isFinite(n) && n > 0)) throw new Error("Invalid media/text ratio");
  return `minmax(0,${media}fr) minmax(0,${text}fr)`;
}

function navigationTracks(c: Ctx): string {
  const columns = Number(c.token("layout-columns", "12"));
  const span = Number(c.fam("family-ui-navigation-span", "2"));
  if (!Number.isInteger(columns) || !Number.isInteger(span) || span < 1 || span >= columns) throw new Error(`${c.slug}: invalid navigation span`);
  return `minmax(0,${span}fr) minmax(0,${columns - span}fr)`;
}

function marketing(c: Ctx): string {
  const split = c.token("layout-structure") === "split";
  const panelRows = [
    ["요청 처리", "1,284", "success"],
    ["대기열", "37", "warning-yellow"],
    ["실패", "2", "error"],
  ];
  return `
<style>
.hero{padding-block:var(--layout-section-y,72px) var(--sp-10)}
.hero-lead{display:grid;grid-template-columns:${split ? "minmax(0,5fr) minmax(0,7fr)" : "1fr"};gap:var(--layout-gutter,24px);align-items:center}
.hero-copy{${split ? "" : "text-align:center"}}
.hero-copy .row{${split ? "" : "justify-content:center"}}
.hero-copy .lede{${split ? "" : "margin-inline:auto"}}
.hero .display{margin-bottom:var(--sp-5)}
.hero .lede{margin-bottom:var(--sp-6)}
.panel{margin-top:var(--sp-10);border:var(--layout-rule,1px) solid var(--border);
  border-radius:var(--r-8);background:var(--surface);overflow:hidden;box-shadow:var(--shadow-2)}
.hero-visual{aspect-ratio:var(--layout-hero,16 / 10);${split ? "" : "max-width:var(--layout-max);width:100%;margin-inline:auto"}}
.panel-head{display:flex;align-items:center;gap:var(--sp-2);
  padding:var(--sp-3) var(--sp-4);border-bottom:var(--layout-rule,1px) solid var(--border);
  font-family:var(--font-mono);font-size:var(--fs-12);color:var(--fg-3)}
.dot{width:8px;height:8px;border-radius:var(--r-pill);background:var(--border-strong)}
.panel-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:0}
.panel-rows{border-right:var(--layout-rule,1px) solid var(--border)}
.prow{display:flex;justify-content:space-between;align-items:center;gap:var(--sp-3);
  padding:var(--sp-3) var(--sp-4);border-bottom:var(--layout-rule,1px) solid var(--border);
  font-size:var(--fs-14)}
.prow:last-child{border-bottom:0}
.prow b{font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-weight:var(--fw-medium,500)}
.bars{display:flex;align-items:flex-end;gap:var(--sp-2);height:190px;padding:var(--sp-4)}
.bars i{display:block;flex:1;border-radius:var(--r-2) var(--r-2) 0 0}
.feature h3{font-family:var(--font-display);font-size:var(--fs-24);margin:0 0 var(--sp-2);color:var(--fg-1)}
.feature p{margin:0;color:var(--fg-3);font-size:var(--fs-14)}
.feature{padding:var(--sp-5);border:var(--layout-rule,1px) solid var(--border);
  border-radius:var(--r-8);background:var(--surface)}
.cta{border:var(--layout-rule,1px) solid var(--border-strong);border-radius:var(--r-8);
  padding:var(--sp-8);background:var(--bg-subtle);display:flex;justify-content:space-between;
  align-items:center;gap:var(--sp-5);flex-wrap:wrap}
@media (max-width:${c.token("layout-bp-md", "820px")}){.panel-body,.hero-lead{grid-template-columns:1fr}.panel-rows{border-right:0}}
</style>
<header class="wrap nav">
  <span class="mark">${escapeHtml(c.name.replace(/ Theme$/, ""))}</span>
  <ul><li>제품</li><li>문서</li><li>가격</li><li>변경 이력</li></ul>
  <a class="btn" href="#none">시작하기</a>
</header>
<main>
  <section class="wrap hero">
    <div class="hero-lead"><div class="hero-copy">
    <p class="eyebrow">버전 3.4 · 로컬 우선</p>
    <h1 class="display">측정되는 것만<br>운영에 남는다</h1>
    <p class="lede">파이프라인의 모든 단계가 수치로 남고, 실패한 단계는 원인까지 함께 기록됩니다. 설치 없이 로컬에서 실행하세요.</p>
    <div class="row" style="margin-top:var(--sp-6)">
      <a class="btn" href="#none">내려받기</a>
      <a class="btn ghost" href="#none">문서 보기</a>
    </div>
    </div><div class="media hero-visual">${c.hero("wide", 0, "neutral")}</div></div>
    <div class="panel">
      <div class="panel-head"><span class="dot"></span><span class="dot"></span><span class="dot"></span>
        <span style="margin-left:var(--sp-3)">runtime · 127.0.0.1</span></div>
      <div class="panel-body">
        <div class="panel-rows">
          ${panelRows.map(([label, value, tone]) => `<div class="prow"><span style="color:var(--fg-2)">${label}</span><b style="color:var(--${tone})">${value}</b></div>`).join("")}
          <div class="prow"><span style="color:var(--fg-2)">평균 지연</span><b>142 ms</b></div>
        </div>
        <div class="bars">
          ${[38, 62, 45, 88, 54, 72, 96, 60].map((h, i) => `<i style="height:${h}%;background:var(--chart-${i + 1})"></i>`).join("")}
        </div>
      </div>
    </div>
  </section>
  <section class="wrap section">
    <div class="grid cols-3">
      ${[["결정론적 실행", "같은 입력은 같은 결과를 만듭니다. 재현되지 않는 통과는 통과가 아닙니다."],
        ["경계에서만 검증", "신뢰 구간 안에서는 방어 코드를 두지 않고, 경계에서 한 번 검증합니다."],
        ["증거가 남는 배포", "모든 게시는 해시와 영수증을 남기고, 실패하면 이전 상태로 되돌아갑니다."]]
        .map(([h, p]) => `<article class="feature"><h3>${h}</h3><p>${p}</p></article>`).join("")}
    </div>
  </section>
  <section class="wrap section" style="padding-top:0">
    <hr class="rule" style="margin-bottom:var(--sp-8)">
    <dl class="facts">
      <div><dt>평균 부팅</dt><dd>0.8초</dd></div>
      <div><dt>메모리</dt><dd>180 MB</dd></div>
      <div><dt>외부 의존</dt><dd>없음</dd></div>
      <div><dt>지원 플랫폼</dt><dd>Windows · macOS</dd></div>
    </dl>
  </section>
  <section class="wrap section" style="padding-top:0">
    <div class="cta">
      <div><p class="eyebrow">지금 시작</p>
        <p class="display" style="font-size:var(--fs-32);margin-top:var(--sp-2)">설치는 한 번, 실행은 로컬에서</p></div>
      <a class="btn" href="#none">내려받기</a>
    </div>
  </section>
</main>
<footer class="wrap foot"><span>${escapeHtml(c.name)}</span><span>미리보기 · 토큰 기반 생성</span></footer>`;
}

function article(c: Ctx): string {
  const fit = c.fam("family-media-fit", "cover");
  const ratio = mediaTracks(c.fam("family-media-text-ratio", "1"));
  const structure = c.token("layout-structure");
  const side = structure === "sidebar";
  const split = structure === "split" || structure === "offset";
  const indented = c.fam("family-editorial-paragraph-mode", "spaced") === "indented";
  const paragraphs = [
    "작업의 속도를 결정하는 것은 도구가 아니라 되돌릴 수 있는 범위다. 한 번에 되돌릴 수 있는 단위가 작을수록 더 과감하게 시도할 수 있고, 시도가 많아질수록 결과는 빨리 수렴한다.",
    "그래서 좋은 작업 환경은 빠른 환경이 아니라 취소가 싼 환경이다. 저장과 게시를 분리하고, 게시에는 영수증을 남기고, 영수증이 있으면 언제든 이전 상태로 돌아갈 수 있게 한다.",
    "이 원칙은 화면에도 그대로 적용된다. 한 화면에서 수행할 수 있는 결정의 수를 줄이면 각 결정의 되돌림 비용이 내려가고, 사용자는 화면을 읽는 대신 사용하게 된다.",
  ];
  return `
<style>
.masthead{display:flex;justify-content:center;align-items:center;
  min-height:var(--layout-nav-h,64px);border-bottom:var(--layout-rule,1px) solid var(--border)}
.masthead .mark{font-family:var(--font-display);font-size:var(--fs-24);letter-spacing:var(--ls-tight)}
.article-shell{display:grid;grid-template-columns:${side ? navigationTracks(c) : "1fr"};gap:var(--layout-gutter,24px)}
.article-shell main{min-width:0}
.contents{padding-block:var(--sp-8);border-right:var(--layout-rule,1px) solid var(--border);font-family:var(--font-mono);font-size:var(--fs-14)}
.contents a{display:block;padding:var(--sp-3) var(--sp-2);overflow-wrap:anywhere}
.article-hero{display:grid;grid-template-columns:${split ? "minmax(0,4fr) minmax(0,8fr)" : "1fr"};gap:var(--layout-gutter,24px);align-items:center}
.article-hero .hero-media{${split ? "grid-column:2;grid-row:1" : ""}}
.article-hero .headline-block{${split ? "grid-column:1;grid-row:1" : ""}}
${structure === "offset" ? ".article-hero .hero-media{margin-top:var(--layout-section-y)}.masthead{justify-content:flex-start}" : ""}
.hero-media{aspect-ratio:var(--layout-hero,16 / 9);margin-block:var(--sp-8)}
.hero-media .fig{object-fit:${fit}}
.headline{max-width:var(--layout-measure,62ch)}
.byline{display:flex;gap:var(--sp-4);flex-wrap:wrap;font-family:var(--font-mono);
  font-size:var(--fs-12);color:var(--fg-4);margin-block:var(--sp-5);
  padding-block:var(--sp-3);border-block:var(--layout-rule,1px) solid var(--border)}
.prose{max-width:var(--layout-measure,62ch);font-family:var(--font-serif);
  font-size:var(--fs-18);line-height:var(--lh-loose,var(--lh-relaxed));color:var(--fg-2)}
.prose p{margin:0 0 ${indented ? "0" : "var(--sp-4)"}}
.prose p + p{${indented ? "text-indent:1em" : ""}}
.pull{font-family:var(--font-display);font-size:var(--fs-32);line-height:var(--lh-tight);
  color:var(--fg-1);margin-block:var(--sp-8);padding-left:var(--sp-5);
  border-left:3px solid var(--primary-blue);max-width:var(--layout-measure,62ch)}
.split{display:grid;grid-template-columns:${ratio};gap:var(--layout-gutter,24px);align-items:start}
.caption{font-family:var(--font-mono);font-size:var(--fs-12);color:var(--fg-4);margin-top:var(--sp-2)}
.more{display:grid;gap:0;margin-top:var(--sp-10)}
.more a{display:flex;justify-content:space-between;gap:var(--sp-4);text-decoration:none;
  padding-block:var(--sp-4);border-bottom:var(--layout-rule,1px) solid var(--border);
  font-family:var(--font-serif);font-size:var(--fs-18);color:var(--fg-1)}
.more a span{font-family:var(--font-mono);font-size:var(--fs-12);color:var(--fg-4)}
@media (max-width:${c.token("layout-bp-md", "820px")}){
  .split,.article-shell,.article-hero{grid-template-columns:1fr}
  .article-hero .hero-media,.article-hero .headline-block{grid-column:auto;grid-row:auto}
  .article-hero .headline-block{order:-1}.article-hero .hero-media{margin-top:var(--sp-4)}
  .contents{display:flex;flex-wrap:wrap;border-right:0;border-bottom:var(--layout-rule,1px) solid var(--border);padding-block:var(--sp-2)}}
</style>
<header class="wrap masthead"><span class="mark">${escapeHtml(c.name.replace(/ Theme$/, ""))}</span></header>
<div class="wrap article-shell">
${side ? '<nav class="contents" aria-label="목차"><a href="#article-intro">개요</a><a href="#article-details">본문</a><a href="#article-related">관련 문서</a></nav>' : ""}
<main>
  <section class="article-hero" id="article-intro">
  <div class="media hero-media">${c.hero("wide", 1, "neutral")}</div>
  <div class="headline-block">
  <p class="eyebrow">에세이 · 작업 방식</p>
  <h1 class="display headline" style="margin-top:var(--sp-3)">되돌릴 수 있는 만큼만<br>과감해질 수 있다</h1>
  </div></section>
  <div class="byline"><span>글 · 편집부</span><span>2026년 3월</span><span>읽는 데 7분</span></div>
  <div class="prose" id="article-details">${paragraphs.map((p) => `<p>${p}</p>`).join("")}</div>
  <blockquote class="pull">취소가 싼 환경에서만 사람은 과감해진다.</blockquote>
  <section class="split section" style="padding-bottom:0">
    <figure style="margin:0">
      <div class="media" style="aspect-ratio:4 / 3">${figure("square", 4, "neutral")}</div>
      <figcaption class="caption">그림 1. 저장과 게시를 분리한 상태 전이</figcaption>
    </figure>
    <div class="prose">
      <p>게시는 저장의 연장이 아니라 별개의 사건이다. 저장은 사용자의 손에서 끝나지만, 게시는 다른 사람이 볼 수 있는 상태를 만든다.</p>
      <p>두 사건을 분리하면 편집 중의 불완전한 상태가 바깥으로 새지 않고, 게시 시점마다 검증할 수 있는 지점이 생긴다.</p>
    </div>
  </section>
  <nav class="more" id="article-related">
    ${[["여백은 장식이 아니라 구조다", "03"], ["측정되지 않는 개선은 취향이다", "02"], ["작은 단위로 되돌리기", "01"]]
      .map(([t, n]) => `<a href="#none">${t}<span>${n}</span></a>`).join("")}
  </nav>
</main></div>
<footer class="wrap foot"><span>${escapeHtml(c.name)}</span><span>미리보기 · 토큰 기반 생성</span></footer>`;
}

function shop(c: Ctx): string {
  const layout = c.fam("family-commerce-gallery-layout", "paired");
  const fit = c.fam("family-media-fit", "cover");
  const sticky = c.fam("family-commerce-purchase-position", "flow") === "sticky";
  const items = [
    ["겹이불 커버", "128,000원"], ["리넨 셔츠", "96,000원"],
    ["가죽 소품함", "72,000원"], ["무광 텀블러", "38,000원"],
  ];
  // A covering crop means the page is one continuous field, so the brand line can cross it; a
  // contained crop means each plate is an object with its own margin, and type stays clear of it.
  const crosses = layout === "paired" && fit === "cover";
  const cell = (label: string, price: string, seed: number, wide: boolean): string => `
    <article class="item${wide ? " wide" : ""}">
      <div class="media shot">${seed === 2 ? c.hero(wide ? "wide" : "portrait", seed, "neutral") : figure(wide ? "wide" : "portrait", seed, "neutral")}</div>
      <div class="meta"><span>${label}</span><span class="price">${price}</span></div>
    </article>`;
  const gallery = layout === "stacked"
    ? items.map(([l, p], i) => cell(l, p, i + 2, true)).join("")
    : layout === "lead-and-pairs"
      ? cell(items[0]![0], items[0]![1], 2, true) + items.slice(1).map(([l, p], i) => cell(l, p, i + 3, false)).join("")
      : items.map(([l, p], i) => cell(l, p, i + 2, false)).join("");
  return `
<style>
.shopnav{display:flex;justify-content:space-between;align-items:center;
  min-height:var(--layout-nav-h,56px);font-family:var(--font-mono);font-size:var(--fs-12);
  color:var(--fg-3);letter-spacing:.06em;text-transform:uppercase}
.brandline{font-family:var(--font-display);line-height:.9;letter-spacing:var(--ls-tight);
  font-size:clamp(var(--fs-48),12vw,9rem);color:var(--fg-1);margin:0;position:relative;z-index:1;
  padding-block:var(--sp-6) var(--sp-4)${crosses ? ";margin-bottom:calc(-0.44 * clamp(var(--fs-48),12vw,9rem))" : ""}}
.gallery{display:grid;gap:var(--layout-gutter,16px);
  grid-template-columns:${layout === "stacked" ? "1fr" : "repeat(2,minmax(0,1fr))"}}
.item .shot{aspect-ratio:${layout === "stacked" ? "16 / 9" : "4 / 5"};border-radius:var(--r-4)}
.item.wide{grid-column:1 / -1}
.item.wide .shot{aspect-ratio:var(--layout-hero,16 / 9)}
.item .fig{object-fit:${fit}}
.meta{display:flex;justify-content:space-between;gap:var(--sp-3);
  padding-block:var(--sp-3);font-family:var(--font-sans);font-size:var(--fs-14);color:var(--fg-2)}
.price{font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--fg-1)}
.detail{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);
  gap:var(--layout-gutter,24px);align-items:start;margin-top:var(--sp-10)}
.buy{${sticky ? "position:sticky;top:var(--sp-4);" : ""}border:var(--layout-rule,1px) solid var(--border);
  border-radius:var(--r-8);padding:var(--sp-5);background:var(--surface);display:grid;gap:var(--sp-3)}
.buy .big{font-family:var(--font-display);font-size:var(--fs-32);color:var(--fg-1)}
.spec{display:grid;gap:0;margin:0}
.spec div{display:flex;justify-content:space-between;gap:var(--sp-3);
  padding-block:var(--sp-2);border-bottom:var(--layout-rule,1px) solid var(--border);
  font-family:var(--font-mono);font-size:var(--fs-12);color:var(--fg-3)}
.spec div:last-child{border-bottom:0}
.spec b{color:var(--fg-2);font-weight:var(--fw-regular,400)}
@media (max-width:${c.token("layout-bp-md", "780px")}){.gallery{grid-template-columns:1fr}.detail{grid-template-columns:1fr}
  .buy{position:static}}
</style>
<header class="wrap shopnav">
  <span>${escapeHtml(c.name.replace(/ Theme$/, ""))}</span>
  <span>검색 · 계정 · 장바구니 (2)</span>
</header>
<main class="wrap">
  <h1 class="brandline">계절이 지나도<br>남는 것들</h1>
  <div class="gallery">${gallery}</div>
  <section class="detail">
    <div>
      <p class="eyebrow">소재와 관리</p>
      <p class="body" style="margin-top:var(--sp-3)">세탁 후에도 형태가 남도록 밀도를 높여 짰습니다. 첫 세탁에서 약간 줄어든 뒤 그 상태로 유지됩니다. 표백제와 건조기는 권하지 않습니다.</p>
      <dl class="spec" style="margin-top:var(--sp-5)">
        <div><span>소재</span><b>리넨 100%</b></div>
        <div><span>중량</span><b>240 g/㎡</b></div>
        <div><span>생산</span><b>국내 봉제</b></div>
        <div><span>배송</span><b>2–4일</b></div>
      </dl>
    </div>
    <aside class="buy">
      <p class="eyebrow">겹이불 커버</p>
      <p class="big">128,000원</p>
      <p style="margin:0;font-size:var(--fs-14);color:var(--fg-3)">퀸 · 오트 / 재고 6</p>
      <a class="btn" href="#none">장바구니에 담기</a>
      <a class="btn ghost" href="#none">위시리스트</a>
    </aside>
  </section>
</main>
<footer class="wrap foot"><span>${escapeHtml(c.name)}</span><span>미리보기 · 토큰 기반 생성</span></footer>`;
}

function poster(c: Ctx): string {
  const split = c.token("layout-structure") === "split";
  const inset = c.slug === "cobalt-atelier";
  const rotation = c.fam("family-creative-type-rotation", "0deg");
  const step = c.fam("family-creative-line-step", "0px");
  const overlap = c.fam("family-creative-type-image-overlap", "0%");
  const credits = [
    ["연출", "임세린"], ["촬영", "박도현"], ["미술", "정하윤"],
    ["음악", "K. 리"], ["제작", "스튜디오 노트"],
  ];
  // The token is a share of the display block's own height, so the block's height is expressed in
  // its own terms - lines x size x leading - and the translation is taken from that. A percentage
  // margin would resolve against the container's width instead and pull the media somewhere random.
  const fraction = (Number.parseFloat(overlap) || 0) / 100;
  return `
<style>
.chrome{display:flex;justify-content:space-between;align-items:center;
  min-height:var(--layout-nav-h,44px);font-family:var(--font-mono);
  font-size:var(--fs-12);color:var(--fg-3);letter-spacing:.08em}
.field{padding-block:var(--layout-section-y,96px) var(--sp-6);text-align:center}
.band .media{border-radius:0;aspect-ratio:var(--layout-hero,21 / 9)}
${inset ? ".band{max-width:var(--layout-max);margin-inline:auto;padding-inline:var(--layout-margin)}.over{text-align:left;padding-top:var(--sp-8)}" : ""}
${split ? `.poster-main{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,4fr);gap:var(--layout-gutter);max-width:var(--layout-max);margin-inline:auto;padding-inline:var(--layout-margin)}
.poster-main>.field,.poster-main>section:last-child{grid-column:1 / -1}.poster-main>.band{grid-column:2;grid-row:2}.poster-main>.over{grid-column:1;grid-row:2;padding-inline:0;overflow:hidden;text-align:left;margin-top:0}` : ""}
.over{position:relative;z-index:1;text-align:center;
  margin-top:calc(-1 * ${fraction} * var(--statement-h));
  padding-bottom:calc(var(--sp-8) - ${fraction} * var(--statement-h))}
.statement{--statement-size:clamp(var(--fs-40),9vw,7rem);
  display:inline-block;transform:rotate(${rotation});
  font-family:var(--font-display);line-height:var(--lh-display,.94);
  letter-spacing:var(--ls-display,var(--ls-tight));color:var(--fg-1);margin:0;
  font-size:var(--statement-size)}
.field,.over{--statement-h:calc(2 * clamp(var(--fs-40),9vw,7rem) * var(--lh-display,.94))}
.statement span{display:block}
.statement span:nth-child(2){margin-left:calc(${step} * 1)}
.statement span:nth-child(3){margin-left:calc(${step} * 2)}
.credits{max-width:calc(var(--layout-measure,46ch) + 8ch);margin:var(--sp-10) auto 0;
  display:grid;gap:0}
.credits div{display:flex;justify-content:space-between;gap:var(--sp-8);
  padding-block:var(--sp-2);font-family:var(--font-mono);font-size:var(--fs-12);
  letter-spacing:.06em;border-bottom:var(--layout-rule,1px) solid var(--border)}
.credits dt{color:var(--fg-4);text-transform:uppercase}
.credits dd{margin:0;color:var(--fg-2)}
.note{max-width:var(--layout-measure,46ch);margin:var(--sp-8) auto 0;text-align:center;
  font-family:var(--font-body);font-size:var(--fs-14);color:var(--fg-3)}
@media (max-width:${c.token("layout-bp-md", "820px")}){
  .poster-main{display:block}.statement{transform:none}.statement span:nth-child(n){margin-left:0}
  .over{margin-top:0;padding-bottom:var(--sp-8)}}
</style>
<header class="wrap chrome">
  <span>${escapeHtml(c.name.replace(/ Theme$/, ""))}</span><span>메뉴</span>
</header>
<main class="poster-main">
  <section class="wrap field"><p class="eyebrow">2026 봄 상영 · 단관</p></section>
  <section class="bleed band"><div class="media">${c.hero("band", 5, "neutral")}</div></section>
  <section class="wrap over">
    <h1 class="statement"><span>흐린 날의</span><span>긴 산책</span></h1>
  </section>
  <section class="wrap">
    <dl class="credits">
      ${credits.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}
    </dl>
    <p class="note">러닝타임 104분 · 전체 관람가 · 3월 12일부터 매일 19시 30분 한 회 상영</p>
  </section>
</main>
<footer class="wrap foot"><span>${escapeHtml(c.name)}</span><span>미리보기 · 토큰 기반 생성</span></footer>`;
}

function workspace(c: Ctx): string {
  const side = c.fam("family-ui-navigation-placement", "side") === "side";
  const fixed = c.fam("family-data-table-layout", "fixed");
  // A data system is judged on rhythm across many rows, so the preview carries a real run of them.
  const rows = [
    ["SPX-1042", "정상", "서울", "2,481", "success"],
    ["SPX-1043", "지연", "부산", "1,120", "warning-yellow"],
    ["SPX-1051", "정상", "대전", "3,004", "success"],
    ["SPX-1067", "실패", "광주", "0", "error"],
    ["SPX-1072", "정상", "인천", "1,894", "success"],
    ["SPX-1080", "대기", "제주", "412", "info"],
    ["SPX-1091", "정상", "서울", "2,760", "success"],
    ["SPX-1104", "정상", "수원", "1,338", "success"],
    ["SPX-1110", "지연", "대구", "902", "warning-yellow"],
    ["SPX-1126", "정상", "울산", "1,507", "success"],
    ["SPX-1133", "대기", "창원", "268", "info"],
    ["SPX-1147", "정상", "청주", "2,045", "success"],
    ["SPX-1152", "실패", "전주", "0", "error"],
    ["SPX-1168", "정상", "천안", "1,712", "success"],
    ["SPX-1174", "정상", "김해", "884", "success"],
    ["SPX-1180", "지연", "포항", "639", "warning-yellow"],
  ];
  return `
<style>
.shell{display:grid;grid-template-columns:${side ? navigationTracks(c) : "1fr"};
  gap:var(--layout-gutter,24px);min-height:100vh;max-width:var(--layout-max);margin-inline:auto;padding-inline:var(--layout-margin)}
.rail{border-right:var(--layout-rule,1px) solid var(--border);background:var(--bg-subtle);
  padding:var(--sp-5) var(--sp-4);display:${side ? "block" : "none"}}
.rail h2{font-family:var(--font-mono);font-size:var(--fs-12);letter-spacing:.08em;
  text-transform:uppercase;color:var(--fg-4);margin:0 0 var(--sp-3)}
.facet{display:flex;justify-content:space-between;gap:var(--sp-2);padding-block:var(--sp-2);
  font-size:var(--fs-14);color:var(--fg-2);border-bottom:var(--layout-rule,1px) solid var(--border)}
.facet b{font-family:var(--font-mono);font-weight:var(--fw-regular,400);color:var(--fg-4)}
.facet.on{color:var(--fg-1)}
.facet.on b{color:var(--primary-blue)}
.main{padding:var(--sp-5) var(--layout-margin,20px);min-width:0;
  display:flex;flex-direction:column}
.main > .foot{margin-top:auto}
.toolbar{display:flex;justify-content:space-between;align-items:center;gap:var(--sp-3);
  flex-wrap:wrap;margin-bottom:var(--sp-4)}
.search{flex:1;min-width:200px;border:var(--layout-rule,1px) solid var(--border);
  border-radius:var(--r-4);padding:var(--sp-2) var(--sp-3);background:var(--surface);
  font-family:var(--font-body);font-size:var(--fs-14);color:var(--fg-3)}
.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--layout-gutter,12px);
  margin-bottom:var(--sp-5)}
.data-visual{height:clamp(180px,24vw,320px);margin-bottom:var(--sp-5)}
.stat{border:var(--layout-rule,1px) solid var(--border);border-radius:var(--r-4);
  padding:var(--sp-3) var(--sp-4);background:var(--surface)}
.stat dt{font-family:var(--font-mono);font-size:var(--fs-12);color:var(--fg-4);
  letter-spacing:.06em;text-transform:uppercase}
.stat dd{margin:var(--sp-1) 0 0;font-family:var(--font-mono);font-size:var(--fs-24);
  font-variant-numeric:tabular-nums;color:var(--fg-1)}
table{width:100%;border-collapse:collapse;table-layout:${fixed};font-size:var(--fs-14)}
.table-scroll{overflow-x:auto}table{min-width:480px}
thead th{position:sticky;top:0;background:var(--bg);text-align:left;
  font-family:var(--font-mono);font-size:var(--fs-12);letter-spacing:.07em;
  text-transform:uppercase;color:var(--fg-4);font-weight:var(--fw-regular,400);
  padding:var(--sp-2) var(--sp-3);border-bottom:var(--layout-rule,1px) solid var(--border-strong)}
tbody td{padding:var(--sp-2) var(--sp-3);color:var(--fg-2);
  border-bottom:var(--layout-rule,1px) solid var(--border)}
td.num{font-family:var(--font-mono);font-variant-numeric:tabular-nums;text-align:right;color:var(--fg-1)}
td.id{font-family:var(--font-mono);color:var(--fg-1)}
.state{font-family:var(--font-mono);font-size:var(--fs-12);padding:var(--sp-1) var(--sp-2);
  border-radius:var(--r-pill);background:var(--bg-muted)}
@media (max-width:${c.token("layout-bp-md", "820px")}){.shell{grid-template-columns:1fr}.rail{${side ? "display:flex;gap:var(--sp-3);overflow-x:auto;border-right:0;align-items:center" : "display:none"}}
  .rail>*{flex-shrink:0}.main{padding-inline:0}
  .summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
<div class="shell">
  <aside class="rail">
    <h2>구분</h2>
    ${[["전체", "412"], ["정상", "381"], ["지연", "24"], ["실패", "7"]]
      .map(([k, v], i) => `<div class="facet${i === 0 ? " on" : ""}"><span>${k}</span><b>${v}</b></div>`).join("")}
    <h2 style="margin-top:var(--sp-6)">지역</h2>
    ${[["수도권", "208"], ["영남", "96"], ["호남", "61"], ["기타", "47"]]
      .map(([k, v]) => `<div class="facet"><span>${k}</span><b>${v}</b></div>`).join("")}
  </aside>
  <main class="main">
    <div class="toolbar">
      <span class="eyebrow">운영 기록 · 최근 24시간</span>
      <div class="row">
        <span class="search">식별자 또는 지역으로 검색</span>
        <span class="tag">정렬 · 최신</span>
      </div>
    </div>
    <dl class="summary">
      ${[["총 실행", "412"], ["성공률", "92.5%"], ["평균 지연", "142 ms"], ["대기", "37"]]
        .map(([k, v]) => `<div class="stat"><dt>${k}</dt><dd>${v}</dd></div>`).join("")}
    </dl>
    <div class="media data-visual">${c.hero("wide", 8, "data")}</div>
    <div class="table-scroll" role="region" aria-label="운영 기록 표" tabindex="0"><table>
      <thead><tr><th>식별자</th><th>상태</th><th>지역</th><th style="text-align:right">처리량</th></tr></thead>
      <tbody>
        ${rows.map(([id, state, region, count, tone]) => `<tr>
          <td class="id">${id}</td>
          <td><span class="state" style="color:var(--${tone})">${state}</span></td>
          <td>${region}</td>
          <td class="num">${count}</td></tr>`).join("")}
      </tbody>
    </table></div>
    <footer class="foot"><span>${escapeHtml(c.name)}</span><span>미리보기 · 토큰 기반 생성</span></footer>
  </main>
</div>`;
}

function place(c: Ctx): string {
  const bleed = Number.parseFloat(c.fam("family-spatial-image-bleed", "100%")) / 100;
  if (!Number.isFinite(bleed) || bleed < 0 || bleed > 1) throw new Error(`${c.slug}: invalid image bleed`);
  const ratio = mediaTracks(c.fam("family-media-text-ratio", "1.6"));
  const fit = c.fam("family-media-fit", "cover");
  return `
<style>
.hero{width:calc(100% - ((100% - min(100% - 2 * var(--layout-margin), var(--layout-max,1360px) - 2 * var(--layout-margin))) * ${1 - bleed}));
  margin-inline:auto;margin-top:var(--sp-6)}
.hero .media{aspect-ratio:var(--layout-hero,16 / 9);border-radius:${bleed === 1 ? "0" : "var(--r-8)"}}
.hero .fig{object-fit:${fit}}
.statement{max-width:var(--layout-measure,56ch);font-family:var(--font-display);
  font-size:clamp(var(--fs-32),4.4vw,var(--fs-48));line-height:var(--lh-tight);
  letter-spacing:var(--ls-tight);color:var(--fg-1);margin:0}
.practical{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));
  gap:var(--layout-gutter,24px);margin-top:var(--sp-8)}
.practical h3{font-family:var(--font-mono);font-size:var(--fs-12);letter-spacing:.1em;
  text-transform:uppercase;color:var(--fg-4);margin:0 0 var(--sp-3);
  padding-bottom:var(--sp-2);border-bottom:var(--layout-rule,1px) solid var(--border)}
.practical div p{margin:0 0 var(--sp-2);font-size:var(--fs-14);color:var(--fg-2);
  display:flex;justify-content:space-between;gap:var(--sp-3)}
.practical div p span:last-child{color:var(--fg-3);font-family:var(--font-mono);font-size:var(--fs-12)}
.pair{display:grid;grid-template-columns:${ratio};gap:var(--layout-gutter,24px);
  align-items:center;margin-top:var(--layout-section-y,96px)}
.pair .media{aspect-ratio:4 / 3}
@media (max-width:${c.token("layout-bp-md", "800px")}){.practical,.pair{grid-template-columns:1fr}}
</style>
<header class="wrap nav">
  <span class="mark">${escapeHtml(c.name.replace(/ Theme$/, ""))}</span>
  <ul><li>공간</li><li>프로그램</li><li>방문</li></ul>
</header>
<main>
  <section class="hero"><div class="media">${c.hero("wide", 6, "neutral")}</div></section>
  <section class="wrap section">
    <p class="eyebrow">오래된 창고를 고쳐 쓰는 일</p>
    <h1 class="statement" style="margin-top:var(--sp-4)">벽을 남기고 바닥을 바꾸면 방은 다시 쓰인다</h1>
    <div class="practical">
      <div><h3>여는 시간</h3>
        <p><span>화–금</span><span>11:00–19:00</span></p>
        <p><span>토·일</span><span>10:00–18:00</span></p>
        <p><span>월요일</span><span>휴관</span></p></div>
      <div><h3>찾아오는 길</h3>
        <p><span>주소</span><span>서동 43-2</span></p>
        <p><span>지하철</span><span>2호선 도보 7분</span></p>
        <p><span>주차</span><span>건물 뒤 6면</span></p></div>
      <div><h3>방문 안내</h3>
        <p><span>입장</span><span>무료</span></p>
        <p><span>단체</span><span>사전 연락</span></p>
        <p><span>촬영</span><span>삼각대 불가</span></p></div>
    </div>
    <div class="pair">
      <div class="media">${figure("square", 8, "neutral")}</div>
      <div>
        <p class="eyebrow">재료</p>
        <p class="body" style="margin-top:var(--sp-3)">바닥은 원래의 콘크리트를 갈아내 그대로 두었고, 벽은 회칠 위에 아무것도 덧바르지 않았습니다. 목재는 철거한 서까래를 다시 켜서 썼습니다.</p>
      </div>
    </div>
  </section>
</main>
<footer class="wrap foot"><span>${escapeHtml(c.name)}</span><span>미리보기 · 토큰 기반 생성</span></footer>`;
}

const RENDERERS: Record<Archetype, (c: Ctx) => string> = {
  marketing, article, shop, poster, workspace, place,
};

function pageFor(theme: Theme): string {
  const ctx: Ctx = {
    ...theme,
    fam: (name, fallback) => theme.token(name, fallback),
    hero: (kind, seed, tone) => heroMedia(theme, kind, seed, tone),
  };
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(theme.name)} — 웹사이트 미리보기</title>
<link rel="stylesheet" href="../../assets/fonts/fonts.css">
<style>
${scopedTokens(theme.css)}
${baseCss(theme)}
</style></head>
<body data-archetype="${theme.archetype}" data-layout="${theme.token("layout-structure")}">
${RENDERERS[theme.archetype](ctx)}
</body></html>
`;
}

function indexPage(themes: readonly Theme[]): string {
  const cards = themes.map((t) => `
  <a class="card" href="./${t.slug}.html">
    <span class="slug">${t.slug}</span>
    <span class="kind">${t.archetype}</span>
  </a>`).join("");
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>웹사이트 미리보기 — 번들 디자인 시스템</title>
<link rel="stylesheet" href="../../assets/fonts/fonts.css">
<style>
*{box-sizing:border-box}
body{margin:0;background:#131316;color:#e9e9ec;
  font-family:"Public Sans","Pretendard",sans-serif;font-size:15px;line-height:1.6}
.page{max-width:1200px;margin:0 auto;padding:48px 32px 96px}
h1{font-size:32px;letter-spacing:-.01em;margin:0 0 8px}
p.sub{color:#9a9aa4;max-width:70ch;margin:0 0 32px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.card{display:flex;justify-content:space-between;align-items:center;gap:12px;
  padding:14px 16px;border:1px solid #2a2a30;border-radius:8px;background:#1a1a1e;
  text-decoration:none;color:#e9e9ec}
.card:hover{border-color:#3f6b8a}
.slug{font-family:"IBM Plex Mono",monospace;font-size:13px}
.kind{font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.1em;
  text-transform:uppercase;color:#8fc4e8}
</style></head>
<body><div class="page">
<h1>웹사이트 미리보기</h1>
<p class="sub">각 미리보기는 해당 디자인 시스템이 실제로 만들어낼 법한 사이트입니다. 구조는 그 시스템의 계열과 <code>--family-*</code> 토큰에서, 모든 표현은 그 시스템의 토큰에서 나옵니다.</p>
<div class="grid">${cards}
</div>
</div></body></html>
`;
}

export async function buildThemePreviews(check = false): Promise<string> {
  const entries = bundledDesignSystems;
  const themes: Theme[] = [];
  for (const { slug, name } of entries) {
    const css = await readFile(path.join(themesRoot, slug, "colors_and_type.css"), "utf8");
    const values = new Map(
      [...css.matchAll(/--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
    );
    const archetype = ARCHETYPE[slug];
    if (!archetype) throw new Error(`${slug}: no archetype mapped; add one before generating`);
    themes.push({
      slug, name, archetype, css,
      token: (key, fallback = "") => values.get(key) ?? fallback,
    });
  }

  const pages = new Map(themes.map(theme => [`${theme.slug}.html`, pageFor(theme)]));
  pages.set("index.html", indexPage(themes));
  if (check) {
    const actual = (await readdir(outputRoot)).filter(file => file.endsWith(".html")).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...pages.keys()].sort())) throw new Error("Preview page list is stale; run bun run previews");
    for (const [file, expected] of pages) {
      if ((await readFile(path.join(outputRoot, file), "utf8")).replaceAll("\r\n", "\n") !== expected) throw new Error(`${file}: preview is stale; run bun run previews`);
    }
    return `${themes.length} previews + index are current`;
  }
  // Remove only generated pages so a removed slug cannot leave stale HTML. The generated media
  // directory is an authored input and must survive every rebuild.
  await mkdir(outputRoot, { recursive: true });
  for (const file of await readdir(outputRoot)) {
    if (file.endsWith(".html")) await rm(path.join(outputRoot, file));
  }
  for (const [file, page] of pages) {
    await writeFile(path.join(outputRoot, file), page, "utf8");
  }

  const written = (await readdir(outputRoot)).length;
  return `${outputRoot} — ${themes.length} previews + index (${written} files)`;
}

if (import.meta.main) console.log(await buildThemePreviews(process.argv.includes("--check")));
