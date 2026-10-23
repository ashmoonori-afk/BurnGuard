# BurnGuard Design System

## Product stance

BurnGuard is a local-first design workspace, not a generic AI chat shell. The
canvas is the primary surface; chat, inspection, edits, comments, and undo are
supporting tools that should keep the user's visual context intact. The
interface should feel precise, quiet, and reversible.

The visual direction combines premium utilitarian minimalism with Linear-like
workspace precision. The existing blue brand accent remains the action color;
neutral surfaces carry hierarchy so a selected artifact is more important than
the chrome around it.

## Tokens

### Color

- `background`: `#ffffff`
- `foreground`: `#17191a`
- `muted`: `#f1f3f5`
- `muted-foreground`: `#5e646c`
- `border`: `#dce4ea`
- `accent`: `#004fff`
- `accent-soft`: `#ecf4ff`
- `success`: `#00ce78`
- `warning`: `#fca63d`
- `danger`: `#d92d20`
- `canvas-ink`: `#111111`

The semantic CSS bindings `--success`, `--success-foreground`, `--warning`,
and `--warning-foreground` expose the existing success and warning palette
through Tailwind's `rgb(var(--token) / <alpha-value>)` convention.

Use semantic Tailwind tokens instead of new one-off colors. Accent is reserved
for the next meaningful action, selection focus, and keyboard focus rings.
Danger is reserved for destructive or unrecoverable states.

Alert copy on a `destructive/10` tint uses `text-foreground` with a
`destructive/30` border: the tint and border carry the semantic while the copy
itself stays above the 4.5:1 contrast floor. Danger-colored text is reserved
for icons, borders, and large or bold labels.

### Type

- UI: the existing system sans stack, with `font-sans` and normal sentence
  case for user-facing copy.
- Artifact metadata and selectors: `font-mono`, compact, and scannable.
- Labels: 10–12px uppercase only for secondary section labels; never use
  uppercase for primary actions or instructions.
- Body line-height: at least 1.45. Do not use tracking-tight for body copy.

### Shape and spacing

- 1px borders use `border-border`.
- Functional controls use 6–8px radii; badges may use full rounding.
- Use the existing 4px spacing scale. Keep panel gutters at 12–16px.
- Keep the canvas free of decorative cards; use one clear work surface and
  one contextual inspector.

## Component anatomy

- **NewProjectPanel**: one prominent idea field, an editable suggested name,
  optional audience, and inline design-system suggestions. The full picker opens
  only through Browse all and preserves the brief. Attachments stay visible;
  detailed fields share one collapsed Advanced section without changing their
  limits or defaults. Create and generate admits one first message, preserves the
  draft if sending fails, and never sends an empty request.
- **FirstRunGuide**: a dismissible, nonmodal home card only before a user has
  created a project. Reuse provider detection and distinguish signed-in,
  signed-out, unknown, failed-probe, and missing states. Its compact creation
  form keeps optional identity, attachments, and detailed controls in Advanced;
  the normal creation entry remains available. Successful creation or explicit
  dismissal hides the guide persistently when browser storage is available.
- **CanvasTopBar**: mode controls, refresh, and file-level undo. Each action
  has an accessible name and a disabled state when unavailable.
  Website surfaces also offer Fit, Desktop (1440), Tablet (768), and Phone
  (390 CSS pixels). These change only the viewport width of the mounted
  preview, never its document or model output. Fixed artboards keep their
  geometry. Selected presets use a neutral wash and pressed state. The toolbar stays on
  a single row: when space is narrow, presets and history move into the More menu.
  Wide previews scroll inside the canvas.
- **SelectorOverlay**: hover and selected bounds. Selection must preserve
  element identity, computed styles, and an authoring anchor when one exists.
- **SelectorReadOnlyPanel**: selected identity and computed/token context. When
  the authoring anchor is available, it exposes the next inline action without
  forcing the user to reselect the element in another mode.
- **TweaksPanel**: focused, editable token controls. Save is an explicit
  checkpoint; reset and undo remain visible and reversible.
- **CommentPanel**: contextual feedback tied to an artifact path and optional
  slide index. Resolved comments leave the active queue.
