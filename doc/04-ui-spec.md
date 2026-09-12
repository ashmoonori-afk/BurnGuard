# UI Specification

Reference screenshots: `ref/스크린샷 2026-04-22 093043.png` and five others.

## 1. Screens

### S-1 Home

#### Layout
Left sidebar (fixed 360 px) + main grid (rest of viewport).

#### Components

**Sidebar**
- Top: brand wordmark "BurnGuard Design" + "Local" badge + version
- Type tabs: Prototype / Slide deck / From template / Other (each opens the "New project" panel)
- On tab click, a "New {type}" panel slides in:
  - `Input` Project name (required)
  - `Select` Design system dropdown (lists published DSs only; optional for ordinary projects)
  - Korean design brief fields: audience, objective, content source, visual mood, density, and output size
  - Type-specific toggles:
    - Slide deck: "Use speaker notes"
    - From template: "Copy template as-is" checkbox and an explicit published design-system source
  - `Button` Create (primary CTA, disabled until name, audience, objective, and any required template source are valid)
  - Caption: "Only you can see your project by default"
- Bottom: user email/name + `Docs` link + user avatar

Template creation accepts any published design system as its source because a
real install does not seed separate template-marked rows. Draft and review
systems never become an implicit project brand, and the UI never selects a
system on the user's behalf.

**Main grid**
- Top tabs: `Recent` · `Your designs` · `Examples` · `Design systems`
- Right: search input (global across projects + DSs)
- Card grid (responsive)
  - Card size: 220 × 180
  - Thumbnail: top 120 px, pastel background + content preview or emoji
  - Title: 17 px semibold
  - Meta: 12 px muted, format `{type} · {relative_time}` (e.g. "Design system · Today")
  - Template card: `TEMPLATE` badge in the top-left
  - Hover: `shadow-3` lift

#### State machine

```
IDLE → (click type tab) → PANEL_OPEN
PANEL_OPEN → (fill name, click Create) → CREATING → (201) → navigate to /projects/{id}
PANEL_OPEN → (click another type tab) → PANEL_OPEN (content swap)
IDLE → (click card) → navigate to /projects/{id} or /systems/{id}
```

### S-2 Project View

#### Layout
Three panels: Chat (left 360 px) + Canvas+Tabs (flex) + Mode Panel (right 320 px; visible only when a mode is active).

#### Top bar (project-scoped)
- Left: project name (inline edit)
- Center: ArtifactTabs
- Right: `Present` `Share` (Phase 2+; Phase 1 omits Share)

#### ArtifactTabs
- `Design System` fixed tab (DS preview)
- `Design Files` fixed tab (file explorer)
- One tab per opened `*.html` file (with close button)
- Active tab: underline emphasis

#### ChatPane (left)
- Top: `Chat` · `Comments` tabs. Comments explains how to activate the canvas `Comment` mode and place a pin.
- Stream area: events rendered top-down in chronological order
  - `agent.message` block: markdown rendering
  - `agent.thinking`: gray inline text, wrapped in `<pre-response-think>`, collapsible
  - `tool.started/finished`: collapsible badge `{tool_name}, {status}` — e.g. `Running JS, Waiting`, `Editing, Screenshot`
  - `file.changed`: link box (click opens corresponding file tab)
  - `status.error`: red card + Retry + Report buttons
  - `usage.delta`: cumulative totals in a footer strip
- Bottom composer:
  - Multiline textarea with placeholder "Describe what you want to create..."
  - Settings control opens the real Settings dialog
  - `자료 첨부` opens the bounded file attachment input
  - `Send` button (primary, Enter to send)
  - No separate Import control; attachments use the same validated upload path

#### Canvas (center)
- Default state: blank white background + placeholder "Describe your idea to get started"
- Render state: iframe rendering project HTML
- Canvas top bar:
  - Mode switcher: `Tweaks` · `Comment` · `Edit` · `Draw` (active depending on phase)
  - Zoom: `75%` dropdown (50/75/100/125/150)
  - `Refresh` button (↻) — reload current project file tree (Phase 1 essential)
- Canvas bottom bar (Slide deck type only, Phase 2):
  - `◀ 01/15 ▶` pagination
  - `reset` (to first slide)

#### Mode Panel (right, based on active mode)

##### Phase 1: read-only selector overlay
- Click element in canvas → purple bbox + this panel shows:
  - Selector breadcrumb
  - Computed style dump (read-only table): font-family, font-size, font-weight, color, width, height, padding, margin, border, border-radius, background

##### Phase 2 Comment
- Form to add a comment on the selected element
- List of existing comments (resolvable)

##### Phase 3 Tweaks (recreation of screenshot 6)
```
TYPOGRAPHY
  Font       [Pretendard ▼]
  Size       [220] px    Weight  [800 ▼]
  Color      [#111111]   Align   [left ▼]
  Line       [0.92]       Tracking [-12.1] px
SIZE
  Width      [1105.55] px  Height [404.781] px
BOX
  Opacity    [1]
  Padding    [0] px   Margin  [0] px
  Border     [0] px   Radius  [0] px
```
- Each field mutates the iframe element's style immediately (debounce 150 ms)
- Change is recorded in the `tweaks` table
- Reset button reverts

### S-3 Design Files view

Recreates screenshot 3. File explorer.

