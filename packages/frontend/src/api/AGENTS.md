# FRONTEND API KNOWLEDGE BASE

## OVERVIEW

Typed browser client for backend resources; earned this guide at score 9 for 17 modules (~1.1k LOC), broad exports, and central use by all views. `client.ts` exports `ApiError`, `bootstrapApiAuthority`, `authorizedFetch`, `apiFetch`; every other module builds on them.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Authority/fetch behavior | `client.ts` | Capability bootstrap and shared envelope unwrapping |
| Workspace reads | `project.ts`, `session.ts` | `session.ts` (184 LOC) is the largest module: turn commands, interrupt, backend switch, tool decisions, and the `EventSource` subscription |
| Artifact mutation | `files.ts`, `checkpoints.ts`, `draws.ts` | Preserve revision/digest headers and conflicts |
| Design workflows | `design-directions.ts`, `design-audit.ts` | Lifecycle state and retries |
| Design systems | `design-system.ts`, `design-system-metadata.ts` | Extraction, tokens, metadata CAS |
| Export jobs | `export.ts` | Creation, status, retry, cancel, download models |
| Home/settings | `home.ts`, `settings.ts` | Local capability status, install operations |
| Review/palette | `ux-review.ts`, `project-palette.ts` | UX review runs and project color palette |
| Query cache | `queryClient.ts` | Singleton TanStack client shared by `main.tsx` and views |

## CONVENTIONS

- Call `bootstrapApiAuthority()` before rendering consumers; later requests use the in-memory launch capability.
- Prefer `apiFetch<T>` for JSON envelopes and `authorizedFetch` only when headers or non-JSON bodies matter.
- Let `apiFetch` set JSON content type; leave it unset for `FormData` so the browser supplies the boundary.
- Throw `ApiError` with backend `code`, `status`, and `details`; views map codes to user-facing Korean copy.
- Reuse DTOs and parsers from `@bg/shared` rather than declaring lookalike transport types.
- Keep one module per backend resource family and expose small function-oriented calls.
- Treat a successful empty body as valid `void`, especially delete endpoints.

## ANTI-PATTERNS

- Do not call bare `fetch` for protected API routes outside authority bootstrap.
- Do not persist the launch capability in local storage, query strings, logs, or application state.
- Do not display raw backend messages or `details` directly to users.
- Do not manually set multipart `content-type`; that drops the generated boundary.
- Do not hide stale identity or conflict codes as generic network failures.
- Do not duplicate backend response envelopes or shared contract unions locally.
- Do not trigger refetch races where SSE event merging is the established authority path.
- Do not let a malformed SSE payload or a consumer exception tear down a healthy `EventSource`; validate the envelope and keep the reconnect cycle quiet.
