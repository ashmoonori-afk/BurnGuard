# BUILT-IN THEMES KNOWLEDGE BASE

## OVERVIEW

Forty-one bundled design systems copied into every workspace on first run - ten converted from daisyUI donor palettes and thirty-one original systems; earned this guide at score 8 for subdirectory count plus a slug/token contract that backend seeding reads by path.

## STRUCTURE

```text
design system themes/<slug>/     # donor: light, dark, cupcake, retro, cyberpunk,
├── colors_and_type.css          #   synthwave, luxury, dracula, nord, business
│                                # original: cobalt-atelier, signal-reel, daylight-press,
│                                #   blueprint-manual, ledger-index, dune-editorial, archive-folio
│                                # family originals, four per design family:
│                                #   minimal-tech: signal-console, paper-instrument,
│                                #     quiet-runtime, graphite-spec
│                                #   editorial: long-form-press, wide-gutter-review,
│                                #     quarterly-folio, night-edition
│                                #   commerce: studio-counter, atelier-counter,
│                                #     market-stack, vitrine-mono
│                                #   culture: night-marquee, stencil-field,
│                                #     press-riso, exhibit-wall
│                                #   data-work: index-table, facet-archive,
│                                #     console-ledger, field-register
│                                #   space-life: warm-vestibule, stone-court,
│                                #     linen-retreat, timber-hall
├── README.md                    # token contract, provenance, local typography
└── SKILL.md                     # agent-facing generation guidance
catalogue.html                   # every registered theme rendered on one page; rebuilt, not hand-edited
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Slug registry | `packages/backend/src/data/bundled-design-systems.ts` | `bundledDesignSystems`, `bundledDesignSystemId` → `builtin-theme-<slug>` |
| Seeding | `packages/backend/src/bootstrap.ts` `seedBundledDesignSystems` | Copies `<slug>/` into `~/.burnguard/data/systems/builtin-theme-<slug>`, then bundled fonts; skips if the destination exists |
| Packaging | `scripts/package-runtime.ts` | Ships everything under the `design system themes/` prefix - the path contains spaces, so quote it everywhere |
| Verification | `packages/backend/tests/daisyui-seed-themes.test.ts` | Checks theme shape, token parity, provenance, layout and family tokens, and the reproduction sections |
| Catalogue | `scripts/build-theme-catalogue.ts` | `bun run catalogue` regenerates `catalogue.html` from the registry; never hand-edit it |
| Attribution | `../NOTICE`, each `README.md` | daisyUI MIT attribution is required per theme |

## CONVENTIONS

- A theme directory is exactly three files; the slug must be registered in `bundledDesignSystems` or it is never seeded.
- `colors_and_type.css` is the single source of truth and uses BurnGuard's canonical token families: `--gray-*`, `--chart-*`, semantic pairs, `--r-*`, `--shadow-*`, `--dur-*`.
- Donor palettes (daisyUI) are converted from OKLCH to sRGB **offline**, gamut-clipped, rounded to 8-bit, and recorded with license and source URL in `README.md`.
- Original systems carry no donor attribution and must not claim one; their `README.md` states they are authored for BurnGuard. They additionally ship `--layout-*` tokens (max width, measure, columns, gutter, margin, section rhythm, rule weight, breakpoints, hero ratio) and document that grid under a `## Layout` heading, because layout is part of the system rather than a per-artifact decision.
- An original system must be rebuildable from its own three files plus an image generator, so every `README.md` carries `## Composition` (the arrangement rules tokens cannot express), `## Image direction` (subject, treatment, light, framing, palette, a never-list and a prompt skeleton) and `## Reproducing this system` (a self-check list).
- Family systems additionally ship `--family-*` tokens for the one structural decision their design family turns on - navigation placement, media fit, gallery pattern, table layout, image bleed - and document them under `## Family tokens`. Keep them after the colour section so the hex-only rule on colours still holds.
- `SKILL.md` carries YAML front matter (`name: builtin-<slug>-design`, `description`, `user-invocable: true`) and points the reader at `README.md` first.
- Typography is local: display/body/mono plus a Korean fallback, with `fonts/` and `fonts.css` copied into every generated output.
- `README.md` and `SKILL.md` repeat the typography and accessibility block verbatim; keep them in sync when either changes.

## ANTI-PATTERNS

- Do not reference a CDN, `@import` a web font, or rely on a system-only font substitute.
- Do not add a theme directory without registering the slug, and do not rename a slug - seeded workspaces key off `builtin-theme-<slug>`.
- Do not introduce component-local color, radius, or duration scales instead of the canonical tokens.
- Do not drop the provenance or license paragraph; the `NOTICE` file and the README must agree.
- Do not drop a semantic background's paired foreground token; contrast guarantees depend on the pair.
