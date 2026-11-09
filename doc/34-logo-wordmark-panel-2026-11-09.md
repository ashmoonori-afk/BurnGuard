# The wordmark and lockup in the geometric logo panel

Dated record, 2026-11-09. Phase 4c: the panel from `31-logo-geometric-panel-2026-11-09.md` now offers every step of the gated flow. The wordmark turns and the server-composed lockup from `33-logo-wordmark-turns-2026-11-09.md` were already in place; this record adds what the person sees of them. The method is still off unless `BG_LOGO_GEOMETRIC=1`.

## Status contract

`LogoGeometricStatusV1` (geometric) has two more keys, so the parser now takes exactly nine:

- `wordmark_review`: `{ passed, findings }` for the wordmark record on disk, read from `geometric/wordmark-review.json` only while its `record_sha256` matches the record's bytes; otherwise null. Its finding kinds are `LOGO_GEOMETRIC_WORDMARK_FINDING_KINDS` (`stem_off`).
- `previews`: `{ wordmark, lockup }`, each the server-written SVG text or null. The wordmark SVG is sent only with a current wordmark review, the lockup SVG only with a current lockup record. Both the backend and the shared parser accept a preview only if it starts with the SVG namespace opening the server writes and is at most `LOGO_GEOMETRIC_PREVIEW_MAX` (256 KiB).

`available_steps` is now all three steps, so the questions open every part, and "Something else" for the parts takes words as the direction's does.

## A stale lockup

`geometric/lockup.json` names the hashes of the symbol and wordmark records it was composed from. `readLogoGeometricState` now treats a lockup whose hashes do not match the records on disk as absent. Without this, a lockup composed before the symbol was revised would keep the flow looking complete with nothing current to show; now the lockup step is "Up next", the panel offers "Make the lockup", and that turn composes it again from the current records.

## The panel

- Wordmark review: the wordmark preview, then the measured checks (the `stem_off` finding in plain words), then "Approve this wordmark" and "Ask for changes". Approve and revise name the wordmark record's hash, as for the symbol.
- Finished flow: the status line, then the lockup preview when there is one.
- A step not made yet names its step ("The wordmark hasn't been made yet.", "Make the wordmark"). The chat lines sent with an action no longer name the symbol, since the same actions now serve every step.

Previews are shown as `<img>` with an `image/svg+xml` data URL, never inlined. An image document runs no script and loads nothing, so even a hand-edited SVG on disk cannot act in the app; the app's CSP already allows `data:` images. The tile is white in both themes so the black artwork reads, and takes the artwork's proportions from its `viewBox`, since an SVG with only a viewBox has no width of its own.

## Checks against the UI guardrails (desktop only: 1440 and 1024 px)

- Every control is at least 44 by 44 px, in light and dark, for the questions, the symbol review, the wordmark review and the finished flow.
- No horizontal overflow at either width; every preview decodes and ends inside the viewport.
- All text in the panel has at least 4.5:1 contrast against what is actually behind it, opacity included.
- The parts "Something else" field takes focus when chosen and Start waits for words; the questions can be answered with the keyboard alone.
- Each preview has a text alternative that says what it is.
- No motion was added, so the reduced-motion rule has nothing new to cover.

Screens were taken at 1440 and 1024 px, light and dark, in Korean and English, for the questions, the wordmark review and the finished flow, from the real wordmark and lockup SVGs the server writes for a Geist "Northstar" and the two-bowl B.

## Tests

- `packages/shared/tests/logo-geometric-status.test.ts`: the nine-key status round-trips; an unknown wordmark finding, a preview that is not a server SVG, an oversized preview and a missing preview key are refused at the named path.
- `packages/backend/tests/logo-geometric-status.test.ts`: all three steps offered; a wordmark with a current review shows its kinds and SVG, a stale review shows neither; an SVG file that is not a server SVG is not shown; a current lockup is recorded and previewed, and one composed from an older symbol is absent with no preview.
- `packages/frontend/tests/logo-geometric.browser.test.ts`: the guardrail sweep above; nothing preselected or closed with every part open; the parts "Something else" answer is sent trimmed; the wordmark preview decodes as a data-URL image, adds no inline SVG, shows one finding and Approve sends the wordmark record; the finished flow shows the lockup preview, and a stale lockup offers "Make the lockup" only. The suite builds the SVGs with the backend's own `finishLogoGeometricWordmark` and `composeLogoGeometricLockup`, so the previews are the real ones.
- Nine mutations (preview not bound to its review, stale lockup kept, backend or shared SVG check removed, only the symbol offered, wordmark preview hidden, parts "Something else" inert, wordmark findings dropped, Approve always naming the symbol) each fail at least one of these suites.

The browser page used by the suite now declares UTF-8, so Korean copy renders correctly in its screens.
