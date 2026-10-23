# Faithful automatic SVG output, but the compactness target failed

Measured on 2026-10-23 KST, on hpdesk WSL with Bun 1.4.2 and the locked native canvas dependency. The retained TypeScript tracer needs no new runtime dependency, executable or WASM. Its frozen-set SVGs are **18.76 times larger** than vtracer polygon output, so this is a draft experiment, not a proven lighter replacement. No merge, release or version bump is included.

## Frozen 18-fixture comparison

| Engine | Mean IoU | Mean MAE (0..255) | Total SVG bytes | Total paths | Mean per-fixture median ms | Validator pass |
|---|---:|---:|---:|---:|---:|---:|
| ours | 0.993185 | 0.744014 | 2093464 | 113 | 114.37 | 18/18 |
| vtracer-polygon | 0.989460 | 1.306078 | 111615 | 581 | 113.33 | 0/18 |
| vtracer-spline | 0.988274 | 1.376647 | 426713 | 581 | 115.02 | 0/18 |

Means give each fixture equal weight; bytes and paths are sums. MAE is RGB error on the 0..255 scale after compositing onto white. IoU is foreground overlap using the predeclared 24/255 distance-from-white threshold. It is weak on dark-background artwork, so color error and rendered comparisons were also inspected.

Timing is three measured repeats after one warm-up per fixture. Ours includes in-process PNG decode and trace; reference timings include a fresh CLI process and file I/O. These are different execution boundaries, not evidence of a pure-engine speedup. The two tracer source modules total 13,558 UTF-8 bytes; this source-size measurement is not a RAM or binary-size comparison.

Reference: vtracer 1.0.0-alpha.4, revision e71343fbcbf469b8a72a255030408a39939162eb; visioncortex 0.9.3, studied revision 0062088c89645aac76c00e066deb7e8f53980dd7. Both reference modes use --max-colors 8; clustering, cleanup and fitting are not equivalent. In particular, our default speckle is four pixels of area, whereas upstream squares a four-pixel side length.

The reference validator check only injects the required source attribute. Every reference SVG then fails svg_viewbox_missing; this is a BurnGuard contract mismatch, not an inability to render. We did not sanitize or add a viewBox to improve its pass count. Tables count original reference SVG bytes: injecting provenance costs another 66 bytes per file, 1,188 bytes for 18 files. Polygon plus provenance totals 112,803 bytes, still much smaller than ours. Our totals already contain the viewBox and source attribute.

No AI-redrawn SVG files were found recursively in either supplied directory. AI comparison is N/A, not a claimed win.

## Acceptance and unsuccessful variants

- Validation: 18/18 passed, all under the existing 1 MiB per-file limit, with the selected-source attribute.
- Relative fidelity: 18/18 met IoU >= polygon reference - 0.02 and MAE <= reference + 3. No fidelity-threshold misses were hidden.
- Compactness: FAILED. Ours totals 2,093,464 bytes versus 111,615 reference bytes. Fewer compound path elements do not mean fewer contours or smaller files.
- A cumulative-mask experiment produced 2,737,760 bytes, mean IoU 0.990383 and MAE 0.781886. Adding upstream's area/perimeter thread rejection produced 2,767,964 bytes, IoU 0.990174 and MAE 0.822320. Both were worse than the retained disjoint masks and were removed. The same 18 inputs and identities were used each time.
- The final source was remeasured after selection. All IoU, MAE, byte counts, path counts and validation outcomes exactly match the first disjoint-mask run. The final modules also bound polygon-reduction distance evaluations.

## What was ported and what was dropped

Adapted vtracer/visioncortex's staged segmentation-to-vector pipeline, transparency separation, four-connected lattice-edge boundary walking with straight-run skipping, holes, and bounded-error polygon reduction. The polygon reduction follows the approach credited upstream to simplify-js, with an iterative work list and explicit work budget. MIT, Apache-2.0 and conservative BSD notices are retained in source, NOTICE and THIRD_PARTY_NOTICES.md; packaging includes the notice file.

Replaced hierarchical clustering with a deterministic RGB histogram and weighted palette fitting capped at eight colors. Dropped upstream cluster hierarchy, mosaic graph, least-squares cubic fitting, full parent-layer composition, watershed/photo modes, gradients and adaptive thresholding. The attempted thread rejection and cumulative masks were discarded after measurement. Optional local quadratic rounding is not the upstream spline fitter. This is a partial algorithm adaptation, not a byte-for-byte port of the entire engine.

