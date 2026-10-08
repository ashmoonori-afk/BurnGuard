Fixes review finding B1-7 (BurnGuard review 2026-10-08).

## Root cause
`validateHtmlArchive` unpacked HTML export archive entries into its temporary stage with `path.join(stage, entry.path)`. Every other archive writer in the tree contains writes through `resolveWithin` (e.g. `export-platform-package.ts`, `project-bundle-archive.ts`); this was the one extraction path relying solely on `safeArchivePath`.

## Change
- `packages/backend/src/services/export-html-validation.ts`: resolve each entry target with `resolveWithin(stage, ...entry.path.split("/"))` instead of `path.join(stage, entry.path)`.
- `packages/backend/tests/export-validation.test.ts`: new case feeding a `../`-named and an absolute-named archive entry through `validateHtmlArchive`.

## Verification
- `flock /tmp/bgfix-tsc.lock bun run typecheck` -> exit 0
- `bun test --timeout 30000 packages/backend/tests/export-validation.test.ts` -> 77 pass, 0 fail
- `bun test --timeout 30000 packages/backend/tests/path-boundary.test.ts` -> 28 pass, 0 fail
- `bun scripts/qa/check-os-matrix-coverage.ts --base-ref origin/main` -> 0 problems
- `bun scripts/qa/check-flake-patterns.ts` -> 0 problems
- `bash tools/hangul-gate.sh` -> OK

## Note on defence-in-depth reachability
The new test cannot reach the `resolveWithin` line directly: JSZip's loader already resolves any `..` component before the validator sees the name, so a `../` entry is neutralised to a basename before `safeArchivePath` or `resolveWithin` run. This was confirmed against a raw crafted zip too. The test therefore pins the combined observable behaviour: the `../` entry is contained inside the temporary stage (nothing appears at the traversal target in the temp root), and an absolute entry name, which does survive the loader, is rejected with the typed `HtmlExportValidationError` code `unsafe_entry`. The `resolveWithin` change is defence in depth for a future regression in `safeArchivePath` or a future reuse of `validateHtmlArchive` on imported zips.

## Not changed
- `safeArchivePath` is unchanged; it already rejects `..`, absolute and backslash names.
- No other extraction or publication path touched.
