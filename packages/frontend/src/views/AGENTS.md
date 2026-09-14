# FRONTEND VIEWS KNOWLEDGE BASE

## OVERVIEW

Five route compositions (3,435 LOC) mounted by `App.tsx`; earned this guide at score 9 for route-boundary ownership, symbol density, and `ProjectView` centrality over canvas, chat, modes, and export.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Route table | `../App.tsx` | `/`, `/projects/:id`, `/systems/:id`, `/settings`; `ProjectRoute` passes `key={id}` so a project switch remounts |
| Workspace orchestration | `ProjectView.tsx` | 1,741 LOC, largest file in the repo: session events, artifact tabs/history, comments, directions, modes, present, palette |
| Home surfaces | `HomeView.tsx` | 877 LOC: project/system listing plus create, import, delete, restore mutations |
| Design-system editing | `DesignSystemView.tsx` | 729 LOC; also named-exports `ColorTokenEditor` |
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
- Do not leave the frame describing a change the backend rejected - a rejected PATCH must roll the canvas UI back (`ProjectView.tsx:1645`).
- Do not add a second repair workflow: platform lint repair reuses the quality-repair send path (`ProjectView.tsx:1095`).
- Do not poll for state the session SSE stream or the frame bridge already signals.
- Do not push view-only orchestration down into `components/` or up into a new global store.
