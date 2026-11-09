# The server side of one geometric logo step

Dated record, 2026-11-09. Describes `packages/backend/src/services/logo-geometric-step.ts`, the backend half of phase 3 of the geometric logo method. It reads the flow's state from disk for the contract in `28-logo-geometric-flow-2026-11-09.md`, turns the model's symbol record into the mark, runs the measured review from `27-logo-geometry-review-2026-11-09.md`, and draws the images the model looks at in its review pass. Connecting it to a turn (prompt, repair pass, approval actions) is the next record.

## Files

```text
geometric/answers.json                    backend   the two answers (doc 28)
geometric/approvals.json                  backend   per step, the record hash the person approved
logo-geometry.json                        model     the symbol record (doc 24)
geometric/wordmark.json                   model     the wordmark record (phase 4)
geometric/lockup.json                     backend   the lockup record (phase 4)
logo.svg                                  backend   the compiled mark
geometric/symbol-review.json              backend   the measured review of one record
geometric/review/symbol-1024.png          backend   the mark at 1024 px
geometric/review/symbol-16.png            backend   the mark at 16 px
geometric/review/symbol-construction.png  backend   the finished construction sheet at 1024 px
```

The model writes geometry and nothing else. `logo.svg` holds the compiled path, never anything the model drew.

## Reading the state

`readLogoGeometricState(dir)` returns the `LogoGeometricFilesState` that `resolveLogoGeometricTurn` and `logoGeometricPlan` take. Every file is read with the pipeline's usual rules: contained under the project root, a regular file with one link, not empty, at most 64 KiB. Anything else, including a malformed answers or approvals file, is absent state rather than a throw. A step's `record_sha256` is the SHA-256 of the bytes on disk.

`recordLogoGeometricApproval(dir, step, sha256)` keeps the other steps' approvals and writes canonical bytes: steps in flow order, two-space JSON, one trailing newline. An approvals file with an unknown step or a malformed hash is refused as a whole.

## Finishing the symbol

`finishLogoGeometricSymbol(dir, label)` parses and compiles `logo-geometry.json`. A refused record returns `{ kind: "refused", code, path }` with the parser's or compiler's stable code (`record_missing`, `invalid_json`, `empty_shape`, ...) and writes nothing. A compiled record writes `logo.svg`, with the label escaped for its attribute, and `geometric/symbol-review.json`:

```json
{ "schema_version": 1, "record_sha256": "<hash of the record bytes>", "passed": true, "findings": [], "snapped": [] }
```

The review names the bytes it describes, so a review left over from an earlier record is visibly stale.

## Review images

`renderLogoGeometricSymbol` draws the three images with `@napi-rs/canvas` through `export-native-modules`, loaded on first use so a server that never makes a geometric mark never loads it. Each SVG gets the target pixel size before rasterizing: a viewBox-only SVG rasterizes at its 64-unit intrinsic size and would be stretched into a blurred image.

## Evidence

`packages/backend/tests/logo-geometric-step.test.ts`: 9 pass. It covers the empty state, hashes of the bytes on disk, malformed answers and approvals, a hard-linked record, canonical approvals, the two-bowl B compiling to a passing review, a planted sliver with an off-grid centre, three refusals that write nothing, and the three images (sizes, ink and paper pixels, and a sharp stem edge at 1024 px). Each of these mutations fails a test: hard links allowed, the label left unescaped, an unknown approval step kept, approvals in arbitrary order, a review not bound to the record's bytes, and the images rasterized without a target size.
