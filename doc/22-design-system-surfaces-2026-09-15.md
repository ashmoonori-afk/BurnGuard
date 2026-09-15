# Design system surfaces: website, slides, content

Date: 2026-09-15. Scope: the design-system format, the 41 bundled themes, the 5 original sample systems,
the Northvale sample, and the prompt harness that injects a system into a turn.

## 1. The problem

A BurnGuard design system was a website design system that three different deliverables were forced to
share.

- `colors_and_type.css` ships the brand core - colour, type families, spacing, radius, elevation,
  motion - plus a **web** grid: `--layout-max`, `--layout-measure`, `--layout-columns`,
  `--layout-gutter`, `--layout-margin`, `--layout-section-y`, `--layout-bp-*`, `--layout-hero`, and
  since [doc/21](./21-theme-reference-layouts-2026-09-15.md) the website region tokens
  `--layout-nav-*`, `--layout-hero-*` and `--layout-footer-*`.
- `README.md` documents that grid under `## Layout`, `## Responsive`, `## Navigation`, `## Hero` and
  `## Footer` - all page rules.
- `prompt-design-system.ts` emitted every one of those tokens and sections inside
  `<selected_design_system_layout>` for **every** project type, under a REQUIRED instruction to apply
  the grid, reading measure, margins, gutter, section rhythm and the navigation/hero/footer regions.

A slide deck has no navigation bar, no footer, no reading measure and no breakpoint; it is a fixed
1920x1080 artboard read from across a room. A content artboard - card news, banner, product detail page,
thumbnail, poster - has no scroll, no reflow and no hover. Both received website instructions, and both
got their real geometry from constants that were identical for all 41 themes:

- `deck-skill.ts` and `prompt-compact-skills.ts` declare `--deck-type-hero: 80px`,
  `--deck-type-heading: 52px`, `--deck-type-body: 32px`, `--deck-type-caption: 24px`,
  `--deck-pad-slide: 72px`, `--deck-pad-block: 32px`.
- `visual-craft-skill.ts` `GRAPHIC_VISUAL_CRAFT` gave every theme the same "safe area of 6-8% of the
  short side", "figure layer at 40-70% of the short side" and "headline at 8-14% of the artboard height".

So Night Marquee, a 100%-copy-share poster theme with a 120px hero offset, and Index Table, a 28%-copy
dense data theme, produced the same slide type ramp and the same artboard composition. The theme changed
only colour and font.

## 2. The surface model

A design system gains three **surfaces**. A surface is the part of a system that applies to exactly one
output geometry.

```
              colors_and_type.css        brand core: colour, type families, spacing,
              README.md / SKILL.md       radius, elevation, motion
                       |                 website grid --layout-*, structure --family-*
                       |                 "## Composition" brand prose
        +--------------+--------------+
        |              |              |
   website        slides         content
   --web-*        --slide-*      --content-*
   fluid          fixed          fixed artboards
   320 -> 1440+   1920 x 1080    1:1, 4:5, 9:16, banner, print
   prototype      slide_deck     graphic
```

Surface selection is derived from `project_type`, not chosen by the user:

| `ProjectType` | Surface |
|---|---|
| `prototype` | `website` |
| `slide_deck` | `slides` |
| `graphic` | `content` |
| `from_template`, `other` | `website` |

### 2.1 What a surface is not allowed to own

Two things look like layout but are brand, and every surface receives them:

- `## Composition` prose. "Phosphor marks only a live state", "no element has a radius above 3px",
  "mono never sets body copy" are true of a slide and an artboard as much as a page.
- `--family-*` tokens. They encode the one structural decision a design family turns on - navigation
  placement, media fit, gallery pattern, table layout, image bleed - and a fixed frame still honours the
  ones that are not navigation chrome.

So a fixed surface does not suppress the layout contract; it receives the **brand half** of it. Only the
website geometry - `--layout-*` tokens and the `layout`, `responsive`, `family`, `navigation`, `hero`
and `footer` sections - is withheld.

### 2.2 Why the website surface keeps its grid where it is

