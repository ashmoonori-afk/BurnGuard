# Logo design deliverable

A `logo` project produces a master vector mark and a brand-guidelines document from a short brief, in two phases that run inside ordinary turns. The contract lives in `packages/shared/src/logo.ts`; the prompt rules in `packages/backend/src/harness/prompt-logo-set.ts` and `skills/logo-skill.ts`; the completion gate in `packages/backend/src/services/logo-deliverables.ts`.

## Brief and flow

Creating a logo project requires `options.logo_set` (`LogoSetV1`): `brand_name`, `niche`, one to seven `character` adjectives, a `logo_type` (`auto` or one of wordmark, lettermark, pictorial, abstract, mascot, combination, emblem), optional `symbol_keywords` and `avoid`. Logo projects need a backend that can generate raster imagery; creation and turn admission refuse with `logo_requires_authenticated_codex` otherwise, exactly like graphic projects.

1. **Explore.** The first turn, and every regenerate, produces exactly four candidate marks with the image-generation tool into `explorations/round-<n>/candidate-1..4.png` (a square between 256 and 4096 px — the tool is asked for about 1024 px and its bytes are kept exactly as returned — one flat mark on a plain ground), records them in `explorations/manifest.json` (`LogoManifestV1`), and replaces `index.html` with a single 1920 x 1080 candidate sheet. With `logo_type: auto` the four candidates span at least three logo types.
2. **Choose.** The app reads the manifest and shows the latest round. `Regenerate` and `Use this candidate` are sent as ordinary chat messages carrying `<burnguard-logo-action-v1>{...}</burnguard-logo-action-v1>`; the phase is derived from the manifest plus that sentinel (`resolveLogoPhase`) before the agent runs, never stored and never re-derived from what the agent wrote. A project holds at most ten rounds; the panel disables regeneration at the cap and the backend refuses a further regenerate before the turn starts.
3. **Finalize.** A select action vectorises the chosen candidate into `logo.svg` (root `<svg>` with `viewBox` and `data-bg-source-exploration="<candidate file>"`; validated by an allowlist parser: paths and basic shapes, local `<use>`, `clipPath`/`mask` only; no `<text>`, `<image>`, `<script>`, `<style>`, `<foreignObject>`, namespace prefixes, DOCTYPE, entities, external references or `url()` outside `clip-path`/`mask`), sets `manifest.selected`, and authors `index.html` as a guidelines document of 1920 x 1080 `[data-graphic-artboard]` pages in this order: cover, index, brand foundation, logo anatomy, construction grid, logo variations, size and ratio, clear space, colour (pairings and HEX/RGB/CMYK palette), logo no-goes grid, typography, applications with the file kit. A document holds 8 to 13 pages: fewer fails the turn and more would exceed the artboard PDF raster budget. It also writes `design-system-patch.json`.

## Image generation is mandatory

The prompt carries the `LOGO_IMAGE_GENERATION_REQUIRED` rule in both phases: candidates are never drawn by hand, and the master vector reproduces the selected generated candidate rather than a new idea. The photorealism contract does not apply to logo candidates (`LOGO_REALISM_EXCEPTION`); a candidate is described to the image tool as a flat vector-style mark. After the turn, `assertLogoDeliverables` rejects the result with `logo_deliverables_missing` when the manifest is absent or malformed, the latest round does not hold four decodable square PNG files whose bytes are new to the project, no successful image-tool call was observed on the turn's event stream, a candidate's bytes are not among the images the image tool reported (hashes attached to its finish event) or wrote between its start and finish (`candidate_unprovenanced`), an earlier round or its candidate files changed, the phase or selected candidate fixed before the turn does not match the tree afterwards, `logo.svg` fails validation or does not name the selected candidate, or the guidelines document has fewer than eight pages. Nothing is published from a failed turn. The image tool's item payload is undocumented and no captured trace exists here, so the adapter hashes two plausible carriers (a base64 PNG, a `.png` path inside the project) and the turn additionally credits files that appear inside the tool's call window; an unrecognised shape fails closed rather than open, and the first real explore turn should confirm the binding.

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

## Sources

The shipped method is distilled from the project's logo master guide and its reference list: the UCDA golden rules and the 99designs/ZillionDesigns seven-step process; George Bokhua's *Principles of Logo Design* (grids, golden ratio), Alina Wheeler's *Designing Brand Identity* and David Airey's *Logo Design Love* (process and deliverables); Paul Rand's writing; Henderson and Cote, "Guidelines for Selecting or Modifying Logos" (Journal of Marketing, 1998) and the 2023 Journal of Business Research figurativeness study for the evaluation dimensions; ZillionDesigns' deliverables and file-format checklists; and public brand manuals (hcma 2022, Asana 2026) for the guidelines structure. None of these are fetched at run time; the prompt carries only the distilled rules.

## Checks

```powershell
bun test packages/backend/tests/logo-contract.test.ts packages/backend/tests/prompt-logo-set.test.ts packages/backend/tests/logo-deliverables.test.ts packages/backend/tests/logo-export.test.ts packages/backend/tests/logo-design-system-sync.test.ts packages/backend/tests/logo-migration.test.ts
bun test packages/frontend/tests/logo-project-creation.test.ts packages/frontend/tests/logo-export-options.test.ts
```

These cover contracts, prompt assembly, the completion gate, export guards and naming, the design-system patch and the migration. They do not submit image-generation requests or judge the quality of a generated mark.
