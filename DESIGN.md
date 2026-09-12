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

- **CanvasTopBar**: mode controls, refresh, and file-level undo. Each action
  has an accessible name and a disabled state when unavailable.
- **SelectorOverlay**: hover and selected bounds. Selection must preserve
  element identity, computed styles, and an authoring anchor when one exists.
- **SelectorReadOnlyPanel**: selected identity and computed/token context. When
  the authoring anchor is available, it exposes the next inline action without
  forcing the user to reselect the element in another mode.
- **TweaksPanel**: focused, editable token controls. Save is an explicit
  checkpoint; reset and undo remain visible and reversible.
- **CommentPanel**: contextual feedback tied to an artifact path and optional
  slide index. Resolved comments leave the active queue.
- **QuickComment**: Control+Space over a loaded canvas opens the existing memo
  editor beside the pointer, without changing canvas mode. Its viewport portal
  stays unscaled and inside screen edges. Creation shows an immediate pending
  state, then focuses the memo; repeated keys never create additional pins.
  Escape closes and saves the draft. Refresh/file changes dismiss stale context
  while preserving edited text through the existing comment save path. Editable
  controls retain Control+Space, including inside the opaque-origin sandbox.
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
- Narrow viewport: the inspector becomes a full-width contextual section below
  the canvas; controls remain at least 44px high where touch is plausible. At
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
