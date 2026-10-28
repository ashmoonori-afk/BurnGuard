# Fixed image fixture data, version 1

This is executable input data, not an extraction implementation or a generated-case suite.
The fixed set has 40 cases: 19 synthetic colour-truth cases, 18 rejection cases,
two existing SVGs with source-colour-only expectations and one existing WebP preview
with determinism-only expectations. All 35,670 image bytes are embedded as base64.

## Files and consumption

- `policy.json` freezes colour semantics, format-specific OKLab tolerances and limits.
- `cases.json` supplies manually labelled source geometry, anchors and dispositions.
- `payloads.json` supplies exact bytes, MIME types, lengths and SHA-256 by case ID.
- Private producer validation records live outside this corpus in ignored evidence.

Join cases and payloads by `id`, decode the base64 and verify its length and SHA-256.
Never reload assets from provenance paths, re-encode inputs, fetch references or generate
new cases during measurements. Source paths point to the A tree at preparation time.
Changes require a new corpus version rather than silent changes to this benchmark.

Rectangles are `[x, y, width, height]`, integer and half-open. Regions form a complete,
non-overlapping partition. RGBA is straight/unassociated sRGB in integer 0..255 units.
Counts describe the authored source regions, not a decoded lossy histogram or a promised
engine segmentation. `anchors` is an unordered role-aware expected colour set; its length
is not an expected engine cluster count. No ranking or dominance ratio is asserted.
Null anchors mean colour accuracy is unestablished; an empty set means no expected anchor.

## Alpha and topology

PNG alpha-zero samples intentionally retain RGB `[17,231,99]` in the encoded stream.
Canvas readback discards those hidden channels, so validation also inflates PNG IDAT and
checks every original straight RGBA sample. The clean-alpha and hidden-RGB blue logos
have identical visible pixels and expected anchors. Partial alpha is 128 for red and
64 for blue; compare uncomposited RGB with alpha handled as coverage, not black/white
matting. WebP hidden RGB is not an exactness contract because its encoder may discard it.

The red-border fixture contains 1,792 edge-connected red background pixels, a separate
256-pixel enclosed red foreground square and 2,048 blue foreground pixels. Removing all
red merely because red touches the border would lose known foreground truth. White,
black and gray logos on transparent backgrounds are foreground, not discarded neutrals.
All-transparent and uniform opaque no-foreground controls are separate cases.

## Colour and rejection contracts

OKLab distance uses unscaled L in 0..1. Tolerances were written before image encoding
or any engine implementation; they were not tuned to decoder measurements. Lossy JPEG
and WebP comparisons target the listed flat interior probes, not edge ringing or a
full-image pixel bound. Validation reports pointwise colour checks only; no clustering
or extraction was built. Source RGB, role labels and geometry remain the colour truth.

Oversized headers are intentionally header-only, with explicit claimed dimensions.
Do not allocate those images. The APNG and WebP animations contain two actual complete
frames, not just animation flags; the expected future policy is rejection. Hostile SVGs
contain inert test references to invalid domains or nonexistent root-level files. Inspect
their bytes only: never render, dereference or resolve them. A local `xlink:href` fragment
is the positive reference control. Rejection reasons are fixture categories, not API codes.

## Limits of the evidence

The 22 safe images decode twice with identical pixels on this Linux host. Those observed
RGBA hashes are diagnostic evidence, not cross-platform goldens. Original byte hashes
are normative. Existing SVG font coverage is not established; their literal fill colours
are recorded without extraction anchors. The existing 1440x960 WebP preview has no
claimed colour truth. JPEG/WebP decoding uses the installed native canvas package,
also used for encoding; a separate second codec implementation was not available.

No feature code, extraction code, runtime scripts, installs, commits, full tests or
browsers are part of this change. The private validation receipt records temporary cache isolation
and cleanup; all authored files are JSON or text written with apply_patch.
