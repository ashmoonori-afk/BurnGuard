# Wordmark and lockup turns of the geometric logo method

Dated record, 2026-11-09. Phase 4b: the wordmark record and the lockup from `32-logo-wordmark-lockup-2026-11-09.md` now run as steps of the gated flow (`28-logo-geometric-flow-2026-11-09.md`, `30-logo-geometric-turn-2026-11-09.md`). The method is still off unless `BG_LOGO_GEOMETRIC=1`, and the panel still offers only the symbol: its questions keep to `available_steps`, which stays `["symbol"]` until the panel can show a wordmark for review (the next record).

## The wordmark step

When the person approves the symbol and their answers asked for the wordmark too, or answered "wordmark" alone, the turn makes the wordmark:

- The model may write one file, `geometric/wordmark.json`. Any other write refuses the turn with `geometry_scope`, as for the symbol.
- The step's machine block carries `step: "wordmark"`, the record file and `families`: the sorted names of the bundled families the record may use (script families left out). The rules tell the model to read the symbol record, take the stem from it and pick a family whose own stem is close, since each font is set at its default weight.
- After the model's pass the server sets the record (`finishLogoGeometricWordmark`), writes `geometric/wordmark.svg` and `geometric/wordmark-review.json` (the measured review bound to the record's hash).
- The review pass runs only when there is something to fix: a record the server refuses, or `stem_off`. Its prompt is a bounded context of its own with the refusal or the measured finding. The model may rewrite the record once; a record that still cannot be set refuses the turn with `geometry_<code>`. A wordmark that is set but still off its stem is kept, and the review file says so.

Unlike the symbol, a wordmark that passes its measured review gets no model review pass: it is set from the font, so the only flaws the server knows of are measured ones.

## The lockup step

The lockup is computed, not authored. When the person approves the wordmark, the server composes the lockup before it records the approval:

- `composeLogoGeometricLockup` compiles the symbol record and sets the wordmark record, then writes `geometric/lockup.json` (the layout plus the hashes of the two records it came from) and `geometric/lockup.svg`.
- If either record is missing or no longer compiles, the turn is refused with `geometric_lockup_unavailable`, and neither the approval nor any lockup file is written.
- Once the lockup exists the flow is complete. The model only replies and writes nothing, as for the approval of a last step.

## Tests

`packages/backend/tests/logo-geometric-turn.test.ts`:

- Capture: approving the symbol with the wordmark asked for makes the wordmark with sorted settable families (Geist in, the script family Caveat out); approving the wordmark composes the lockup from both records (gap 8 and clear space 16 at cap 16, both record hashes) and completes the flow; approving a wordmark that cannot be set is refused with no lockup and no new approval; approving the wordmark before the symbol is refused as out of order.
- Prompt block: the wordmark step carries `families` and the wordmark rules, and the symbol step carries neither.
- Whole turns through `startUserTurn` with real bundled fonts: a wordmark that meets its stem is published after one model call; one with `stem_off` gets a review pass that names the finding and its fix is published; one in an unknown family is refused after the review pass and the project is left unchanged.

Eight mutations were each caught: the approval recorded before the lockup, the lockup never composed, the wordmark review never run, the wordmark review always run, the symbol record file used for every step, no families offered, the symbol rules on the wordmark step, and a still-refused wordmark accepted.

Not yet done: the panel showing the wordmark and its review, and the lockup preview (next record); exports (phase 5).
