# SHARED CONTRACTS KNOWLEDGE BASE

## OVERVIEW

Shared API and persistence contracts across packages; earned this guide at score 14 for 66 modules, a barrel re-exporting almost all of them, strict schemas, and workspace-wide imports.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Public barrel | `index.ts` | Re-export additions used through `@bg/shared`; `package.json` `main`/`exports` resolve to `src`, so consumers compile this source directly |
| App identity | `app.ts` | `APP_NAME`, `APP_VERSION` (stamped into native installers), `BackendId`, `ProjectType`, `ThemeMode` |
| API envelopes | `api.ts` | Success/error transport shapes |
| Session events | `events.ts` | Normalized backend-to-frontend stream contract |
| Projects/artifacts | `project.ts`, `artifact*.ts` | Revision/digest identities and summaries |
| Exports | `export.ts`, `export-attempt.ts` | Options, attempts, receipts, lifecycle states |
| Design systems | `design-system.ts`, `extraction-*.ts` | Sources, provenance, strict extraction domains |
| Design rules and DESIGN.md | `design-system-rules.ts`, `design-md.ts` | Do and Don't rule schema; single-file DESIGN.md import and export |
| Research/learning | `research-contract.ts`, `learning-contract.ts` | Versioned persisted and prompt-facing data |
| Visual/reference inputs | `visual-source.ts`, `reference-layout.ts` | Roles and immutable-underlay contracts |
| Runtime parsing | `contract-parser.ts` | Typed upgrade failures and exact shape checks |
| Settings/generation | `settings.ts`, `generation.ts`, `local-fonts.ts` | Backend selection, generation options, font inventory |
| Scenes and review | `three-scene.ts`, `ux-review.ts`, `design-audit.ts` | Scene payloads and review/audit findings |
| Security and updates | `security.ts`, `updates.ts`, `vercel.ts` | Artifact CSP, updater channel, type-only Vercel share |

## CONVENTIONS

- Define readonly data, literal discriminants, and explicit schema versions for persisted or transported values.
- Pair externally supplied contract shapes with parsers accepting `unknown` and typed upgrade failures.
- Reject unknown keys where canonical bytes, compatibility, or digest identity depends on exact shape.
- Keep arrays sorted and unique when the contract claims canonical ordering.
- Export public modules through both `index.ts` and `package.json` subpaths when direct subpath imports are needed; 32 subpaths are declared today, so omitting a new module from `package.json` is an explicit choice.
- Prefer additive compatible fields only when every parser and consumer can safely handle them.
- Typecheck this package before backend/frontend consumers: `bun run --cwd packages/shared typecheck`.

## ANTI-PATTERNS

- Do not duplicate a DTO in backend routes or frontend API/types; change the shared authority.
- Do not use `any`, unchecked casts, or permissive records at persistence/network boundaries.
- Do not accept unknown discriminants unless the stream contract documents forward-compatible skipping.
- Do not rename route-facing fields or sentinel values without updating parsers and both package consumers.
- Do not mix UI-only state into transport contracts.
- Do not make canonical serialization depend on object insertion order or locale-sensitive sorting.
- Do not expose private absolute paths, tokens, or provider-native diagnostic payloads in shared events.
