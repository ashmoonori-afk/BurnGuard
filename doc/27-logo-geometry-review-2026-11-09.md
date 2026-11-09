# Measured self-review of a geometric mark

Dated record, 2026-11-09. Describes the first part of phase 3 of the geometric logo method: the checks that run on a compiled mark (`25-logo-geometry-2026-11-09.md`) before any model or person looks at it. The gated flow and the server pipeline that act on the findings come in later records.

## Why measured first

A vision critique is an opinion and can miss a 0.3-unit nick. These checks are facts computed from the record and the compiled outline, so they are deterministic, cheap and testable. The pipeline runs them first, hands every finding back to the model for at most one repair, and states any finding that remains in plain words. A finding is never fixed silently.

## The checks

`reviewLogoGeometry(geometry, compiled)` in `packages/shared/src/logo-geometry-review.ts` returns `{ passed, findings }`. `passed` is true only when there are no findings.

```text
kind              what it means                                        threshold

sliver            an outline edge too short to read as shape           < 0.75 units (compiler)
near_touch        two outline boundaries miss each other               > 0 and <= 0.5 units
duplicate_guide   two guide positions almost coincide                  < 0.5 units apart
closed_counter    a hole fills in when the mark is rasterised          at 16 px or 32 px
```

- `sliver` comes straight from `compiled.slivers`, with the edge midpoint and its primitives.
- `near_touch` measures every pair of boundaries the outline runs along (circles after overshoot, clipped half-plane lines, rect and polygon edges; never the artboard). Crossing or touching boundaries have a gap of 0 and are not reported, so a deliberate tangency is not a flaw. The closest gap per pair of primitives is reported.
- `duplicate_guide` compares neighbouring entries of `compiled.guides`. A near miss usually shows up twice, as a `near_touch` and as a doubled guide, because both describe the same mistake.
- `closed_counter` rasterises the mark on a 256-cell reference grid, finds the background regions that do not reach the artboard edge, and checks that each one still leaves at least one pixel that is at most half ink at 16 and at 32 px. Pockets that lie within one reference cell of a boundary everywhere are hairline gaps, not counters; the gap itself is a `near_touch`.

Numbers in findings are rounded to 0.001, so a review serialises the same way on every OS.

## Evidence

`packages/shared/tests/logo-geometry-review.test.ts`: the two-bowl B passes clean; a planted 0.3-unit sliver is reported eight times; a 0.119-unit circle gap and a 0.25-unit box-to-circle gap are near touches; exact tangency is not; a 3-unit hole on a pixel corner closes at 16 and 32 px, and the same hole centred on a 32 px pixel closes at 16 px only. Removing the near-touch bound, counting tangency as a near touch, dropping the depth filter, loosening the coverage limit or dropping slivers each fails at least one test.