Pure TypeScript reuses BurnGuard's existing native canvas decode path on the supported platforms. WASM or a Rust CLI would add packaging/build/runtime machinery; neither is shipped. This avoids dependency growth, but has not demonstrated smaller SVGs or lower memory usage.

## Integration and regression evidence

On explicit candidate selection, turns.ts pins the expectation, verifies the candidate file and digest, and stages logo.svg and the manifest selection before invoking the AI adapter. The SVG passes the existing allowlist. A ready context tells the adapter to reuse it for guidelines; expected input, empty-output or budget failures retain the existing AI vectorization route. Explicit AI tidy-up remains possible. Unexpected errors still fail, and publication, provenance, originality, cancellation, repair and rollback checks remain in charge.

The supplied candidate PNGs contain a caBX C2PA chunk with an embedded SVG string. Native canvas loaded the file path successfully but misclassified the byte buffer as SVG. Removing only text/EXIF did not fix it. Decode now retains pixel, transparency and color-management chunks while dropping non-rendering metadata; the pinned original file and digest stay unchanged. Unit regressions cover tEXt and caBX.

Final checks:

- 425 tests passed across all 18 logo-related test files, including the real ArtifactCoordinator turn with an adapter that writes guidelines but no SVG or manifest selection. A separate real-turn case exceeds the tracing pixel budget and succeeds through AI-authored fallback output.
- Workspace typecheck and OS-matrix coverage guard passed. No tests were skipped, weakened or suppressed to reach green.
- Mutation proof: changing binary threshold < to <= made the equality-boundary test fail (one failing assertion); restoring it passed the final suite.
- Native-size fixture comparison rendered all 23 inputs through each of the three engines. The dori, sisyphus and synthetic comparison sheets were inspected: the original symbols, lettering and holes remain recognizable; polygon circles still have visibly angular edges. This is not a packaged desktop-app or provider-inference test.
- Windows and macOS CI on the eventual pushed head and native desktop packaging were not run locally. The new tests are listed in both OS and security workflows as required by AGENTS.md.

## Fixed data and reproduction

The original scripts/logo-tracer-fixtures.json preserves all 18 SHA identities: eight dori logos, four sisyphus illustrations and six fixed synthetic marks. The five other PNGs matched by the requested dori glob have a separate supplemental lock: three earlier candidates and two UI screenshots. They are reported below, not pooled into the frozen acceptance score. Both screenshots are deliberately retained as stress cases, not relabeled as logos.

Original artwork remains external and is not redistributed by this change. Keep the six originally frozen synthetic PNGs too: rasterizing their circles again on Linux changes two PNG hashes. The optional last argument reuses the exact frozen PNG bytes across OS/CPU architectures rather than rewriting the lock.

```sh
bun scripts/measure-logo-tracer.ts "$DORI_DIR" "$MERCH_DIR" "$RUN_DIR" "$VTRACER_CLI" "$FROZEN_SYNTHETIC_DIR"
bun test packages/backend/tests/logo-*.test.ts packages/backend/tests/prompt-logo-set.test.ts packages/backend/tests/css-logo-check.test.ts
bun run typecheck
bun scripts/qa/check-os-matrix-coverage.ts
```

## Frozen per-fixture measurements

