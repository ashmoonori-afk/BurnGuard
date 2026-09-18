# Logo design deliverable

A `logo` project produces a master vector mark and a brand-guidelines document from a short brief, in two phases that run inside ordinary turns. The contract lives in `packages/shared/src/logo.ts`; the prompt rules in `packages/backend/src/harness/prompt-logo-set.ts` and `skills/logo-skill.ts`; the completion gate in `packages/backend/src/services/logo-deliverables.ts`.

## Brief and flow

Creating a logo project requires `options.logo_set` (`LogoSetV1`): `brand_name`, `niche`, one to seven `character` adjectives, a `logo_type` (`auto` or one of wordmark, lettermark, pictorial, abstract, mascot, combination, emblem), optional `symbol_keywords` and `avoid`. Logo projects need a backend that can generate raster imagery; creation and turn admission refuse with `logo_requires_authenticated_codex` otherwise, exactly like graphic projects.

1. **Explore.** The first turn, and every regenerate, produces exactly four candidate marks with the image-generation tool into `explorations/round-<n>/candidate-1..4.png` (square 1024 px, one flat mark on a plain ground), records them in `explorations/manifest.json` (`LogoManifestV1`), and replaces `index.html` with a single 1920 x 1080 candidate sheet. With `logo_type: auto` the four candidates span at least three logo types.
2. **Choose.** The app reads the manifest and shows the latest round. `Regenerate` and `Use this candidate` are sent as ordinary chat messages carrying `<burnguard-logo-action-v1>{...}</burnguard-logo-action-v1>`; the phase is derived from the manifest plus that sentinel (`resolveLogoPhase`), never stored.
3. **Finalize.** A select action vectorises the chosen candidate into `logo.svg` (root `<svg>` with `viewBox` and `data-bg-source-exploration="<candidate file>"`; paths and basic shapes only; no `<text>`, `<image>`, `<script>`, `<foreignObject>`, external references or `url()`), sets `manifest.selected`, and authors `index.html` as a guidelines document of 1920 x 1080 `[data-graphic-artboard]` pages in this order: cover, index, brand foundation, logo anatomy, construction grid, logo variations, size and ratio, clear space, colour (pairings and HEX/RGB/CMYK palette), logo no-goes grid, typography, applications with the file kit. A document holds 8 to 13 pages: fewer fails the turn and more would exceed the artboard PDF raster budget. It also writes `design-system-patch.json`.

## Image generation is mandatory

The prompt carries the `LOGO_IMAGE_GENERATION_REQUIRED` rule in both phases: candidates are never drawn by hand, and the master vector reproduces the selected generated candidate rather than a new idea. The photorealism contract does not apply to logo candidates (`LOGO_REALISM_EXCEPTION`); a candidate is described to the image tool as a flat vector-style mark. After the turn, `assertLogoDeliverables` rejects the result with `logo_deliverables_missing` when the manifest is absent or malformed, the latest round does not hold four real PNG files, `logo.svg` fails validation or does not name the selected candidate, or the guidelines document has fewer than eight pages. Nothing is published from a failed turn.

## Exports

| Format | Logo project | Download name |
|---|---|---|
| `svg` | The validated `logo.svg`, copied unchanged, `image/svg+xml` | `<slug>-logo-r<revision>.svg` |
| `pdf` (`pdf_paper: "artboard"`) | One 1920 x 1080 page per guideline artboard | `<slug>-guidelines-r<revision>.pdf` |
| `html_zip` | The guidelines HTML before PDF conversion | `<slug>-guidelines-html-r<revision>.zip` |

`svg` is refused for every other project type (`format_requires_logo`); `png`, `png_zip`, `pptx`, `handoff` and the platform packages are refused for logo projects with their existing reasons. The filename keeps the repository's `-` separator and `r<revision>` suffix.

## Guidelines into the design system

When the project has a selected design system and the finalize turn wrote `design-system-patch.json` (`LogoDesignSystemPatchV1`: up to twelve hex colours, a `## Logo` README section, `logo_asset: "logo.svg"`), the app applies it to that existing system: colours are upserted through the design-system colour token service, the README `## Logo` section is replaced or appended, and `logo.svg` is copied to the system's `assets/` folder. A system is never created by this step, and a failed patch is reported as a warning rather than failing the turn.

## Method reference

The shipped logo skill distils published professional guidance: the seven logo types and when each fits, a seven-criterion value assessment (simplicity, memorability, timelessness, versatility, appropriateness, distinctiveness, structural integrity), geometric construction (circles and tangents, modular grids, golden-ratio proportions, optical correction), shape and symbol meanings, and the tests every mark must pass (grayscale, 16 px, one colour, silhouette, blur, backgrounds, competitor line-up). The guidelines document follows the structure of professional brand books: numbered sections, one rule per page, every rule demonstrated on the mark itself.

## Checks

```powershell
bun test packages/backend/tests/logo-contract.test.ts packages/backend/tests/prompt-logo-set.test.ts packages/backend/tests/logo-deliverables.test.ts packages/backend/tests/logo-export.test.ts packages/backend/tests/logo-design-system-sync.test.ts packages/backend/tests/logo-migration.test.ts
bun test packages/frontend/tests/logo-project-creation.test.ts packages/frontend/tests/logo-export-options.test.ts
```

These cover contracts, prompt assembly, the completion gate, export guards and naming, the design-system patch and the migration. They do not submit image-generation requests or judge the quality of a generated mark.
