/**
 * Visual craft guidance injected by `prompt-builder.ts` for every artifact
 * type, in both compact and full context modes. The per-type skills describe
 * STRUCTURE (archetypes, node ids, runtime contracts); this module describes
 * how the result must LOOK so generated output reads as senior-designer work
 * instead of a template.
 *
 * Token ownership is unchanged: when a design system is selected its
 * `colors_and_type.css` owns colour and type, and these rules only govern
 * scale, rhythm, material, and composition. `DEFAULT_VISUAL_IDENTITY` ships
 * only when no design system is selected and becomes the token source.
 *
 * Budget: `VISUAL_CRAFT_CORE` + one per-type block + `DEFAULT_VISUAL_IDENTITY`
 * must stay within `MAX_VISUAL_CRAFT_CHARS`; the test pins it.
 */
export const MAX_VISUAL_CRAFT_CHARS = 6400;

export const VISUAL_CRAFT_CORE = `# Visual craft (VISUAL_CRAFT_CORE)

The bar is work a senior designer at Linear, Stripe, or Vercel would ship.
Correct-but-flat is a failure. Structure rules say what goes where; these
rules say how it must look. When a design system is selected, take colour
and type from its tokens and apply everything else here.

## Type
- Two roles: display for headlines, body for text; mono for numbers and code.
  Never show Arial, Helvetica, or system-ui as the visible face.
- Display: weight 500-700, line-height 1.0-1.1, letter-spacing -0.02em to
  -0.04em, sized with clamp() (hero 44-88px, section titles 32-56px). Body
  16-18px, line-height 1.55-1.65, measure 55-70ch. \`text-wrap: balance\` on headings.
- Headlines wrap in 3 lines or fewer: widen the container before shrinking type.
- Eyebrows: 11-13px, uppercase, letter-spacing 0.14-0.2em, muted colour. Never
  numbered filler ("SECTION 01", "STEP 1", "ABOUT US").
- Tabular numerals for every metric; keep the unit beside the number.

## Colour and material
- One accent, on at most 3 elements per screen (primary CTA, one highlight,
  one data mark). Everything else is neutrals from the token ramp.
- Surfaces read as material, not outlines: hairlines at 6-10% of the ink
  colour; shadows as two soft layers (0 1px 2px at 8% + 0 24px 48px at 6-10%),
  never one hard grey shadow. No pure #000 on pure #FFF.
- Nest featured frames: outer shell with 6-8px padding and a large radius,
  inner core with radius minus that padding. Use it for hero media, the
  featured card, and stage frames.
- Give backgrounds depth with exactly one device per artifact: a large radial
  glow of the accent at 10-20% opacity, a 1px grid at 4-6%, or paper grain.
- Alternate a dark block against light blocks at least once so the artifact
  has rhythm; the alternate band inverts surface and ink tokens.
- Contrast: body 4.5:1 or better, large text 3:1; button text legible on its fill.

## Space and rhythm
- 8px spacing scale. Sections breathe: 96-160px vertical padding on desktop,
  64-96px on mobile. Related items 8-16px apart, unrelated groups 48px or more.
- 12-column grid, 24-32px gutters, content max-width 1200-1280px. Asymmetric
  spans (7/5, 8/4) beat 6/6 outside heroes.
- Grids never leave voids: every bento cell is filled; use fewer, larger cards
  (3-5) rather than eight small ones.

## Motion
- Easing cubic-bezier(0.32, 0.72, 0, 1); 200-300ms for hover, 500-800ms for
  reveals; transform and opacity only.
- Hover: cards lift 2px and deepen their shadow, buttons shift fill, press
  scales to 0.98. Nothing decorative moves.

## Self-check before finishing
Judge the render at 1280 and 375: no headline over 3 lines, no grid void, no
stray accent, no default-blue link, no text under 12px, nothing clipped. If it
still looks like a template, rework the hero and the type scale first.
`;

export const PROTOTYPE_VISUAL_CRAFT = `## Website craft (PROTOTYPE_VISUAL_CRAFT)

- Navbar: a floating pill or thin bar detached 16-24px from the top, max-width
  1200px, blur backdrop once scrolled, logo left, 3-5 links, one CTA. Never a
  flat edge-to-edge grey bar.
- Hero: h1 container at least 880px wide on desktop, 2-3 lines, subheadline
  18-20px in 2 lines or fewer, one primary plus one ghost CTA. Pick one
  architecture: cinematic centred over a lit field; editorial split with a
  framed product stage; or an offset headline with an overlapping media card.
- Product stage: build a believable interface in HTML/CSS (window chrome,
  sidebar, rows, an SVG chart) or an inline SVG illustration inside a nested
  frame. Never a grey placeholder box, never "image here", never a remote URL.
- Pacing: each section changes at least one of background tone, column count,
  or alignment from the previous one. No three look-alike card rows in a row.
- Features: a bento with one 2x cell plus smaller cells, or alternating
  media/text rows; 3-5 items, each with a 20-24px Lucide icon on a tinted disc.
- Proof and stats: 48-72px display numbers with 12-13px labels; wordmarks
  drawn as text at 60% opacity, never fabricated logos.
- Pricing: the recommended tier lifted (larger, accent border, dark or accent
  fill); other tiers quiet.
- Footer: a dark or tinted band with 3-4 link columns and 12-13px legal text;
  never a single grey line.
- Mobile (375px): one column, hero type 36-44px, nav collapses to logo plus
  CTA, cards full width, sections 64-80px padding, nothing that carries the
  value hidden.
`;

