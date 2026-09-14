---
name: northvale-capital-design
description: Use this skill to generate well-branded interfaces and assets in the Northvale Capital editorial-finance reference style — a fictional institutional brand bundled with BurnGuard as a worked sample. Contains design guidelines, colors, type, fonts, placeholder logos, and UI kit components for prototyping in an editorial-financial visual language.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

Northvale Capital is **not a real company**. The name and logos are placeholders so the design system has something concrete to reference — fork and rename when shipping for a real brand.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this style.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick reference

- **Tokens:** `colors_and_type.css` — single source of truth for colors, type, spacing, radii, shadows, motion.
- **Fonts:** `fonts/` — Zen Serif (display), KoPub Batang (serif body), Pretendard + KoPub Dotum (sans), IBM Plex Mono (CDN).
- **Logos:** `assets/logos/` — six placeholder SVG lockups (Box, Outline, Reversed, Secondary, Signature, Signature Reverse).
- **UI kit:** `ui_kits/website/` — header, hero, insights grid, market strip, callout band, footer.
- **Voice:** institutional, restrained, third-person. Title-case headlines, sentence-case body, ALL-CAPS tracked eyebrows. No emoji. Tabular numerals everywhere.
- **Visual rules:** white or near-white surfaces, dusty `#7399C6` brand blue used sparingly, `#186ADE` for interactive. No gradients, no textures, no playful shapes. Editorial layouts, generous whitespace, conservative radii (0/2/4/8). Lucide icons at 1.5px stroke.


## Required layout

Read Layout, Composition and Responsive in README.md and apply the --layout-* and --family-* tokens from colors_and_type.css before arranging content. Preserve the grid, reading measure, section rhythm, hero geometry and navigation placement; a palette/font swap on a generic layout is incomplete. Direction variants may change content emphasis, but must retain this structure unless the user explicitly overrides it. Check the rendered result at wide and narrow viewports and 200% zoom; fixed artboards retain their dimensions.