- **QuickComment**: Alt/Option+C over a loaded canvas opens the existing memo
  editor beside the pointer, without changing canvas mode. Its viewport portal
  stays unscaled and inside screen edges. Creation shows an immediate pending
  state, then focuses the memo; repeated keys never create additional pins.
  Escape closes and saves the draft. Refresh/file changes dismiss stale context
  while preserving edited text through the existing comment save path. Editable
  controls retain Alt/Option+C, including inside the opaque-origin sandbox.
- **RevisionThumbnails**: two equal columns captioned before and after, using
  the existing 640-by-360 preview with contain fitting, muted fallback text,
  semantic borders and the 4px spacing scale. Each side keeps its own failed
  source and bounded preview retry state. Expired or missing revisions never
  substitute the live artifact. The history dialog owns scrolling.
- **ChatPane**: intent entry and streaming state. Chat must not obscure the
  artifact or imply a completed update before the backend event arrives.
  Each queued PDF/PPTX owns a stable item identity and an explicit ordinary
  content or immutable visual-reference role. Existing managed visual files
  are disclosed as editable-only; unsupported network sources are named
  without presenting a false selection action.
- **GraphicCanvas**: one finite, server-owned artboard with persisted CSS-pixel
  width and height. Graphic projects never use slide structure or deck runtime;
  their truthful delivery action is a DPR-1 PNG at the exact persisted size.
  Creation offers editable bounded dimensions and named presets without hiding
  the 16-million-pixel ceiling. In the canvas sandbox only, the exact artboard
  scales down without upscaling and centres on a neutral letterbox; this preview
  transform never changes the served artifact or export geometry.
- **QualityPanel**: one fixed status/action header above a bounded, vertically
  scrolling findings body. Findings remain ordered as must-fix, recommended,
  unknown, then a collapsed explicit-pass count. Technical evidence is bounded
  and monospaced; skipped and unmeasurable checks are never presented as pass.
  Audit reruns and safe fixes are mutually exclusive; reduced motion keeps the
  textual progress signal while suppressing spinner motion.
- **QualityLayer**: a reveal-only accent outline requested once through the
  frame bridge for the active file and node. It never owns hit testing or polls.

## State and interaction rules

- First run: explain the canvas and the next action without blocking creation.
- Empty: provide one clear action and avoid fake content.
- Loading: preserve the last stable artifact while showing what is pending.
- Error: name the failed operation, preserve the user's input, and offer retry
  or recovery. Never fail silently.
- Saving: disable duplicate submission and show a local checkpoint state.
- Saved: surface the changed artifact and make undo discoverable.
- Cancelled/interrupted: keep the last stable artifact and make retry safe.
- Keyboard: every toolbar action and inspector control is reachable in order;
  focus is visible with the accent ring.
- Reduced motion: state changes remain understandable without transitions.
- One modal at a time: platform export guides open as a step view with a Back
  button inside the export details dialog, and closing the dialog returns focus
  to the Export button.

## Motion

Use short opacity/color transitions for mode changes and selection feedback.
Avoid layout movement during streaming. Under `prefers-reduced-motion: reduce`,
remove non-essential transitions and preserve the same visible state changes.

## Responsive behavior

- The project route is capped to the viewport (`h-dvh`, `overflow-hidden`).
  The document never scrolls: the project top bar and every panel header stay
  in place, and each pane owns exactly one scrollport. Document-shaped routes
  (home, settings, systems) keep normal page scrolling.
- Desktop: chat, canvas, and the contextual inspector share the viewport
  without nested horizontal scrolling.
- Narrow viewport (below lg): mode panels open over the canvas as a bottom sheet
  sized to their content up to 65% height; controls remain at least 44px high where touch is plausible. At
  widths up to 900px, every canvas mode action is at least 44px high.
- At widths up to 900px chat, canvas, and the inspector share the capped
  height instead of scrolling the page: chat and the inspector shrink, the
  canvas keeps a 192px floor, and each pane scrolls inside itself.
- The artifact tab strip centres the active tab group — label and close button
  together — inside its scrollport whenever the strip overflows, with an edge
  fade and proximity snapping as the overflow affordance.
