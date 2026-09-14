# Task Preset Implementation and Evidence Gates

Date: 2026-09-14. Implementation status for [doc/18](18-design-task-and-reasoning-presets-plan-2026-09-14.md).

## Shipped behavior

The existing generation path selects draft task guidance by validated backend/provider route, exact model or alias, effort, and deliverable. The model and effort selected by the user remain unchanged. Shared craft cleanup, the 4,000-character envelope budget, bounded turn observations, and the localized settings hint are implemented. Original security, image approval, staging, and publication authority remain in the existing service.

Every shipped combination is still draft. The reviewed example corpus and adoption table are empty. No live stronger-model example or comparison establishes improved LOW design quality.

## Example selection and rollback

`REVIEWED_TASK_EXAMPLES` is the registry's single example data source. An example is eligible only for the exact route/base-preset/deliverable at LOW effort, and only when an enabled adoption says `example: "on"` or a QA registry explicitly enables development examples. Production does not enable development examples. An explicit adoption saying off, or a disabled adoption, overrides development mode as well. Removing a production adoption falls back to the draft preset without the example.

CI runs the committed corpus/evidence tests. Each populated cell must name an existing preset, contain at most 600 characters of example text, and have a matching receipt at:

```text
doc/evidence/task-presets/examples/<reviewEvidenceId>.json
doc/evidence/task-presets/examples/objects/<sha256>
```

The receipt must match the cell's route, base preset, LOW effort, deliverable, example ID, exact text hash, and evidence ID. Every referenced artifact tree/archive, audit, observation, screenshot, and mandatory-check object must exist and hash to its declared digest. CI reads these through the existing path containment helper. Prompt and invocation hashes identify the source run; raw prompts are not retained by this gate.

The recognized policy is `task-presets-v1`, with explicit required checks for prototypes, slide decks, and graphics in [task-preset-evidence.ts](../scripts/qa/task-preset-evidence.ts). Missing, duplicated, unknown, nonpassing, or unsupported-policy checks fail promotion. At least one screenshot and human approval of a completed development case are required. Generic and standalone diagram examples need a future reviewed policy. Hash matching establishes identity and integrity; a human still verifies visual quality and the truth of the supplied observations.

Keep evidence sanitized and scoped to the example. Never commit private paths, credentials, raw prompts, or user uploads. A passing test cannot substitute for the actual run or human review.

## Comparison CLI: planning, not collection

The comparison CLI describes the experiment arms. It does not execute models, import previous runs, export artifacts, or produce review receipts. Its current results are:

| Invocation | Result | Exit |
|---|---|---|
| Without `BG_TASK_PRESET_SMOKE=1` | `skipped / opt_in_required` | 0 |
| Opt-in `--mode examples` | `blocked / live_collection_not_implemented` | 2 |
| Opt-in `--mode compare` (includes original LOW) | `blocked / pre_p0_archive_required` with the pinned source revision | 2 |
| Opt-in `--mode compare --condition task-low --condition post-low` | `planned`, `execution_status: not_run` | 0 |

The original control is pinned to Git revision `5ace81b40e25573e61f106a138149f3923144172`, before preset/shared-craft changes. A future isolated executor must reconstruct that full prompt path. It must not report the cleanup arm as the original control. The cleanup arm retains the original model execution instructions byte for byte; a frozen fixture checks Codex, Claude, Opus, and CommandCode routes.

## Remaining doc/18 work

- Implement isolated live case execution, artifact collection, and the original-baseline archive path.
- Produce and review stronger-model development examples, then commit qualifying corpus entries with verified evidence.
- Run the planned development/holdout comparisons, score actual outputs, and record timing and available usage measurements.
- Adopt only qualifying combinations using the measured results.

These are remaining P1 experiment tasks, not completed collection or performance claims. The new CI gate validates prompt behavior and evidence integrity independently of live provider access.
