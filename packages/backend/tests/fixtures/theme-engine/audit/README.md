# Fixed source-audit corpus for independent review

This is authored input and hand-labelled ground truth, not an audit implementation.
Labels were decided from the declarations below without running a detector.
No precision or recall has been measured. The integrity command does not decide
whether a declaration violates a token policy.

## Scope and counting

There are 150 independent assertions: 70 positives, 70 valid negatives, and
10 unresolved cases. Each of colour, radius, spacing, font size and shadow has
14 positives, 14 negatives and 2 unresolved cases. Count source assertions once,
not once per mode, token candidate or colour nested inside a shadow.

An assertion is about the named property at the named location. These are
selected assertions, not an inventory of every declaration in every file.
For example, a raw shadow is one shadow assertion, not another colour assertion.
Local token-name shadow cases target the consumer; ordinary local raw-definition
cases target the definition. Do not double-count both as one labelled case.

Candidate ambiguity is separate from detection uncertainty. A positive can have
several equally valid nearest names while remaining a known violation.
The zero-distance candidate sets in colour, radius and shadow deliberately retain
all equal names. An explicit approved reference to one of those names is valid.
The 10 unresolved cases are dynamic JSX and cyclic aliases; neither is a negative.

## Fixture environment and policy

`tokens.css` is the complete, small token document. It declares every token in
both modes. Load it before one source fixture at a time. Each fixture is an
independent source input, with no other author styles, scripts, external token
definitions, registrations or utility configuration. CSS duplicate rules inside
one file are intentionally not collapsed. This is a source audit, not an audit
of only winning computed declarations.

Light is the default `:root`. Dark means the root element has `data-mode="dark"`.
Selectors that explicitly require dark are audited only in dark. A `mode` column
of `light` on an otherwise unrestricted rule describes the mode used for its
candidate distance, not an exemption from checking dark before a fix.

Only the exact relative file `tokens.css` is allowlisted for raw token
definitions, and only its custom property definitions receive that exemption.
The allowlist is not a filename pattern and does not apply to component custom
properties. The five labelled definitions are representative negatives; the
remaining token declarations are context, not extra counted assertions.

A positive is an active raw design choice in the named category, including a
component-local custom property consumed in that category, a known local shadow
of a canonical name, or an active raw fallback. A raw value is still positive
when it happens to equal an approved token. Token aliases that terminate in the
canonical definitions are valid negatives.

The first argument of a `var()` can be resolved from this closed environment.
An undefined `--missing` activates its fallback. A canonical variable defined
in both modes makes its fallback inactive. A same-name component override is
not a canonical reference. Local a/b cycles have no terminal value: their
consumer assertions are unresolved, not guessed as raw or valid.

Allowed non-token choices include valid unitless zero, CSS-wide keywords,
`currentColor`, `transparent`, `auto` margins and `none` shadows. This does not
mean that zero is valid for every CSS property: `box-shadow: 0` is not included.
Image backgrounds without colours are not colour findings. Width, height,
minimum width and logical inline size are dimension geometry, not spacing.
Line height is not font size. Relative lengths and percentages are known raw
choices, but their distances to px tokens are unresolved without context.

The `.tsx.txt` file carries exact TSX source text, not a compiled component or a Tailwind build target.
Static arbitrary classes have their usual declared meanings, fixed here:
`text-[#446688]` is colour, `rounded-[4px]` is radius, `p-[8px]` is padding,
`w-[8px]` is width, `text-[length:16px]` is font size, and shadow underscores
represent spaces. Typed variable variants have the same properties. Runtime
props and interpolated arbitrary classes have no fixed value. No browser or
utility compiler is needed to review these literal declarations.

## Expected JSON row format

Each `expected-*.json` has a category, distance description and explicit rows.
The row columns, in order, are:

