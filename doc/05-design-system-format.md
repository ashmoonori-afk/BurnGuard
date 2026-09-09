# Design System Format

## 1. Source of Truth

`design system sample/` (Northvale Capital) is the **canonical example** of the format. Every DS we generate follows this structure.

## 2. Directory Layout

```
{system_id}/
├── README.md               # Brand narrative + content/visual rules
├── SKILL.md                # Agent-Skill manifest (Claude Code compatible)
├── colors_and_type.css     # All design tokens (CSS custom properties)
├── fonts/
│   ├── fonts.css           # @font-face declarations
│   └── *.ttf|woff2|otf     # Font files (only when licensing permits)
├── assets/
│   └── logos/              # Logo lockups (PNG + SVG)
├── preview/                # Token/component preview HTML cards (16 sections)
│   ├── brand-logos.html
│   ├── brand-icons.html
│   ├── colors-brand.html
│   ├── colors-neutrals.html
│   ├── colors-ramps.html
│   ├── colors-semantic.html
│   ├── colors-charts.html
│   ├── type-display.html
│   ├── type-headings.html
│   ├── type-body.html
│   ├── spacing.html
│   ├── radii-shadows.html
│   ├── components-buttons.html
│   ├── components-cards.html
│   ├── components-forms.html
│   └── components-badges-table.html
├── ui_kits/                # Full-component HTML (optional)
│   └── website/
└── uploads/                # Extraction sources (optional)
```

## 3. `SKILL.md` frontmatter

### Bundled typography baseline

New projects and bundled themes carry `fonts/fonts.css`, local WOFF2 files, and their licenses. The shared source is [`assets/fonts/`](../assets/fonts/README.md). Load the stylesheet before applying type tokens; do not depend on Google Fonts network requests at runtime.

| Role | Default stack | Intended use |
|---|---|---|
| Body / UI | DM Sans, Pretendard, system-ui, sans-serif | English and Korean body copy; 16–18px, line-height 1.55–1.8 |
| Heading | Space Grotesk, Pretendard, sans-serif | Product and technical headings; 300–700 weight |
| Editorial display | DM Serif Display, Gowun Batang, serif | English/Korean editorial headings; regular weight, comfortable line height |
| Expressive display | Bebas Neue, Pretendard, sans-serif | Short English poster headlines; Korean uses Pretendard |
| Numbers / code | IBM Plex Mono, Pretendard, monospace | Labels, tabular numbers and code; regular weight |

Specify display, body and mono tokens, available weights, Korean fallback, and responsive sizes in each system. Keep Korean body text at readable tracking and at least 1.55 line-height; reserve tight tracking and display faces for short headings. Check wrapping at mobile width and fixed slide/poster boundaries after changing fonts. Copy the font files and license notices with HTML exports. Existing user-supplied fonts remain separate; embedding a local font still depends on its own license.

```markdown
---
name: northvale-capital-design
description: Use this skill to generate well-branded interfaces...
user-invocable: true
---

Read the README.md file...

## Quick reference
- Tokens: ...
- Fonts: ...
- Logos: ...
- UI kit: ...
- Voice: ...
- Visual rules: ...
```

## 4. Required `README.md` sections

```markdown
# {Brand} Design System

## Index
| File | Contents |
|...|...|

## Brand snapshot
(3–5 sentences describing brand identity)

## CONTENT FUNDAMENTALS
Voice / Tone / Casing / Numerals / Emoji / Vibe / Examples

## VISUAL FOUNDATIONS
Colors / Type / Spacing / Backgrounds / Animation / Hover / Press / Borders / Shadows / Layout / Transparency / Imagery / Cards

## ICONOGRAPHY
Logo lockups / UI icons / Restrictions

## Caveats & substitutions
(Flag any items substituted during extraction)
```

## 5. Required tokens in `colors_and_type.css`

```css
:root {
  /* Neutrals (10-step gray ramp) */
  --gray-100 ... --gray-10

  /* Brand */
  --primary-blue   /* or brand color variable */
  --action-blue    /* interactive */

  /* Accent ramps */
  --red-60, --orange-50, --yellow-30, --green-60, --teal-50, --aqua-60,
  --blue-{range}, --ultramarine-60, --purple-60, --pink-60

  /* Semantic */
  --success, --warning-yellow, --warning-orange, --error, --info

  /* Surface & text */
  --bg, --bg-subtle, --bg-muted, --surface, --surface-inverse
  --fg-1, --fg-2, --fg-3, --fg-4, --fg-on-dark, --fg-on-brand
  --border, --border-strong, --focus-ring

  /* Chart ramps */
  --chart-1 ... --chart-10

  /* Type families */
  --font-display, --font-serif, --font-sans, --font-mono

  /* Type scale (12..80) */
  --fs-12 ... --fs-80

  /* Weight / leading / tracking */
  --fw-light..--fw-black, --lh-tight..--lh-relaxed, --ls-tight..--ls-eyebrow

  /* Spacing (4px grid) */
  --sp-1..--sp-20

  /* Radii */
  --r-0, --r-2, --r-4, --r-8, --r-pill

  /* Elevation */
  --shadow-1..--shadow-4

  /* Motion */
  --ease-standard, --ease-emphasis, --dur-fast, --dur-base, --dur-slow
}
```

