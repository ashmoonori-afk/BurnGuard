# FRONTEND LIB KNOWLEDGE BASE

## OVERVIEW

20 dependency-free helper modules (1,515 LOC) holding the view logic worth asserting; earned this guide at score 9 for export count, test-target density, and `cn`/`apiErrorCopy` reference reach.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Class merging | `utils.ts` | `cn` = `clsx` + `tailwind-merge`; 28 importers, the most-used symbol in the package |
| Backend error copy | `error-copy.ts` | `apiErrorCopy` maps stable backend codes to `MessageKey`s, never to literal strings |
| Project creation | `project-creation.ts` | 341 LOC: request building, selectable systems, selection retention |
| Artifact identity | `artifact-identity.ts` | `readFileIdentity`, `isStaleIdentityError`; revision/digest pairing |
| Canvas source/nav | `canvas-source.ts`, `frame-navigation.ts` | `isSafeCanvasPagePath`, `resolveCanvasNavigation`, page targets |
| Canvas media | `canvas-images.ts` | 193 LOC: inline/embedded image handling under the artifact CSP |
| Workflow state | `design-audit-state.ts`, `design-direction-state.ts`, `session-event-state.ts`, `app-update-state.ts` | Pure reducers over query + SSE inputs |
| Draft persistence | `creation-draft.ts` | localStorage draft lifecycle for the creation panel |
| Graphic projects | `graphic-project.ts`, `graphic-preview.ts`, `graphic-set-form.ts` | Canvas parsing, preview selection, form models |
| Fix requests | `quality-fix-request.ts`, `platform-fix-request.ts` | Both build prompts for the single repair send path |

## CONVENTIONS

- Pure functions and types only: no React imports, no hooks, no `fetch`, no query client access.
- Named exports throughout; a module is one topic, and most have a matching `packages/frontend/tests/<name>.test.ts`.
- Inputs are already-parsed `@bg/shared` DTOs; re-parse only when the value crosses a storage or `postMessage` boundary.
- Exhaustive `switch` over discriminants ends with a `never` assignment so a new union member fails typecheck.

## ANTI-PATTERNS

- Do not return partial artifact identity; an incomplete identity is an explicit error (`artifact-identity.ts`).
- Do not surface arbitrary exception text; `canvas-charts.ts` maps known validation messages only.
- Do not emit `data:`/`blob:` stylesheet imports - the artifact CSP forbids them (`canvas-images.ts`).
- Do not clear a persisted draft when creation fails; blocked or full storage costs the draft, not the panel (`creation-draft.ts`).
- Do not show the audit spinner with no report, error, or in-flight request (`design-audit-state.ts`).
- Do not let direction progress move backwards or be synthesized; `updated_at` from the backend is authoritative (`design-direction-state.ts`).
