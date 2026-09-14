---
name: builtin-signal-console-design
description: Use this bundled Signal Console Theme theme to create token-driven interfaces and visual artifacts.
user-invocable: true
---

Read README.md first, then use colors_and_type.css as the single source of truth.

## Quick reference
- Reference colour, type, spacing, radius, elevation, layout and family tokens by CSS variable name.
- Preserve the paired foreground tokens whenever a semantic background is used.
- Use the local display/body/mono fonts specified in README.md and colors_and_type.css. Copy fonts/
  with licenses into outputs and link fonts/fonts.css; no CDN.
- Keep components coherent with the theme's shape and contrast rather than adding unrelated decoration.

## How this theme composes

Ground everything in near-black and spend the phosphor signal only where something is live: an active tab, a focused field, a running state, a link under the cursor. Everything else is neutral. Mono is structural — it labels panels, numbers figures, and annotates diagrams, and it never sets body copy. Put a real product surface in the hero: a terminal, a console, a panel with its own chrome, rendered as an element rather than a screenshot. Separate regions with a single hairline at `--border`; no card, no shadow, no rounded container. Radius stays at or below 3px so nothing reads as soft.

## Layout

Use the `--layout-*` tokens; do not invent a grid per artifact. Content sits inside `--layout-max`
with `--layout-margin` at the sides, body copy holds to `--layout-measure`, sections are separated by
`--layout-section-y`, and dividers use `--layout-rule`. The base grid is `--layout-columns` columns
with `--layout-gutter` between them, collapsing at `--layout-bp-md`. Hero media uses `--layout-hero`.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `top` | `top` or `side` — whether primary navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `2` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `above` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |

Navigation is a single top row at `--layout-nav-h`; the span value is inert here and exists so a side-navigation variant stays expressible. Labels stack above their control so a dense form keeps one reading column.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Hardware and interface: a rack, a board, a device edge, or a close macro of a connector, shot as an object rather than a scene. No people, no desks, no offices.

**Treatment.** Photographic, high fidelity, matte surfaces, deep blacks that stay black. Fine machined detail preserved. No gloss, no lens flare, no bokeh-heavy blur.

**Light.** Single cool key from one side against a very dark field, with controlled falloff. Small phosphor-green emissive points may appear as status indicators and are the only saturated colour in frame.

**Framing.** Tight and frontal or a shallow three-quarter. Subject fills most of the frame, cropped by the edge rather than floating with air around it.

**Relationship to the palette.** Near-black ground with cool grey mid-tones; the only chroma is the phosphor green of indicator lights, matching `--primary-blue`. Treat any other hue as a defect.

**Never:**
- Stock-photo people, handshakes, or open-plan offices.
- Blue-glow 'cyber' gradients, circuit-board overlays, or holographic UI clichés.
- Warm ambient light or amber practicals — they break the single-signal rule.
- Visible brand marks or readable third-party logos.

**Prompt skeleton.** `macro photograph of matte-black server hardware, single cool key light from the left, deep black background, small green status LEDs, fine machined detail, no people, no logos, tight frontal crop`

## Reproducing this system

1. The page reads near-black, and the only saturated colour anywhere is the phosphor signal.
2. Every phosphor use marks a live or interactive state; none is decorative.
3. Mono appears only as chrome, labels, figures or annotation — never as body copy.
4. A product surface panel occupies the hero at the declared aspect ratio.
5. No element has a radius above 3px, and no element carries a shadow.
6. Regions are separated by hairlines at `--layout-rule`, not by cards.

## Local typography

- Display: Geist; body: Geist; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
