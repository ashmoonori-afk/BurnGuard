# Northvale Capital Design System

A fictional editorial-finance reference design system bundled with BurnGuard as a worked example. It exists so the harness has something realistic to render in the canvas, prompts can name a real-feeling brand, and exports / handoffs have tokens to reference. **Northvale Capital is not a real company** — the name, logos, and copy are placeholders. Use this kit when you want to prototype institutional, editorial, financial-services interfaces without bringing in a real brand's trademarks.

> **Sources**
> - Color, type, spacing, radii, shadow, and motion tokens were synthesized for this sample from common editorial-finance design conventions. Nothing here is derived from a specific real-world institution's design system.
> - **Brand fonts (user-supplied):** **Zen Serif** for display, **KoPub Batang** (serif) for editorial body, **Pretendard** (variable) as the primary UI sans with **KoPub Dotum** as KR fallback, and **IBM Plex Mono** for tabular numerals. Wired up in [`fonts/fonts.css`](./fonts/fonts.css).
> - **Logos** in `assets/logos/` are placeholder SVG monograms and wordmarks (not real trademarks). Replace them when you fork this for a real brand.

---

## Index

| File / Folder | What's in it |
|---|---|
| [`README.md`](./README.md) | This file — overview, content & visual rules |
| [`SKILL.md`](./SKILL.md) | Agent-Skill manifest (drop into Claude Code) |
| [`colors_and_type.css`](./colors_and_type.css) | All CSS custom properties — colors, type, spacing, radii, shadows, motion |
| [`fonts/`](./fonts/) | `fonts.css` (Google-Fonts substitution layer + notes) |
| [`assets/logos/`](./assets/logos/) | Six placeholder SVG lockups (Box, Outline, Reversed, Secondary, Signature, Signature Reverse) |
| [`preview/`](./preview/) | Cards rendered in the Design System tab — colors, type, spacing, components |
| [`ui_kits/website/`](./ui_kits/website/) | Marketing-website kit: header, hero, article, data callout, footer, full landing page |
| [`uploads/`](./uploads/) | Drop zone for design references during local exploration. **Gitignored** — nothing here is meant to ship publicly. See `.gitignore` for the guard. |

---

## Brand snapshot

Northvale Capital is positioned as an institutional asset manager — the persona is **considered, restrained, and editorial**, closer to a serious newspaper or annual report than a tech product. The display wordmark is a high-contrast Didone-style serif; the supporting palette is built on cool blue-grays with a dusty `#7399C6` "Northvale Blue" as the brand color.

The system is meant to feel **trustworthy, considered, and quiet**. There is no playfulness. The few moments of color are reserved for data and status.

---

## CONTENT FUNDAMENTALS

**Voice.** Authoritative, restrained, third-person institutional. Northvale writes about itself in the third person ("Northvale Capital is…"), and addresses readers as "our clients," "investors," "the market." Direct second-person ("you") appears in CTAs and product UI, but rarely in editorial.

**Tone.** Considered, evidence-led, never breathless. Headlines state a thesis or a fact; subheads provide context. Marketing copy avoids superlatives ("best-in-class," "revolutionary"). Numbers carry the weight that adjectives would in a startup voice.

**Casing.**
- **Title Case** for headlines and section titles ("Global Markets Outlook 2026").
- **Sentence case** for body and supporting copy.
- **ALL-CAPS eyebrows** with tracked letter-spacing (`0.14em`) for category labels: `INSIGHTS`, `Q1 2026`, `MARKETS`.

**Numerals & units.** Tabular figures everywhere a number can be compared (use `font-feature-settings: 'tnum'`). Money: `$1.2B`, `$485M`, `2.3%`. Years standalone: `2026`. Currency before figure for USD; ISO codes (USD, JPY, EUR) when ambiguous.

**Emoji.** Never. Not in product, not in marketing, not in internal tools.

**Vibe.** Editorial-financial. Think *The Economist* meets a research note. Long-form prose is welcome; whitespace is generous.

**Examples (in the Northvale voice):**
- ✅ "Equity markets enter the second quarter on firmer footing."
- ✅ "Our research desk expects a 25 bp cut at the June meeting."
- ✅ "Insights from Northvale Research"
- ❌ "🚀 Markets are crushing it this quarter!"
- ❌ "We think you're gonna love what's coming next."

---

## VISUAL FOUNDATIONS

