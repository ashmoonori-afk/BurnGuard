# Fixed theme-engine corpus, version 1

This corpus is QA input, independent of the future theme engine. Reuse the exact
numeric inputs, labels, image bytes and tolerances in every measurement round.
Do not regenerate cases from implementation output or adjust truth to fit it.

## Inventory and truth boundaries

- `baseline/`: 43 registered brand-role anchors, 144 captured exported rows,
  54 boundary rows and 8,192 fixed RGB lattice inputs (4,096 per gamut).
  `calibration.json` adds 12 fresh requested/delivered anchor comparisons and one
  separately marked gamut-switch observation (`comparison: false`).
- `images/`: 40 embedded payloads with byte hashes: 19 known-colour, 18 negative,
  two source-colour-only and one determinism-only case. Refer to its README for
  alpha semantics and preregistered tolerance limitations.
- `audit/`: 150 manually labelled assertions across five categories, each with
  14 positives, 14 negatives and two unresolved cases. The `.tsx.txt` carrier
  preserves TSX source bytes without entering backend TypeScript compilation.
  `validate.mjs` checks anchors and metadata, not detector accuracy.

Raw rendered captures and producer execution records belong in the lead clone's
ignored `.omo/evidence/bg-themes-1028/` directory, not in these test inputs.
`baseline/legacy-inventory.json` records repo-relative provenance and exact source
hashes; those external source files are not copied into this manifest. Captured
reference rows retain numerical values, not reference-site attribution or URLs.
The freeze CLI never imports production code or fetches sources.

## Freeze and verify

Run from the repository root with Bun:

```sh
bun scripts/qa/theme-engine-fixtures.ts freeze
bun scripts/qa/theme-engine-fixtures.ts verify
bun scripts/qa/theme-engine-fixtures.ts verify --root <owned-corpus-copy>
node packages/backend/tests/fixtures/theme-engine/audit/validate.mjs
```

`manifest.json` records every other regular file's repo-portable relative path,
exact byte length and SHA-256, in lexical path order. It excludes itself.
Freeze creates it exclusively once and refuses any existing manifest; there is
no overwrite or re-freeze option. Verify is read-only and rejects extra, missing,
resized or changed files, symbolic links, non-regular entries and malformed
manifests. Private `validation.json` execution records are forbidden in the tree.
Keep the reviewed manifest with the reviewed corpus: it is a content commitment,
not an authentication mechanism against replacement of both data and manifest.

## Hostile input references are intentional data

The image negatives contain synthetic `theme-fixture.invalid` network references,
root-level `file:///theme-fixture-do-not-read.*` references, an embedded data URI
and an external entity. They are not real host paths or source-site attribution.
SVG/XML namespace URIs and a local fragment are also intentional payload syntax.
Never fetch or render the hostile cases. No real developer home or owned
execution-temp path belongs in publishable corpus text.
