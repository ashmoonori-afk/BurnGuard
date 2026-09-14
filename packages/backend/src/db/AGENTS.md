# DATABASE KNOWLEDGE BASE

## OVERVIEW

SQLite/Drizzle authority and lifecycle repositories; earned this guide at score 14 for 39 modules (~4.8k LOC) plus 14 forward migrations (`0001`-`0014`) and 4 project templates, dense domain exports, and central transactional invariants.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Open database | `client.ts`, `sqlite-client.ts` | Singleton uses WAL, foreign keys, and busy timeout |
| Change schema exports | `schema.ts`, `*-schema.ts` | Root barrel exposes tables consumed by Drizzle |
| Add migration | `migrations/`, `migrate.ts` | Lexical `NNNN_name.sql` order is persisted in `schema_migrations` |
| Migrate a test/local profile | `migrate-local.ts` | Entry called by `scripts/test-preload.ts` before any test runs |
| Seeded tutorials/samples | `seed-tutorials.ts`, `seeded-project-html.ts` | Largest files here (985/590 LOC); bytes must stay stable |
| Project/session CRUD | `seed.ts`, `events.ts` | Seed module also owns core reads and updates |
| Artifact operations | `artifact-operation-repository.ts` | Revision and digest checks guard transitions |
| Export lifecycle | `export-lifecycle-repository.ts` | Attempts, findings, retention, retry, and corruption |
| Research lifecycle | `research-repository.ts` | Canonical evidence and result digests are validated |
| Catalog/design systems | `catalog-repository.ts`, `design-system-repository.ts` | Prepared and committed receipt phases |

## CONVENTIONS

- Use Drizzle for typed relational access and direct `bun:sqlite` statements for guarded state transitions.
- Make lifecycle transitions conditional in SQL and require `changes() === 1`; translate misses to typed conflicts.
- Store canonical JSON and SHA-256 identity wherever recovery must distinguish valid, stale, and corrupt state.
- Keep IDs and timestamps injectable in repository seams used by deterministic tests.
- Add schema changes as forward migrations; keep SQLite and Drizzle declarations in parity.
- Migration table rebuilds may disable foreign keys only outside the transaction and must restore them in `finally`.
- Preserve sorted/canonical path and JSON ordering before digesting or persisting receipts.

## ANTI-PATTERNS

- Do not edit an applied migration to change current behavior; add a lexically later migration.
- Do not turn process-local publication registries into presumed durable locks.
- Do not read lifecycle rows without validating persisted JSON, digest, revision, and owner relationships.
- Do not split an authority transition across unguarded statements when a transaction can make it atomic.
- Do not silently repair corrupt receipts during ordinary reads; classify or quarantine them through recovery.
- Do not generate fixture content dynamically when tests or seeded tutorials depend on stable bytes.
- Do not leave foreign keys disabled after migration failure.
