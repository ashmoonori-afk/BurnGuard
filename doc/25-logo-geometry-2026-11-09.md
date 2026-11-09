# Geometry-first logo marks: the source record and its compiler

Dated record, 2026-11-09. Describes phase 1 of the geometric logo method: the data model and the compiler. Later phases (the construction renderer, the gated flow, the wordmark and lockup, and the construction exports) get their own dated records.

## Why

Today a mark is a raster candidate traced into polygons (`24-logo-tracer-2026-10-23.md`), and its construction page is drawn afterwards by the model. Nothing checks that drawing against the mark, and the tracer loses every true arc. The geometric method reverses the order: the geometry is written first, and the outline is compiled from it. The construction drawing then comes from the same record, so it cannot disagree with the mark.

The raster method stays for pictorial and mascot marks.

## The record

`LogoGeometryV1` lives in `packages/shared/src/logo-geometry.ts`, and its file name in a logo project is `logo-geometry.json`.

- The artboard is 64 units square. Centres, line points and rectangle edges snap to 0.5 units, and the parser lists every coordinate it moved.
- The primitives are `circle`, `line` (a half-plane), `rect` and `polygon`, at most 12 in total. There are no Bezier curves.
- Radii are declared once and referenced by id, so equal radii are one fact.
- A boolean tree (`union`, `subtract`, `intersect`) combines them, at most 4 levels deep.
- Optical corrections are named: `overshoot` grows one circle by at most one unit, and `notch` subtracts a primitive from the whole mark. The construction view will show both.
- The parser refuses unknown keys, unknown references, unused primitives or radii, and coordinates off the artboard. Each refusal carries a stable code and a JSON path, so it can go back to the model as is.

## The compiler

`packages/backend/src/services/logo-geometry-compile.ts`, with no new dependency.

```text
primitives + artboard edge  ->  curves (segments, circles)
curves x curves             ->  exact intersections (tangencies flagged)
each curve                  ->  edges between consecutive intersections
each edge                   ->  sample the tree just left and right of its midpoint
                                kept when the two sides differ, oriented inside-left
kept edges                  ->  closed loops  ->  one M/L/A/Z path
```

Along with the path, the compiler returns the vertices, each tagged with the primitives it lies on, plus the tangencies, the guide positions (every vertex and every point where the outline runs level or upright), the exact area, and the slivers (kept edges under 0.75 units). Every mark is clipped to the artboard, so a lone half-plane is still bounded. If the tree leaves nothing, or the kept edges do not close, the compiler refuses the mark. It never guesses a path.

The compiled SVG passes the master vector allowlist (`logo-svg-validation.ts`), because arcs and lines were already admitted there.

## Evidence

`packages/backend/tests/logo-geometry-compile.test.ts` holds four golden marks drawn for the tests: a ring, two tangent circles, a circle minus a half-plane, and a two-bowl B. Each one passes these checks:

- Its area matches a closed form within 1e-6.
- Every vertex lies on each primitive it names, measured from the record, within 1e-9.
- Every arc radius in the path is a declared radius.
- The SVG passes the allowlist.

A rectangle whose corners poke 0.3 units out of a circle is reported as eight slivers. Three hand-made mutations of the edge classifier each fail the suite: keeping interior edges, ignoring orientation, and sampling one side only. `packages/shared/tests/logo-geometry.test.ts` covers the parser's refusals and snapping.

## Borrowed method, not material

The method follows a study of a commercial logo tool: geometry as the source, an honest construction view, gated steps and a self-review. No name, copy, layout, markup, mark or measurement from that tool is used. Marks made there must never become fixtures or goldens.
