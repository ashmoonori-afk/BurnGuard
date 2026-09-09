# Burnguard research catalog

This catalog turns the source-grounded design review retrieved on 2026-08-25 into deterministic repository data. It is a reference set for generation and review, not a replacement for accessibility testing, product judgment, or legal review.

## Artifacts

- `packages/backend/src/research-data/sources.json` is the provenance ledger. Each stable `S-*` record identifies its URL, retrieval date, owner or title, tags, a short paraphrase, usage boundary, confidence, and limitation.
- `packages/backend/src/research-data/common-rules.json` contains reusable `CR-*` rules. Every rule cites ledger IDs and declares its authority class.
- `packages/backend/src/research-data/purpose-references.json` contains the ten supported prompt reference sets. Purpose IDs are selectors, not new project types.

All JSON is UTF-8, two-space indented, newline terminated, and sorted by stable ID. The focused validator rejects noncanonical serialization, duplicate or unsorted IDs, unresolved citations, incomplete provenance, and unsupported purpose IDs.

## Reading authority correctly

`normative_web_constraint` records paraphrase web-content constraints from WCAG material. Their limitations preserve criterion levels, scope, and exceptions. A rule must not be strengthened by dropping those qualifications. In particular, the 24-by-24 CSS pixel target criterion has exceptions, essential two-dimensional layouts can have scoped reflow exceptions, and interaction-triggered animation is Level AAA rather than AA.

`sampled_system_guidance` records synthesis from the named Material, Fluent, Carbon, USWDS, GOV.UK, NHS, Atlassian, Shopify, VA, and Primer sources. Recurrence across this bounded sample supports guidance, not universal law. Exact spacing values, grids, fonts, colors, breakpoints, radii, component names, and vendor token names remain system-specific.

Normative constraints take precedence when both classes apply. Sampled guidance may choose an implementation pattern, but it cannot weaken a normative constraint.

## Purpose axes

Purpose selection keeps four concepts separate:

- `project_type` is the repository generation contract: `prototype` or `slide_deck` in these records.
- `request_intent` selects the applicable subgenre or orthogonal intent, such as `diagram` or `dashboard`.
- `creation_mode` describes whether the reference set supports generated or authored output.
- `fallback` records the generic fallback without treating it as a purpose.

The prompt catalog covers `prototype.landing`, `prototype.dashboard`, `prototype.diagram`, `prototype.editorial`, `prototype.sandbox`, `deck.company`, `deck.pitch`, `deck.report`, `deck.sales`, and `deck.training`. Editorial and sandbox remain prototype subgenres. Diagram remains request intent. Every deck purpose retains medium confidence because the sources support bounded communication principles, not a universal narrative for that deck kind.

The persisted mass-research contract intentionally remains narrower. `ResearchProjectPurpose` accepts the five prototype purposes plus `deck.pitch`; the four additional deck purposes are prompt-catalog selectors only. `selectCatalogRules` can resolve all ten prompt purposes, while `selectResearchPromptContext` rejects a persisted result for a prompt-only purpose until the shared research contract is expanded deliberately.

## Applying records

1. Select exactly one purpose record from explicit request intent and project type.
2. Resolve its `common_rule_ids`, then read every rule with its limitations.
3. Resolve all `source_ids` through the source ledger before presenting a claim as sourced.
4. Preserve conflicts instead of averaging them into false universals. For example, keep spacing configurable and keep prose measure as guidance.
5. Verify the rendered result through its real surface. Data records do not establish conformance by themselves.

Tables and diagrams may need bounded horizontal or two-dimensional behavior at narrow widths. That exception does not exempt surrounding controls, descriptions, or navigation from reflow and keyboard requirements. Likewise, status announcements should not move focus, while an error summary used after submission may deliberately receive focus as a recovery pattern.

## Provenance and reuse boundaries

The evidence fields are original paraphrases under twenty words. They are not copied source prose. The catalog contains no vendor assets, fonts, templates, component code, or proprietary design-system content. Follow each `license_usage` note before reusing anything beyond the paraphrased principle; repository-level licensing assumptions are unsafe where a source has path-specific terms.

Pinned repository URLs identify deterministic source states where the research depended on source code or metadata. Other web URLs record what was retrieved on the ledger date and may change later. Confidence and limitations must remain attached when a claim is surfaced.

## Updating the catalog

Add or revise a source only after checking the primary page, its usage terms, and a counterexample or conflict search. Assign the next stable ID; never recycle an ID. Keep evidence paraphrased and shorter than twenty words. Add a common rule only when skeptic review leaves the claim supported with its scope intact. Add no purpose without a concrete selector and independent evidence for its guidance.

Format each JSON file with `JSON.stringify(value, null, 2)` plus one final newline, sort records lexicographically by ID, and sort citation arrays. From any directory, run:

```sh
cd /tmp
bun test /absolute/path/to/BurnGuard/packages/backend/tests/research-catalog.test.ts
```
