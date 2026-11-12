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
- The panel's X and Y fields show the saved `translate`, which runs along the parent's own axes: under
  a parent turned a quarter, a move of 40 px to the right on screen reads as Y -40.

Not read by the bridge, as before: the CSS `scale` property, `zoom` and 3D transforms. Under a
rotated parent with padding or a border, Align still reads the parent's content box as if it were
upright.

## Text inside a line

The browser does not apply CSS transforms, `translate` included, to a non-replaced inline box: a
`span`, an inline link or emphasis inside a sentence. Such an element took the saved `translate` and
stayed where it was, while the panel showed the new offset.

It is now refused before the drag. The bridge reports `inLine` for such an element, `moveRefusal` in
`lib/element-geometry.ts` names the reason, and `targetOffset` answers null for it, so drag, arrow
keys, the X and Y fields and Align all leave it alone. The Move surface shows a not-allowed pointer
and carries the reason as its tooltip, and the panel's Position section gives the same sentence. A
press on it still selects what is under the pointer.

Making it move by switching it to `display: inline-block` was not chosen. An inline box that wraps
over two lines becomes one block and the text around it reflows, which a move promises not to do. A
resize already makes that switch on purpose, and after it the element can be moved.

Pictures, video, canvas and other replaced elements, inline blocks, buttons and SVG elements are not
refused: the browser moves them.

## What a move writes

Record 39 and journey J08 said that nothing else in the file changes. A move writes only the element's
`translate`, but the save gives editing ids (`data-bg-node-id`) to the element and to the elements
inside it when they have none, as every canvas save does. The undo shortcut takes the offset back and
keeps those ids; the toolbar's undo restores the file byte for byte. J08 in
`scripts/qa/prerelease-ux-qa.md` now says this.

## How it is checked

`packages/frontend/tests/canvas-move.browser.test.ts` runs the real Style overlay and bridge in
Chromium over the two pages of the pre-release check and a page of transform cases. It saves with the
backend's patch function and measures the saved page: the preview and the saved element must both move
exactly as far as the pointer, at 1440 and 390 px, on a canvas zoomed to 200%, by arrow keys and by
Align. For text inside a line it checks that nothing is saved, that the Move surface and the panel give
the same reason, and that the refusal agrees with what the browser itself does for eight kinds of
element.