## 6. Extraction Pipeline (Phase 3)

```
[Input]
  ├─ Git URL / GitHub URL        → git clone → parse SCSS/CSS/JSON
  ├─ Website URL                 → fetch HTML/CSS → infer tokens + logos + UI kit
  ├─ Figma file URL              → Figma REST (styles + components) → tokens
  ├─ Uploaded PDF/PPTX           → extract images/text → cluster colors (k-means)
  └─ Uploaded assets (logos etc) → sharp color histograms, fontkit metadata

[Processing pipeline]
  1. Raw asset ingestion          → tmp dir
  2. Token extraction             → candidate {colors, typography, spacing, radii, shadows}
  3. LLM custom tool `design_extract_system`:
       input:  raw tokens + brand name + sample screenshots
       output: {readme_md, skill_md, colors_and_type_css, voice_rules, caveats}
  4. File tree synthesis          → generate canonical layout
  5. Auto-generate preview cards  → inject values into 16-section templates
  6. Status: "draft"
  7. Review UI (screenshot 2)     → Publish

[Output]
  Final directory at `~/.burnguard/data/systems/{new_id}/`
```

## 7. State Machine

```
draft → (user reviews) → review → [Publish] → published
                            ↑                      │
                            └──── [Unpublish] ─────┘
```

- `draft`: extracted, not public. Cannot be chosen when creating a project.
- `review`: user is editing (preview cards render partially, manual tweaks allowed).
- `published`: appears in the project-creation dropdown.

## 8. Bundled Sample (Phase 1)

`design system sample/` (Northvale Capital) is embedded at build time. On first run, copied to `~/.burnguard/data/systems/northvale-capital/`.

- Status: locked to `published`
- User edits allowed (they are just local files)
- "Reset" restores from the embedded copy

## 9. Claude Code Interoperability

The `SKILL.md` frontmatter conforms to Claude Code's [user-invocable skill](https://docs.anthropic.com/en/docs/claude-code/skills) format. Any DS we produce is usable as a Claude Code skill:

```bash
cp -r ~/.burnguard/data/systems/northvale-capital ~/.claude/skills/
```

After which `/northvale-capital` is invokable from Claude Code CLI. **Two-way interop is an intentional design choice.**

## 10. Font Licensing

- Sample-bundled Pretendard (OFL), KoPub (public/government use license), Zen Serif (OFL) are fine to redistribute
- Commercial fonts must be added by the user to their own `fonts/` directory
- Web-safe fallbacks must always be declared in `fonts.css`

## 11. Publish Workflow (Phase 3 detail)

1. User creates a system via extraction (`draft`) or manual form
2. `draft → review` when the user opens the editor
3. In `review`, user can:
   - Edit any token in `colors_and_type.css`
   - Replace font files
   - Rewrite `README.md` content
   - Approve or remove extracted logo variants
4. Clicking Publish:
   - Lints the tokens (all required variables present?)
   - Re-generates the 16 preview cards
   - Writes a thumbnail
   - Sets `status = published`
5. After publish, the DS appears as a selectable option when creating new projects.

## 12. Extraction Pipeline Details (Phase 3)

### 12.1 GitHub extraction

1. `git clone --depth=1 {url} {tmp}`
2. Scan for known token file patterns:
   - `_colors.scss`, `colors.scss`, `tokens.scss`
   - `tailwind.config.js/ts` (extract `theme.colors`, `fontFamily`, `spacing`)
   - `design-tokens.json` (W3C format)
   - `tokens.css` with `:root { --... }` declarations
3. Scan for logo assets: `*/logos/*.{png,svg}`, `**/logo*.{svg,png}`
4. Emit candidate token bundle

### 12.1b Website extraction

1. Fetch the target HTML
2. Download same-origin linked stylesheets
3. Parse inline/style-link CSS variables and font-family declarations
4. Capture logo-like image candidates
5. Write the homepage or captured shell into `ui_kits/website/`
6. Emit the same candidate token bundle shape as the git path

### 12.2 Figma extraction

1. User supplies Figma personal access token (stored in `config.json`, chmod 600)
2. Call Figma REST `GET /v1/files/{key}/styles` → resolve each style node
3. Map Figma paint styles → color tokens (naming: `Primary/600` → `--primary-600`)
4. Map Figma text styles → typography tokens
5. Call `GET /v1/images/{key}?ids=...` for logo-like frames
6. Emit candidate token bundle

### 12.3 LLM synthesis

The harness invokes Claude Code or Codex with a tool call that takes the candidate bundle and produces:
- `README.md` text (brand analysis)
- `SKILL.md` frontmatter
- `colors_and_type.css` (full file)
- `caveats` list (substitutions, defaults applied)

The LLM is the editorial layer that turns raw token soup into a coherent system.
