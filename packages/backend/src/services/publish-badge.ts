export const MADE_WITH_BADGE_MARKER = "data-burnguard-badge";

const BADGE_STYLE = [
  "all:initial", "position:fixed", "right:12px", "bottom:12px", "z-index:2147483647",
  "display:inline-block", "padding:6px 10px", "border-radius:999px", "background:rgba(17,17,17,0.88)",
  "color:#ffffff", "font:500 12px/1.2 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
  "text-decoration:none", "cursor:pointer", "box-shadow:0 1px 4px rgba(0,0,0,0.25)",
].join(";");

// Static markup only: no script, no remote assets. The style element exists solely to hide the pill in print.
const BADGE_MARKUP = `<style ${MADE_WITH_BADGE_MARKER}>@media print{a[${MADE_WITH_BADGE_MARKER}]{display:none!important}}</style>`
  + `<a ${MADE_WITH_BADGE_MARKER} href="https://github.com/ashmoonori-afk/BurnGuard" target="_blank" rel="noopener" style="${BADGE_STYLE}">Made with BurnGuard</a>`;

/** Inserts the badge before the last closing body tag, or appends it when there is none. Idempotent. */
export function injectMadeWithBadge(html: string): string {
  if (html.includes(MADE_WITH_BADGE_MARKER)) return html;
  let index = -1;
  for (const match of html.matchAll(/<\/body\s*>/gi)) index = match.index;
  return index < 0 ? `${html}${BADGE_MARKUP}` : `${html.slice(0, index)}${BADGE_MARKUP}${html.slice(index)}`;
}
