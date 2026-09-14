# Atelier Counter Theme

A bone-paper shop with a didone brand voice, contained product plates, and a purchase panel that stays in the reading flow.

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
| `--layout-max` | `1280px` | Outer content width |
| `--layout-measure` | `58ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `24px` | Space between columns |
| `--layout-margin` | `clamp(20px, 4vw, 64px)` | Page side margin |
| `--layout-section-y` | `clamp(56px, 7vw, 112px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `4 / 5` | Hero aspect ratio |

Products sit as contained plates with real space around them, the way goods are placed on a counter rather than stacked on a shelf. A hairline rule separates product rows. The purchase panel sits in the column beneath the product description, not pinned.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `contain` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-commerce-gallery-layout` | `lead-and-pairs` | `stacked`, `paired`, or `lead-and-pairs` — the repeating placement pattern of a product gallery. |
| `--family-commerce-purchase-position` | `flow` | `flow` or `sticky` — whether the purchase panel scrolls with content or pins inside its section. |

The gallery opens with one full-width lead plate and continues in pairs, which gives a product page an opening statement before its detail. Images are contained so the whole object stays visible — in this system the product's silhouette is the selling point. The purchase panel stays in flow so the page reads as a description rather than a conversion funnel.

## Composition

Work on warm bone paper with a didone brand voice reserved for the name and section openings, and a humanist sans for everything read at length. Product plates are contained on the paper with generous surrounding space. The oxblood accent marks price emphasis, sale state and the primary action, and appears nowhere else. Small letterspaced eyebrows label categories. Rules are hairline; nothing is rounded, nothing is elevated. Restraint is the merchandising strategy: one strong image, one clear price, one action.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** A single object presented whole — a garment laid flat, a bag upright, a shoe in profile, an accessory arranged. The complete silhouette must be visible.

**Treatment.** Bright even product photography on a bone or oat seamless that matches the page ground, so the object appears to rest on the paper. Accurate material colour, visible texture, no gloss.

**Light.** Broad soft frontal daylight with a faint contact shadow to seat the object. Almost no modelling; the silhouette matters more than the volume.

**Framing.** Vertical 4:5 with comfortable margin inside the frame — the object never touches the frame edge, because it is contained rather than cropped.

**Relationship to the palette.** Bone and oat surroundings with the product's own colour as the single chroma. Warm cast throughout so it sits on the warm page.

**Never:**
- Cropping the object at the frame edge; the whole silhouette must read.
- Cool grey or white-blue seamless that fights the warm paper.
- Models posing in a scene — this system presents goods, not lifestyle.
- Drop shadows or reflections added in post.

**Prompt skeleton.** `product photograph of a single object presented whole on a bone seamless background, broad soft frontal daylight, faint contact shadow, complete silhouette visible with margin inside the frame, warm accurate material colour, vertical 4:5, no crop, no gloss`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the design. Check
the result against all of these:

1. Products are contained plates with generous space, never bleeding to the edge.
2. The gallery opens with one lead image and continues in pairs.
3. Didone is used only for the brand name and section openings; body is sans.
4. The oxblood accent appears only on price emphasis and the primary action.
5. The purchase panel sits in the flow of the column and never pins.
6. Nothing is rounded and nothing carries a shadow.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Bodoni Moda; body: Figtree; numbers/code: IBM Plex Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for display, "Pretendard" for body; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.


## Responsive

Below --layout-bp-md, collapse content to one column in reading order, place message before media and move any side navigation into a compact top row. Remove decorative offsets and keep tables in their own horizontal scroll region. Between medium and large breakpoints, reduce spans without changing the hierarchy. Above --layout-bp-lg, retain the full grid within --layout-max. At 200% zoom, allow labels and actions to wrap without clipping. Slides and graphics keep their fixed artboard dimensions; adapt content inside that canvas rather than applying website breakpoints to its size.
