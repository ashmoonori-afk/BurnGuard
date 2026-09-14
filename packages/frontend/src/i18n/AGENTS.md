# FRONTEND I18N KNOWLEDGE BASE

## OVERVIEW

Typed three-locale message registry (16 files, 1,936 LOC) behind every user-facing string; earned this guide at score 12 for its registry module boundary, export surface, and `useT` reach across ~75 modules.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Locale state | `locale.ts` | `LOCALES = ["ko","en","zh-CN"]`, `LOCALE_STORAGE_KEY = "burnguard.locale"`, `useLocaleStore`, `localeTag` (`ko-KR`/`en-US`/`zh-CN`), `applyDocumentLocale` sets `<html lang>` |
| Translate | `t.ts` | `t(key, params)` reads the store snapshot; `useT()` subscribes and re-renders; `formatMessage` does `{name}` interpolation |
| Message shape | `types.ts` | `Message = string \| { one, other }`, `MessageDefinition = Record<Locale, Message>`, `defineMessages` identity helper |
| Registry | `messages/index.ts` | 12 packs spread-merged; `MessageKey = keyof typeof messages` |
| Add copy | `messages/<pack>.ts` | `home` 306, `chat` 252, `modes` 241, `export` 182, `canvas` 173, `directions` 170, `settings` 127, `workspace` 129, `system` 121, `errors` 66, `files` 44, `shell` 27 LOC |

## CONVENTIONS

- Every key defines all three locales; `MessageDefinition` makes a missing locale a typecheck failure, so translation gaps never reach runtime.
- Key namespace equals the pack file name (`shell.*` lives in `messages/shell.ts`); a new pack must be imported into both arrays in `messages/index.ts`.
- Korean is the default and the fallback: `resolveInitialLocale` only accepts `en`/`zh-CN`, everything else resolves to `ko`.
- Plural messages use `{ one, other }` and are selected by `Intl.PluralRules`; numeric params are formatted by `Intl.NumberFormat` for the active locale.
- `localStorage` access is wrapped: a `DOMException` (private mode, blocked storage) degrades to the default locale, any other error rethrows.
- Non-React callers (`@/lib/error-copy`, helpers) use `t`; components use `useT()` so a locale switch re-renders.

## ANTI-PATTERNS

- Do not hardcode user-facing strings in components, mappers, or error copy tables; map to a `MessageKey` instead.
- Do not reuse a key across packs - the spread merge silently keeps the last one registered.
- Do not add an i18n library, remote catalog, or runtime locale fetch; the registry is compiled in.
- Do not format numbers or plurals by hand; pass `params` and let `formatMessage` apply `Intl`.
- Do not delete or empty a `ko` value to "fall back"; there is no runtime fallback chain.

## COMMANDS

```bash
bun test packages/frontend/tests/i18n-locale.test.ts packages/frontend/tests/i18n-messages.test.ts --timeout 30000
```