`--layout-*` and `--family-*` stay in `colors_and_type.css`. They are the website surface, they landed
in doc/21, and `REQUIRED_LAYOUT_TOKENS`, `designSystemLayoutPreview`, `scripts/theme-preview-regions.ts`
and the theme preview pages all read them from there. Moving them would be churn with no product gain.
`surfaces/website.css` therefore carries only what the website surface was still missing: a per-theme web
type ramp and block padding, which until now came from generic craft advice identical for every theme.

## 3. Token contracts

Surface files are token-only: one `:root` block, no other selector, no `@import`, no colour value. Colour
stays in `colors_and_type.css`, so the brand-core rule and the hex-only colour gate keep holding.
`packages/shared/src/design-surface.ts` is the authority: it declares the token names, the kind of value
each one accepts, and the derived defaults.

A value that cannot act as the length, count, fraction, flag, enum or ratio its token requires is
**rejected at extraction**, so the default takes over instead of an unusable value silently blocking it.
A token belonging to another surface is never read.

### 3.1 `surfaces/website.css` - `--web-*`

| Token | Kind | Meaning |
|---|---|---|
| `--web-type-hero` | responsive | Hero display size, usually a `clamp()` |
| `--web-type-heading` | responsive | Section heading size |
| `--web-type-body` | length | Body copy size |
| `--web-type-caption` | length | Caption, eyebrow and label size |
| `--web-pad-block` | length | Padding inside a card or panel |

Grid, regions, reading measure and section rhythm remain the `--layout-*` / `--family-*` contract.
`--layout-section-y` stays the only vertical rhythm authority; this surface deliberately adds no second
one.

### 3.2 `surfaces/slides.css` - `--slide-*`

| Token | Kind | Meaning |
|---|---|---|
| `--slide-w`, `--slide-h` | length | Artboard size in CSS px |
| `--slide-aspect` | ratio | Artboard aspect ratio |
| `--slide-pad-edge` | length | Safe area from every edge |
| `--slide-pad-block` | length | Gap between blocks inside a slide |
| `--slide-columns`, `--slide-gutter` | count, length | Slide-local grid |
| `--slide-rule` | length | Divider weight on a slide |
| `--slide-type-hero` | length | Cover title size |
| `--slide-type-heading` | length | Slide title size |
| `--slide-type-body` | length | Body and bullet size |
| `--slide-type-caption` | length | Eyebrow, caption and chart label size; the projection floor |

Every shipped system declares 1920x1080 at 16 / 9 and a caption step of at least 24px, and a test pins
that. The tokens exist so authoring, the design audit and both exporters read one source, **not** so a
theme can choose its own deck size: a per-theme slide size would need a project-level size contract that
`design-audit.ts` and the PDF/PPTX exporters also honour, which does not exist yet.

The deck runtime, the PDF exporter and the PPTX exporter keep consuming `--deck-type-*` and
`--deck-pad-*`. The slides surface does not replace that contract; it supplies its values.

### 3.3 `surfaces/content.css` - `--content-*`

An artboard size comes from the project's `graphic_canvas`, not from the theme, so this surface is
expressed relative to the frame.

| Token | Kind | Meaning |
|---|---|---|
| `--content-base` | length | Shorter side the px values below are authored for (`1080px`) |
| `--content-safe` | fraction | Safe-area inset as a fraction of the shorter side |
| `--content-columns` | count | Artboard-local column count |
| `--content-pad-block` | length | Gap between stacked blocks |
| `--content-rule` | length | Divider weight, floored at 1px once scaled |
| `--content-figure` | fraction | Figure size as a fraction of the shorter side |
| `--content-bleed` | flag | `0` or `1`: whether a figure may cross the safe area |
| `--content-anchor` | enum | `top`, `center`, `bottom`, `left` or `right` |
| `--content-type-hero` | length | Headline size at `--content-base` |
| `--content-type-sub` | length | Subhead size at `--content-base` |
| `--content-type-body` | length | Body size at `--content-base` |
| `--content-type-caption` | length | Caption and label size at `--content-base` |

The author computes two values per frame, because CSS percentages resolve against the containing block's
width rather than the shorter side, and because a 250px banner must not shrink its caption to 5px:

```css
/* per artboard */
--content-short: 1080px;                                        /* that frame's shorter side */
--content-scale: calc(var(--content-short) / var(--content-base));

padding: calc(var(--content-short) * var(--content-safe));      /* safe inset, a length on both axes */
font-size: max(12px, calc(var(--content-type-body) * var(--content-scale)));
```

