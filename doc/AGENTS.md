# DOCUMENTATION KNOWLEDGE BASE

## OVERVIEW

13 tracked Markdown documents (four foundational specifications plus topic docs); the numbered records 04–23 and `reference-*.md` are local-only and gitignored (see `README.md`), so a fresh checkout has none of them. Earned this guide at score 8 for an authorship contract that no source guide covers.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Entry point | `README.md` | Index, Start Here, numbered read order, topic table; states which specs are historical |
| Contributing rules | `CONTRIBUTING.md` | Stack conventions, naming, import order, security rules, PR checklist |
| Foundational specs | `00-overview` … `03-backend-adapters` | Overview, architecture, data model, adapters; `04`–`07` (UI spec, design-system format, milestones, ADRs) are local-only |
| Current behavior | `08`–`23` dated records (local-only) | Dated files supersede the numbered specs where they disagree; `14-…-2026-09-09` is the deliverables/publishing authority for maintainers holding the local copies |
| Decisions | `07-decisions.md` (local-only) | 15 ADRs; entries carry context/decision/consequences and a `Supersedes` line |
| Manual smoke steps | `07-manual-smoke-test.md` (local-only) | Referenced by `.github/workflows/security.yml` |
| Generation rule sources | `charts.md`, `design-craft.md`, `image-production.md`, `research.md`, `brand-identity.md` | Product rules that the backend harness prompts mirror |
| Screenshots/assets | `images/`, `screenshots/` | Each has a README with slot names, 2x capture, framing and size budgets (<500 KB per file) |

## CONVENTIONS

- All documentation in `doc/` is English (`CONTRIBUTING.md:171`); `README.md:73` still says English or Korean - CONTRIBUTING wins, and the Korean product README lives at the repo root.
- New implementation records are dated files, `NN-topic-YYYY-MM-DD.md`, added to the `README.md` Start Here list and topic table in the same change.
- ADRs are append-only: supersede with a new entry, mark the old one, never rewrite or delete it.
- Diagrams are ASCII; no Mermaid, PlantUML, or external renderer.
- Status language is date-qualified. A document describing past state stays as written, even when the code has moved on.
- `docs/` (plural, separate tree) holds two standalone dated reports - browser E2E coverage and the security assessment - and is not part of this index.

## ANTI-PATTERNS

- Do not edit a dated record to reflect new behavior; write the next dated record instead.
- Do not treat `04-ui-spec.md` or `06-milestones.md` as a current checklist; `README.md` marks them historical.
- Do not copy `CONTRIBUTING.md`'s `bun run test:e2e` / `tests/e2e/*.spec.ts` references - `17-project-review-and-roadmap-2026-09-11.md:120` records that neither exists; QA lives in `scripts/qa/`.
- Do not rely on the Out-of-Band References table's `ref/` and `devplan/` paths; both are gitignored and absent from a fresh checkout.
- Do not restate source-level API detail here; link the module and let its `AGENTS.md` carry it.
