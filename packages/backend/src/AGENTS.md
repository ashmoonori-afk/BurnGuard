# BACKEND SOURCE KNOWLEDGE BASE

## OVERVIEW

Local Bun/Hono application core; earned this guide at score 13 for its 11-domain layout, module entrypoint, dense exports, and cross-repository centrality.

## STRUCTURE

```text
src/
├── adapters/       # Claude Code and Codex process/stream translation
├── db/             # SQLite schema, repositories, migrations, seed data
├── harness/        # Prompt assembly and shipped artifact skills
├── routes/         # Hono API domain handlers
├── security/       # request authority and managed-path containment (own guide)
├── services/       # lifecycle, extraction, export, and artifact logic (152 modules)
├── runtime/        # browser-injected deck runtime strings
├── lib/            # app-root paths, port probe, browser launch
├── data/           # bundled design systems, fonts, original samples
├── fixtures/       # static JSON payloads read by `data/home.ts`
├── research-data/  # JSON research sources, rules, purpose references
├── config.ts       # atomic 0600 config read/write queue
├── bootstrap.ts    # migrate, seed, reconcile, start watchers
├── server.ts       # API classification and static frontend serving
└── index.ts        # process startup and ordered shutdown
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Change startup order | `bootstrap.ts`, `index.ts` | Migrations precede all reconciliation and watchers |
| Add an API domain | `server.ts`, `routes/` | Update classifier and lazy dispatch together |
| Change localhost trust | `security/request-authority.ts` | Health is public; other API access is capability-bound (see `security/AGENTS.md`) |
| Change managed paths | `lib/paths.ts`, `security/path-boundary.ts` | Existing symlink/junction prefixes are resolved |
| Change shutdown | `index.ts` | Stop intake, interrupt turns, close browsers, then force stop |
| Own the profile | `profile-ownership.ts`, `desktop-lifecycle.ts` | One process per `BG_APP_ROOT`; desktop shell handshake |

## CONVENTIONS

- Bind to `127.0.0.1`; canonical backend port is `14070`, and scanning is opt-in via `BG_SCAN_PORT=1`.
- Keep browser/static serving in `server.ts`; route modules remain lazy-loaded by domain.
- Treat SQLite and canonical filesystem receipts as authorities, not in-memory registries.
- Parse external and persisted `unknown` values before use; expose stable machine-readable error codes.
- `bun run --cwd packages/backend typecheck` covers `src` only (`tsconfig.json` `include`); `tests/` is checked by the root `tsc --build`.
- Run tests from the repository root so `bunfig.toml` preloads `scripts/test-preload.ts`, which mints and migrates a throwaway `BG_APP_ROOT`.
- Narrow runs are `bun test packages/backend/tests/<name>.test.ts`.

## ANTI-PATTERNS

- Do not reorder recovery ahead of migrations or start watchers before reconciliation converges.
- Do not widen host/origin/capability checks for convenience; browser bootstrap is the authority handoff.
- Do not serve user-selected absolute paths; derive locations beneath managed roots.
- Do not expose provider diagnostics, private attachment paths, tokens, or raw trace content through API errors.
- Do not launch long-lived work without an abort/cleanup path that participates in process shutdown.