`--content-pad-block` scales the same way, `--content-rule` never falls below 1px, and 12px
(`CONTENT_TYPE_FLOOR_PX`) is the same readability floor the craft self-check already states.

### 3.4 The graphic kind still outranks the surface

`<burnguard-graphic-output-v1>` and `<burnguard-graphic-rules-v1>` already carry per-kind rules that a
theme cannot override: a story frame's 250px top and bottom exclusion zones, print millimetre trim and
bleed, and a product detail page's full-height section sequence ending in a call to action. The content
surface owns ground, safe area, type ramp, figure and the never-list; the kind owns frame geometry and
sequence. Where both define a margin the larger wins, and on a product detail page the surface rules
apply per section rather than to the page as a whole. `--content-bleed` is composition, never print
bleed.

## 4. File layout and README contract

```
{system_id}/
├── colors_and_type.css      # brand core + website grid, regions and family tokens (unchanged)
├── README.md                # + ## Surfaces, ## Slide deck, ## Content artboards
├── SKILL.md                 # + one ## Surfaces pointer section
└── surfaces/
    ├── website.css          # --web-*
    ├── slides.css           # --slide-*
    └── content.css          # --content-*
```

Three new README sections, all H2 so the existing bounded section parser can read them:

- `## Surfaces` - indexes the three files, states which tokens each surface owns, and carries the
  scaling recipe above. Not parsed into a prompt section; it exists so a human reader and a Claude Code
  skill user can find the split.
- `## Slide deck` - how this theme composes a slide: ground and signal, cover, structure, imagery, and
  what never appears. Parsed as the `slides` surface section.
- `## Content artboards` - the same for a fixed frame. Parsed as the `content` surface section.

