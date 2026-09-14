# ROUTES KNOWLEDGE BASE

## OVERVIEW

Hono HTTP/SSE boundary: 17 domain route modules plus 3 `*-input.ts` body parsers and one thumbnail handler (~3.4k LOC); earned this guide at score 12 for distinct transport contracts, dense handlers, and central route exports. `session.ts` (606 LOC) is the largest and most coupled module.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Session turns and SSE | `session.ts` | Subscribe-before-backfill prevents reconnect gaps |
| Artifact/export APIs | `artifacts.ts`, `artifact-operations.ts` | Identity conflicts map to explicit status codes |
| Project files | `managed-files.ts`, `project.ts` | Keep managed reads separate from mutation operations |
| Design-system APIs | `system.ts`, `catalog.ts` | Extraction/editing versus catalog lifecycle domains |
| Research/learning | `research.ts`, `learning.ts` | Persisted lifecycle contracts and cancellation |
| Settings/home | `settings.ts`, `home.ts` | Never expose secret values in status payloads |
| Runtime delivery | `runtime.ts` | Shipped deck-stage path is a stable browser contract |

## CONVENTIONS

- Return shared envelopes: `{ data, meta? }` on success and `{ error: { code, message, details? } }` on failure.
- Parse request bodies as `unknown`; reject malformed IDs, enum values, revisions, and contract fields at the edge.
- Use route-local `ok`/`fail` helpers while preserving shared DTO field names.
- Persist sequenced events before publishing them; reconnect paths subscribe before querying backfill.
- Reserve singleton work before accepting uploads, and release reservations on every failure.
- Let services own filesystem/database workflows; routes own transport parsing and status mapping.
- Add route families to `../server.ts` classification and lazy dispatch, not only to a new Hono module.

## ANTI-PATTERNS

- Do not leak provider messages, absolute paths, capability values, or attachment internals in `details`.
- Do not publish an event before its durable sequence exists.
- Do not trust multipart filenames or JSON attachment paths without canonicalization and role validation.
- Do not invent hidden response unions; update shared contracts when a client-visible shape changes.
- Do not collapse `409`, `400`, `404`, `415`, and cancellation cases into generic `500` responses.
- Do not bypass the server classifier with independently mounted route trees.
- Do not let SSE cleanup depend on arbitrary sleeps or polling.
