#!/usr/bin/env bun
/**
 * Regenerate the self-contained HTML catalogue of every bundled design system.
 *
 * This is a generator for a committed artifact, not a step in `bun run build`: it rewrites tracked
 * source (`design system themes/catalogue.html`) and is run deliberately after the registry or a
 * theme changes, so the build pipeline never mutates the working tree.
 *
 * Each theme declares its tokens on `:root`, so loading them all into one page would make them fight
 * over a single scope. Each stylesheet is therefore re-scoped to `[data-theme="<slug>"]` at build
 * time and the cards are plain elements - no iframes, no runtime script, no network dependency.
 *
 * The page is evidence, not decoration: every card is driven by its own theme's tokens, so what you
 * see is what the theme actually ships. Run it after changing the registry or any theme:
 * `bun run build:catalogue`.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const themesRoot = path.join(repoRoot, "design system themes");
const registryPath = path.join(repoRoot, "packages/backend/src/data/bundled-design-systems.ts");
const outputPath = path.join(themesRoot, "catalogue.html");

/** Themes converted from donor palettes; everything else in the registry is original. */
const DONOR = new Set([
  "light", "dark", "cupcake", "retro", "cyberpunk",
  "synthwave", "luxury", "dracula", "nord", "business",
]);

/** Read slug/name pairs from the registry so the catalogue can never drift from what seeds. */
async function registered(): Promise<readonly string[]> {
  const source = await readFile(registryPath, "utf8");
  return [...source.matchAll(/\{\s*slug:\s*"([^"]+)",\s*name:\s*"([^"]+)"\s*\}/g)].map((m) => m[1]!);
}

function token(css: string, name: string): string {
  return new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(css)?.[1]?.trim() ?? "";
}

/** Re-scope one theme's :root block to a per-theme attribute selector. */
function scopedCss(slug: string, css: string): string {
  return css
    .replaceAll("\r\n", "\n")
    // The catalogue supplies fonts once; a per-theme @import would resolve against the wrong path.
    .replace(/@import\s+url\([^)]*\);\s*/g, "")
    // color-scheme belongs to the card, not the document.
    .replace(/color-scheme:\s*[^;]+;/g, "")
    .replace(/:root\s*\{/g, `[data-theme="${slug}"] {`)
    .trim();
}

/** Every bundled system carries a layout contract. */
function layoutBlock(css: string): string {
  if (!token(css, "layout-measure")) return '<p class="nolayout">NO LAYOUT CONTRACT</p>';
  const cells = ([
    ["measure", "layout-measure"],
    ["columns", "layout-columns"],
    ["gutter", "layout-gutter"],
    ["rule", "layout-rule"],
  ] as const)
    .map(([label, name]) => `<div><dt>${label}</dt><dd>${token(css, name)}</dd></div>`)
    .join("");
  return `<dl class="layout">${cells}</dl>`;
}

function card(slug: string, css: string): string {
  const bars = Array.from({ length: 10 }, (_, i) => `<i style="background:var(--chart-${i + 1})"></i>`).join("");
  const origin = DONOR.has(slug)
    ? '<span class="origin">DONOR</span>'
    : '<span class="origin original">ORIGINAL</span>';
  return `
<article class="card" data-theme="${slug}">
  <header class="card-head">
    <span class="slug">${slug}</span>
    ${origin}
  </header>
  <div class="stage">
    <p class="eyebrow">TOKEN PREVIEW</p>
    <h2 class="display">여백과 구조 Aa</h2>
    <p class="lede">본문 텍스트는 이 테마의 measure와 leading을 따릅니다. Body copy follows the theme.</p>
    <div class="actions"><span class="btn">Primary</span><span class="btn ghost">Secondary</span></div>
    <div class="chips">
      <span class="chip s">SUCCESS</span><span class="chip w">WARN</span>
      <span class="chip e">ERROR</span><span class="chip i">INFO</span>
    </div>
    <div class="ramp">${bars}</div>
${layoutBlock(css)}
  </div>
</article>
`;
}

