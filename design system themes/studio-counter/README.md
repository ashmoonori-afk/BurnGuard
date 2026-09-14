# Studio Counter Theme

A near-black studio where product photography is the page and the buying chrome is deliberately the smallest type on it.

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
| `--layout-max` | `1600px` | Outer content width |
| `--layout-measure` | `52ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `8px` | Space between columns |
| `--layout-margin` | `12px` | Page side margin |
| `--layout-section-y` | `clamp(32px, 4vw, 64px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `4 / 5` | Hero aspect ratio |

Margins and gutters are intentionally tiny so imagery reaches almost to the viewport edge and products sit shoulder to shoulder. Navigation pins to the extreme corners at 40px. The brand line is set large enough to cross more than one product frame.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-commerce-gallery-layout` | `paired` | `stacked`, `paired`, or `lead-and-pairs` — the repeating placement pattern of a product gallery. |
| `--family-commerce-purchase-position` | `sticky` | `flow` or `sticky` — whether the purchase panel scrolls with content or pins inside its section. |

Products run in equal pairs so the eye compares rather than scans. Images cover their frame; the crop is part of the merchandising. The purchase panel pins within its product section and returns to flow below `--layout-bp-md` — it never becomes a floating duplicate bar.

## Composition

Let photography be the page. Products fill nearly the full width in tight pairs with an 8px gutter, and the ground shows only as a hairline between them. Set the brand line oversized and let it cross the imagery rather than sit above it — overlap is the signature, not an accident. Keep every piece of chrome small: navigation, search, account and cart sit at the extreme corners in 11px type. Emphasis comes from scale contrast, never from a coloured button; the primary action is bone-on-black or black-on-bone. Radius stays at or below 2px.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single garment or object on a body or a form, shot in a studio. The product is the whole subject; no environment, no narrative scene.

**Treatment.** Studio product photography on a mid-grey or charcoal seamless, matching the page ground closely enough that the frame edge is the only boundary. Matte, true-to-material colour, fine fabric or surface detail preserved.

**Light.** Controlled studio light with soft modelling — enough shadow to describe form and material, never flat, never dramatic. Keep the background falling darker than the subject.

**Framing.** Vertical 4:5, subject centred and cropped decisively at the frame edge. Composition must survive a cover crop and pair cleanly with a second image beside it.

**Relationship to the palette.** Charcoal to near-black surroundings with the product's own material colour as the only chroma. Consecutive images in a pair should agree tonally so the row reads as one field.

**Never:**
- White or bright seamless backgrounds; they tear a hole in the dark page.
- Lifestyle scenes, locations, or props competing with the product.
- Visible logos, tags, or readable brand marks.
- Heavy retouching gloss or plastic-looking skin and fabric.

**Prompt skeleton.** `studio product photograph on charcoal seamless background, single garment on a form, soft controlled modelling light, matte true-to-material colour, fine fabric detail, vertical 4:5 crop, background darker than subject, no logos, no props`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the design. Check
the result against all of these:

1. Imagery reaches nearly to the viewport edge; margins and gutters are visibly tiny.
2. Products appear in equal pairs, not in a three or four column grid.
3. The brand line overlaps imagery rather than sitting above it.
4. All navigation and purchase chrome is the smallest type on the page.
5. The primary action is achromatic — no coloured button exists.
6. Image backgrounds are dark enough to merge with the page ground.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Public Sans; body: Public Sans; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Pretendard" for display and body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