| Fixture | Engine | IoU | MAE (0..255) | SVG bytes | Paths | Median ms | Validation |
|---|---|---:|---:|---:|---:|---:|---|
| dori-idea-1 | ours | 0.994847 | 0.286678 | 26634 | 8 | 127.92 | pass |
| dori-idea-1 | vtracer-polygon | 0.988642 | 1.265678 | 2399 | 7 | 88.43 | svg_viewbox_missing |
| dori-idea-1 | vtracer-spline | 0.988854 | 1.330564 | 7306 | 7 | 83.23 | svg_viewbox_missing |
| dori-idea-2 | ours | 0.993120 | 0.303177 | 28661 | 8 | 99.96 | pass |
| dori-idea-2 | vtracer-polygon | 0.988554 | 1.382081 | 2386 | 7 | 98.78 | svg_viewbox_missing |
| dori-idea-2 | vtracer-spline | 0.986481 | 1.520285 | 8602 | 7 | 86.13 | svg_viewbox_missing |
| dori-idea-3 | ours | 0.995908 | 0.270310 | 25166 | 8 | 101.59 | pass |
| dori-idea-3 | vtracer-polygon | 0.989132 | 1.295749 | 2304 | 8 | 93.53 | svg_viewbox_missing |
| dori-idea-3 | vtracer-spline | 0.991358 | 1.314856 | 7891 | 8 | 85.15 | svg_viewbox_missing |
| dori-v2-candidate-1 | ours | 0.984191 | 1.043318 | 163524 | 8 | 170.92 | pass |
| dori-v2-candidate-1 | vtracer-polygon | 0.977231 | 1.552093 | 7404 | 28 | 167.34 | svg_viewbox_missing |
| dori-v2-candidate-1 | vtracer-spline | 0.973122 | 1.695409 | 21985 | 28 | 179.71 | svg_viewbox_missing |
| dori-v2-candidate-2 | ours | 0.984613 | 1.088570 | 178485 | 8 | 181.73 | pass |
| dori-v2-candidate-2 | vtracer-polygon | 0.978845 | 1.634515 | 7999 | 35 | 183.89 | svg_viewbox_missing |
| dori-v2-candidate-2 | vtracer-spline | 0.977205 | 1.697793 | 24779 | 35 | 180.87 | svg_viewbox_missing |
| dori-v2-candidate-3 | ours | 0.981700 | 1.063989 | 157298 | 8 | 169.80 | pass |
| dori-v2-candidate-3 | vtracer-polygon | 0.978186 | 1.588011 | 7842 | 34 | 179.35 | svg_viewbox_missing |
| dori-v2-candidate-3 | vtracer-spline | 0.976816 | 1.656914 | 24363 | 34 | 179.23 | svg_viewbox_missing |
| dori-v2-candidate-4 | ours | 0.985919 | 1.021374 | 151136 | 8 | 165.83 | pass |
| dori-v2-candidate-4 | vtracer-polygon | 0.980186 | 1.564791 | 7863 | 39 | 175.94 | svg_viewbox_missing |
| dori-v2-candidate-4 | vtracer-spline | 0.977116 | 1.684062 | 23614 | 39 | 203.90 | svg_viewbox_missing |
| dori-candidate-4 | ours | 0.987534 | 1.040385 | 162651 | 8 | 171.41 | pass |
| dori-candidate-4 | vtracer-polygon | 0.981472 | 1.596051 | 7487 | 37 | 181.15 | svg_viewbox_missing |
| dori-candidate-4 | vtracer-spline | 0.978169 | 1.731229 | 22904 | 37 | 174.60 | svg_viewbox_missing |
| sisyphus-1 | ours | 0.995065 | 1.690106 | 339764 | 8 | 216.25 | pass |
| sisyphus-1 | vtracer-polygon | 0.992534 | 2.516045 | 23871 | 158 | 253.01 | svg_viewbox_missing |
| sisyphus-1 | vtracer-spline | 0.992353 | 2.620343 | 103745 | 158 | 269.23 | svg_viewbox_missing |
| sisyphus-2 | ours | 0.995238 | 1.739223 | 342219 | 8 | 207.66 | pass |
| sisyphus-2 | vtracer-polygon | 0.993376 | 2.390127 | 16105 | 84 | 218.73 | svg_viewbox_missing |
| sisyphus-2 | vtracer-spline | 0.993053 | 2.503788 | 67217 | 84 | 225.41 | svg_viewbox_missing |
| sisyphus-3 | ours | 0.996166 | 1.527482 | 283075 | 8 | 199.02 | pass |
| sisyphus-3 | vtracer-polygon | 0.993674 | 2.373769 | 13297 | 74 | 207.37 | svg_viewbox_missing |
| sisyphus-3 | vtracer-spline | 0.993428 | 2.489874 | 61265 | 74 | 208.77 | svg_viewbox_missing |
| sisyphus-4 | ours | 0.996873 | 1.300659 | 231749 | 8 | 194.92 | pass |
| sisyphus-4 | vtracer-polygon | 0.995080 | 1.896211 | 10632 | 57 | 178.25 | svg_viewbox_missing |
| sisyphus-4 | vtracer-spline | 0.994960 | 1.978620 | 49698 | 57 | 180.20 | svg_viewbox_missing |
| rectangle | ours | 1.000000 | 0.000000 | 307 | 2 | 1.68 | pass |
| rectangle | vtracer-polygon | 1.000000 | 0.000000 | 283 | 2 | 2.45 | svg_viewbox_missing |
| rectangle | vtracer-spline | 1.000000 | 0.000000 | 409 | 2 | 2.42 | svg_viewbox_missing |
| ring | ours | 1.000000 | 0.000000 | 342 | 2 | 10.97 | pass |
| ring | vtracer-polygon | 1.000000 | 0.000000 | 328 | 2 | 2.72 | svg_viewbox_missing |
| ring | vtracer-spline | 1.000000 | 0.000000 | 557 | 2 | 2.92 | svg_viewbox_missing |
| diagonal | ours | 1.000000 | 0.000000 | 335 | 2 | 10.49 | pass |
| diagonal | vtracer-polygon | 1.000000 | 0.000000 | 306 | 2 | 2.17 | svg_viewbox_missing |
| diagonal | vtracer-spline | 1.000000 | 0.000000 | 465 | 2 | 2.07 | svg_viewbox_missing |
| thin-cross | ours | 1.000000 | 0.000000 | 355 | 2 | 10.66 | pass |
| thin-cross | vtracer-polygon | 1.000000 | 0.000000 | 321 | 2 | 2.12 | svg_viewbox_missing |
| thin-cross | vtracer-spline | 1.000000 | 0.000000 | 579 | 2 | 2.03 | svg_viewbox_missing |
| three-color | ours | 1.000000 | 0.357971 | 1217 | 8 | 13.61 | pass |
| three-color | vtracer-polygon | 1.000000 | 0.326518 | 457 | 4 | 3.08 | svg_viewbox_missing |
| three-color | vtracer-spline | 1.000000 | 0.366475 | 885 | 4 | 2.76 | svg_viewbox_missing |
| transparent-disk | ours | 0.986158 | 0.659017 | 546 | 1 | 4.17 | pass |
| transparent-disk | vtracer-polygon | 0.973362 | 2.127767 | 331 | 1 | 1.58 | svg_viewbox_missing |
| transparent-disk | vtracer-spline | 0.966010 | 2.189433 | 449 | 1 | 1.65 | svg_viewbox_missing |