`## Image direction` is deliberately **not** read into a surface. Several themes phrase it against the
website opening ("the website opening uses its separate Hero ratio", "preserve the complete editorial
subject within the named Hero geometry"), which is exactly the geometry a fixed frame must not inherit.
The subject, treatment and never-list a fixed frame needs are restated in the two generated sections.

## 5. Prompt behavior

`appendDesignSystemContext` takes the surface and branches once:

- The untrusted-design-data warning is now emitted for every system, not only for one that ships layout
  rules.
- **website** - the full `<selected_design_system_layout>` block, unchanged in shape, tokens, sections
  and REQUIRED text, plus `<selected_design_system_surface surface="website">`.
- **slides** and **content** - the same layout block reduced to its brand half (`--family-*` tokens and
  the `composition` section) under a REQUIRED line that states the withheld geometry explicitly, plus
  `<selected_design_system_surface surface="slides"|"content">`.

Both blocks keep the existing `<` escaping and sit before `## Delivery`. The surface block carries
`supplied`, the list of keys that came from a fallback rather than from the system, so the model can tell
a decision from a default.

Shipped skills keep their current contract and gain one conditional clause each:

- `DECK_SKILL_MD` and `COMPACT_DECK_SKILL_MD` keep declaring `--deck-type-*` and `--deck-pad-*` at their
  current values, and now say: when a slides surface supplies `--slide-type-*` and `--slide-pad-*`, take
  the `--deck-*` values from it instead, never below 24px.
- `DECK_VISUAL_CRAFT` and `GRAPHIC_VISUAL_CRAFT` defer to `--slide-type-*`, `--content-safe` and
  `--content-figure` when a surface supplies them. `MAX_VISUAL_CRAFT_CHARS` stays 6400 and the budget
  test still passes.

## 6. Older systems, new systems, and systems that ship no surface

Three sources, in order:

1. The system's own `surfaces/<surface>.css` and README sections.
2. For a bundled theme, an original sample or the Northvale sample, the repository copy of the same
   system - the mechanism `readDesignSystemLayout` already uses - so an installation seeded before this
   change reads the current surface without any of its authored files being rewritten.
3. Otherwise the derived defaults in `DERIVED_SURFACE_TOKENS`: 1920x1080 with the 80/52/32/24 ramp and a
   72px safe area for slides, a 1080px base with a 0.07 safe fraction for content, and the current craft
   ramp for the website.

Every key filled from step 2 or 3 is listed in `supplied`.

**No filesystem migration.** `seedBundledDesignSystems` returns early when a destination exists, and a
top-up could not add README sections to a workspace the user may have edited without overwriting their
work. The supplement path above is what makes an existing workspace correct, and it never writes to a
system directory.

**New extractions do write the files.** `design-system-extract.ts` emits all three surface stylesheets
and the three README sections through the same `writeText` helper as `README.md` and
`colors_and_type.css`, so they enter the `generated` inventory before canonical publication rather than
appearing after a receipt is computed. Those values are the derived defaults, and an extracted system
owns them from that moment: editing them changes the user's own system.

## 7. Authoring the shipped systems

Numbers are derived from each system's own landed decisions, so a theme's surfaces agree with its
website:

| Source signal | Drives |
|---|---|
| `--layout-hero-copy-ratio`, `--layout-hero-title-measure` | The display step: a short title measure and a high copy share mean a type-led theme, so hero and heading grow and the figure shrinks. Body and caption move at half that rate so readability never follows the display size |
| `--layout-hero-offset` | `--slide-pad-edge`, `--slide-pad-block` and `--content-safe` |
| `--layout-hero-media-position` | `--content-anchor` and `--content-bleed` |
| `--layout-columns`, `--layout-gutter` | `--slide-columns`, `--slide-gutter`, `--content-columns`, `--web-pad-block` |
| `--layout-rule` | `--slide-rule` and `--content-rule` |
| `--layout-measure` | `--web-type-body` and `--web-type-caption` |

Prose comes from a spec table in the generator with six fields per system - ground, signal, cover,
structure, figure, never - because those are the facts no derivation can know. `## Image direction` and
`## Composition` were the source material for them.

`scripts/build-theme-surfaces.ts` (`bun run surfaces`) is the generator, in the same spirit as
`scripts/build-theme-catalogue.ts`: it rewrites tracked source deliberately and is never part of
`bun run build`. It is idempotent - it replaces everything from the generated `## Surfaces` heading
onward - it parses every token set through the shared contract before writing, and it fails on an
unregistered system rather than writing a partial one.

## 8. Verification

`packages/backend/tests/design-system-surfaces.test.ts` gates:

- project type to surface mapping;
- every shipped system ships all three surface files and the three README sections, every required token
  present, every value contract-valid, one `:root` block per file and no colour or `@import`;
- slides are 1920x1080 at 16 / 9 with a monotonic type ramp, a caption step of at least 24px and a safe
  area of at least 64px;
- content safe fraction between 0.06 and 0.12, figure between 0.3 and 0.8, caption at or above the 12px
  floor;
- Night Marquee and Index Table differ in hero step, safe area and figure size, so the split changes
  more than colour;
- an unusable value (`--content-safe: red`), a foreign token and an invalid `supplied` key are rejected;
- an installation with no `surfaces/` resolves completely from its bundled source, reports every filled
  key in `supplied`, and is not written to;
- a slide_deck and a graphic prompt carry their own surface block and only the brand half of the layout
  contract, while a prototype prompt carries the full one - in both context modes.

The existing suites that cover this area still pass unchanged: `design-system-layout`,
`visual-craft-skill`, `deck-type-scale`, `prompt-builder`, `bundled-font-reference`,
`daisyui-seed-themes`, `design-direction-routes`, `theme-previews`, `package-resources`, `catalog` and
`design-system-extract`.

Not verified here: no deck or artboard was rendered under two themes and compared. The token and prose
differences are asserted, the resulting pixels are not.

## 9. Out of scope

- Slide and content preview HTML beside `design system themes/previews/`, and their catalogue entries.
  The existing website previews load only `colors_and_type.css` and size from `--fs-*`, so they do not
  yet demonstrate the `--web-*` ramp either; both belong to the same follow-up.
- A surface picker in the UI. The surface follows the project type; there is nothing to choose.
- Design directions stay website-shaped: a direction preview is a page thumbnail, and a slide or artboard
  direction is separate work.
- Long-form text content such as a blog or documentation. There is no project type for it, so a fourth
  surface would have no consumer.
- Full context mode still inlines `SKILL.md`, `colors_and_type.css` and `README.md` excerpts inside
  Markdown fences, which a hostile README could close. That predates this change and is untouched by it;
  the surface and layout blocks are escaped JSON.
