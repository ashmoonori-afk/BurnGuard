# The construction view of a geometric mark

Dated record, 2026-11-09. Describes phase 2 of the geometric logo method: one renderer draws the construction of a mark from its record (`25-logo-geometry-2026-11-09.md`), and the symbol card in the app plays it.

## One renderer for every surface

`renderLogoConstruction(geometry, compiled, t, { theme, label })` in `packages/shared/src/logo-construction.ts` returns the whole sheet as SVG text for one moment `t` in [0, 1]. It is pure. The app plays it, and the later GIF and MP4 exports will sample it, so all three show the same frames. No test depends on a clock.

The sheet is built from the record and the compiled outline only:

```text
step      what is drawn                                        source
guides    full-bleed lines at every compiled guide position    compiled.guides
circles   each circle, its centre cross and a radius line      geometry.primitives (+ overshoot)
lines     half-planes clipped to the artboard, rect and        geometry.primitives
          polygon edges
points    every vertex; tangencies as hollow accent rings      compiled.vertices, compiled.tangencies
outline   each loop traced along its own length                compiled.loops
fill      the outline fill fades in                            compiled.path
```

Primitives named by an optical correction (`overshoot`, `notch`) are drawn in the accent colour, so a correction is visible rather than hidden in the outline.

## Motion

There is one motion, a draw-in, staggered once because the order means something. Each stroke draws in with `stroke-dashoffset` and a cubic ease-out over at most 400 ms, strokes in one step start 60 ms apart, points grow in 200 ms and the fill fades in 300 ms. A step starts when the step before it has drawn in. The two-bowl B in the tests takes 3.96 s in total.

`logoConstructionProgress(elapsed, timeline, reducedMotion)` maps a clock reading to `t`. Under reduced motion it is always 1, so the first frame is the finished sheet.

## In the app

`LogoConstructionCard` sits in the Design stage beside the candidate picker. It appears only when the project tree holds `logo-geometry.json`, so raster marks look as before. It reads the record, parses and compiles it in the browser with the shared compiler, and shows:

- a 디자인 / 작도 switch (Radix tabs, arrow keys move between them, 44 px targets); the panel switch fades in 200 ms;
- in 작도, the draw-in and a Replay button that starts it again;
- an alert in place of the switch when the record cannot be read or compiled.

The card follows the project file listing that the project view already refreshes after each turn, keyed by the file's hash, so a rewritten record is read again without polling.

## Evidence

- `packages/shared/tests/logo-construction.test.ts`: frame hashes at t = 0, 0.5 and 1; steps in build order; every stroke within 400 ms and the fill within 300 ms; one outline per loop and one point per vertex; reduced motion and clamping; empty first frame and fully drawn last frame; themes change colours only; the label is escaped.
- `packages/frontend/tests/logo-construction.browser.test.ts` (Chromium, desktop widths 1024 and 1440, light and dark): every control at least 44 px and inside the card, a square drawing, the switch by keyboard, Replay restarting the draw-in, reduced motion opening on the final frame, and the alert for a refused record.

BurnGuard is a desktop product, so the card is checked at desktop widths only.
