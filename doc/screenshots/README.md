# Screenshots

Slot specifications for optional feature-tour screenshots in `doc/screenshots/`. Place a PNG at any path below to match its documented surface and dimensions.

## Slots

| Path                       | Rendered width | Source resolution | Shown in                                       |
|----------------------------|----------------|-------------------|------------------------------------------------|
| `home.png`                 | 720 px         | 1440 × 900 (2×)   | Home navigation (`Recent work`, `My projects`, `Explore examples`, `Design systems`) |
| `new-project.png`          | 360 px         | 720 × 900 (2×)    | `Create a new project` dialog with format chips (`Slide deck`, `Web design`, `Graphic`, `Logo design`, `Template`, `Other`), idea field, and inline design-system suggestions |
| `chat.png`                 | 720 px         | 1440 × 900 (2×)   | `Chat` and `Comments` tabs, `AI tool` (`Claude Code` / `Codex`) selector, `Options` (`Edit scope`, `Model`, `Reasoning effort`), `Keep as rule`, and `Revert this turn` |
| `canvas.png`               | 720 px         | 1440 × 900 (2×)   | Canvas iframe with top bar (`Preview`, `Edit`, `Style`, `Comment`, `Draw`, `Quality review`, `Fit`, `Desktop 1440`, `Tablet 768`, `Phone 390`, `Background & colors`, `Visual alternatives`, `Save history`) |
| `canvas-tweaks.png`        | 540 px         | 1080 × 900 (2×)   | `Style` panel (`Fonts and colors`, `Spacing and corners`, `Size and rotation`) with color picker open |
| `design-system.png`        | 720 px         | 1440 × 900 (2×)   | Design system view (`Layout and composition`, `Do and don't rules`, `Design previews`, `Colors and fonts`, `Download DESIGN.md`) |
| `ds-import.png`            | 540 px         | 1080 × 720 (2×)   | `Import design system` dialog (`Import from URL` for Git repository, Website, or Figma file; `Upload file` for PPTX, PDF, or `DESIGN.md`) |
| `export-menu.png`          | 320 px         | 640 × 480 (2×)    | `Export` dropdown showing format items (`HTML ZIP file`, `PDF`, `PowerPoint`, `Developer handoff (.zip)`, `PNG bundle (ZIP)`, `Cafe24 Smart Design package`, `Imweb code widget package`) plus `Export settings`, `Print check`, and `Recent exports` |
| `settings.png`             | 640 px         | 1280 × 900 (2×)   | `Settings` modal showing `Generation tools`, `Runtime diagnostics`, `Appearance`, `File conversion` (`Chromium for exports`, `Python for uploads`), `Updates`, and `Connections` |

## Conventions

- **Format:** PNG, 24-bit color, no transparency unless the screenshot
  genuinely has a transparent region (rare).
- **Resolution:** capture at 2× the rendered width so the scale-down
  stays crisp on retina displays. A 720 px slot means a 1440 px PNG.
- **Framing:** crop tight to the relevant surface: include enough
  chrome (tab bar, side nav) to anchor the reader, and drop the rest
  of the OS window.
- **Content:** prefer a realistic deck or website with the bundled sample data
  loaded. Avoid showing in-progress CLI runs or partial toasts unless
  the screenshot is specifically about that state.
- **Compression:** optimize with `pngquant` / `oxipng` before committing
  so binaries stay well under 500 KB. The whole directory target is
  &lt; 5 MB so clone size stays reasonable.

## Adding a new slot

1. Add a new `<img>` tag (with a matching row in `README.ko.md`) at
   the section it belongs to.
2. Append a row to the table above.
3. Commit the PNG alongside the README edits in a single commit
   (`docs(screenshots): add <path>`).
