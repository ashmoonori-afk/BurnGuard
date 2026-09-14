# Night Edition Theme

A dark reading edition where the page is ink, the serif is set light, and one warm signal marks the current article.

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
| `--layout-max` | `1100px` | Outer content width |
| `--layout-measure` | `66ch` | Reading measure for body copy |
| `--layout-columns` | `12` | Base column count |
| `--layout-gutter` | `24px` | Space between columns |
| `--layout-margin` | `clamp(20px, 5vw, 72px)` | Page side margin |
| `--layout-section-y` | `clamp(60px, 8vw, 120px)` | Vertical rhythm between sections |
| `--layout-rule` | `1px` | Divider weight |
| `--layout-hero` | `16 / 9` | Hero aspect ratio |

A single centred reading column on an ink ground. Because the page is dark, the measure is held slightly tighter and the leading slightly looser than the light editions — light text on dark needs more air to stay readable over a long passage.

## Family tokens

| Token | Value | Meaning |
|---|---|---|
| `--family-media-fit` | `cover` | `contain` or `cover` — whether imagery is shown whole or cropped to fill its frame. |
| `--family-media-text-ratio` | `3 / 2` | Media-track width against text-track width in a side-by-side composition, gutter excluded. |
| `--family-editorial-paragraph-mode` | `spaced` | `spaced` (a `--sp-4` gap, no indent) or `indented` (1em first line, no gap, not after a heading). |

Paragraphs are spaced rather than indented: on a dark ground an indent is hard to perceive, so separation has to come from a gap. Images cover their frame and are allowed to run wider than the measure to give the column relief.

## Composition

Treat the page as ink and the type as light falling on it. Body serif is set one weight lighter than you would on paper, with looser leading, because dark grounds bloom. The warm signal marks the current article, the active link and the reading progress, and nothing else — on a dark page a second accent becomes noise immediately. Images are the only large bright areas, so place them deliberately and give them room. Rules are hairline and dim. Radius stays at or below 2px.

## Image direction

Every artifact on this system needs imagery of a specific kind; the palette alone will not
reproduce the design. Generate it rather than sourcing it, and use these directions verbatim as the
prompt basis.

**Subject.** Night and low-light subjects: a lit interior seen from outside, a street after dark, a stage, a lamp-lit desk. The image should belong to the same hour as the page.

**Treatment.** Low-key photography with deep shadow retention and controlled highlight. Detail lives in the mid-tones; blacks stay black rather than lifting to grey.

**Light.** Practical sources within the frame — a window, a lamp, a sign. Warm sources preferred so they rhyme with the accent.

**Framing.** Room for darkness. Compose so a substantial part of the frame is shadow, which lets the image merge into the ink ground at its edges.

**Relationship to the palette.** Ink and charcoal with warm practical highlights matching `--primary-blue`. Cool blue-dominant night images fight the warm signal and should be avoided.

**Never:**
- Brightly lit daytime scenes — they punch a hole in the page.
- Lifted, hazy blacks or heavy film-grain overlays.
- Cool blue night grading that clashes with the warm accent.
- Placing an image against a light panel; it sits on the ink ground directly.

**Prompt skeleton.** `low-key night photograph, warm practical light sources inside the frame, deep retained shadows, true blacks, detail in the mid-tones, substantial dark area in the composition, warm amber highlights, no daylight`

## Reproducing this system

A builder with only this directory and an image generator should be able to rebuild the design. Check
the result against all of these:

1. The ground is ink and body serif is set lighter than a light-mode equivalent.
2. Leading is looser than the light editions to counter blooming.
3. Exactly one warm signal marks current and active state; no second accent exists.
4. Paragraphs are separated by a gap, never by an indent.
5. Images are the brightest areas on the page and are given room.
6. Radius never exceeds 2px and no element is elevated.

## Provenance

Original system authored for BurnGuard. The palette, type pairing, scale, layout, family tokens,
composition rules and image direction were composed for this theme; no third-party theme, stylesheet,
palette or asset is included, and it carries no external licence obligation.

## Local typography

- Display: Newsreader; body: Newsreader; numbers/code: Geist Mono with tabular numerals. Korean fallback: "Nanum Myeongjo" for serif text, "Pretendard" for UI; finish with generic serif/sans-serif/monospace.
- Body 16-18px, line-height 1.6; supporting copy at least 14px/1.5. Headings 32-64px responsive, line-height 1.15 (Korean 1.3); allow wrapping and 200% zoom without clipping.
- Keep readable contrast (4.5:1 body, 3:1 large text), visible focus, and avoid ultra-light text. Use only supplied weights.
- Copy the bundled fonts/ directory including licenses into each output and link fonts/fonts.css. No CDN, external font import, or system-only replacement. Preserve supplied brand fonts.