function page(themes: string, cards: string, total: number, donor: number): string {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BurnGuard — bundled design systems</title>
<link rel="stylesheet" href="../assets/fonts/fonts.css">
<style>
/* Page chrome is deliberately neutral so no theme's palette leaks into a neighbouring card. */
*{box-sizing:border-box}
body{margin:0;background:#131316;color:#e9e9ec;font-family:"Public Sans","Pretendard",sans-serif;font-size:15px;line-height:1.6}
.page{max-width:1600px;margin:0 auto;padding:48px 32px 96px}
h1{font-size:34px;letter-spacing:-0.01em;margin:0 0 8px}
.sub{color:#9a9aa4;max-width:74ch;margin:0 0 8px}
.count{font-family:"IBM Plex Mono",monospace;font-size:12px;color:#7f7f8a;letter-spacing:.08em;margin:0 0 36px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(400px,1fr));gap:22px}
.card{border:1px solid #2a2a30;border-radius:10px;overflow:hidden;background:#1a1a1e}
.card-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 13px;border-bottom:1px solid #2a2a30}
.slug{font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:#e9e9ec;letter-spacing:.04em}
.origin{font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.1em;padding:2px 7px;border-radius:999px;border:1px solid #3a3a44;color:#9a9aa4}
.origin.original{border-color:#3f6b8a;color:#8fc4e8}

/* Everything below is driven by the card's own theme tokens. */
.stage{background:var(--bg);color:var(--fg-1);padding:22px;min-height:330px;display:flex;flex-direction:column;gap:13px}
.eyebrow{font-family:var(--font-mono);font-size:var(--fs-12);letter-spacing:var(--ls-eyebrow);color:var(--fg-3);margin:0}
.display{font-family:var(--font-display);font-size:var(--fs-32);line-height:var(--lh-tight);letter-spacing:var(--ls-tight);color:var(--fg-1);margin:0}
.lede{font-family:var(--font-body);font-size:var(--fs-14);color:var(--fg-2);margin:0;max-width:var(--layout-measure,60ch)}
.actions{display:flex;gap:8px;flex-wrap:wrap}
.btn{font-family:var(--font-sans);font-size:var(--fs-13);padding:7px 14px;border-radius:var(--r-4);background:var(--primary-blue);color:var(--fg-on-brand)}
.btn.ghost{background:transparent;color:var(--fg-1);border:var(--layout-rule,1px) solid var(--border-strong)}
.chips{display:flex;gap:5px;flex-wrap:wrap}
.chip{font-family:var(--font-mono);font-size:10.5px;padding:3px 7px;border-radius:var(--r-2)}
.chip.s{background:var(--success);color:var(--fg-on-success)}
.chip.w{background:var(--warning-yellow);color:var(--fg-on-warning)}
.chip.e{background:var(--error);color:var(--fg-on-error)}
.chip.i{background:var(--info);color:var(--fg-on-info)}
.ramp{display:flex;height:26px;gap:2px}
.ramp i{flex:1;border-radius:var(--r-2) var(--r-2) 0 0}
.layout{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:auto 0 0;padding-top:11px;border-top:var(--layout-rule,1px) solid var(--border)}
.layout div{min-width:0}
.layout dt{font-family:var(--font-mono);font-size:9.5px;letter-spacing:.07em;color:var(--fg-4);text-transform:uppercase}
.layout dd{font-family:var(--font-mono);font-size:11px;color:var(--fg-2);margin:1px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nolayout{font-family:var(--font-mono);font-size:10px;color:var(--fg-4);margin:auto 0 0;padding-top:11px;border-top:1px solid var(--border);letter-spacing:.05em}

${themes}
</style></head>
<body><div class="page">
<h1>Bundled design systems</h1>
<p class="sub">Every card below is rendered by its own theme's tokens — ground, foreground steps, one action, the semantic pairs, the ten-step chart ramp, and its layout signature. Nothing here restyles a theme, so the page is the evidence.</p>
<p class="count">${total} systems · ${donor} donor-derived · ${total - donor} original</p>
<div class="grid">
${cards}
</div>
</div></body></html>
`;
}

export async function buildThemeCatalogue(): Promise<string> {
  const slugs = (await registered()).filter((slug) => existsSync(path.join(themesRoot, slug)));
  const sheets: string[] = [];
  const cards: string[] = [];
  for (const slug of slugs) {
    const css = await readFile(path.join(themesRoot, slug, "colors_and_type.css"), "utf8");
    sheets.push(scopedCss(slug, css));
    cards.push(card(slug, css));
  }
  const donor = slugs.filter((slug) => DONOR.has(slug)).length;
  await writeFile(outputPath, page(sheets.join("\n"), cards.join(""), slugs.length, donor), "utf8");
  return `${outputPath} — ${slugs.length} cards (${donor} donor, ${slugs.length - donor} original)`;
}

if (import.meta.main) console.log(await buildThemeCatalogue());
