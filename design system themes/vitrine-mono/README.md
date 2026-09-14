# Vitrine Mono Theme

A gallery-case shop: achromatic ground, mono product data, and objects presented as exhibits with their specifications beside them.

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
| `--layout-max` | `1400px` | Outer content width |
| `--layout-measure` | `48ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `0px` | Space between columns |
| `--layout-margin` | `20px` | Page side margin |
| `--layout-section-y` | `0px` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `1 / 1` | Hero aspect ratio |

Every product is a ruled cell in a case: zero gutter, zero section spacing, and 1px borders that meet exactly so the page reads as one continuous vitrine. Specification data sits inside the cell beneath the image, in mono, as a labelled list.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `contain` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-commerce-gallery-layout` | `paired` | `stacked`, `paired`, or `lead-and-pairs` — the repeating placement pattern of a product gallery. |
| `--family-commerce-purchase-position` | `flow` | `flow` or `sticky` — whether the purchase panel scrolls with content or pins inside its section. |

Paired cells let two exhibits be compared directly, which is the point of a case. Images are contained so the object is documented rather than cropped for effect. The purchase control sits in flow at the end of the specification list, treated as one more field.

## Composition

Present goods as exhibits. The page is a grid of ruled cells with no gutter and no gap; borders are shared, so the whole surface is one case. Inside each cell: the object contained on the achromatic ground, then its specifications in mono as label and value pairs — material, dimension, origin, price. No colour is used for emphasis at all; emphasis is position and rule weight. The primary action is a black block with bone type. Radius is zero everywhere.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single object documented straight on or in strict profile, as a museum record shot. Tools, hardware, ceramics, instruments — objects with describable specifications.

**Treatment.** Flat, even record photography on a light achromatic ground matching the page. No styling, no atmosphere, no artful angle. The object is being catalogued.

**Light.** Completely even and shadowless, or with a single faint contact shadow. Nothing dramatic; legibility of form and material is the only goal.

**Framing.** Square 1:1, object centred with equal margin on all sides, orthographic where possible so proportions read true.

**Relationship to the palette.** Achromatic ground with the object's true material colour. Grey, bone, steel, unglazed clay. Any saturated colour must come from the object itself.

**Never:**
- Angled hero shots or perspective drama — these are record images.
- Coloured or gradient backdrops.
- Props, hands, styling surfaces, or context of any kind.
- Cropping the object; it must be fully contained with even margin.

**Prompt skeleton.** `flat museum record photograph of a single object, centred with equal margin on a light achromatic seamless background, completely even shadowless lighting, orthographic straight-on view, true material colour, square 1:1, no styling, no props`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the design. Check
the result against all of these:

1. The page is one continuous case: zero gutter, shared 1px borders meeting exactly.
2. Every cell carries the object plus mono label-and-value specifications.
3. No colour is used for emphasis anywhere; emphasis is position and rule weight.
4. The primary action is a black block with bone type.
5. Objects are contained with even margin, never cropped.
6. Radius is zero and no element is elevated.

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