1. `id`: unique case marker, also present on its source line.
2. `file`: exact relative source filename within this directory.
3. `line`: one-based source line.
4. `selector`: CSS selector, expanded nesting, HTML ID, or JSX data-case selector.
5. `property`: CSS property name; JSX camelCase is normalized to the CSS name.
6. `value`: the whole declared value, or the intended decoded arbitrary value.
   Dynamic values retain their source expression, not an invented result.
7. `literal`: exact source span text on that line. For zero, cycles, and some
   aliases it includes the property to disambiguate occurrences. For arbitrary
   classes it is the complete class; for dynamic classes it includes interpolation.
8. `mode`: `light`, `dark` or `both`, with the candidate-context rule above.
9. `label`: `positive`, `negative` or `unresolved`.
10. `candidates`: every equally nearest obvious comparable token as
    `[name, distance]`. Candidate sets are unordered. Distances are scoped to
    the category and the indicated mode. For active fallbacks they describe the
    fallback value, not the entire `var()` expression.
11. `auto_fix`: `[eligible, replacement]`. An ineligible replacement is `null`.
    A non-null replacement applies to the declared value, or the entire utility
    class, not to a property-prefixed locator span.
12. `reason`: hand-authored label rationale and fix eligibility or refusal reason.

An empty candidate list is not proof that no similar token exists. On negatives
and dynamic/cyclic cases it means no recommendation is needed or possible.
For relative or structurally incompatible raw values no comparable distance is
asserted. For the cross-mode local colour shadow no single mode-stable ranking
is asserted. Shadow distance is only exact-tuple equality; no speculative
weighted colour/geometry distance is invented. Colour distance is encoded sRGB
channel distance, not a perceptual or accessibility metric.

Automatic replacement is intentionally narrow: one exact candidate, correct
category, equal units and full value, correct scope and mode, with no semantic
ambiguity. Scalar radius/spacing/type tokens can be exact value-preserving fixes.
The dark-only exact shadow also qualifies. Approximate distances, token-name
ties, relative units, mode mismatch and local shadows never authorize a fix.
Colour role is not inferred from value equality. Active fallback cases do not
authorize replacing the whole `var()` even when the fallback itself matches.

## Existing contracts inspected

Paths below are relative to the worktree root; no production files were edited.

- `AGENTS.md` and `packages/backend/tests/AGENTS.md`.
- `packages/backend/src/services/design-audit.ts`: rendered audit identity and safe-fix context.
- `packages/backend/src/services/design-system-conformance.ts` and its test:
  the current literal scan skips custom properties and values containing `var()`,
  and does not provide these five-category source labels.
- `packages/frontend/src/lib/design-audit-state.ts`: current/stale and safe-fix guards.
- `packages/frontend/tests/design-token-usage.test.ts`: token/default allowlists,
  raw-palette guards and non-colour utility exclusions.
- `packages/frontend/tests/token-color.test.ts`: aliases, fallbacks and cycles.

These existing scans are context, not an oracle used to author the labels.
This corpus deliberately tests distinctions they do not yet establish.

## Reproducing integrity verification

Run only the corpus-integrity command, not a repository test suite:

```sh
RUN_ROOT=$(mktemp -d /tmp/bg-audit-review.XXXXXX)
export TMPDIR="$RUN_ROOT"
export NODE_COMPILE_CACHE="$RUN_ROOT/node-cache"
export BUN_RUNTIME_TRANSPILER_CACHE_PATH="$RUN_ROOT/bun-cache"
node packages/backend/tests/fixtures/theme-engine/audit/validate.mjs
RESULT=$?
rm -rf -- "$RUN_ROOT"
exit "$RESULT"
```

`validate.mjs` reads only this directory. It checks JSON structure, counts,
unique IDs, exact line markers and literal spans, declaration anchors, token
candidate existence and fix metadata. It does not generate labels, calculate
nearest tokens, apply fixes, run production code, compile TSX, or claim detector
accuracy. The original preparation used non-fast `gpt-6.1-sol` through
`chatgpt-subscription`, with no delegation.
