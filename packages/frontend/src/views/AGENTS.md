# FRONTEND VIEWS KNOWLEDGE BASE

## OVERVIEW

Six route views (3,788 LOC) mounted by `App.tsx`; earned this guide at score 9 for route-level state ownership, symbol density, and `ProjectView` coordination across canvas, chat, modes, and export.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Route table | `../App.tsx` | `/`, `/projects/:id`, `/systems/:id`, `/settings`, and `*` (`NotFoundView`); `ProjectRoute` sets `key={id}` so switching projects remounts |
| Workspace orchestration | `ProjectView.tsx` | 1,987 LOC: session events, artifact tabs and history, comments, directions, modes, present, palette |
| Home surfaces | `HomeView.tsx` | 922 LOC: project and system lists plus create, import, delete, and restore actions |
| Design-system editing | `DesignSystemView.tsx` | 772 LOC; also exports `ColorTokenEditor` |
| Managed file browsing | `DesignFilesView.tsx` | 69 LOC; embedded inside `ProjectView`, not only a route |
| Settings route | `SettingsView.tsx` | 19 LOC shim; the real UI is `components/settings/SettingsModal.tsx` |

## CONVENTIONS

- One default-exported component per file; views compose features rather than wrapping them - `ProjectView` renders `DesignFilesView` and `DesignSystemView` inline.
- Server state stays in TanStack Query hooks declared in the view; mutations invalidate query keys instead of writing local mirrors.
- Copy comes from `useT`/`t`; backend failures go through `apiErrorCopy` before reaching a toast or inline message.
- Artifact writes carry expected revision/digest identity from `@/lib/artifact-identity`; a stale-identity `ApiError` is a handled branch, not a crash.
- Logic worth asserting moves to `@/lib` or a feature helper and is tested from `packages/frontend/tests`; views keep wiring only.

## ANTI-PATTERNS

- Do not convert `ProjectView`'s mount-only effect into a dependency-tracking effect; it intentionally runs once per project mount.
- Do not leave the frame showing an edit the backend rejected; a failed PATCH must roll back the canvas UI (`ProjectView.tsx`).
- Do not introduce a second repair flow; platform lint repair sends through the existing quality-repair path (`ProjectView.tsx`).
- Do not poll for state the session SSE stream or the frame bridge already signals.
- Do not push view-only orchestration down into `components/` or up into a new global store.
