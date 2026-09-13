![BurnGuard — local AI design workspace](doc/images/burnguard-cover.png)

# BurnGuard

**Describe an idea, refine it on canvas, and take the files with you.**

BurnGuard is a local AI workspace for slide decks, websites and graphics, available as native Windows and macOS apps. Connect Claude Code or Codex CLI, describe what you want to make, and refine it beside a live preview. Projects, attachments and design systems stay on your computer; AI generation uses your chosen provider.

[한국어](README.ko.md) · [简体中文](README.zh-CN.md) · [Download](https://github.com/ashmoonori-afk/BurnGuard/releases/latest) · [Get started](#get-started) · [Documentation](doc/README.md)

## What you can make

| Format | Workflow and output |
|---|---|
| Slide decks | Generate and edit slides, review copy and typography, present, or export HTML, PDF and PPTX. |
| Websites | Create linked pages with shared design tokens and page-specific layouts. Export an HTML/CSS/JS/assets ZIP or publish to your Vercel account. |
| Graphics | Set artboard dimensions, create a poster or multi-frame set, and export PNG, a PNG bundle or PDF. |
| Product detail pages | Build a long marketplace page with section imagery; export section-aware PNG/JPEG slices. |
| Platform pages | Export Cafe24 Smart Design or Imweb code-widget packages with installation guides. Installation is manual. |
| Data charts | Create area, line, bar, composed, radar, pie, radial and Sankey charts. Edit the data, theme and colors; keep portable SVG and source data in HTML. |
| 3D scenes | Add and adjust bundled Three.js objects, or ask AI to edit the scene. |

## Get started

### Install the app

Download the Windows or macOS package from [GitHub Releases](https://github.com/ashmoonori-afk/BurnGuard/releases/latest). On Windows, run the installer or extract the portable ZIP and open `BurnGuard.exe`. macOS packages are unsigned. Both desktop apps use the same local engine and support release-feed updates. See the [installation and update guide](doc/13-windows-updates-and-original-samples.md) for details, or [run from source](#run-from-source).

### Connect AI when you're ready

You can explore examples and edit the canvas before connecting AI. To generate content, install and authenticate Claude Code or Codex CLI, then choose your connection and model in Settings.

| Capability | Requirement |
|---|---|
| Windows desktop | Windows 10/11 x64, .NET Framework 4.8 and Microsoft Edge WebView2 Runtime |
| AI generation | Installed and authenticated `claude` or `codex` CLI; your provider account |
| Graphic generation | Authenticated Codex connection; generated creative images use Codex image generation |
| Render previews and exports | Supported Chrome/Edge or Chromium installation; check Settings |
| Read attachments | PDF, PPTX, DOCX, supported images and text (TXT/MD/CSV); document extraction requirements are shown in Settings |

**LOW effort and vanilla mode are the defaults.** Vanilla mode excludes personal plugins and instructions while preserving BurnGuard's project context. CommandCode routing uses a key entered in Settings and still requires the Claude Code CLI.

## Create and refine your first project

1. **Start or import.** Choose a format or template and add source material, or import an exported HTML project ZIP. BurnGuard reads a bounded inventory of existing HTML/CSS and extracts supported documents for the next AI request. Attached originals are preserved under the project's `docs/attachments` and excluded from website publication. Scanned PDFs retain the original file; automatic OCR is not guaranteed.
2. **Set direction.** Choose from 21 image treatments and 38 purpose recipes across 13 domains, or let each image's role determine its recipe. Set the copy tone, model and effort. [Image production guide](doc/image-production.md).
3. **Generate.** Follow changes in the canvas while the request runs. Session drafts and source attachments remain available when you return.
4. **Refine.** Select elements to resize or rotate them. Use Advanced for fonts and spacing, the palette for colors, or comments for a targeted AI edit. Pan and zoom with Ctrl/Cmd + wheel.
5. **Review and export.** Quality and UX checks offer recommendations and an AI repair action. Their pass/fail status does not block export or publishing; file safety and request-authority checks still apply.

To leave a quick comment, hover over the canvas and press **Control+Option+Space on macOS** or **Control+Space on Windows/Linux**. The comment editor opens at your pointer. On macOS, Control+Space remains available for switching input sources.

![BurnGuard editor with conversation and canvas](doc/images/workspace-editor.png)

## Export and share

Choose the output that fits your project: HTML, PDF or PPTX for slides; an HTML/CSS/JS/assets ZIP for websites; or PNG and PDF for graphics. Product detail pages support section-aware PNG/JPEG slices.

HTML and PDF preserve the rendered slide design. **PPTX contains a high-resolution image of each complete slide, with its text in speaker notes.** Edit individual elements in BurnGuard's HTML workspace, not as PowerPoint objects.

Cafe24 Smart Design and Imweb code-widget packages include installation guides. Installation is manual, and the packages have not been verified in a live customer shop. External APIs and server features still need their own services.

### Publish a website

Choose **Share → Prepare current output**, enter your Vercel token and optional team ID, and select **Publish publicly**. Once the deployment is READY, copy the link. Quality findings remain advisory. Tokens stay in memory and are cleared when the dialog closes or deployment becomes ready. Hosting cost, plan eligibility and visitor access depend on your Vercel account settings; review those in Vercel before publishing.

## Add charts, styles and reusable assets

### Build a chart

Open an HTML file and choose **Chart (차트)** beside the canvas zoom/3D controls. Pick one of the eight types, replace the clearly marked sample data with your own, and save. Paste tab-separated rows from a spreadsheet: the first row names the category and series; subsequent rows contain values. Sankey uses source, target and value columns.

- Use the saved-chart selector to edit any chart in the file. Save uses the current file revision and supports multi-step undo. Use Ctrl/Cmd+Z in the workspace, or Save history to select a retained project revision. Text fields keep native undo; drawing keeps its own local history.
- Choose a theme, source, units and colors; adjust dimensions under Advanced. Composed charts let each series use bars, lines or areas.
- Ask AI to create a chart in its intended page/slide position, or save one and send a layout/data request from the chart panel.
- Charts retain JSON data, inline SVG, native hover titles and an accessible data table. HTML displays them without chart scripts or a CDN. PNG/PDF capture the rendered SVG; they are not editable data-chart formats.

The renderer is an original implementation with no added chart-library dependency. [Chart data contract, limits and examples](doc/charts.md).

### Explore examples and design systems

**21 original image examples cover every visual treatment and all 13 purpose domains.** Each pairs a style with an image's job; these are generated creative examples, not application screenshots. [Full gallery and exact prompts](doc/images/image-recipes/README.md).

| Brand · identity | Watercolor · learning | Print · campaign |
|---|---|---|
| ![Green and citrus stationery identity](doc/images/image-recipes/01-brand.png) | ![Watercolor pea-pod study](doc/images/image-recipes/08-watercolor.png) | ![Vermilion kite print campaign](doc/images/image-recipes/11-print.png) |
| Clay · collectible | Flash · sports | Pixel art · sequence |
| ![Handcrafted clay teapot creature](doc/images/image-recipes/13-clay.png) | ![Direct-flash badminton photograph](doc/images/image-recipes/17-flash.png) | ![Three-scene pixel gardening story](doc/images/image-recipes/20-pixel.png) |

Start with **SONNEL** (tactile sound), **FOLIOVER** (material journal), **ODDWARD** (experimental studio) or **VELUNE** (sculptural lighting). Each original collection includes a website, six-slide deck, graphic and design system. [Explore the collections](samples/original/README.md).

37 font families, 36 from Google Fonts plus Pretendard, are bundled locally with their license notices. The style panel can also load installed fonts when requested; local font files are not automatically embedded in exports. [Font catalog](assets/fonts/README.md).

Import supported files, URLs or Figma sources into Design Systems. Pinterest mood import accepts up to 12 public pin URLs and distinguishes sampled colors from inferred mood and fallback typography. Review a system before publishing it for project use.

## Local data and security

The default profile is `~/.burnguard` (`%USERPROFILE%\.burnguard` on Windows), containing the SQLite database, projects, systems, settings and export cache. Do not delete it when replacing an app package.

Local storage does not mean offline generation: selected context goes to the provider configured in your CLI. Imports and publishing can also use the network. The server binds to loopback, verifies launch capability and Host/Origin, and isolates generated pages in a sandbox. Do not expose the local server to the internet. [Security model](doc/01-architecture.md#7-security-and-safety-model).

## Development

### Run from source

```sh
git clone https://github.com/ashmoonori-afk/BurnGuard.git
cd BurnGuard
bun install --frozen-lockfile
bun run scripts/dev-launcher.ts
```

Use Bun 1.3.14, as pinned in CI. The launcher opens the frontend at `http://127.0.0.1:5173`; the backend binds to `127.0.0.1:14070`. Stop it with Ctrl+C. If a port is occupied, identify the process before starting another instance.

On Windows, `Start-BurnGuard.bat` opens the native app and builds it on first launch; Bun and the .NET 8 SDK are needed for that build. After source changes, use `Start-BurnGuard.bat --rebuild`. See [Development and native builds](doc/CONTRIBUTING.md).

### Project structure

| Package | Responsibility |
|---|---|
| `packages/frontend` | React 18/Vite UI, conversation, canvas and settings |
| `packages/backend` | Bun/Hono, SQLite, generation, durable files and exports |
| `packages/shared` | Versioned contracts, validation and portable chart rendering |
| `packages/desktop-windows` | WinForms/WebView2 shell and updates |
| `packages/desktop-mac` | AppKit/WKWebView shell and updates |

### Validate changes

```sh
bun run typecheck
bun run lint
bun run build:frontend
bun test
# Focused chart validation and isolated browser checks:
bun test packages/backend/tests/charts.test.ts
node scripts/qa/e2e-smoke.mjs --only creation-canvas-charts
```

Run tests from the repository root so the preload creates an isolated temporary profile. Browser QA needs Node.js 22.13+ and Chrome/Edge; on Windows, pass `--bun <absolute-path-to-bun.exe>` if needed. It uses an owned fixture profile and does not submit real provider requests. Coverage (`bun run test:coverage`) is a separate gate from passing tests. Before each release publication, review the final source and packages with Daybreak and resolve blocking security findings.

## Documentation and license

[Documentation index](doc/README.md) · [Architecture](doc/01-architecture.md) · [Design systems](doc/05-design-system-format.md) · [Generation guidance](doc/design-craft.md) · [Brand identity](doc/brand-identity.md)

BurnGuard is licensed under **Apache-2.0**. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for existing third-party notices, and [image notes](doc/images/README.md) for artwork and screenshot provenance.
