# BUILT-IN THEMES KNOWLEDGE BASE

## OVERVIEW

Seventeen bundled design systems copied into every workspace on first run - ten converted from daisyUI donor palettes and seven original editorial systems; earned this guide at score 8 for subdirectory count plus a slug/token contract that backend seeding reads by path.

## STRUCTURE

```text
design system themes/<slug>/     # donor: light, dark, cupcake, retro, cyberpunk,
├── colors_and_type.css          #   synthwave, luxury, dracula, nord, business
│                                # original: cobalt-atelier, signal-reel, daylight-press,
│                                #   blueprint-manual, ledger-index, dune-editorial, archive-folio
├── README.md                    # token contract, provenance, local typography
└── SKILL.md                     # agent-facing generation guidance
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Slug registry | `packages/backend/src/data/bundled-design-systems.ts` | `bundledDesignSystems`, `bundledDesignSystemId` → `builtin-theme-<slug>` |
| Seeding | `packages/backend/src/bootstrap.ts` `seedBundledDesignSystems` | Copies `<slug>/` into `~/.burnguard/data/systems/builtin-theme-<slug>`, then bundled fonts; skips if the destination exists |
| Packaging | `scripts/package-runtime.ts` | Ships everything under the `design system themes/` prefix - the path contains spaces, so quote it everywhere |
| Verification | `packages/backend/tests/daisyui-seed-themes.test.ts` | Checks theme shape and token parity |
| Attribution | `../NOTICE`, each `README.md` | daisyUI MIT attribution is required per theme |

## CONVENTIONS

- A theme directory is exactly three files; the slug must be registered in `bundledDesignSystems` or it is never seeded.
- `colors_and_type.css` is the single source of truth and uses BurnGuard's canonical token families: `--gray-*`, `--chart-*`, semantic pairs, `--r-*`, `--shadow-*`, `--dur-*`.
- Donor palettes (daisyUI) are converted from OKLCH to sRGB **offline**, gamut-clipped, rounded to 8-bit, and recorded with license and source URL in `README.md`.
- Original systems carry no donor attribution and must not claim one; their `README.md` states they are authored for BurnGuard. They additionally ship `--layout-*` tokens (max width, measure, columns, gutter, margin, section rhythm, rule weight, breakpoints, hero ratio) and document that grid under a `## Layout` heading, because layout is part of the system rather than a per-artifact decision.
- Original systems carry no donor attribution and must not claim one; their `README.md` states they are authored for BurnGuard. They additionally ship `--layout-*` tokens (max width, measure, columns, gutter, margin, section rhythm, rule weight, breakpoints, hero ratio) and document that grid under a `## Layout` heading, because layout is part of the system rather than a per-artifact decision.
- `SKILL.md` carries YAML front matter (`name: builtin-<slug>-design`, `description`, `user-invocable: true`) and points the reader at `README.md` first.
- Typography is local: display/body/mono plus a Korean fallback, with `fonts/` and `fonts.css` copied into every generated output.
- `README.md` and `SKILL.md` repeat the typography and accessibility block verbatim; keep them in sync when either changes.

## ANTI-PATTERNS

- Do not reference a CDN, `@import` a web font, or rely on a system-only font substitute.
- Do not add a theme directory without registering the slug, and do not rename a slug - seeded workspaces key off `builtin-theme-<slug>`.
- Do not introduce component-local color, radius, or duration scales instead of the canonical tokens.
- Do not drop the provenance or license paragraph; the `NOTICE` file and the README must agree.
- Do not drop a semantic background's paired foreground token; contrast guarantees depend on the pair.
