# The wordmark and the lockup of the geometric logo method

Dated record, 2026-11-09. Describes the wordmark record and its compiler (`packages/shared/src/logo-wordmark.ts`, `packages/backend/src/services/logo-wordmark-compile.ts`) and the deterministic lockup (`packages/shared/src/logo-lockup.ts`). This is phase 4a: the pieces work and are tested, but no turn makes them yet. Wiring them into the gated flow (`28-logo-geometric-flow-2026-11-09.md`) and showing them in the panel (`31-logo-geometric-panel-2026-11-09.md`) are the next records.

## The wordmark record

`geometric/wordmark.json`, written by the model, parsed by `parseLogoWordmarkV1`:

```text
{ schema_version: 1, text, font, cap_height, stem, tracking }
```

- `text`: plain Latin letters, digits and `& . ' -`, single spaces between words, at most 24 characters.
- `font`: a family from the bundled font manifest (`assets/fonts/manifest.json`). Every bundled family is OFL. Script families (category `handwriting`) are refused: they have no flat capitals or upright stems to measure.
- `cap_height` (6 to 32), `stem` (0.5 to 8) and `tracking` (-2 to 8) are in symbol units on the 64-unit artboard. Values off the 0.5 grid are snapped and listed, as for the symbol.

Unknown keys, out-of-range values and malformed text are refused with a stable code and JSON path. An unknown or script family is refused by the compiler with `font_unknown`.

## Setting the wordmark

`compileLogoWordmark` reads the outlines from the font with `fontkit`, which the backend already uses for font validation, so nothing new ships. The scale makes the flat top of a capital H exactly `cap_height`; the baseline sits at `y = cap_height`, so capitals run from 0 to the cap height. Kerning stays on; ligatures and contextual alternates are off, so each character keeps its own glyph. `tracking` is added between letters only. Numbers are written with three decimals, so the same record always gives the same path bytes.

The stem is measured, not forced. The font is set at its default weight, and `stem_measured` is the width of a capital I at half its height. `reviewLogoWordmark` reports `stem_off` with both values when it is more than 0.25 units from the asked stem, so the model can pick another family or cap height. The design asked for the stem to be taken from the symbol unit; matching it exactly would need other weights of the variable fonts, and fontkit 2.0.4 cannot instance a WOFF2 variable font that has composite glyphs (it throws in the glyf transform). Weight choice is left for a later record, along with the one glyph detail that may echo the symbol.

## The lockup

`composeLogoLockup(symbol, wordmark)` is pure and uses no model. Both drawings share one unit, so neither is scaled:

- Gap: half the cap height, rounded up to 0.5, from the symbol's ink to the wordmark's ink.
- Optical centre: the middle of the cap height sits on the symbol's area centroid, not its box centre. `logoGeometryCentroid` integrates the compiled line and arc edges exactly (Green's theorem), holes included; a mark heavier at the bottom carries its words lower.
- Clear space: one cap height on every side. `logoGeometryBounds` includes every arc's extreme points.

`logoLockupSvg` writes two filled paths with their translations. The same two compiled records give the same bytes.

## Tests

- `packages/shared/tests/logo-wordmark.test.ts`: the parser keeps, snaps and refuses; the review passes within tolerance and names a stem it cannot meet.
- `packages/shared/tests/logo-lockup.test.ts`: centroid and area of a ring and of a disc over a slab against their analytic values, exact bounds, gap and clear space as 0.5 multiples, the cap middle on the centroid, and a golden for the SVG bytes.
- `packages/backend/tests/logo-wordmark-compile.test.ts`: every settable bundled family covers every wordmark character; flat capitals run exactly from the cap line to the baseline; tracking adds exactly what it says; stated metrics are unit multiples; the measured stem scales with the cap height and a heavier face measures heavier; the outline and a real symbol-plus-wordmark lockup match their goldens; unknown and script families are refused.

Nine mutations were each caught: tracking after the last letter, the baseline at the top, script families allowed, the stem measured at the baseline, the box centre instead of the centroid, the clear space halved, arc extremes ignored, no snapping, and the stem never reviewed.

Not yet measured: how often a model's chosen family and cap height land within the stem tolerance. That belongs to the twelve-brief measurement, after the wordmark step is wired.
