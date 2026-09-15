/**
 * Visual craft guidance injected by `prompt-builder.ts` for every artifact
 * type, in both compact and full context modes. The per-type skills describe
 * STRUCTURE (archetypes, node ids, runtime contracts); this module describes
 * how the result may LOOK.
 *
 * Precedence: the user's brief, the requested brand and the selected
 * direction always outrank the style recipes in this module. Recipes are
 * optional starting points for choices the brief left open; correctness,
 * accessibility, safe-area and scope rules stay mandatory.
 *
 * Token ownership is unchanged: when a design system is selected its
 * `colors_and_type.css` owns colour and type. `DEFAULT_VISUAL_IDENTITY` ships
 * only when no design system is selected and offers example tokens.
 *
 * Budget: `VISUAL_CRAFT_CORE` + one per-type block + `DEFAULT_VISUAL_IDENTITY`
 * must stay within `MAX_VISUAL_CRAFT_CHARS`; the test pins it.
 */
export const MAX_VISUAL_CRAFT_CHARS = 6400;

export const VISUAL_CRAFT_CORE = `# Visual craft (VISUAL_CRAFT_CORE)

The brief, the requested brand and fonts, and the selected direction decide
how this looks and outrank everything below. What follows are optional
starting points: reach for one only when it fits the brief and the brief left
that choice open, never to override what the user asked for. Rules marked
mandatory stay mandatory. When a design system is selected, colour and type
come from its tokens.

## Type
- Keep requested and brand fonts exactly as given; suggest a bundled face only
  for a role the brief left unspecified. Usual split: display for headlines,
  body for text, mono for numbers and code.
- Suggested display: weight 500-700, line-height 1.0-1.1, letter-spacing
  -0.02em to -0.04em; body line-height 1.55-1.65, measure 55-70ch;
  \`text-wrap: balance\` on headings. Widen a container before shrinking type,
  but headline line count is never an acceptance gate.
- Eyebrows: uppercase, letter-spacing 0.14-0.2em, muted. Never numbered filler
  ("SECTION 01", "STEP 1", "ABOUT US").
- Tabular numerals for every metric; keep the unit beside the number.

## Colour and material
- Mandatory: body text contrast 4.5:1 or better, large text 3:1, button text
  legible on its fill. Follow the brief's palette wherever it has one.
- Suggestions, never gates: a restrained accent on a few elements with
  neutrals around it; hairlines at 6-10% of the ink colour; two soft shadow
  layers (0 1px 2px at 8% + 0 24px 48px at 6-10%) over one hard grey shadow; a
  featured frame nested as an outer shell with 6-8px padding and an inner core
  at radius minus that padding; avoiding pure #000 on pure #FFF.
- Depth and tonal contrast are optional: a radial accent glow at 10-20%, a 1px
  grid at 4-6%, paper grain, or a band that inverts surface and ink. Use any,
  several, or none, and only where it supports the brief. Flat designs and
  all-light or all-dark artifacts are fully acceptable.

## Space and rhythm
- A reliable default when the brief is silent: an 8px spacing scale, related
  items 8-16px apart, unrelated groups 48px or more, asymmetric column spans
  (7/5, 8/4) over 6/6, and filled grid cells using few large cards instead of
  many small ones. None of this is an acceptance condition.

## Motion
- Easing cubic-bezier(0.32, 0.72, 0, 1); 200-300ms hover, 500-800ms reveals;
  transform and opacity only. Hover: cards lift 2px and deepen their shadow,
  buttons shift fill, press scales to 0.98. Nothing decorative moves.

## Self-check before finishing
Inspect the render at the output contract's own dimensions: every text
readable and none under 12px, contrast met, nothing clipped or overflowing,
hierarchy coherent, and everything the brief asked for present.
`;

export const PROTOTYPE_VISUAL_CRAFT = `## Website craft (PROTOTYPE_VISUAL_CRAFT)

Optional responsive starting points for whatever the brief leaves open: hero
display 44-88px and section titles 32-56px through clamp(), body 16-18px;
section padding 96-160px on desktop and 64-96px on mobile; a 12-column grid
with 24-32px gutters and 1200-1280px content width.
- Conditional examples, not prohibitions — any alternative that serves the
  brief is equally valid: a floating pill or thin navbar detached 16-24px from
  the top with a blur backdrop once scrolled, logo, a few links and a CTA; a
  hero that is cinematic centred over a lit field, an editorial split with a
  framed product stage, or an offset headline over an overlapping media card;
  a dark or tinted footer band with multiple link columns and small legal
  text; a bento with one 2x cell, alternating media/text rows, lifted
  recommended pricing, or display-size stats with small labels.
- No section count is mandated. Mandatory instead: every piece of content and
  navigation the brief asks for is present and reachable, and the primary
  value stays accessible at every width.
- Product stage: build a believable interface in HTML/CSS (window chrome,
  sidebar, rows, an SVG chart) or an inline SVG illustration. Never a grey
  placeholder box, never "image here", never a remote URL. Draw wordmarks as
  text; never fabricate logos.
- Give the page pacing by varying background tone, column count, or alignment
  rather than repeating identical card rows.
- Test viewports, not fixed page or artboard dimensions: judge the render at
  desktop 1280 and narrow 375, and content must reflow with no horizontal
  scroll and nothing that carries the value hidden down to 320px.
`;

