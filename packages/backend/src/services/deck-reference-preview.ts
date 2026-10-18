import { DECK_REFERENCES, deckReferenceFor } from "../data/deck-references";

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** Read-only authored specimens. Brand CSS is bundled, never supplied by a request. No scripts. */
export function renderDeckReferencePreview(slug: string, name: string, brandCss: string, slideCss: string): string | null {
  const reference = deckReferenceFor(slug);
  if (!reference) return null;
  const profile = Object.entries(DECK_REFERENCES).find(([, value]) => value === reference)![0];
  const tokens = new Map([...slideCss.matchAll(/(--slide-[a-z-]+)\s*:\s*([\d.]+)px;/g)].map(match => [match[1]!, Number(match[2])]));
  const units = (token: string, fallback: number) => `${(tokens.get(token) ?? fallback) / 19.2}cqw`;
  const css = brandCss.replace(/@import\s+[^;]+;/g, "").replace(/<\/style/gi, "<\\/style");
  const picture = (className = "visual") => `<img class="${className}" src="./media/${slug}.webp" alt="${escape(name)} — illustrative brand image">`;
  const title = `<div class="title"><small>01 / ${escape(name)}</small><h1>Ideas into<br>lasting impact.</h1><p>A direction. A clear point of view.</p></div>`;
  const specimen = `<div class="specimen"><span>Aa</span><div class="swatches"><i></i><i></i><i></i></div><small>Type / colour / composition</small></div>`;
  const narrative = `<div class="narrative"><small>02 / Point of view</small><h2>Make room<br>for what matters.</h2><p>One clear idea, supported by a deliberate visual hierarchy.</p></div>`;
  const bars = `<div class="chart"><small>ILLUSTRATIVE DATA · NOT RESULTS</small><div class="bars">${[38, 56, 78].map((value, index) => `<div><b>${value}</b><i style="height:${value}%"></i><span>${["Before", "Today", "Next"][index]}</span></div>`).join("")}</div></div>`;
  const proof = `<div class="narrative"><small>03 / Evidence</small><h2>Show the<br>difference.</h2><p>Keep the observation and its supporting evidence together.</p></div>`;
  let cover = title + picture();
  let body = narrative + picture();
  let evidence = proof + bars;
  switch (profile) {
    case "geometric": cover = title + '<div class="geometry"><i></i><i></i><i></i></div>'; body = narrative + `<div class="lineup">${[1, 2, 3].map(n => `<figure>${picture()}<figcaption>Perspective ${n}</figcaption></figure>`).join("")}</div>`; break;
    case "luminous": body = narrative + specimen; evidence = proof + `<div class="specimen-grid">${["Aa", "Bb", "Cc", "Dd"].map(letter => `<span>${letter}</span>`).join("")}</div>`; break;
    case "manual": cover = title + picture() + '<div class="swatches"><i></i><i></i><i></i></div>'; body = narrative + specimen; evidence = proof + `<div class="contact">${picture()}${picture()}</div>`; break;
    case "construction": body = narrative + picture() + '<aside class="note">A useful observation,<br>at the right point.</aside>'; break;
    case "analytic": cover = title + '<div class="line-art" aria-hidden="true"></div>'; evidence = proof + bars + '<aside class="method"><small>METHOD</small><p>Compare the same measure over a consistent period.</p></aside>'; break;
    case "merchant": body = narrative + specimen; evidence = proof + `<div class="applications">${["Primary", "Compact", "Inline"].map(label => `<div><span>${label}</span><strong>One next step →</strong></div>`).join("")}</div>`; break;
    case "editorial": evidence = proof + picture(); break;
    case "quarterly": cover = `<div class="period">Q4 <span>2026</span></div>${title}<div class="dots">○ ○ ●</div>`; body = narrative + '<div class="results"><p>01 / A stronger foundation</p><p>02 / A clearer direction</p><p>03 / One shared measure</p></div>'; evidence = `<div class="panel">${proof}</div><div class="panel">${bars}</div>`; break;
    case "softfield": cover = title + '<div class="organic" aria-hidden="true"></div>'; body = narrative + '<div class="organic"><span>Our<br>approach.</span></div>'; evidence = `<div class="island"><strong>78</strong><small>ILLUSTRATIVE VALUE</small></div>${proof}`; break;
    case "poster": cover = title; body = narrative + specimen; evidence = proof + '<div class="specimen-grid"><span>Aa</span><span>Aa</span><small>PRIMARY</small><small>SECONDARY</small></div>'; break;
    case "framed": cover = picture() + title; evidence = '<blockquote>“A clear principle<br>changes the way<br>we make things.”<small>ILLUSTRATIVE STATEMENT</small></blockquote>' + picture(); break;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(name)} · Slide compositions</title><link rel="stylesheet" href="./fonts.css"><style>${css}
*{box-sizing:border-box}
body{margin:0;background:var(--surface,#f1f0ed);color:var(--fg-1,#202020);font-family:var(--font-body,var(--font-sans,sans-serif))}
.intro,.rules{padding:20px;font:14px/1.6 var(--font-body,sans-serif)}
.intro p{margin:4px 0}
.intro strong{font-size:18px}
.sheet{container-type:inline-size;margin:0 0 12px}
.slide{position:relative;isolation:isolate;aspect-ratio:16/9;overflow:hidden;padding:var(--edge);background:var(--surface,#f1f0ed);display:grid;grid-template-columns:1fr 1fr;gap:2cqw;--edge:${units("--slide-pad-edge",72)};--hero:${units("--slide-type-hero",132)};--heading:${units("--slide-type-heading",72)};--body:${units("--slide-type-body",32)};--caption:${units("--slide-type-caption",24)};border:1px solid color-mix(in srgb,currentColor 25%,transparent)}
h1,h2,p,figure{margin:0}
h1,h2{font-family:var(--font-display,var(--font-sans,sans-serif));font-weight:600;line-height:1.03;letter-spacing:-.045em}
h1{font-size:var(--hero)}
h2{font-size:var(--heading)}
p{font-size:var(--body);line-height:1.5;max-width:30ch}
small,figcaption{font-size:var(--caption);line-height:1.45}
small{display:block;letter-spacing:.035em}
.title,.narrative{position:relative;z-index:2;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:2.5cqw;min-width:0}
.title small{margin-bottom:auto}
.title p{margin-top:auto}
.visual{width:100%;height:100%;min-height:0;object-fit:cover;display:block}
.cover .visual{position:absolute;inset:0;z-index:-2}
.cover:has(>.visual):not(.framed .cover):after{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(90deg,#000b,#0001)}
.cover:has(>.visual){color:white}
.cover .title{grid-column:1/-1;max-width:85%}
.body .visual{max-height:46cqw}
.specimen{display:flex;flex-direction:column;justify-content:center;border-left:1px solid currentColor;padding-left:3cqw;gap:3cqw}
.specimen>span{font:16cqw/1 var(--font-display,sans-serif)}
.swatches{display:flex;gap:1cqw;align-items:end}
.swatches i{display:block;background:var(--brand-primary,var(--primary-blue,#555));width:7cqw;aspect-ratio:1;border-radius:50%}
.swatches i:nth-child(2){background:var(--orange-50,#aaa);width:5cqw}
.swatches i:nth-child(3){background:var(--green-50,#777);width:3cqw}
.chart{display:flex;flex-direction:column;justify-content:center;min-width:0}
.bars{height:33cqw;display:flex;gap:3cqw;padding-top:4cqw;border-bottom:1px solid currentColor}
.bars>div{flex:1;display:flex;flex-direction:column;justify-content:end;align-items:center;gap:1cqw}
.bars i{width:70%;display:block;background:currentColor}
.bars>div:last-child i{background:var(--brand-primary,var(--primary-blue,#666))}
.bars b{font-size:2.6cqw}
.bars span{font-size:var(--caption)}
.closing{grid-template-columns:1fr}
.closing h2{font-size:var(--hero);max-width:12ch}
.closing small{align-self:end}
.geometry{display:flex;align-items:end;position:absolute;right:0;bottom:0;width:60%;height:28%}
.geometry i{flex:1;height:100%;background:var(--brand-primary,var(--primary-blue));border-radius:50% 50% 0 0}
.geometry i:nth-child(2){background:var(--orange-50);border-radius:0}
.geometry i:nth-child(3){background:var(--green-50);border-radius:50%}
.geometric .cover,.geometric .closing{background:var(--brand-primary,var(--primary-blue));color:var(--fg-on-brand,#fff)}
.geometric .title{grid-column:1/-1;max-width:85%}
.geometric .body{grid-template-columns:1fr;grid-template-rows:1fr 1.2fr}
.geometric .narrative{gap:1cqw}
.lineup{display:grid;grid-template-columns:repeat(3,1fr);gap:2cqw;min-height:0}
.lineup figure{min-height:0;display:flex;flex-direction:column;gap:1cqw}
.lineup img{height:14cqw}
.luminous .cover .visual{filter:blur(1.6cqw);transform:scale(1.05)}
.luminous .body,.manual .body,.manual .evidence{grid-template-columns:3fr 9fr}
.specimen-grid{display:grid;grid-template-columns:1fr 1fr;align-content:center}
.specimen-grid>*{border:1px solid color-mix(in srgb,currentColor 30%,transparent);padding:2cqw;font-size:8cqw}
.specimen-grid small{font-size:var(--caption)}
.manual .cover{grid-template-columns:9fr 3fr;grid-template-rows:3fr 1fr;color:var(--fg-1,#222)}
.manual .cover .visual{position:static;z-index:0;grid-column:2;grid-row:1/3}
.manual .cover:after{display:none!important}
.manual .cover .title{grid-column:1;max-width:none}
.manual .cover .swatches{border-top:1px solid currentColor;padding-top:2cqw}
.manual .closing{background-image:linear-gradient(90deg,transparent 25%,#8884 25%,#8884 25.1%,transparent 25.1%),linear-gradient(transparent 75%,#8884 75%,#8884 75.2%,transparent 75.2%)}
.contact{display:grid;grid-template-columns:3fr 2fr;gap:1cqw;min-height:0}
.contact img:last-child{object-position:80%}
.construction .slide{background-image:linear-gradient(#8883 1px,transparent 1px),linear-gradient(90deg,#8883 1px,transparent 1px);background-size:8.333% 16.667%}
.construction .cover{background-color:var(--brand-primary,var(--primary-blue));color:var(--fg-on-brand,#fff)}
.construction .cover .visual{display:none}
.construction .cover:after{display:none!important}
.construction .body{grid-template-columns:4fr 8fr}
.construction .narrative{border-top:1px solid currentColor;border-bottom:1px solid currentColor}
.note{position:absolute;bottom:5cqw;right:5cqw;padding:2cqw;background:var(--surface);font-size:var(--body);border:1px solid currentColor}
.analytic .evidence{grid-template-columns:3fr 6fr 3fr}
.method{font-size:var(--body);border-left:1px solid currentColor;padding-left:2cqw;align-self:center}
.analytic .cover .title{grid-column:1;max-width:none}
.line-art{background:repeating-conic-gradient(from 50deg at 0 50%,transparent 0deg 2deg,var(--brand-primary,var(--primary-blue)) 2deg 2.2deg,transparent 2.2deg 4deg);opacity:.5}
.merchant .cover{background:var(--brand-primary,var(--primary-blue));color:var(--fg-on-brand,#fff)}
.merchant .cover:after{background:var(--surface)!important;left:67%!important;transform:skew(6deg)}
.merchant .cover .visual{display:none}
.merchant .cover .title{grid-column:1;max-width:none}
.applications{display:flex;flex-direction:column;justify-content:center;gap:3cqw}
.applications>div{display:flex;flex-direction:column;gap:1cqw;font-size:var(--caption)}
.applications strong{padding:2cqw;border:1px solid currentColor;font-size:var(--body)}
.editorial .body{grid-template-columns:6fr 6fr}
.editorial .body .visual{grid-column:1;grid-row:1}
.editorial .body .narrative{grid-column:2}
.editorial .evidence{grid-template-columns:4fr 8fr}
.quarterly .cover{display:flex;flex-direction:column}
.period{font-size:6cqw;border-bottom:1px solid currentColor;padding-bottom:2cqw;display:flex;justify-content:space-between}
.quarterly .cover .title{flex:1;max-width:100%}
.quarterly .cover .title small,.quarterly .cover .title p{display:none}
.dots{font-size:4cqw;text-align:right;border-top:1px solid currentColor}
.results{align-self:center}
.results p{border-bottom:1px solid currentColor;padding:3cqw 0}
.panel{border:1px solid currentColor;border-radius:1.5cqw;padding:2cqw;display:flex;align-items:center}
.panel .chart{width:100%}
.campaign h1{background:var(--surface);color:var(--fg-1);padding:.5cqw;box-decoration-break:clone}
.campaign .evidence .chart{background:color-mix(in srgb,var(--brand-primary,var(--primary-blue)) 15%,var(--surface));padding:2cqw}
.softfield .cover{grid-template-columns:1fr}
.organic{background:var(--brand-primary,var(--primary-blue));border-radius:30% 70% 55% 45% / 50% 40% 60% 50%;color:var(--fg-on-brand,#fff);display:flex;align-items:center;justify-content:center;min-height:30cqw}
.organic span{font-size:6cqw}
.softfield .cover .organic{position:absolute;inset:10% -10% -30% 25%;z-index:-1;opacity:.2}
.softfield .cover .title{max-width:85%}
.island{align-self:center;border-radius:45% 55% 40% 60%;padding:5cqw 2cqw;background:color-mix(in srgb,var(--brand-primary,var(--primary-blue)) 18%,var(--surface));text-align:center}
.island strong{font-size:12cqw}
.poster .cover{grid-template-columns:1fr;background:var(--brand-primary,var(--primary-blue));color:var(--fg-on-brand,#fff)}
.poster .title{max-width:90%}
.poster .body{grid-template-columns:4fr 8fr}
.framed .cover{grid-template-columns:5fr 7fr}
.framed .cover .visual{position:static;z-index:0}
.framed .cover .title{grid-column:2;max-width:none;color:var(--fg-1)}
.framed .cover:after{display:none!important}
.framed .cover{background-image:linear-gradient(transparent 78%,color-mix(in srgb,var(--brand-primary,var(--primary-blue)) 25%,var(--surface)) 78%)}
blockquote{font:5cqw/1.15 var(--font-serif,serif);margin:0;align-self:center}
blockquote small{margin-top:3cqw}
.framed .evidence .visual{height:65%;align-self:end}
.rules summary{cursor:pointer}
.rules li{margin:8px 0}
</style></head><body class="${profile}"><header class="intro"><strong>${escape(name)}</strong><p>Layout study · Original theme imagery · Illustrative copy and data</p></header>${[["cover",cover],["body",body],["evidence",evidence],["closing",'<h2>Make the<br>next move.</h2><small>04 / One clear next step →</small>']].map(([kind,content]) => `<div class="sheet"><section class="slide ${kind}" data-slide-kind="${kind}" aria-label="${kind}">${content}</section></div>`).join("")}<details class="rules"><summary>Composition rules</summary><ul>${[reference.cover,reference.body,reference.evidence,reference.close].map(rule=>`<li>${escape(rule)}</li>`).join("")}</ul></details></body></html>`;
}