- Left tree (categorized):
  - FOLDERS: `assets/`, `fonts/`, `preview/`, `ui_kits/`, `uploads/`
  - STYLESHEETS: `colors_and_type.css`
  - SCRIPTS: `deck-stage.js`
  - DOCUMENTS: `SKILL.md`, `README.md`
- Click a file → right preview:
  - Text files: syntax-highlighted (Shiki)
  - Images: thumbnail + metadata
  - html/css/js: preview iframe + source toggle
- Top-right actions: `New sketch` · `Paste`
- Bottom drop zone: "DROP FILES HERE — Images, docs, references, Figma links, or folders"

### S-4 Design System view

Follows the sample format:
- Header: DS name + status (draft/review/published) + Publish button
- Tabs: `Design System` (previews) · `Design Files` (asset explorer)
- Contents of Design System tab:
  - Brand: logo lockup grid
  - Colors: render `preview/colors-brand.html`, `colors-neutrals.html`, `colors-ramps.html`, `colors-semantic.html`, `colors-charts.html` as cards
  - Type: `type-display.html`, `type-headings.html`, `type-body.html`
  - Spacing: `spacing.html`
  - Radii & Shadows: `radii-shadows.html`
  - Components: buttons, cards, forms, badges-table

## 2. Colors & Typography (app chrome)

### Palette

The user-supplied tokens in `colors_and_type.css` can be reused for app chrome. Baseline defaults:

```
--app-bg         : #FAFAF7
--app-surface    : #FFFFFF
--app-ink-1      : #1C2B36
--app-ink-2      : #5B7282
--app-ink-3      : #9FB1BD
--app-accent     : #E06B4C   (nods to Claude Design's orange CTA)
--app-border     : #E8E3DB
```

### Fonts

- UI: `Pretendard Variable` (bundled) with `-apple-system, BlinkMacSystemFont, Segoe UI` fallbacks
- Monospace: `SF Mono, Consolas, monospace`
- Display: not used in chrome — reserved for in-artifact design systems

## 3. Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + K` | Global search |
| `Cmd/Ctrl + Enter` | Composer → Send |
| `Cmd/Ctrl + /` | Focus composer |
| `Cmd/Ctrl + R` | Refresh canvas |
| `Esc` | Cancel mode / close modal |
| `?` | Keyboard shortcuts modal |
| `[` / `]` | Slide deck: prev/next slide (Phase 2) |

## 4. Empty states

- Home first visit: auto-create a "Getting started" tutorial project
- Project with 0 messages: "Describe your idea to get started" + three example prompts
- No design systems: "No design systems yet" + "Create" button (Phase 3)

## 5. Error states

- CLI not installed: pre-check modal before project creation — "Claude Code or Codex CLI not found. Install one to continue." + install guide links
- CLI crashed: bottom-right toast "Backend crashed. Click to restart."
- Export failed: failed item appears in export list with Retry

## 6. Responsive behavior

- ≤ 1280 px: Chat pane narrows to 280 px
- ≤ 1024 px: Mode panel auto-hides (becomes floating overlay)
- ≤ 768 px: unsupported (desktop-only warning)

## 7. Component API (representative)

### ChatPane
```tsx
interface ChatPaneProps {
  sessionId: string;
  onAttach: (files: File[]) => void;
  onSend: (text: string, attachments: string[]) => void;
  onInterrupt: () => void;
}
```

### Canvas
```tsx
interface CanvasProps {
  projectId: string;
  entrypoint: string;                 // e.g. 'index.html'
  mode: "select" | "tweaks" | "comment" | "edit" | "draw";
  onElementSelect: (node: SelectedNode) => void;
  onRefresh: () => void;
}

interface SelectedNode {
  nodeId: string;                     // data-bg-node-id
  rect: DOMRect;
  computed: Record<string, string>;   // computed style subset
  file: string;
}
```

### ArtifactTabs
```tsx
interface ArtifactTabsProps {
  tabs: Array<{ id: string; title: string; kind: "design-system" | "design-files" | "file" }>;
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;      // only applicable to file tabs
}
```

### ModePanel (Phase 1 = SelectorOverlayPanel)
```tsx
interface SelectorOverlayPanelProps {
  node: SelectedNode | null;
}
```

## 8. Accessibility

- All interactive elements are keyboard-focusable with a visible focus ring (`--focus-ring`)
- Icon-only buttons carry `aria-label`
- SSE event badges: `role="status" aria-live="polite"` so screen readers announce them
- Canvas iframe is marked `aria-label="Design canvas"`
- Modal dialogs use Radix UI primitives (provided by Shadcn)

## 9. Internationalization

Application UI supports Korean (`ko`), English (`en`), and Simplified Chinese
(`zh-CN`). Typed message packs live in `packages/frontend/src/i18n/messages/`.
Korean remains the initial default. Settings > Appearance applies language
selection immediately and stores it locally under `burnguard.locale`, including
for the bootstrap/offline screen. Language selection is independent of the
settings Save and Cancel actions.

Components subscribe through `useT()`; non-component copy helpers resolve `t()`
when invoked rather than storing translated module-level values. Message keys
and interpolation placeholders are shared across all three locales. Plural
forms and dates follow the selected locale. The application updates the document
language, while Korean-only keep-all wrapping does not constrain Chinese text.

User input, agent replies, generated artifacts, project and file names, and
persisted project content are not translated by the interface language switch.
