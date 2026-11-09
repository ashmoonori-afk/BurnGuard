# Wiring the geometric logo method into a turn

Dated record, 2026-11-09. Describes `packages/backend/src/services/logo-geometric-turn.ts`, `packages/backend/src/harness/prompt-logo-geometric.ts` and the branch in `turns.ts` that connects the flow contract (`28-logo-geometric-flow-2026-11-09.md`) and the server step (`29-logo-geometric-step-2026-11-09.md`) to an ordinary logo turn. The question cards and plan UI are the next record.

## The switch

The method is off by default. `logoGeometricEnabled(env)` is true only when `BG_LOGO_GEOMETRIC=1`. It stays off until the twelve-brief measurement in the design record shows it beats the raster flow; nothing ships on weak numbers. With the switch off, every logo turn runs exactly as before.

## Deciding the method before the agent runs

`captureLogoGeometricTurn(dir, requestText, logoSet, enabled)` runs where the raster flow captures its expectation. It returns `null`, and the turn stays raster, when the switch is off, the project has no logo brief, the brief's type is drawn (pictorial, mascot, emblem), or the message carries no geometric action and no answers are on disk. Otherwise:

- `answer` writes `geometric/answers.json` canonically and drops every earlier approval, because new answers make the shown records stale.
- `approve` names a step and the SHA-256 of the record the person saw. It is recorded only when it matches the bytes on disk and the step is the current one.
- A plain message with answers on disk makes the current step again, with the message as guidance.

The result is `{ kind: "make", step, answers, note, record_file }` or `{ kind: "complete" }`. A refusal throws `LogoDeliverableError("geometric_<code>")` before any provider call (`geometric_unanswered`, `geometric_stale_record`, and `geometric_step_unavailable` for the wordmark and lockup steps, which arrive in phase 4).

## The turn

A geometric turn takes the ideation path: no raster expectation, trace or evidence; `imageGeneration: "forbidden"`; no continuation run; no `generationOutputComplete`, design review, three.js runtime or chart staging. The prompt builder replaces the raster phase contract with `<burnguard-logo-geometric-step-v1>` (the brief, the answers and any note as JSON with every `<` escaped) and a rules block that asks for exactly one file, the step's record.

After the agent, `assertLogoGeometricScope` allows only the step's record to change on a make turn and nothing on a completing turn; anything else is `geometry_scope`. Then `completeLogoGeometricTurn` runs:

1. Finish the symbol (compile, write `logo.svg` and the measured review). When it compiles, draw the three review renders.
2. Run one review pass in its own context, with `<burnguard-logo-geometric-review-v1>` carrying the measured findings and the render paths, or the refusal code when the record did not compile. The review may rewrite the record and nothing else.
3. When the record changed or the first finish was refused, finish again. A record still refused fails the turn with `geometry_<code>`.

A failed review run, a non-zero exit or a provider failure fails the turn; nothing is published.

## Rejection reasons

Two reasons join `TurnRejectionReason`: `logo_geometry_invalid` for every `geometry_*` detail (a refused record, a write outside the record) and `logo_geometric_step_refused` for every `geometric_*` detail. They are added to the sanitizer's closed set, the event-sequence repository, `ErrorCard` and the chat copy in ko, en and zh-CN.

## Tests

`packages/backend/tests/logo-geometric-turn.test.ts` covers capture (switch off, drawn types, answers, guidance, approval, three refusals), the scope rule, the escaped prompt block, and six real turns through `startUserTurn` with only the provider injected: made, repaired by the review, still broken, a stray file in the agent run, a stray file in the review run, and a stale approval. Six mutations were each caught: the switch on by default, the scope check removed, the prompt not escaped, the image tool allowed, the review pass skipped and the geometry reason unmapped.

Not yet measured: how well a live model writes and reviews records from this prompt. That is the twelve-brief measurement, run before the switch is turned on.