- Korean Quality copy uses keep-all wrapping. The panel and toolbar must not
  introduce horizontal overflow; the findings body owns bounded panel scroll.
  Auxiliary units (`-고 있다`, `-지 않다`, `-ㄹ 수 없다`) are bound with U+00A0
  so an ending never orphans onto its own line, and status/banner paragraphs
  add `text-pretty`.
- Long selectors and file paths truncate visually but remain available in a
  `title` or accessible description.

## Evidence expectations

Interface language is a local preference: Korean, English, or Simplified Chinese.
Changing it updates application chrome without rewriting user or generated
content. Language controls use endonyms and visible selected states. Keep-all
wrapping is Korean-only; Chinese must wrap between characters, and longer English
labels must remain usable in narrow panels. Locale-aware dates follow this
preference rather than the operating system language.

Every new behavior needs a focused RED -> GREEN proof and a real app scenario.
Visual review covers desktop and narrow viewport screenshots, keyboard focus,
empty/loading/error/recovery states, and reduced motion. Generated artifacts
must remain understandable on disk and reversible through the existing file
patch and undo contracts.

## Deterministic logo tracing before AI finalization

Design and test protocol frozen before implementation, 2026-10-23.

## Source study

Read vtracer `e71343fbcbf469b8a72a255030408a39939162eb` and
visioncortex `0062088c89645aac76c00e066deb7e8f53980dd7`.
The checked-out repositories now declare MIT OR Apache-2.0, rather than
the older single-license descriptions in the task. Retain both requested
notices conservatively; upstream visioncortex has no NOTICE file.

- vtracer `frontend/color_cluster.rs` keys transparency, reduces color
  precision and drives visioncortex's incremental cluster builder.
- visioncortex `color_clusters/builder.rs` first joins similar adjacent
  pixels, then visits clusters by area, merges into the closest-color
  neighbor, and optionally preserves a contrasting patch as a deeper layer.
  `runner.rs::patch_good` absorbs speckles and rejects thread-like regions.
- `path/walker.rs` follows lattice edges separating inside/outside pixels
  and skips straight runs. Diagonally connected components are separated.
- `path/paths.rs`, `simplify.rs`, `reduce.rs` remove staircase corners and
  reduce polygons. `spline.rs` smooths/subdivides polygons, detects corners
  and splice points, then fits cubic Beziers using flo_curves.
- vtracer `compose.rs` stacks solid parent masks underneath child layers.
  Cutout now uses a shared-boundary mosaic graph to avoid hairline seams.

## Smaller scope

Use pure TypeScript, not WASM or a Rust executable. BurnGuard already ships
`@napi-rs/canvas` on Windows x64 and macOS arm64 through
`export-native-modules.ts`; reuse it solely for PNG decode and test rasterization.
No new runtime dependency, native build, download or subprocess is needed.

Decode the pinned PNG buffer after retaining only pixel/transparency/color
management chunks. Native canvas mistakes `<svg` inside C2PA `caBX` metadata
for an SVG; removing text and EXIF alone is insufficient on the supplied PNGs.
File-path decode succeeds on the same bytes. Test both text and C2PA metadata.

Adapt the lattice-edge walking and bounded-error polygon reduction approach.
Replace the hierarchical cluster graph with a deterministic RGB histogram,
weighted palette fitting (at most eight colors), and four-connected masks.
Merge tiny components into an adjacent palette region rather than deleting
foreground pixels. Emit one compound path per color with evenodd holes.
Default to polygon mode to retain sharp logo corners; offer a local quadratic
spline mode for optional smoothing, not the upstream least-squares fitter.
Transparent pixels stay transparent; partially transparent pixels are
thresholded, an explicit limitation for translucent artwork.

