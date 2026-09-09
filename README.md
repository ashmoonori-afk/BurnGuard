![BurnGuard — your local AI design studio for slides, websites and graphics](doc/images/burnguard-cover.png)

# BurnGuard

<img src="doc/images/burnguard-mark.png" width="72" height="72" alt="BurnGuard brand mark" />

**Describe an idea, refine it on canvas, and take the files with you.**

BurnGuard is an AI design workspace that runs on your computer. Connect **Claude Code or Codex CLI** to create slide decks, web designs, and graphics, then refine them through conversation and the canvas. Choose the model and reasoning effort for each request; **LOW and vanilla mode are the defaults**. Projects and design systems are stored locally.

[한국어](README.ko.md) · [Get started](#get-started) · [Workflow](#workflow) · [Development](#development) · [Documentation](doc/README.md)

> The cover is an AI-generated concept illustration. The screenshots below show the actual app using a separate local sample profile.

## One workspace

| What you want to make | What you can do in BurnGuard |
|---|---|
| Presentations | Create a slide deck, review each slide, then present it or export it as PDF or PPTX. |
| Web designs | Create a homepage and linked subpages, navigate them in the preview, and edit HTML on canvas. Start from landing templates with matching design systems. |
| Graphics | Set the canvas dimensions, create a design, and export it as PNG. |
| Consistent designs | Connect a published design system's colors, typography, and rules to a project. |
| Work from existing material | Choose a template or attach PDF/PPTX documents and assign reference roles. |
| Interactive 3D | Add and adjust Three.js objects, or ask AI to create a scene; orbit and zoom in the preview. |

PDF and the HTML deck preserve the full slide design. The current PPTX exporter transfers editable text and slide backgrounds; it does not include images or reproduce arbitrary CSS layouts.

### A home for starting and resuming work

Start a new project by choosing its type. Enter a name, audience, and goal, then expand any additional options you need. Search and reopen recent work, your projects, examples, and design systems from their own lists.

![BurnGuard home with new project options and recent projects](doc/images/workspace-home.png)

### An editor that keeps the conversation beside the result

See the actual output beside your AI conversation. Choose editing, styles, comments, drawing, or quality checks as needed, and switch between files to review them. On smaller screens, switch between **Workspace (작업 화면)** and **AI conversation (AI 대화)** to give each enough room.

![Workspace with separate conversation, canvas, and editing tools](doc/images/workspace-editor.png)

## Review and refine

Open **Quality → UX improvements** to review the current HTML structure and search 10 original patterns. Send a proposal to the existing AI conversation with an explicit click, preserving the selected model and effort. Product-owned anti-slop rules and model-specific execution guidance apply to generation; static heuristics do not certify usability or visual quality. [Guidance and verification scope](doc/design-craft.md).

Edit text and images individually. Website ZIPs include the project HTML, CSS, JavaScript, images and bundled fonts: extract and upload to static hosting. Features that require an external API or server still need that service.

Select an element to resize or rotate it with canvas handles, or enter its width, height and aspect ratio. Typography and spacing live under **Advanced (고급)**. The **Color palette** beside Quality updates opaque HEX colors in the current HTML and its linked local CSS, with undo. **Fix issues automatically** sends the current findings to your selected AI and runs another quality check after the turn completes; unresolved and unmeasurable checks stay visible.

Generated creative images must use Codex's image tool; unavailable image generation is reported instead of replaced with CSS/SVG artwork. Real locations use verified map embeds, and subpages use layouts suited to their purpose while sharing the brand. The canvas permits official Google Maps embed URLs. NAVER's remote JavaScript API is not supported in the sandbox; it needs a compatible provider integration and configuration.

### Share a website

Choose **Share (공유)**, prepare the validated HTML export, enter a Vercel token (and optional team ID), then click **Publish publicly**. Once Vercel reports READY, copy or open the deployment link. Tokens stay in memory and are cleared when the dialog closes or the deployment is ready. Deployment protection may require visitors to sign in; check it in your Vercel project. [Vercel Hobby](https://vercel.com/docs/plans/hobby) is free for personal, non-commercial use; commercial work needs an appropriate plan. Account-backed live deployment requires your token.

## Get started

### Prerequisites

| Purpose | Required tool |
|---|---|
| Run from source | Bun. The current repository validation environment uses Bun 1.3.13 on Windows. |
| AI generation | An installed and authenticated `claude` or `codex` CLI |
| PDF, PPTX, and PNG rendering and previews | Chromium or a supported Chrome/Edge installation. Check its status in the app settings. |
| Read PDF chat attachments | Bundled Node and PDF.js; no Python installation needed. Image-only PDFs retain their original, with an explicit note that OCR was not performed. |
| Import design systems from PDF/PPTX; read PPTX attachments | Python 3; PDF design-system extraction additionally requires the supported `pypdf` version. Check the app settings. |

You can explore the built-in examples and canvas before connecting an AI tool. Generation requires authentication for the selected CLI and is subject to its provider's terms.

Graphic projects require an authenticated Codex connection. Vanilla mode excludes personal plugins and instructions while keeping BurnGuard's project context. Its CLI flags were checked with Codex 0.153.4 and Claude Code 2.1.261; older CLIs may need updating. Turn vanilla mode off explicitly to use personal configuration.

### Windows desktop app

Install **`BurnGuard-win-Setup.exe`**, or extract **`BurnGuard-win-Portable.zip`** and open `BurnGuard.exe`. The native window uses the shared **Microsoft Edge WebView2 Runtime**, starts the local engine, and stops owned work when you close it. Existing projects in `%USERPROFILE%\.burnguard` remain available. Stop any older browser-mode BurnGuard server first.

Version **0.5.0** adds automatic updates through GitHub Releases: the app checks at startup and every six hours, downloads a new stable release, and applies it on the next launch. You can also choose **다시 시작해 적용** in the bottom bar; this stops current work and restarts the app. Offline checks do not prevent using the workspace. Releases must be published with their update assets before the public feed can supply updates.

The portable app targets **Windows 10/11 x64 with .NET Framework 4.8**. If WebView2 is missing, install Microsoft's [Evergreen Runtime](https://go.microsoft.com/fwlink/p/?LinkId=2124703). The app does not include a separate Chromium browser. AI CLIs, rendering, and document-import prerequisites still apply.

To build it from source, install the **.NET 8 SDK**, then run:

```powershell
bun install --frozen-lockfile
bun run build:windows:release
```

Publish the installer, portable ZIP, `.nupkg`, and `releases.win.json` from **`dist/releases/`** together. The raw `dist/windows-native/` development folder has no update installation metadata. Existing 0.4.0 users need to switch to the new installer or portable package once. Packages are currently unsigned. [Build, publish, and update guide](doc/13-windows-updates-and-original-samples.md).

### Four original sample collections

Six Google Fonts families and Pretendard are bundled locally: DM Sans, Space Grotesk, DM Serif Display, Bebas Neue, IBM Plex Mono, and Gowun Batang, with Pretendard for Korean body text. Original collections use distinct pairings; new projects and built-in themes include the fonts and license notices, and the style panel offers these families. [Font sources](assets/fonts/README.md) · [Typography baseline](doc/05-design-system-format.md#bundled-typography-baseline)

Start in **Examples (예시)** or select an original design system in **New project → Template**. Each collection includes a complete web page, six-slide presentation, 1080 × 1350 graphic, and a published design system with tokens, composition rules, and a visual preview. Web pages contain seven or more sections. Your copies appear in My projects; edited or deleted examples stay that way across restarts.

| SONNEL · tactile sound objects | FOLIOVER · material journal |
|---|---|
| ![SONNEL original sound object](samples/original/sonnel/assets/hero.png) | ![FOLIOVER original material composition](samples/original/foliover/assets/hero.png) |
| ODDWARD · experimental studio | VELUNE · sculptural lighting |
| ![ODDWARD original chrome sculpture](samples/original/oddward/assets/hero.png) | ![VELUNE original glass light](samples/original/velune/assets/hero.png) |

These are fictional concepts with newly written copy and four generated images. They are not commercial products or affiliations with the reference sites. [Sample sources, image prompts, and design references](samples/original/README.md).

### Run from source in a browser

```powershell
git clone https://github.com/ashmoonori-afk/BurnGuard.git
cd BurnGuard
bun install --frozen-lockfile
bun run scripts/dev-launcher.ts
```

This development launcher waits for the backend to be ready, starts the frontend, and opens a browser.

On Windows, double-click `Start-BurnGuard.bat` to open the native app. It builds the app on first launch (Bun and the .NET 8 SDK are required), then opens the existing build immediately on later launches. After updating source code, run `Start-BurnGuard.bat --rebuild` to build and open the updated app. Close the browser-mode servers before opening the native app.

- App: **http://127.0.0.1:5173**
- Backend health: **http://127.0.0.1:14070/api/health**
- Stop: press `Ctrl+C` in the running terminal.

If another program is using a default port, identify it before trying again. The launcher does not terminate other processes automatically.

### Build a distributable folder

```powershell
bun run build
```

Run `dist/windows/burnguard-design.exe` to serve the built UI at **http://127.0.0.1:14070**. To distribute the app, copy the **entire `dist/windows` folder**. Its `resources` directory includes the UI, migrations, bundled design assets, Playwright, Node, and their licenses. Check Chromium and Python availability separately.

macOS builds use the same Velopack release channel: `bun run build:mac:release` produces the installer, portable app and `releases.osx.json` feed, and the packaged app checks GitHub Releases for updates from Settings → 업데이트. See the [build and development guide](doc/CONTRIBUTING.md) and [updates](doc/13-windows-updates-and-original-samples.md#macos-packaging-and-updates).

## Workflow

1. **New project** — Choose slides, web design, graphic, or template. Set the brief and section count, and upload source material immediately. Attachments and the brief arrive as an editable conversation draft.
   Once the project exists, selected attachments are immediately preserved in `docs/attachments`. Originals survive send failures, removing a selection, AI edits, and undo; they appear in Project Files for download and are excluded from website publication.
2. **Create with AI** — Select the model and effort, review the draft, then send it. Increase effort explicitly when the task needs more reasoning; LOW does not guarantee a particular response time.
3. **Review the result** — Open generated files and inspect them on canvas. Conversation drafts and attachment roles are restored per session.
4. **Refine directly** — Pan and zoom the canvas, scroll while editing styles, load installed fonts, and adjust 3D objects. Send a saved comment to AI with its file and target context, then follow the result in the conversation. Undo/Redo and quality checks remain available.
5. **Export** — Choose a format supported by the project. Follow progress, cancellation, failure, and expiration states, then download an available result.

![New project screen guiding users through project type and required details](doc/images/project-create.png)

## Design systems and settings

In **Design systems (디자인 시스템)**, review imported material, inspect colors, typography, and previews, then publish it. Projects use published systems. URL, Figma, and file imports depend on the supported source formats and authentication requirements.

**Pinterest mood import** accepts up to 12 public pin URLs and creates a reviewable draft from sampled image colors and available metadata. It distinguishes sampled evidence from inferred mood and fallback fonts. Private pins, boards, and shortened links are not supported; unavailable pins are reported individually.

**Settings and connections (설정 및 연결)** brings together your profile, default AI tool, display theme, Chromium, Python, and Figma connection. If one tool's status check fails, you can still edit other settings and retry the failed check separately.

Save or delete a **CommandCode API key** in settings to route supported Claude models through the [CommandCode provider API](https://commandcode.ai/docs/provider). This integration still uses the installed Claude Code CLI. The saved key is never returned by the settings API; real provider execution needs your valid key and account. Local fonts are loaded only when requested, using browser permission or the Windows font list; font files are not uploaded or embedded in exports.

## Data and network use

The default data directory is `~/.burnguard/`, or `%USERPROFILE%\.burnguard\` on Windows.

```text
.burnguard/
├── config.json          # User settings
├── burnguard.db         # Projects, conversations, events, and job state
├── data/
│   ├── projects/        # Project files
│   └── systems/         # Design systems
├── cache/exports/       # Exported results
└── logs/
```

Local storage does not mean all processing happens offline. During AI generation, prompts and selected context are sent to the provider used by your CLI. Web and Figma imports and tool installation also use the network. Check your provider's policies before attaching sensitive material.

The app binds to loopback and checks API launch authority and Host/Origin. The canvas runs in a separate sandbox under a Content-Security-Policy that keeps generated artifacts from reaching other hosts, and raw project files are never rendered as a top-level page. Other processes and users on the same machine are trusted: do not run BurnGuard on a shared or remotely reachable host, and never expose this server directly to the internet. See the [security model](doc/01-architecture.md#7-security-and-safety-model).

## Development

The Bun monorepo uses the existing React, React Query, Radix, and Tailwind stack, without adding a new state management or design library.

| Path | Responsibility |
|---|---|
| `packages/frontend` | React/Vite UI, conversations, canvas, design systems, and settings |
| `packages/backend` | Hono, SQLite, CLI execution, file recovery, extraction, and exports |
| `packages/shared` | Versioned API and event contracts and parsers |
| `packages/desktop-windows` | Windows x64 WinForms/WebView2 window and owned engine lifecycle |
| `scripts` | Launching, builds, and isolated QA |

```powershell
bun run typecheck
bun run build:frontend
bun run test
bun run test:coverage
bun run lint
node scripts/qa/e2e-smoke.mjs
```

Run tests from the repository root. The preload prepares an isolated temporary profile and a database using the real migrations. Browser QA requires Node.js 22.13 or later, uses a sample profile separate from your work, and does not send external model requests. If you use the npm-provided Windows Bun command shim, pass `--bun <absolute path to bun.exe>` to browser QA. Running browser-heavy checks sequentially is more reliable.

`lint` runs `git diff --check`. Passing tests and meeting the per-file 80% coverage threshold are separate results. The previous review passed all tests but missed the per-file coverage threshold; those results are not reused as validation of the new UI.

## Current scope

- This is a single-user workspace that uses local CLIs. Cloud collaborative editing, hosting, and automatic deployment are outside its scope.
- The research catalog supplies references and limitations for generation. It does not provide a separate research management UI or guarantee the quality of every source. See the [research documentation](doc/research.md).
- External providers, Figma accounts, all user document types, macOS, Narrator, and full accessibility conformance require verification beyond local regression tests.
- Per-file coverage gaps and the exact validation scope are recorded in the [previous review](doc/09-review-remediation-2026-09-08.md), [UI redesign](doc/10-ui-redesign-2026-09-09.md), and [creation and canvas update](doc/11-creation-tools-and-canvas-2026-09-09.md).

## Documentation and license

[Documentation index](doc/README.md) · [Contributing](doc/CONTRIBUTING.md) · [Architecture](doc/01-architecture.md) · [Data model](doc/02-data-model.md) · [Design system format](doc/05-design-system-format.md)

The code is licensed under **Apache-2.0**. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for third-party sources and licenses. The [image notes](doc/images/README.md) describe image generation and the scope of the actual app screenshots.

The generated B mark, palette, and usage rules are documented in the [brand identity guide](doc/brand-identity.md).
