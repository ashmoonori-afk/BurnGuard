# Construction exports in the export menu (2026-11-09)

Phase P5 of the next logo version, menu part. doc/35 added the construction sheet export and doc/36 the
draw-in GIF; this record puts both in the logo export menu with an honest disabled state and a
specific error state.

## The person and the journey

A logo project owner, on desktop, who has finished the geometric logo steps and wants the drawing as
a file for a pitch deck or a social post. They open Export, pick a construction file, wait for the
job, and download it from Recent exports. Two things can go wrong: the project has no construction
record yet (a logo made before the geometric method, or one still in progress), or the GIF export
fails after it started.

## What the menu does

- A logo project lists, after the logo SVG and the guidelines, `Construction sheet SVG`
  (`construction_svg`) and `Construction draw-in GIF` (`construction_gif`).
- Both read whether `logo-geometry.json` is in the project file listing. The menu uses the shared
  `["project", id, "files"]` query, the same key the construction card reads, so it follows turns
  without polling. Other project types never fetch it.
- Without the record both entries stay listed but disabled, with the reason
  `export.disabled.construction_missing` under the label (the same pattern as the web-only package
  entries). Hiding them would leave the person guessing where the construction export went.
- A failed construction export shows its own toast body: the backend keeps the code in the
  persisted failure message (`Export failed: construction_too_large`), and
  `classifyConstructionFailure` maps `construction_missing`, `construction_invalid` and
  `construction_too_large` to `export.construction.*`. The too-large copy points to the sheet SVG,
  which has no size bound. Other failures keep the existing chain (platform checks, render phase,
  Chromium, then the stop reason).

## Checks

- `logo-export-options.test.ts`: the entries with and without the record, absence on a prototype
  project, and the classifier for all three codes and for unrelated messages.
- `export-construction-menu.browser.test.ts` (real Chromium, 1440 and 1024 px): both entries are
  `aria-disabled` and show the reason without the record, are selectable with it, and a running GIF
  job that fails as too large raises an alert toast with the construction copy.
- Screens checked at 1440 and 1024 px, light and dark, Korean and English: the disabled entries,
  the enabled entries and the error toast. BurnGuard is desktop only, so there is no phone width.

## Not in this phase

- The MP4 export behind an H.264 codec probe (DESIGN.md P5) is still open.
- The geometry JSON inside the plain `svg` export stays deferred (doc/35).
