# Canvas move corrections after the pre-release check (2026-11-12)

The pre-release check of release 1 (the canvas magnet, [record 39](39-canvas-magnet-2026-11-10.md)) found
that a move could be saved at a place the preview had not shown. This record covers what changed. Where
it disagrees with record 39, this record is current.

## A move under transforms

CSS applies `translate` outside the element's own `rotate` and `transform`, in the space of its
parent. The move tools divided the distance on screen by a scale that included the element's own
transform and ignored rotation above it. A box with `transform: scale(2)` dragged 40 px was saved
20 px away, and a child of a `rotate(90deg)` parent dragged to the right moved down.

- The frame bridge now also reports `basis`: the 2x2 part (a, b, c, d) of the transforms above the
  element, without its own.
- `offsetDelta` in `lib/element-geometry.ts` turns a distance on screen into `translate` pixels
  through the inverse of that basis. Drag, arrow keys and Align all use it. A basis that flattens the
  element to nothing, or that cannot be read, moves nothing.
- An arrow key still moves the element one `translate` pixel; `nudgeTravel` gives the distance that
  covers on screen.
- Resize and rotate are unchanged. They work in the element's own box and keep its full scale and
  rotation.

Not read by the bridge, as before: the CSS `scale` property, `zoom` and 3D transforms. Under a
rotated parent with padding or a border, Align still reads the parent's content box as if it were
upright.

## How it is checked

`packages/frontend/tests/canvas-move.browser.test.ts` runs the real Style overlay and bridge in
Chromium over the two pages of the pre-release check and a page of transform cases. It saves with the
backend's patch function and measures the saved page: the preview and the saved element must both move
exactly as far as the pointer, at 1440 and 390 px, on a canvas zoomed to 200%, by arrow keys and by
Align.
