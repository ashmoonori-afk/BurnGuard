# FRONTEND PACKAGE KNOWLEDGE BASE

## OVERVIEW

Vite + React 18 SPA (`@bg/frontend`) driving the whole product UI against the loopback backend; earned this guide at score 15 for 178 source files, 9 source subdomains, its own build/test config, and repo-wide `@/` alias reach.

## STRUCTURE

```text
packages/frontend/
├── src/api/         # one module per backend resource family (own guide)
├── src/components/  # feature UI + canvas integration (own guide)
├── src/views/       # 5 route compositions; ProjectView is 1,741 LOC (own guide)
├── src/lib/         # 20 pure state/serialization helpers + error copy (own guide)
├── src/i18n/        # ko/en/zh-CN message packs behind useT (own guide)
├── src/hooks/       # useSessionEvents, useTheme, useFrameElementRect
├── src/state/       # uiStore.ts, the only Zustand singleton
├── src/mocks/       # typed @bg/shared fixtures for views
└── tests/           # 46 bun:test files + browser fixtures (own guide)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Providers/route table | `src/main.tsx`, `src/App.tsx` | StrictMode > `Bootstrap` > QueryClientProvider > BrowserRouter > `App`; locale applied before render |
| Workspace screen | `src/views/ProjectView.tsx` | Hub for session events, artifact tabs, comments, directions, canvas |
| SSE consumption | `src/hooks/useSessionEvents.ts` | Snapshot + backfill + subscribe, merged through `mergeSessionEvents` |
| Toasts/global UI state | `src/state/uiStore.ts` | `error`/`warn` toasts persist; other tones auto-dismiss after 3s |
| Testable logic | `src/lib/*.ts` | project-creation, design-audit, direction state, canvas geometry |
| Backend error copy | `src/lib/error-copy.ts` | `apiErrorCopy` maps backend codes to localized `MessageKey`s, never literal strings |
| Locale switching | `src/i18n/locale.ts` | `useLocaleStore`, `burnguard.locale` storage key, Korean default and fallback |
| Dev server/proxy | `vite.config.ts` | `127.0.0.1:5173` strictPort; `/api` and `/runtime` proxy to `14070` |
| Design tokens | `tailwind.config.ts`, `src/index.css` | Semantic tokens (`bg-background`, `z-toast`, `shadow-app-3`) |

## CONVENTIONS

- `@` resolves to `src` in both `vite.config.ts` and `tsconfig.json`; transport types always come from `@bg/shared`, never redeclared locally.
- Server state belongs to TanStack Query (`src/api/queryClient.ts` singleton); `uiStore` holds only ephemeral UI state.
- Views are feature compositions, not thin route wrappers - `ProjectView` embeds `DesignFilesView` and `DesignSystemView` directly.
- Extract logic worth asserting into `src/lib` pure functions and test it from `tests/` with `bun:test` Given/When/Then names.
- All user-facing copy resolves through `useT`/`t` with a typed `MessageKey`; every key defines `ko`, `en`, and `zh-CN`.
- Dev server keeps `strictPort`, `frame-ancestors 'none'`, and `X-Frame-Options: DENY`; the deck runtime is proxied from the backend, never bundled.

## ANTI-PATTERNS

- Do not import backend modules into the browser bundle; a test asserts this for the composer path.
- Do not add a second global store or move query cache into Zustand.
- Do not relax the Vite CSP/frame headers or repoint the proxy off loopback.
- Do not use fixed delays in tests; subscribe to the event or state under assertion.
- Do not deep-import another package's `src`; `@bg/shared` subpaths are the contract surface.

## COMMANDS

```bash
bun run --cwd packages/frontend dev        # Vite only (use scripts/dev-launcher.ts for full stack)
bun run --cwd packages/frontend typecheck  # tsc --noEmit
bun run --cwd packages/frontend build      # tsc -b && vite build
bun test packages/frontend/tests/<name>.test.ts
```
