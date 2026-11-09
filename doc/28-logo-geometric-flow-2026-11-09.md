# The gated flow of the geometric logo method

Dated record, 2026-11-09. Describes the contract of phase 3 of the geometric logo method: two questions, then one candidate per step with Approve or Revise. This record covers the pure contract in `packages/shared/src/logo-geometric-flow.ts`. The server pipeline that runs a step (compile, render, measured review from `27-logo-geometry-review-2026-11-09.md`, at most one repair) and the question cards and plan in the app come in later records.

## Which marks use it

`logoMethodFor(type)` returns `raster` for `pictorial` and `mascot`, which need drawing rather than construction, and `geometric` for every other type, including `auto`.

## Questions

Two multiple-choice questions, each with an "other" answer in the person's own words (at most 200 characters):

```text
parts       symbol_wordmark | symbol | wordmark | other
direction   sharp_geometric | bold_abstract | auto | other
```

The parts answer sets the steps: `symbol_wordmark` and any "other" answer get symbol, wordmark and lockup; `symbol` and `wordmark` get that one step. The server writes the answers to `geometric/answers.json` in canonical bytes (`serializeLogoGeometricAnswers`); `parseLogoGeometricAnswersV1` refuses anything else in that file.

## Steps and the derived position

```text
symbol -> review -> wordmark -> review -> lockup
```

The symbol and the wordmark are reviewed by the person; the lockup is computed, so it is done once it exists. Nothing records where the flow is. The server reads, for each step, the SHA-256 of its record and the hash its approval names, and derives the rest:

- A reviewed step is done when its approval names the hash of the record on disk. Rewriting an approved record reopens it.
- The current step is the first step that is not done. Every step after it is pending, even with an approval of its own, because the wordmark takes its metrics from the symbol and the lockup from both.
- `logoGeometricPlan(state)` gives each step `done`, `awaiting_review` (made and shown), `next` (not made yet) or `pending`. It is empty before the questions are answered.

## Actions and turns

The flow uses its own sentinel, `<burnguard-logo-geometric-v1>`, so the raster flow's `parseLogoAction` and `resolveLogoPhase` are unchanged. A malformed sentinel is treated as absent.

```text
action    fields                               turn
answer    parts, direction                     make the first step with these answers (starts over)
approve   step, record_sha256                  record the approval, make the next step or complete
revise    step, record_sha256, note (<= 500)   make the same step again with the note
(none)    -                                    make the current step; the message is the guidance
```

`resolveLogoGeometricTurn(state, action)` refuses a turn with a stable code instead of guessing:

- `unanswered`: no answers yet and the message does not answer.
- `out_of_order`: the action names a step that is not the current one.
- `stale_record`: the action names a record hash that is no longer on disk, so the person approved or revised something they are no longer looking at.
- `flow_complete`: every step is done. Answering again starts a new flow.

## Evidence

`packages/shared/tests/logo-geometric-flow.test.ts`: 21 pass. It covers every sentinel, 15 malformed ones, the answers file round trip and its refusals, every turn above, the stale-record and out-of-order refusals, a rewritten approved symbol that reopens the flow, and the plan at every point. Each of these mutations fails at least one test: approval ignoring the hash, no stale check, no order check, a reviewed lockup, mascot moved to the geometric method, and extra keys allowed in a sentinel.
