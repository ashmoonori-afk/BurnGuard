# The construction draw-in GIF export (2026-11-09)

Phase P5b of the next logo version. A geometric logo project can export its construction as an
animated GIF: the same draw-in the construction panel plays (guides, circles, lines, points,
outline, then the fill), on the light theme, looping. It sits next to the still construction sheet
of doc/35 and shares its staging, admission and errors.

## What the export does

- Format `construction_gif`, no options. Logo projects only: the export service and the artifacts
  route refuse other projects with `format_requires_logo`, before an export authority exists.
- The service (`packages/backend/src/services/export-construction-gif.ts`) reads the staged
  `logo-geometry.json`, parses and compiles it, and renders `renderLogoConstruction` at evenly spaced
  moments of the timeline. Missing or invalid records fail as `construction_missing` /
  `construction_invalid`, the same codes as the sheet, and nothing is written.
- Each frame is rasterised with the bundled canvas at 480 x 480 on white and mapped to the nearest
  entry of one fixed 256-colour table. The table is five ramps built from the light construction
  colours: paper to ink, line and accent (64 steps each), ink to line and ink to accent (32 each).
  Entry 0 is the paper, so the empty first frame is all index 0.
- Frames are one per 100 ms of the draw-in (10 fps). The first frame is the empty artboard, the last
  is the finished drawing and is held for 2 s before the loop restarts (NETSCAPE2.0, loop forever).
- Bounds: at most 120 frames, 480 x 480 pixels, 8 MiB. A file over the byte bound fails as
  `construction_too_large`. The two-bowl B of the tests is 41 frames, about 300 KB, rendered in
  about 0.3 s.
- The file is `<slug>-construction-r<rev>.gif`, `image/gif`. The receipt records
  `{ frames, width, height, bytes }`; export parity counts it as one page, like the SVG formats.
- Migration `0030_construction_gif_export_format.sql` widens `ck_exports_format` (rebuilt from 0029).

## The encoder

`packages/backend/src/services/gif-encoder.ts` is a small GIF89a writer with no dependency: one
global 256-entry table, a graphic control block per frame (delay, no transparency, leave in place),
full-screen frames, and LZW with the variable code size GIF decoders expect (8-bit minimum code
size, 9 to 12 bit codes, a clear code when the table is full). The output is deterministic.

It is tested against an independent decoder written from the format
(`packages/backend/tests/helpers/gif-decode.ts`), with flat, patterned and uniform-noise frames so
the table really fills and restarts, and against the bundled canvas image decoder for colours.

## Not in this phase

- The export menu entries for the sheet and the GIF, and their error state. Whether a project has a
  construction record comes from the geometric status query, not from the project options the menu
  reads (doc/35); the entries are the next phase.
- The MP4 export (the same frames encoded with WebCodecs H.264 in the bundled Chromium, behind a
  codec probe that offers this GIF when H.264 is missing) is a later phase.
- A dark-theme GIF. The table and the export use the light theme only, like the sheet.