export const DECK_VISUAL_CRAFT = `## Deck craft (DECK_VISUAL_CRAFT)

- Every slide is a poster: one dominant element (headline, number, chart, or
  image) and everything else supports it. Two competing elements means two slides.
- Cover: full-bleed dark or accent field, title at --deck-type-hero with tight
  tracking, eyebrow above, one line of context below, one background device.
  The closing slide mirrors it.
- Chrome on every content slide: running title top-left, slide number
  bottom-right in mono, both at --deck-type-caption and muted; identical
  --deck-pad-slide margins on all slides.
- Bullets are the last resort: prefer two columns, a big number with a
  one-sentence claim, a three-step row, or a labelled diagram. At most 4
  bullets, each one line.
- Big numbers: 120-200px in the display face and the accent colour, unit
  attached, a 32px label, source caption below.
- Charts: inline SVG with hairline axes, 2-3 series at most, the key series in
  the accent and the rest in neutrals, direct labels instead of a legend, one
  takeaway line above.
- Rhythm: alternate dark and light slides at least once every 3-4 slides and
  use one accent-field slide for the key claim.
- Media and product mocks sit in nested frames with a soft shadow; never
  stretched, never with a hard 1px black border.
- Safe area: nothing inside --deck-pad-slide of the edge; verify no wrap pushes
  content off the 16:9 artboard.
`;

export const GRAPHIC_VISUAL_CRAFT = `## Graphic craft (GRAPHIC_VISUAL_CRAFT)

A single fixed artboard must read from across the room. Compose three layers:
- Field: a background with depth (a mesh of 2-3 radial glows, a duotone
  gradient, or a paper tone with 3-5% grain). Never flat default white.
- Figure: one large element at 40-70% of the short side (an oversized number, a
  typographic word, an SVG shape composition, or a framed product mock),
  placed off-centre on a rule-of-thirds intersection.
- Type: one headline at 8-14% of the artboard height in 3 lines or fewer with
  tight tracking; one body line at 2-3%; optional eyebrow and small mark. Two
  typefaces at most.
- Margins: safe area 6-8% of the short side on every edge; only a deliberate
  full-bleed figure crosses it.
- Contrast: headline 7:1 or better against its local background; place text on
  the calmest part of the field or on a translucent plate.
- Format: portrait stacks figure above type; square centres the figure and
  anchors type to the bottom; landscape splits 60/40.
- Size in px relative to the artboard (or % of its width); no viewport units,
  no scroll, no animation: the PNG export captures one static frame.
`;

export const DEFAULT_VISUAL_IDENTITY = `## Default visual identity (DEFAULT_VISUAL_IDENTITY)

No design system is selected, so this identity is the design system. Declare
these tokens in :root, link fonts/fonts.css (bundled, no CDN), and reference
tokens everywhere. Do not invent other colours or typefaces.

- Display voice, pick one from the content: product/tech "Space Grotesk";
  editorial/premium "DM Serif Display" with "Gowun Batang" Korean fallback;
  poster/impact "Bebas Neue". --font-body: "DM Sans", "Pretendard", sans-serif;
  --font-mono: "IBM Plex Mono", "Pretendard", monospace; append "Pretendard" as
  the fallback of --font-display.
- Mode, pick one and keep it for the whole artifact:
  Paper (calm, editorial): --bg:#F6F1E8 --surface:#FFFDF9 --surface-2:#EFE6D8
  --ink:#18232D --ink-2:#52616C --ink-3:#8A949C --line:rgba(24,35,45,.10)
  --accent:#C8512F --accent-ink:#FFF8F2 --accent-soft:rgba(200,81,47,.12)
  Ink (bold, product, tech): --bg:#0B0D12 --surface:#141822 --surface-2:#1C2230
  --ink:#F6F1E8 --ink-2:#B7B2A8 --ink-3:#7C7A74 --line:rgba(246,241,232,.10)
  --accent:#E06B4C --accent-ink:#0B0D12 --accent-soft:rgba(224,107,76,.16)
- Data accent only for charts: --accent-2:#2F6FDB (Paper) or #7DB4FF (Ink).
  Status: --ok:#1F8A5B --warn:#B7791F --danger:#C0392B, always paired with
  text or an icon.
- Scale: --space-1..8 = 4 8 16 24 32 48 64 96px; --radius-s:8px
  --radius-m:16px --radius-l:28px --radius-pill:999px.
- Material: --shadow-1: 0 1px 2px rgba(0,0,0,.08); --shadow-2: 0 24px 48px
  rgba(0,0,0,.10) (Ink: .35); borders 1px solid var(--line).
- Motion: --ease: cubic-bezier(.32,.72,0,1); --dur-fast:200ms; --dur-slow:600ms.
- Usage: --bg on body, --surface for cards, --surface-2 for the alternate band,
  --accent on the primary CTA and one highlight only. The alternate band may
  switch mode (a dark band on Paper) by using the other mode's values.
`;

export const VISUAL_CRAFT_BY_TYPE = {
  prototype: PROTOTYPE_VISUAL_CRAFT,
  slide_deck: DECK_VISUAL_CRAFT,
  graphic: GRAPHIC_VISUAL_CRAFT,
} as const;
