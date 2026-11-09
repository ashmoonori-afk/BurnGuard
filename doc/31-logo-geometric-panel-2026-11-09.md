# The geometric logo panel

Dated record, 2026-11-09. Describes the screen a person uses for the geometric logo method: the read-only status route, the shared status contract, `LogoGeometricPanel` and the change in `ProjectView` that shows it in place of the raster pipeline. It builds on the flow contract (`28-logo-geometric-flow-2026-11-09.md`), the server step (`29-logo-geometric-step-2026-11-09.md`) and the turn (`30-logo-geometric-turn-2026-11-09.md`). BurnGuard is a desktop app; the panel is checked at 1440 and 1024 px only.

## Status

`GET /api/projects/:id/logo/geometric` (domain `logo-geometric` in `server.ts`) returns `LogoGeometricStatusV1` from `@bg/shared/logo-geometric-status`. It is read from the project files on every request by `readLogoGeometricStatus`, with the same method decision as a turn, so the screen and the next turn cannot disagree:

- `{ method: "raster" }` when the switch is off, the project has no logo brief or the brief asks for a drawn mark. The raster pipeline shows as before.
- Otherwise `{ method: "geometric", answers, plan, available_steps, records, symbol_review }`. `available_steps` is what this build can make (the symbol; the wordmark and lockup arrive with phase 4). `records` holds each step's record hash, which an approval or revision names. `symbol_review` is the measured review of the symbol record now on disk, reduced to the kinds of finding the app explains; a review written for other bytes, or naming a kind the app does not know, is null.

The route has no write. Every choice the person makes travels as a turn sentinel on the ordinary send path, so checkpoints, history and the turn's own refusals cover it. A project that is not a logo answers `404 project_not_found`. The frontend parses the body once with `parseLogoGeometricStatusV1`, which refuses extra keys, unknown values and repeated entries.

The status query is keyed on the project file listing (the record and everything under `geometric/`), as the construction card is, so it refetches when a turn writes and never polls.

## The panel

`ProjectView` hides the raster pipeline and the concept panel when the status is geometric, and shows the symbol card (`LogoConstructionCard`) and then the panel. The card is the mark the decisions refer to. A failed status load shows an alert with Try again and leaves the raster panels in place.

1. Questions. Two fieldsets: what the logo includes, and the direction. A parts answer is open only when every step it needs is available; the others are disabled and say "Coming in a later update" through `aria-describedby`. With one option open it starts chosen. Something else opens a labelled field (200 characters) that takes focus. Start the symbol stays disabled until both questions are answered.
2. Plan. Each step shows its name and its status in words (Done, Waiting for your review, Up next, Later), never by colour alone; the current step carries `aria-current="step"`. At 1280 px and wider the plan is a pinned list beside the step; below that it is one bar that opens the list (`aria-expanded`).
3. The current step. Waiting for review shows the measured checks (passed, missing, or one plain sentence per finding kind) and Approve this symbol or Ask for changes. Ask for changes opens a labelled note (500 characters, live count) with Send changes and Cancel; Escape cancels, and closing returns focus to Ask for changes. A step not made yet offers Make the symbol, which sends a plain message so the saved answers decide the step. After the last approval the panel says where the files are.
4. While a turn runs every control is disabled and a status line says the AI is working.

The chat bubble for a geometric action shows the app's own line, never the sentinel (`requestDisplayText`).

## Guardrail review

The UI contract (person, journey, fixed cases) was written before the build. Verdicts at 1440 and 1024 px, light and dark, measured in the browser suite:

| Rule | Verdict | Evidence |
|------|---------|----------|
| Targets at least 44 px | pass | every button, field and choice label measured in both states, both widths, both themes |
| No horizontal overflow | pass | document scroll width equals the viewport in every case |
| Text contrast 4.5:1 | pass | every text node against its composited background, including filled buttons, translucent rows and opacity; disabled buttons are exempt (WCAG 1.4.3), the reason a choice is closed is not |
| Status not by colour alone | pass | plan status is text; findings are sentences |
| Keyboard only | pass | questions answered with Tab, Space and Enter; plan bar opened with Enter; Escape closes the note and focus returns |
| Labels and descriptions | pass | fieldsets have legends, fields have labels, closed options name why |
| Motion | not applicable | the panel adds no motion; the spinner stops under reduced motion |

## Tests

- `packages/shared/tests/logo-geometric-status.test.ts`: the parser accepts both shapes and refuses extra keys, unknown and repeated values, malformed hashes, answers and reviews.
- `packages/backend/tests/logo-geometric-status.test.ts`: the reader against real files (switch, drawn types, nothing answered, review reduced to unique kinds, stale or unknown review hidden, approval shown as done) and the route through `createApp` (classification, the switch, 404, 403 without the capability).
- `packages/frontend/tests/logo-project.test.ts` and `request-display.test.ts`: every geometric action survives its chat message, Make carries no sentinel, and the bubble hides the sentinel.
- `packages/frontend/tests/logo-geometric.browser.test.ts`: the guardrail table above, the plan at both widths, keyboard answering, Something else, approve and revise with Escape, the working state, and the not-made, finished and failed-load states.

Eight mutations were each caught: the switch ignored by the status, a stale review shown, a repeated plan step accepted by the parser, the sentinel shown in the chat bubble, every parts option opened, the plan bar shown on wide screens, focus not returned after the note closes, and the closed-option reason faded below 4.5:1. The last one first slipped through because the contrast check ignored opacity; the check now blends it in.

Not yet measured: whether people find the two questions and the plan clear. That needs the frozen-brief measurement with real people, after the switch is on.
