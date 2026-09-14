# Signal Console Theme

A near-black instrument ground where one phosphor signal marks everything live, and mono chrome annotates rather than decorates.

## Files

- `colors_and_type.css` - canonical BurnGuard colour, type, spacing, shape, layout and family tokens
- `SKILL.md` - concise artifact-generation guidance

## Design token contract

The palette is expressed through BurnGuard's canonical neutral, brand, semantic, surface, chart,
type, spacing, radius, elevation and motion tokens. Use the complete `--gray-*` and `--chart-*` ramps
for hierarchy and data visualization, and use `--r-*`, `--shadow-*` and `--dur-*` tokens rather than
introducing component-local scales.

## Layout

Layout is part of this system, not a per-page decision. Build on these tokens rather than inventing a
grid:

| Token | Value | Meaning |
|---|---|---|
| `--layout-max` | `1320px` | Outer content width |
| `--layout-measure` | `62ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `20px` | Space between columns |
| `--layout-margin` | `clamp(20px, 3vw, 48px)` | Page side margin |
| `--layout-section-y` | `clamp(56px, 7vw, 112px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `16 / 10` | Hero aspect ratio |

Reserve the upper band for a product surface panel at `--layout-hero` and let the headline sit beneath it, not over it. Annotation labels live in the outer margin, connected to their subject by a single `--layout-rule` hairline. Sections are divided by rules, never by cards.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-ui-navigation-placement` | `top` | `top` or `side` — whether primary navigation sits above the content or beside it at expanded widths. |
| `--family-ui-navigation-span` | `2` | Base-grid columns reserved for side navigation; inert when placement is `top`. |
| `--family-ui-label-placement` | `above` | `above` or `beside` — whether form labels stack over their control or sit in a second track. |

Navigation is a single top row at `--layout-nav-h`; the span value is inert here and exists so a side-navigation variant stays expressible. Labels stack above their control so a dense form keeps one reading column.

## Composition

Ground everything in near-black and spend the phosphor signal only where something is live: an active tab, a focused field, a running state, a link under the cursor. Everything else is neutral. Mono is structural — it labels panels, numbers figures, and annotates diagrams, and it never sets body copy. Put a real product surface in the hero: a terminal, a console, a panel with its own chrome, rendered as an element rather than a screenshot. Separate regions with a single hairline at `--border`; no card, no shadow, no rounded container. Radius stays at or below 3px so nothing reads as soft.

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

A builder with only this directory and an image generator should be able to rebuild the design. Check
the result against all of these:

1. The page reads near-black, and the only saturated colour anywhere is the phosphor signal.
2. Every phosphor use marks a live or interactive state; none is decorative.
3. Mono appears only as chrome, labels, figures or annotation — never as body copy.
4. A product surface panel occupies the hero at the declared aspect ratio.
5. No element has a radius above 3px, and no element carries a shadow.
6. Regions are separated by hairlines at `--layout-rule`, not by cards.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Geist; body: Geist; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below --layout-bp-md, collapse content to one column in reading order, place message before media and move any side navigation into a compact top row. Remove decorative offsets and keep tables in their own horizontal scroll region. Between medium and large breakpoints, reduce spans without changing the hierarchy. Above --layout-bp-lg, retain the full grid within --layout-max. At 200% zoom, allow labels and actions to wrap without clipping. Slides and graphics keep their fixed artboard dimensions; adapt content inside that canvas rather than applying website breakpoints to its size.