**Colors.** A 10-step gray ramp from `#FFFFFF` to `#1C2B36` carries 90% of the surface area. The dusty **`#7399C6` "Northvale Blue"** is reserved for the wordmark and rare brand moments. **`#186ADE` action-blue** drives interactive states (links, buttons, focus). Accent hues (red, orange, green, teal, purple, pink) exist as full 10-step ramps but appear almost exclusively in **data visualization** and **status messaging** — never as decoration.

**Type.** Display in **Zen Serif** (brand) at large sizes with tight tracking (`-0.02em`). Editorial body & long-form in **KoPub Batang** (serif). UI labels, eyebrows, and shorter copy in **Pretendard** (variable, 100–900) with KoPub Dotum as KR fallback. Numerals in **IBM Plex Mono** (tabular).

**Spacing.** A strict **4px grid**: `4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64 / 80`. Editorial layouts breathe — section padding is typically 80–120px vertical.

**Backgrounds.** Predominantly **white** (`--gray-100`) or **near-white** (`--gray-10` `#F2F5F7`). The single dark variant is `--gray-90` `#1C2B36` for inverse sections. **No gradients.** No textures. No noise. No hand-drawn illustration. Imagery is **photographic**, cool-toned, often architectural or human portraits with neutral grading — never warm or saturated.

**Animation.** Minimal. Standard easing is `cubic-bezier(0.2, 0, 0, 1)` at `200ms` for state changes, `120ms` for micro-interactions. No bounces, no spring physics, no parallax. Fades and short slides only.

**Hover states.** Links underline. Buttons darken by ~10% (move to `blue-70` from `blue-60`). Cards lift to `--shadow-3`. No glow, no scale.

**Press states.** Move to the next-darker stop in the color ramp (`blue-80`). No shrink or scale transform.

**Borders.** `1px solid var(--border)` (`--gray-20` `#DCE3E8`) is the default. Strong borders use `--gray-30`. Border-radius is **conservative**: 0px (editorial blocks), 2px (inputs/badges), 4px (buttons), 8px (cards). Never pill-shaped except on filter chips.

**Shadows.** Four-tier elevation system (see `--shadow-1`…`--shadow-4`). All shadows are cool gray (`rgba(28, 43, 54, …)`), never warm. Used sparingly — most cards rely on a 1px border instead of a shadow.

**Capsules vs. protection gradients.** Neither. The brand sits on solid color or imagery with sufficient contrast — it does not use scrim gradients or capsule pills behind copy.

**Layout.** Strict 12-column grid. Generous gutters (24–32px). Editorial layouts often go asymmetric (8/4 splits) with copy on the wider column. Fixed elements: top navigation only. No floating action buttons, no sticky sidebars in marketing.

**Transparency & blur.** Almost never. The aesthetic is opaque and printed-paper-like. The one exception is a subtle 80% white overlay on hero images to seat copy.

**Imagery vibe.** Cool-toned, low-saturation, often desaturated to near-monochrome. Architecture, trading floors, hands at keyboards, considered portraits. **Never** stock-photo handshakes, lens flares, or warm sunset palettes.

**Cards.** White surface, 1px `--border`, `8px` radius, `--shadow-1` at rest. Padding is `24–32px`. Hover lifts to `--shadow-3`.

---

## ICONOGRAPHY

The Northvale brand uses **photography** and **typography** as its primary visual language — iconography is a supporting role and is held to a strict, neutral system.

- **Logo lockups.** Six placeholder SVG lockups live in `assets/logos/`:
  - `Northvale_Signature` — primary wordmark, dark on light
  - `Northvale_Signature_Reverse` — primary wordmark, white on dark
  - `Northvale_Box` — square brand mark on `#1a3a5c`
  - `Northvale_Reversed` — white outline mark for dark backgrounds
  - `Northvale_Outline` — line treatment of the brand mark
  - `Northvale_Secondary` — combined mark + wordmark lockup

  These are deliberately simple monograms so a real fork can swap them out without touching layout. None of them carry real-world trademark.