Retain disjoint palette masks with evenodd holes and an area-only speckle
threshold (four pixels by default, not the upstream four-pixel side length).
On the same frozen set, the attempted cumulative-mask variant grew from
2,093,464 to 2,737,760 bytes. Adding upstream `runner.rs::patch_good`'s
area/perimeter rejection grew it again to 2,767,964 bytes and increased color
error. Discard both experiments, not their unfavorable measurements.
The retained version is still 18.8 times larger than the reference and misses
the size target. It is a draft experiment, not a demonstrated compact replacement.
Bound Douglas-Peucker distance evaluations per contour as well as edge count,
pixels and SVG bytes.
Drop photo mode, gradients, watershed, adaptive thresholding, arbitrary
palettes, hierarchical cluster graphs, mosaic topology, least-squares cubics,
animation and interactive cached segmentation. Binary mode uses a fixed
luminance threshold. Do not imply this is a byte-for-byte port of vtracer.
Bound input pixels, contour complexity and SVG bytes. Cancellation must be
observed between asynchronous batches, not just before a synchronous loop.

## Integration and authority

`turns.ts` captures `LogoTurnExpectation` before the adapter. Immediately
after expectation capture and before the adapter, finalize prepares `logo.svg` from that pinned selected PNG and
records the selected pair in the staged manifest. The AI receives a finite
ready/fallback context, writes guidelines, and leaves a ready SVG alone unless
the person explicitly asks for tidy-up. Unsupported or over-budget tracing
uses the existing AI vectorization path. Unexpected errors still fail.

Trace only selected exploration candidates, never moodboard references.
Check the selected digest and normal managed-path/file identity rules.
Validate generated SVG using the existing validator and set
`data-bg-source-exploration` to the exact selected candidate path.
Keep all existing history, provenance, originality, repair, transactional
publication and cancellation gates. This does not fix AI-authored guidelines.

## Fixed evaluation, defined before code

Freeze SHA-256 identities before tracing. Use all seven root `idea-*.png`
and `v2-candidate-*.png` files present in the supplied dori directory, plus
`candidate-4.png` as the eighth: the requested name patterns contain seven,
not eight files. Also use all four `option-*-illustration.png` files.
Add six fixed 128 px synthetic marks: rectangle, ring with a hole, diagonal
touch, thin cross, three-color nested mark, and transparent disk. Their
geometry and colors are constants, not generated by a model.

Pass the optional frozen-synthetic directory to the measurement command when
moving between OS/CPU architectures. Re-rendering circles on Linux changes
two PNG identities; reuse the six originally frozen PNGs instead of updating
the lock or accepting different pixels.

Measure each original PNG at its native dimensions with no crop, alignment
search or background removal. Rasterize SVG with the same installed canvas
renderer for both implementations. Compare RGB composited onto white with
mean absolute error (0..255). Also report foreground IoU: pixels differing
from white by more than 24 in any channel. This silhouette metric alone is
insufficient on dark backgrounds, so retain color error and visual checks.
Report original SVG UTF-8 bytes, path count, wall time and validator result.
vtracer 1.0.0-alpha.4 gets the same original input, --max-colors 8,
polygon mode and default speckle threshold; also report its spline output.
This is a matched palette cap, not equivalent clustering or fitting.
Only inject the required source attribute for reference validation; do not
silently sanitize invalid output or omit its cost. Report cold CLI elapsed
time separately from our in-process decode+trace time, not as a speedup.
Run three measured repeats after one warm-up; report medians.

Search both supplied directories for existing AI-redrawn SVGs; compare only
when an SVG can be paired with its actual source. Missing pairs are N/A.

Preserve the original 18-file SHA lock unchanged. Also measure the other five
PNGs in the requested dori glob under a separate supplemental lock: three
earlier candidates and two UI screenshots. Do not count screenshots as logo
acceptance fixtures, and do not pool supplemental rows into the frozen score.

Predeclared acceptance target: validation on 18/18; per-fixture IoU within
0.02 of the matched polygon reference and MAE at most reference + 3/255;
smaller total bytes than the eight-color polygon reference. Show every miss.
Do not tune the fixture set or hide failures to satisfy the target.

Unit tests cover exact binary/threshold behavior, holes, diagonals, sharp
corners, palette cap, speckles, transparency, invalid input, cancellation,
and output budget. Integration drives the real finalize stage and completion
gate without asking the adapter to write SVG or selection. Mutate the
binary threshold comparison and require the focused test to fail, then
restore it and run the relevant suite once. Package notices must be shipped.
