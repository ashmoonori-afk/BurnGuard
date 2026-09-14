# FRONTEND COMPONENTS KNOWLEDGE BASE

## OVERVIEW

Feature-oriented React UI and canvas integration; earned this guide at score 14 for 107 files (~12.5k LOC), 14 feature folders, dense symbols, and high-reference primitives.

## STRUCTURE

```text
components/
├── canvas/       # sandbox iframe, frame bridge (847 LOC), draw/edit/tweak overlays (3.1k LOC)
├── chat/         # composer, attachment intake, blocks/ event renderers
├── directions/   # generated direction choices and status
├── errors/       # backend crash toast container, CLI missing modal
├── export/       # format/options, status list, Vercel share
├── files/        # file tree and bounded file preview
├── home/         # project/system landing widgets and dialogs
├── layout/       # AppShell (skip link, focus target), Sidebar, TopBar
├── modes/        # ModePanel orchestrates comment/draw/edit/tweaks/quality/UX panels
├── present/      # fullscreen presentation overlay
├── project/      # workspace top bar and ResizeObserver artifact tabs
├── settings/     # SettingsModal, backend selector, generation controls
├── systems/      # design-system cards, preview iframe
└── ui/           # 7 Radix/shadcn-style primitives
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Canvas rendering | `canvas/Canvas.tsx` | Coordinates iframe, modes, drawings, and failures |
| Frame protocol | `canvas/frame-bridge.ts` | Source identity substitutes for opaque-origin checks |
| Draw persistence | `canvas/DrawLayer.tsx` | Serialization format is consumed by API storage |
| Attachment behavior | `chat/attachment-intake.ts` | Limits, roles, readiness, and supported kinds |
| Tweak controls | `modes/TweaksPanel.tsx` | 630 LOC: parsing, clamping, previews, commit-on-blur |
| Mode routing | `modes/ModePanel.tsx` | Single orchestrator for every mode panel |
| Settings UI | `settings/SettingsModal.tsx` | 627 LOC hub for backend/provider/generation/update/locale state |
| Shared controls | `ui/` | Tailwind variants, Radix parts, focus behavior |

## CONVENTIONS

- Use default exports for feature components and named exports for reusable models, constants, and pure helpers.
- Use `@/` for cross-feature application imports and relative paths within a feature folder.
- Resolve every product string through `useT()` and a typed `MessageKey` in `@/i18n/messages`; Korean stays haeyo-che and each key also carries `en` and `zh-CN`. Map internal errors through stable copy tables.
- Use semantic Tailwind tokens and `cn`; preserve accessible focus and bounded internal scrollports.
- The canvas iframe is `sandbox="allow-scripts allow-popups"` with no `allow-same-origin`; require exact bridge source checks. `systems/PreviewIframe.tsx` is the one deliberate `allow-same-origin` exception, for design-system previews only.
- Subscribe to frame events before triggering actions and clean up subscriptions on unmount.

## ANTI-PATTERNS

- Do not add `allow-same-origin` or weaken bridge source checks because `postMessage` targets `"*"`.
- Do not add independent polling when the frame bridge or application stream can signal the exact change.
- Do not render raw API/provider errors; use the feature error-copy mapping.
- Do not copy stateful view orchestration into reusable components.
- Do not bypass attachment role/limit planning in composer UI.
- Do not replace Lucide icons with emoji, arbitrary SVG sprites, or network-loaded icon assets.
- Do not render unbounded previews; `files/FilePreview.tsx` caps text/image size and `chat/attachment-intake.ts` caps extensions and counts.