- **UI icons.** The repo does not ship an icon set. We standardize on **[Lucide](https://lucide.dev)** loaded from CDN — a thin, geometric, 1.5px-stroke open-source set that matches the editorial restraint of this system. Lucide's stroke weight and squared terminals fit the editorial tone better than thicker rounded sets.
  - **Substitution flagged.** If a real brand is forking this and ships its own icon set, swap the CDN reference in `ui_kits/website/index.html`.
- **No emoji.** Anywhere.
- **No unicode pictographs as icons** (★, ✓, →) except the en-dash and bullet (·) used as typographic separators in eyebrows: `INSIGHTS · MARKETS · Q1 2026`.
- **No hand-drawn SVG illustration.** Where a visual is needed, use photography.

---

## Caveats & substitutions to flag

1. **Icon set → Lucide.** The repo ships no icons. Replace the Lucide CDN if a real brand fork has its own icon library.
2. **Tokens are sample defaults.** Spacing, type scale, radii, shadows, and motion are reasonable defaults consistent with editorial-finance peers — they are starting points, not a real institution's authoritative tokens.
3. **Mono → IBM Plex Mono.** No brand mono is supplied. Swap if a fork has one.
4. **Logos are placeholders.** The six SVGs in `assets/logos/` are simple monograms; replace before shipping any real-brand artifact.


## Layout

The 12-column grid, 1200px maximum width, 62ch reading measure and 28px gutters are mandatory. Use the page margins, vertical section rhythm and 16 / 10 hero ratio from colors_and_type.css. Layout belongs to this system alongside palette and typography.

## Composition

Use an editorial finance masthead, a broad lead statement and a narrow reading measure. Align research figures, tables and supporting copy on one twelve-column grid; use rules and whitespace to distinguish sections.


## Responsive

Below --layout-bp-md, collapse content to one column in reading order, place message before media and move any side navigation into a compact top row. Remove decorative offsets and keep tables in their own horizontal scroll region. Between medium and large breakpoints, reduce spans without changing the hierarchy. Above --layout-bp-lg, retain the full grid within --layout-max. At 200% zoom, allow labels and actions to wrap without clipping. Slides and graphics keep their fixed artboard dimensions; adapt content inside that canvas rather than applying website breakpoints to its size.

## Surfaces

This system has one contract per output geometry. Shared brand identity - colour, type families, spacing, radius, elevation and motion - stays in `colors_and_type.css` together with the website grid and the `--family-*` structural decisions, and the `## Composition` rules apply to all three surfaces. Each surface below owns only what its own geometry needs.

| Surface | File | Owns | Used by |
|---|---|---|---|
| Website | `surfaces/website.css` | `--web-*` type ramp and block padding | Websites and prototypes |
| Slides | `surfaces/slides.css` | `--slide-*` geometry, safe area and projection ramp | 1920x1080 slide decks |
| Content | `surfaces/content.css` | `--content-*` safe area, figure, anchor and type ramp | Fixed artboards: card news, banners, product detail pages, thumbnails, posters |

Content values are authored for a `--content-base` shorter side. Per artboard set `--content-short` to that frame's shorter side and `--content-scale: calc(var(--content-short) / var(--content-base))`, then size type as `max(12px, calc(var(--content-type-body) * var(--content-scale)))`. `--content-safe` is a fraction of the shorter side, so the safe inset is `calc(var(--content-short) * var(--content-safe))` on every edge.

## Slide deck

Slides are fixed 1920 x 1080 CSS px artboards at 16 / 9, not pages: no navigation bar, no footer, no reading measure, no breakpoint, no hover. Nothing required sits outside `--slide-pad-edge` (72px), and `--slide-type-caption` (24px) is the smallest type on any slide.

- Ground: the editorial finance ground; the brand blue marks one figure or action.
- Cover: an editorial masthead with a broad lead statement.
- Structure: research figures, tables and copy aligned on one grid, separated by rules and whitespace. One takeaway per slide, titled at `--slide-type-heading` (52px) with support at `--slide-type-body` (32px).
- Imagery: a restrained institutional figure or chart rather than stock photography. At most one image per slide unless the request asks for a grid.
- Never: tech-product styling, decorative photography, an unlabelled figure.

## Content artboards

Each artboard is one fixed frame at the size the request declares. The requested kind's own rules come first - frame sizes, platform exclusion zones, print trim and bleed, and a product detail page's full-height section sequence with its closing call to action - and the rules below govern how each frame or section looks. Keep required content inside the safe inset (7% of the shorter side), place the primary figure at `--content-figure` (0.56) of the shorter side anchored bottom, and nothing crosses the safe area because `--content-bleed` is `0`.

- Frame: the editorial finance ground; the brand blue marks one figure or action.
- Composition: research figures, tables and copy aligned on one grid, separated by rules and whitespace. In a multi-frame set the first frame follows the cover rule above and the last carries the call to action; on a product detail page these rules apply per section.
- Type: one claim per frame at `--content-type-hero` (120px at a 1080px shorter side, scaled by `--content-scale`), support at `--content-type-sub` (56px), and nothing below `--content-type-caption` (24px) or 12px once scaled.
- Figure: a restrained institutional figure or chart rather than stock photography.
- Never: tech-product styling, decorative photography, an unlabelled figure.
