# The canvas magnet: move, resize and rotate with alignment (2026-11-10)

Release 1 of the three canvas tools planned after 0.5.35 (magnet, then component grid, then image
editor). This record covers the magnet only. The grid and the image editor are not built yet.

## The person and the journey

Someone refining a generated page, deck, poster or app screen on a desktop window, in Korean, English
or Chinese. Until now they could resize and rotate one element by eye. They select an element in
Style mode, drag it, see what it lines up with, release, and can undo. The same person on a narrow
window uses the panel as a bottom sheet, and a keyboard user does all of it without the pointer.
Two things can go wrong: the file changes underneath while they drag, or they change their mind in
the middle of a drag.

## What it does

- **Move.** The selection box has a Move surface. A drag past 3 screen pixels moves the element; a
  shorter press is a click and still selects what is under the pointer, so a nested element stays
  reachable. The offset is saved as the CSS `translate` property on that one element. Neighbours
  never reflow and nothing else is written.
- **Magnet.** Within 6 screen pixels at any zoom, the element locks to sibling edges and centres, the
  parent's content box, the slide or artboard, grid lines of a grid parent, and a gap equal to one
  that already exists between two neighbours. Ties go to the grid line, then artboard centre,
  artboard edge, parent centre, parent edge, sibling edge, sibling centre. An element that is not
  rotated by a quarter turn locks by its centre only. An element already within 0.05 px of a line
  is shown as locked but not shifted, so no stray `0.01px` is written on an axis nobody touched.
- **Resize and rotate.** The moving edge of an upright element locks to the same lines, and its
  width or height locks to a sibling's size. Rotation locks to multiples of 15 degrees within 3. A
  rotated element resizes freely, because it grows on both sides of its centre.
- **Pause and toggle.** Ctrl or Command pauses the magnet during a gesture. The Magnet toggle in the
  canvas top bar switches it off and is remembered under `bg.canvas.magnet` in local storage.
- **Keyboard.** With the Move surface focused: Arrow 1 px, Shift+Arrow 10 px, Alt or Option+Arrow to
  the next line. A burst saves once, about 0.4 s after the last key is released. Clicking an element
  hands focus to its Move surface, and the surface takes focus back after the save reloads the
  canvas.
- **Panel.** A Magnet section states every lock as a sentence in a polite live region. A Position
  section has X and Y fields that follow a move in progress, Reset position, and six Align to parent
  buttons.
- **Guides.** One one-screen-pixel line per direction with a named chip beside the moved box, both
  gaps of an equal spacing, a badge naming the sibling for a same-size lock, the angle for a
  rotation lock. They fade out in 100 ms after the gesture and are removed at once under reduced
  motion.

## How it is built

```
ProjectView  (tweaksMutation: identityForPatch, directEditRevision)
 |- Canvas -- CanvasTopBar (Magnet toggle, alignment group folds into More first)
 |    `- TweaksLayer -- Move surface, handles, key handling, align action
 |         |- lib/move-gesture.ts    one gesture or key burst -> at most one save
 |         |- lib/resize-gesture.ts  snapResize, snapRotate
 |         |- lib/snap-engine.ts     candidates, locks, next line, rotation steps
 |         |- lib/snap-guides.ts     chip and sentence message keys
 |         |- SnapGuides.tsx         parent chrome over the preview
 |         `- frame-bridge.ts  <- postMessage ->  sandboxed iframe (snap-rects, hit-bg)
 `- ModePanel -- TweaksPanel (Magnet status, Position, Align)
```

- The sandboxed document is the only place that can measure the page. One read-only bridge action,
  `snap-rects`, returns the element, its parent box and content box, the grid lines of a grid
  parent, the artboard, and up to 80 visible siblings, nearest first. It is asked once per gesture
  and never polled. Its answer is parsed all-or-nothing (`parseFrameSnapRects`), because the
  numbers end up in saved styles.
- A grid line is `{ start, end }`: with a gap the line has thickness, so three columns give four
  lines and both edges of every gap.
- Nothing is drawn inside the iframe and nothing changes there during a gesture. The preview and the
  guides are overlay elements in the parent app. The sandbox attributes and the bridge source check
  are unchanged.
- Every canvas gesture, including the older resize and rotate handles, reads the file identity when
  it starts and saves against it. A change that lands while the pointer is down is refused as stale
  and the preview returns to the saved place. Panel fields and buttons commit at once, so they read
  the identity at save time.
- No new dependency, no database migration, no new backend route. Saves use the existing
  `PATCH /api/projects/:id/fs/*` path and the existing undo.

## Differences from the plan

- The magnet choice lives in the existing UI store, not a new `canvasPrefsStore`: the frontend guide
  allows one global store. `lib/canvas-prefs.ts` holds the storage read and write.
- Resize locks apply to upright elements only. The plan's "centre only unless a multiple of 90
  degrees" rule is kept for moving.
- Two things were added after testing in a real browser. A selection under 40 px on one side keeps
  its handles outside the box, because they covered the Move surface of small text elements. And
  the Save history dialog, which has opened by itself after every revision since the source
  comparisons arrived, now stays closed for a revision made by hand on the canvas; before that it
  covered the canvas after each drag and took the keyboard away from the next key press.
- Taps on an arrow key are joined into one save by a short pause after the last key release. The
  plan said "on key release", which would have saved every tap on its own.

## Checks

- Unit tests run the pure parts and the real bridge script against a fake document:
  `snap-engine`, `canvas-interaction`, `element-geometry`, `snap-guides`, `selection-bridge`,
  `edit-target`, `tweaks-panel`, `canvas-prefs`, `toolbar-overflow`, `history-dialog`. Each change
  was mutation-checked: every one-rule mutation tried made a test fail (138 mutations in all).
- Real browser, headless Chrome against the built app on an isolated profile, at 1440 and 390 px:
  dragging a nav link 135 px locked to its neighbour and saved `translate: 134.02px 0px`; Undo
  restored the original file hash; Escape and a 2 px press saved nothing; Ctrl saved the unlocked
  135 px; a change made through the API while the pointer was down made the move fail as stale and
  the file kept only that other change; a same-width lock saved the neighbour's 38.7 px; a rotation
  drag saved 45deg; five arrow taps saved `translate: 5px 0px` as one operation; Align center put
  the box centre within 1 px of the parent's; a paragraph in a four-column grid row locked to
  `column 2`; a nav link locked to the 134 px gap between its neighbours.
- Korean and English, light and dark were captured for the move guides and the toggle.
- Not checked: touch input, a screen reader run, 200% text, a reduced-motion browser run, and a
  scaled slide or a zoom other than 100% in the real app (those two are covered by unit tests).

## Not in this release

- The component grid: Layout and Grid item controls, the grid overlay, reordering.
- The image editor.
- Live Width and Height numbers in the panel while a handle is dragged.
