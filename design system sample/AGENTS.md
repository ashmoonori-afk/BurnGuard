# NORTHVALE SAMPLE SYSTEM KNOWLEDGE BASE

## OVERVIEW

Northvale Capital, the bundled fictional editorial-finance reference design system (44 files); earned this guide at score 8 for file/subdirectory count plus a seeding-and-privacy contract that backend code enforces by path.

## STRUCTURE

```text
design system sample/
├── colors_and_type.css   # single source of truth for tokens
├── README.md             # brand snapshot, content and visual rules
├── SKILL.md              # agent-skill manifest (front matter + quick reference)
├── assets/logos/         # six placeholder SVG lockups
├── fonts/                # Zen Serif, KoPub Batang/Dotum, Pretendard + fonts.css
├── preview/              # 14 cards rendered in the Design System tab
├── ui_kits/website/      # header, hero, insights grid, market strip, callout, footer
└── uploads/              # gitignored drop zone; only .gitkeep is tracked
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Seeding | `packages/backend/src/bootstrap.ts` `seedSampleDesignSystems` | Copies this tree to `systems/northvale-capital`, filtered by `isSampleSourcePathAllowed` |
| Upload exclusion | `isSampleSourcePathAllowed`, `.gitignore` | Anything under `uploads/` is excluded from seeding, packaging, and git |
| Packaging | `scripts/package-runtime.ts` | Ships the `design system sample/` prefix except `design system sample/uploads/` |
| Verification | `packages/backend/tests/package-resources.test.ts`, `daisyui-seed-themes.test.ts` | Assert the uploads exclusion and the system shape |

## CONVENTIONS

- Tokens live only in `colors_and_type.css`; previews and UI kit components reference variables, never literal values.
- Brand voice is institutional and third-person: Title Case headlines, sentence-case body, ALL-CAPS tracked eyebrows (`0.14em`), tabular numerals.
- Visual rules: white/near-white surfaces, `#7399C6` brand blue used sparingly, `#186ADE` for interactive, conservative radii (0/2/4/8), 4px grid, Lucide icons at 1.5px stroke.
- `SKILL.md` front matter (`name: northvale-capital-design`, `user-invocable: true`) sends the reader to `README.md` first; keep its quick reference aligned with the README.
- This tree doubles as the worked example for the authoring contract in `doc/05-design-system-format.md` (local-only record, see doc/README.md; the tracked contract is `design system themes/AGENTS.md`).

## ANTI-PATTERNS

- Never commit anything into `uploads/` except `.gitkeep`; the guard exists because real customer material was once dropped there.
- Do not present Northvale Capital as a real institution, and do not swap the placeholder logos for real trademarks.
- Do not add gradients, textures, playful shapes, glow/scale/bounce/parallax motion, or emoji and pictograph icons.
- Do not use pill-shaped treatments outside filter chips, and do not introduce warm, saturated imagery.
- Do not fork the tokens into a component; change `colors_and_type.css` and let previews and kits follow.
