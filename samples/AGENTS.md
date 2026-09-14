# ORIGINAL SAMPLES KNOWLEDGE BASE

## OVERVIEW

Shipped sample corpus: four fictional brands × three finished formats (33 files) seeded into every user's workspace on first run; earned this guide at score 8 for file count plus a folder contract that backend code reads by path.

## STRUCTURE

```text
samples/original/
├── README.md                 # brand directions, image provenance, font licensing
└── <slug>/                   # sonnel | foliover | oddward | velune
    ├── design-system/        # colors_and_type.css, README.md, SKILL.md, preview.html
    ├── web/index.html        # prototype
    ├── slides/deck.html      # slide_deck (inlines the backend deck runtime)
    ├── graphic/index.html    # graphic, 1080×1350
    └── assets/hero.png       # 1536×1024 generated hero, copied into every format
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Slug/format registry | `packages/backend/src/data/original-samples.ts` | `originalSamples`, `originalSampleFormats` (directory + entrypoint), `originalGraphicCanvas` |
| Copy into a project | `copyOriginalSample` | Copies the format directory, then `assets/`, then bundled fonts |
| Seeding | `packages/backend/src/db/seed-original-samples.ts` | Seeds once; user deletion is permanent and updates never overwrite edited copies |
| Packaging | `scripts/package-runtime.ts` | `samples/original/` is a runtime-source prefix, shipped with the binary |
| Verification | `packages/backend/tests/original-samples.test.ts` | Also gated in `.github/workflows/windows-release.yml` |

## CONVENTIONS

- The directory names are the contract: adding or renaming a brand means editing `originalSamples`, and a format directory/entrypoint pair must match `originalSampleFormats`.
- HTML references assets relatively (`assets/hero.png`) so copied projects and exports stay self-contained.
- Typography is locally bundled (Space Grotesk, IBM Plex Mono, DM Serif Display, Gowun Batang, Bebas Neue, Pretendard, DM Sans) and loaded through `fonts/fonts.css` copied in by the seeder.
- Each brand's `design-system/` follows the same authoring contract as `design system themes/` entries, with a per-brand `SKILL.md`.
- Brands, copy, and depicted objects are invented; `README.md` records the reference research and the generated-image directions.

## ANTI-PATTERNS

- Do not introduce a runtime network dependency: no Google Fonts, CDN scripts, or remote images in sample HTML.
- Do not reference real companies, trademarks, offers, prices, or testimonials in sample copy.
- Do not change the 1080×1350 graphic canvas or a deck's inlined runtime expectations without updating `original-samples.ts` and its test.
- Do not add a brand folder without all three formats plus `assets/`; the seeder copies by path and fails loudly otherwise.
- Do not hand-edit a seeded copy under `~/.burnguard` and expect it to flow back here; this tree is the source.