export const DECK_VISUAL_CRAFT = `## Deck craft (DECK_VISUAL_CRAFT)

- Mandatory: use the deck skill's projection tokens at their declared values,
  or the slides surface's --slide-type-* and --slide-pad-* when one is
  supplied, for every text element and never lower them in self-review. Eyebrows,
  chrome, captions and chart labels are --deck-type-caption (24px), nothing
  smaller. Size from those tokens (or calc() on them), never raw px or
  viewport units.
- Mandatory: safe area — nothing inside --deck-pad-slide of the edge or off
  the artboard. Media and mocks are never stretched.
- Mandatory: deliver exactly the requested slide count. Never add or drop a
  slide; when one is crowded, recompose within that slide (tighter wording,
  two columns, a diagram, a smaller support element).
- Optional composition suggestions: one dominant element per slide with the
  rest supporting it, spanning much of the slide and filling 60-80% of its
  height; a cover on a full-bleed dark or accent field with a --deck-type-hero
  title, an eyebrow above and one context line below, mirrored by the closing
  slide; a background device; running title top-left and mono slide number
  bottom-right, both muted, with eyebrows and badges in the content area
  rather than the same corner; nested frames with a soft shadow for media.
- Structure usually beats bullets: two columns, a big number in the display
  face and accent with its unit attached plus a label and caption, a
  three-step row, or a labelled diagram. Short bullet lists are fine.
- Charts: inline SVG filling its column, hairline axes, 2-3 series, the key
  series in the accent, direct labels at --deck-type-caption instead of a
  legend, one takeaway line above.
`;

export const GRAPHIC_VISUAL_CRAFT = `## Graphic craft (GRAPHIC_VISUAL_CRAFT)

Each requested fixed artboard must read from across the room at exactly the
dimensions declared for that frame.
- Mandatory: a safe area of 6-8% of the short side on every edge, or
  --content-safe when the content surface supplies it, holds all required
  content; only a deliberate full-bleed figure crosses it.
- Mandatory: headline contrast 7:1 or better against its local background;
  put text on the calmest part of the background or on a translucent plate.
- Mandatory: size in px relative to the artboard (or % of its width); no
  viewport units, no scroll, no animation — the export captures one static
  frame.
- Optional model when the brief leaves composition open: a field layer (a mesh
  of 2-3 radial glows, a duotone gradient, or a paper tone with 3-5% grain), a
  figure layer at --content-figure, or 40-70% of the short side, placed
  off-centre on a
  rule-of-thirds intersection, and a type layer of one headline at 8-14% of
  the artboard height with a body line at 2-3%, plus an optional eyebrow and
  mark, in at most two typefaces.
- Flat fields and white backgrounds are fine, and a layout the user directs
  wins over anything suggested here. Optional format hints: portrait stacks
  figure above type, square centres the figure, landscape splits 60/40.
`;

export const DEFAULT_VISUAL_IDENTITY = `## Default visual identity (DEFAULT_VISUAL_IDENTITY)

No design system is selected. Use supplied brand and direction first; create
missing tokens from the brief and its imagery. The font, palette, spacing and
material values below are optional examples, not a required theme. Declare
your tokens in :root, link fonts/fonts.css (bundled, no CDN), and style from
tokens everywhere.

- Display voice from the content: product/tech "Space Grotesk"; editorial
  "DM Serif Display" + "Gowun Batang" (Korean); poster "Bebas Neue".
  --font-body: "DM Sans"; --font-mono: "IBM Plex Mono"; "Pretendard" is a good
  fallback in any stack. Other bundled families (BUNDLED_FONT_REFERENCE):
  read fonts/fonts.md first.
- Optional palette examples:
  Paper (calm, editorial): --bg:#F6F1E8 --surface:#FFFDF9 --surface-2:#EFE6D8
  --ink:#18232D --ink-2:#52616C --ink-3:#8A949C --line:rgba(24,35,45,.10)
  --accent:#C8512F --accent-ink:#FFF8F2 --accent-soft:rgba(200,81,47,.12)
  Ink (bold, product, tech): --bg:#0B0D12 --surface:#141822 --surface-2:#1C2230
  --ink:#F6F1E8 --ink-2:#B7B2A8 --ink-3:#7C7A74 --line:rgba(246,241,232,.10)
  --accent:#E06B4C --accent-ink:#0B0D12 --accent-soft:rgba(224,107,76,.16)
- Data accent for charts: --accent-2:#2F6FDB (Paper) or #7DB4FF (Ink).
  Status: --ok:#1F8A5B --warn:#B7791F --danger:#C0392B, always paired with
  text or an icon.
- Scale: --space-1..8 = 4 8 16 24 32 48 64 96px; --radius-s:8px
  --radius-m:16px --radius-l:28px --radius-pill:999px.
- Material: --shadow-1: 0 1px 2px rgba(0,0,0,.08); --shadow-2: 0 24px 48px
  rgba(0,0,0,.10) (Ink: .35); borders 1px solid var(--line).
- Motion: --ease: cubic-bezier(.32,.72,0,1); --dur-fast:200ms; --dur-slow:600ms.
- Usage: --bg on body, --surface for cards, --accent for emphasis. An
  alternate band is optional and may borrow the other palette's values.
`;

export const VISUAL_CRAFT_BY_TYPE = {
  prototype: PROTOTYPE_VISUAL_CRAFT,
  slide_deck: DECK_VISUAL_CRAFT,
  graphic: GRAPHIC_VISUAL_CRAFT,
} as const;
