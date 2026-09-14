# SECURITY BOUNDARY KNOWLEDGE BASE

## OVERVIEW

Five modules (464 LOC) that own every trust decision the rest of the backend depends on; earned this guide at score 9 as a distinct domain with 38 top-level symbols, 18 exports, and 54 backend files importing from `security/` (40 of them `resolveWithin`, 22 `assertSafeName`).

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Validate one path component | `path-boundary.ts` `assertSafeName` | Rejects `.`/`..`, absolute and `C:`-style prefixes, `<>:"/\|?*`, control chars, trailing space/dot, Windows reserved names - on every platform |
| Contain a path under a root | `path-boundary.ts` `resolveWithin` | `realpath`s the longest existing prefix, so not-yet-created leaves are still checked; case-insensitive compare on Win32; `/private` prefix stripped on macOS unless the root itself is `/private/...` |
| Host/origin/capability gate | `request-authority.ts` `createRequestAuthority` | 421 `misdirected_request` on unknown `Host`, 403 `forbidden` otherwise |
| Mint/rotate the capability | `request-authority.ts` `generateLaunchCapability` | 32 random bytes, base64url, per launch; compared with `timingSafeEqual` |
| Change a body ceiling | `request-limits.ts` `requestBodyLimitFor` | 1 MiB JSON default, 4 MiB draw `PUT`, 64 MiB listed multipart routes; `MAX_REQUEST_BODY_BYTES` is the `Bun.serve` hard cap |
| Serve user-written bytes | `raw-file-response.ts` `rawFileHeaders` | `Sec-Fetch-Dest: document` becomes a download; active MIME types get the artifact CSP plus `frame-ancestors <origin>` |
| Detect agent control files | `agent-control-files.ts` | NFC + lowercase match on `agents.md`, `claude.md`, `.mcp.json`, `.claude/`, `.codex/`; app-owned top-level dirs are skipped |

## CONVENTIONS

- `/api/health` is the only public path; `/api/bootstrap` is `GET`-only and requires same-origin (`Origin`, or `Sec-Fetch-Site`+`Sec-Fetch-Mode` when `Origin` is absent), then sets the `HttpOnly; SameSite=Strict; Path=/api` capability cookie.
- Mutations (`POST/PUT/PATCH/DELETE`) require both a matching `Origin` and the `x-burnguard-capability` header; reads may fall back to the cookie.
- Compare secrets only with `timingSafeEqual` on equal-length buffers - never `===`.
- Enforce body ceilings before any handler parses: a declared `Content-Length` is checked up front, and a chunked body is buffered only up to the ceiling and re-wrapped as a fixed-length `Request`.
- Throw typed `PathBoundaryError` (`invalid_name` / `outside_root` / `invalid_path`); every caller catches it and re-throws its own domain error with a stable code (`unsafe_tree_entry`, `project_path_unavailable`, `invalid_preview_id`, ...) - it never escapes as a 500.
- Keep these modules dependency-light: only `node:` builtins, `hono` types, and `@bg/shared/security` for the artifact CSP.

## ANTI-PATTERNS

- Do not join DB- or user-supplied path fragments with `path.join`; every managed read/write goes through `resolveWithin` (see `../lib/paths.ts`).
- Do not add a route to `PUBLIC_API_PATHS` or widen `authorities`; the desktop/dev authority set is fixed at startup.
- Do not add a multipart route without adding its pattern to `MULTIPART_ROUTES`; it silently inherits the 1 MiB JSON cap.
- Do not serve project bytes without `rawFileHeaders`; an HTML artifact rendered as a same-origin top-level document defeats the sandbox.
- Do not log or echo the capability value, resolved absolute paths, or `PathBoundaryError` messages into API responses.
- Do not make `assertSafeName` platform-conditional; the Windows rules run everywhere so a name accepted on macOS stays creatable on Windows.
- Do not bypass `resolveManagedPath` for DB-stored absolute paths (`../lib/paths.ts`); it also rejects the storage root itself as a record path.
