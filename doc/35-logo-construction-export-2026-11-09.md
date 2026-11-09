# The construction sheet export

Dated record, 2026-11-09. Phase 5a of the geometric logo method: a logo project can export its construction drawing as a still SVG sheet, the first of the three construction formats in the design (sheet, GIF, MP4). The record it is drawn from only exists when the geometric method made the symbol, which stays off unless `BG_LOGO_GEOMETRIC=1`.

## The format

`construction_svg` is a new `ExportFormat`. It takes no options, is admitted for logo projects only (`format_requires_logo` otherwise, at the service and at the route), and publishes one `image/svg+xml` file. Its download name is `<project>-construction-r<revision>.svg`, beside the master's `<project>-logo-r<revision>.svg`.

The exports table's format check gains the value in migration `0029_construction_svg_export_format.sql`, a table rebuild in the same shape as `0018`. It is numbered 0029 because the app-screens branch adds its own 0028; the two touch different tables, so either merge order leaves the same schema.

## The sheet

`renderLogoConstructionSheet(geometry, compiled, label)` in `packages/shared/src/logo-construction.ts` is the finished construction (t = 1, light theme) drawn as a still: the same strokes, points and outline as the app's last frame, with every stroke whole and undashed and the fill solid. The animated renderer keeps its frames byte for byte; the sheet is that last frame with the dash attributes and the fill opacity taken out, and a test states exactly that.

The export (`packages/backend/src/services/export-construction.ts`) reads `logo-geometry.json` from the staged copy, parses and compiles it, renders the sheet, and passes it through the master vector allowlist (`validateLogoSvg`) before writing. So the sheet is held to the same allowlist as `logo.svg`. The animated frame would not pass it, since the allowlist has no dash attributes. That is why the export draws a still sheet instead of sampling a frame. A missing record fails the attempt as `construction_missing`; a record the parser or compiler refuses, or a name the allowlist cannot carry, fails it as `construction_invalid`. Nothing is published in either case. The accessible name is the one the symbol step gives the mark: the brand name, else the project name.

## Not in this phase

- The export menu does not offer the format yet. Whether a project has a geometry record is known from the geometric status, not from the project type, so the menu entry, its error state and the desktop screens come with the GIF and MP4 entries in a later phase. Until then the format is reachable through the API only.
- The design also asks for the geometry JSON to travel with the `svg` export. The master `svg` export publishes `logo.svg` byte for byte (doc/23 D6), and the allowlist has no element for embedded data. Carrying the JSON therefore needs a format decision (an archive, or a data element added to the allowlist) and is left open.

## Tests

- `packages/shared/tests/logo-construction.test.ts`: the sheet equals the t = 1 frame with its dashes and fill opacity removed; the same record gives the same bytes, and only the label differs between names. The existing frame hashes at t = 0, 0.5 and 1 still hold.
- `packages/backend/tests/logo-construction-export.test.ts`: the sheets of a two-bowl B and a ring pass the allowlist and the animated frame does not; a staged record publishes exactly the sheet with a receipt validation that round-trips; a missing record, malformed JSON, a record the compiler refuses and an unsafe name each fail with their code and write nothing.
- `packages/backend/tests/logo-export.test.ts`: a prototype project is refused at the service and the route with no authority row; options are refused; a logo project with a ring record runs the whole pipeline (migration, staging, render, receipt) and publishes the sheet.
- `packages/backend/tests/export-naming.test.ts`: extension, MIME type and the `-construction-r3.svg` name.