## Supplemental measurements

| Fixture | Engine | IoU | MAE (0..255) | SVG bytes | Paths | Median ms | Validation |
|---|---|---:|---:|---:|---:|---:|---|
| supplemental-candidate-1 | ours | 0.986815 | 0.993369 | 149067 | 8 | 588.23 | pass |
| supplemental-candidate-1 | vtracer-polygon | 0.983592 | 1.859138 | 5850 | 28 | 137.01 | svg_viewbox_missing |
| supplemental-candidate-1 | vtracer-spline | 0.981719 | 1.893289 | 17982 | 28 | 138.64 | svg_viewbox_missing |
| supplemental-candidate-2 | ours | 0.979000 | 1.030305 | 154719 | 8 | 210.83 | pass |
| supplemental-candidate-2 | vtracer-polygon | 0.980265 | 1.940741 | 5619 | 30 | 143.01 | svg_viewbox_missing |
| supplemental-candidate-2 | vtracer-spline | 0.977534 | 2.003685 | 18018 | 30 | 155.66 | svg_viewbox_missing |
| supplemental-candidate-3 | ours | 0.985940 | 1.050513 | 173678 | 8 | 179.31 | pass |
| supplemental-candidate-3 | vtracer-polygon | 0.982748 | 1.946691 | 6356 | 38 | 145.87 | svg_viewbox_missing |
| supplemental-candidate-3 | vtracer-spline | 0.980876 | 2.010673 | 20280 | 38 | 139.78 | svg_viewbox_missing |
| supplemental-access-expired | ours | 0.942330 | 0.103460 | 61908 | 8 | 316.47 | pass |
| supplemental-access-expired | vtracer-polygon | 0.749177 | 1.319341 | 16770 | 170 | 184.91 | svg_viewbox_missing |
| supplemental-access-expired | vtracer-spline | 0.745224 | 1.323583 | 53963 | 170 | 186.14 | svg_viewbox_missing |
| supplemental-failure-panel | ours | 0.628590 | 1.782800 | 394034 | 8 | 420.21 | pass |
| supplemental-failure-panel | vtracer-polygon | 0.718692 | 5.925979 | 114830 | 1028 | 849.05 | svg_viewbox_missing |
| supplemental-failure-panel | vtracer-spline | 0.702340 | 6.008122 | 435183 | 1028 | 964.00 | svg_viewbox_missing |

## Scope and remaining risks

Restored the pre-existing design-system text in DESIGN.md instead of replacing it. Removed duplicate attribution and unused competing trace-state plumbing. Kept the two one-line CI additions: repository policy requires every new test file on Ubuntu, macOS and Windows. Kept only source verification, tracing, prompt integration, notices, packaging selection, tests and the fixed-data measurement tools.

Output can remain large because flat palette masks retain many antialias contours. Eight colors, alpha thresholding and polygon approximation do not reproduce arbitrary gradients or translucent artwork. Optional AI tidy-up still carries its existing failure risk, and guidelines still come from the adapter. Neither the compactness failure nor absent cross-platform CI is a release approval.

The compactness QA row fails. This draft does not claim a passing production gate review.
