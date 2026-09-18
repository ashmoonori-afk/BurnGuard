import { LOGO_PAGE, type LogoSetV1 } from "@bg/shared";
import { escapeHtml } from "./index";

/** The sentence and node id the deliverables gate compares a finished turn against. */
export const LOGO_STARTER_SENTENCE = "Four logo candidates will appear here after the first turn.";
export const LOGO_STARTER_NODE_ID = "logo-brief";

export function renderLogo(projectName: string, logoSet: LogoSetV1): string {
  const title = escapeHtml(projectName);
  const brand = escapeHtml(logoSet.brand_name);
  const brandClass = [...logoSet.brand_name].length > 40 ? ' class="long-title"' : "";
  const chips = logoSet.character.map((value) => `<li>${escapeHtml(value)}</li>`).join("");
  const keywords = logoSet.symbol_keywords ?? [];
  const facts: readonly (readonly [string, string])[] = [
    ["분야", logoSet.niche],
    ["로고 유형", logoSet.logo_type],
    ...(keywords.length === 0 ? [] : [["심볼 키워드", keywords.join(", ")] as const]),
    ...(logoSet.avoid === undefined ? [] : [["피할 것", logoSet.avoid] as const]),
  ];
  const brief = facts
    .map(([label, value]) => `<div class="fact"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("");
  return `<!doctype html>
<html lang="ko">
<head>
  <link rel="stylesheet" href="fonts/fonts.css">
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    h1, h2, h3 { font-family: "Space Grotesk", "Pretendard", sans-serif; }
    code, pre, .number { font-family: "IBM Plex Mono", "Pretendard", monospace; font-variant-numeric: tabular-nums; }
    :root { color-scheme: light; --page-background: #ffffff; }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-width: ${LOGO_PAGE.width}px; min-height: ${LOGO_PAGE.height}px; background: var(--page-background); }
    body { font-family: "DM Sans", "Pretendard", sans-serif; color: #14213d; }
    [data-graphic-artboard] {
      position: relative;
      overflow: hidden;
      padding: 128px;
      display: grid;
      align-content: center;
      gap: 40px;
      background: var(--page-background);
    }
    .mark { position: absolute; inset: 128px auto auto 128px; font-size: 18px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #004fff; }
    h1 { min-width: 0; margin: 0; max-width: min(18ch, 100%); word-break: keep-all; overflow-wrap: break-word; font-size: 128px; line-height: 1.1; letter-spacing: -0.055em; }
    h1.long-title { max-width: 100%; font-size: 56px; line-height: 1.2; }
    .chips { display: flex; flex-wrap: wrap; gap: 12px; margin: 0; padding: 0; list-style: none; }
    .chips li { padding: 10px 20px; border: 1px solid rgba(20, 33, 61, 0.2); border-radius: 999px; font-size: 22px; }
    .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 48px; margin: 0; max-width: 1200px; }
    .fact dt { font-size: 16px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #004fff; }
    .fact dd { margin: 8px 0 0; font-size: 26px; line-height: 1.4; color: #405273; }
    .waiting { margin: 0; font-size: 24px; line-height: 1.5; color: #405273; }
  </style>
</head>
<body><section data-graphic-artboard id="frame-1-logo-brief" style="width:${LOGO_PAGE.width}px;height:${LOGO_PAGE.height}px"><div class="mark">BurnGuard Logo</div><h1${brandClass} data-bg-node-id="${LOGO_STARTER_NODE_ID}">${brand}</h1><ul class="chips">${chips}</ul><dl class="facts">${brief}</dl><p class="waiting">${LOGO_STARTER_SENTENCE}</p></section></body>
</html>`;
}
