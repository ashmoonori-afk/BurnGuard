![BurnGuard — local AI design workspace](doc/images/burnguard-cover.png)

# BurnGuard

**Describe an idea, refine it on canvas, and take the files with you.**

BurnGuard is a local AI workspace for slide decks, websites and graphics, with native Windows and macOS apps. Connect Claude Code or Codex CLI, select a model, and work beside a live preview. **LOW effort and vanilla mode are the defaults.** Projects, attachments and design systems stay on your computer; generation uses your chosen provider.

[한국어](README.ko.md) · [Download](https://github.com/ashmoonori-afk/BurnGuard/releases/latest) · [Get started](#get-started) · [Documentation](doc/README.md)

> This README describes the current source branch. A published desktop release may contain an earlier feature set. The cover is generated artwork; the workspace screenshots are from a separate sample profile.

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

**Export limits:** HTML and PDF preserve the rendered slide design. PPTX preserves each complete slide as a high-resolution image and keeps its text in speaker notes. Individual elements are edited in the HTML workspace, not as PowerPoint objects. External APIs and server features still need their own services. Cafe24/Imweb packages have not been verified in a live customer shop.

## Get started

### Desktop

Download a package from [GitHub Releases](https://github.com/ashmoonori-afk/BurnGuard/releases/latest). On Windows, run the installer or extract the portable ZIP and open `BurnGuard.exe`. macOS packages are unsigned. Both desktop shells use the shared local engine and support release-feed updates; see the [installation, packaging and update guide](doc/13-windows-updates-and-original-samples.md).

| Capability | Requirement |
|---|---|
| Windows desktop | Windows 10/11 x64, .NET Framework 4.8 and Microsoft Edge WebView2 Runtime |
| AI generation | Installed and authenticated `claude` or `codex` CLI; your provider account |
| Graphic generation | Authenticated Codex connection; generated creative images use Codex image generation |
| Render previews and exports | Supported Chrome/Edge or Chromium installation; check Settings |
| Read attachments | PDF, PPTX, DOCX and supported images; document extraction requirements are shown in Settings |

You can explore examples and edit the canvas before connecting AI. Scanned PDFs retain the original file; automatic OCR is not guaranteed. Vanilla mode excludes personal plugins and instructions while preserving BurnGuard's project context. CommandCode routing uses a key entered in Settings and still requires the Claude Code CLI.

### From source

```powershell
git clone https://github.com/ashmoonori-afk/BurnGuard.git
cd BurnGuard
bun install --frozen-lockfile
bun run scripts/dev-launcher.ts
```

Use Bun 1.3.14, as pinned in CI. The launcher opens the frontend at `http://127.0.0.1:5173`; the backend binds to `127.0.0.1:14070`. Stop it with Ctrl+C. If a port is occupied, identify the process before starting another instance.

On Windows, `Start-BurnGuard.bat` opens the native app and builds it on first launch; Bun and the .NET 8 SDK are needed for that build. After source changes, use `Start-BurnGuard.bat --rebuild`. [Development and native builds](doc/CONTRIBUTING.md).

## Work beside the result

1. **Start or import.** Choose a format/template and upload source material, or import an exported HTML project ZIP. Import automatically reads a bounded inventory of existing HTML/CSS and extracts supported docs into the next AI context. Attached originals are preserved under the project's `docs/attachments`; they are excluded from website publication.
2. **Set direction.** Choose from 21 image treatments and 38 purpose recipes across 13 domains, or let each image's role determine its recipe. Set the copy tone, model and effort. [Image production guide](doc/image-production.md).
3. **Generate.** Follow changes in the canvas while the request runs. Session drafts and source attachments remain available when you return.
4. **Refine.** Select elements to resize or rotate them. Use Advanced for fonts and spacing, the palette for colors, or comments for a targeted AI edit. Pan and zoom with Ctrl/Cmd + wheel.
5. **Review and export.** Quality and UX checks offer recommendations and an AI repair action. Their pass/fail status does not block export or publishing; file safety and request-authority checks still apply.

![BurnGuard editor with conversation and canvas](doc/images/workspace-editor.png)

### Charts

Open an HTML file and choose **Chart (차트)** beside the canvas zoom/3D controls. Pick one of the eight types, replace the clearly marked sample data with your own, and save. Paste tab-separated rows from a spreadsheet: the first row names the category and series; subsequent rows contain values. Sankey uses source, target and value columns.

- Use the saved-chart selector to edit any chart in the file. Save uses the current file revision and supports multi-step undo. Use Ctrl/Cmd+Z in the workspace, or Save history to select a retained project revision. Text fields keep native undo; drawing keeps its own local history.
- Choose a theme, source, units and colors; adjust dimensions under Advanced. Composed charts let each series use bars, lines or areas.
- Ask AI to create a chart in its intended page/slide position, or save one and send a layout/data request from the chart panel.
- Charts retain JSON data, inline SVG, native hover titles and an accessible data table. HTML displays them without chart scripts or a CDN. PNG/PDF capture the rendered SVG; they are not editable data-chart formats.

The renderer is an original implementation with no added chart-library dependency. [Chart data contract, limits and examples](doc/charts.md).

### Design systems and examples

Start with **SONNEL** (tactile sound), **FOLIOVER** (material journal), **ODDWARD** (experimental studio) or **VELUNE** (sculptural lighting). Each original collection includes a website, six-slide deck, graphic and design system. [Explore the collections](samples/original/README.md).

Six Google Fonts families and Pretendard are bundled locally with their license notices. The style panel can also load installed fonts when requested; local font files are not automatically embedded in exports. [Font catalog](assets/fonts/README.md).

Import supported files, URLs or Figma sources into Design Systems. Pinterest mood import accepts up to 12 public pin URLs and distinguishes sampled colors from inferred mood and fallback typography. Review a system before publishing it for project use.

### Share a website

Choose **Share → Prepare current output**, enter your Vercel token and optional team ID, and select **Publish publicly**. Once the deployment is READY, copy the link. Quality findings remain advisory. Tokens stay in memory and are cleared when the dialog closes or deployment becomes ready. Hosting cost, plan eligibility and visitor access depend on your Vercel account settings; review those in Vercel before publishing.

## Local data and security

The default profile is `~/.burnguard` (`%USERPROFILE%\.burnguard` on Windows), containing the SQLite database, projects, systems, settings and export cache. Do not delete it when replacing an app package.

Local storage does not mean offline generation: selected context goes to the provider configured in your CLI. Imports and publishing can also use the network. The server binds to loopback, verifies launch capability and Host/Origin, and isolates generated pages in a sandbox. Do not expose the local server to the internet. [Security model](doc/01-architecture.md#7-security-and-safety-model).

## Development

| Package | Responsibility |
|---|---|
| `packages/frontend` | React 18/Vite UI, conversation, canvas and settings |
| `packages/backend` | Bun/Hono, SQLite, generation, durable files and exports |
| `packages/shared` | Versioned contracts, validation and portable chart rendering |
| `packages/desktop-windows` | WinForms/WebView2 shell and updates |
| `packages/desktop-mac` | AppKit/WKWebView shell and updates |

```powershell
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
