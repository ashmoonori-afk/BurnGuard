# Windows updates and original samples — 0.5.0

## Package and publish

Windows 10/11 x64, .NET Framework 4.8, and the Edge WebView2 Evergreen Runtime are required. Build with Bun 1.3.13, Node 24, and the .NET 8 SDK:

```powershell
bun install --frozen-lockfile
bun run build:windows:release
```

The repository pins Velopack CLI/library 1.2.0. `dist/releases/` contains the installer, portable ZIP, full `.nupkg`, `releases.win.json` feed, and SHA256 sums. Distribute the complete installer or portable ZIP. The raw `dist/windows-native/` development directory and its ZIP are not update installations.

Each local packaging run replaces the generated `dist/releases/` directory. Keep published packages in GitHub Releases; local output is a rebuildable workspace.

For each new version:

1. Increase the version together in root/backend/frontend/shared `package.json`, `packages/shared/src/app.ts`, and `packages/desktop-windows/BurnGuard.Desktop.csproj`.
2. Commit and merge the verified change. A tag must match the version, for example `v0.5.0`.
3. Push that tag to run **Windows release package**. The workflow builds packages and creates a **draft** GitHub Release. A manual workflow run only produces a downloadable Actions artifact.
4. Check the installer and portable app, then publish the draft as a stable release with **all generated assets attached**, including `releases.win.json` and `.nupkg`. The app uses the public repository `ashmoonori-afk/BurnGuard`; drafts and prereleases are excluded.

No tag or public release is created by the local build script. Package signing is not configured. Configure a trusted Windows signing certificate in a private release environment before signed distribution; never commit certificate secrets. Changing the repository requires updating the native `GithubSource` URL before shipping the last release on the old feed.

## macOS packaging and updates

macOS packages use the same Velopack tool and the same GitHub release. Build on macOS with Bun 1.3.14 and the .NET 8 SDK:

```bash
bun install --frozen-lockfile
bun run build:mac:release
```

`dist/releases/` then contains `BurnGuard-osx-Setup.pkg`, `BurnGuard-osx-Portable.zip`, the full `.nupkg`, the `releases.osx.json` feed, and SHA256 sums. The packed bundle is `BurnGuard.app` with `Contents/MacOS/UpdateMac` beside the engine; only that bundle can update itself. The bundle also carries the native canvas binding and PDF.js under `Contents/MacOS/node_modules`, which thumbnails, PNG export and PDF rasterization need. The plain `dist/mac/BurnGuard Design.app` and the DMG are development builds without an updater.

The **macOS release package** workflow runs on the same `v*` tag as the Windows workflow and attaches its assets to the same draft release (whichever job finishes first creates the draft). Publish the draft with both `releases.win.json` and `releases.osx.json` attached. Signing and notarization run when `BG_MAC_SIGN_IDENTITY`, `BG_MAC_INSTALL_IDENTITY` and `BG_MAC_NOTARY_PROFILE` are configured; unsigned packages are for verification only and Gatekeeper will warn on first launch.

On macOS the engine itself checks the feed shortly after launch and every six hours, downloads the newer full package into `~/.burnguard/cache/updates`, verifies its SHA-256 against the feed, and shows the result in Settings → 업데이트. **다시 시작해 적용** stops the engine and lets `UpdateMac` swap the bundle and relaunch it. `BG_UPDATE_FEED_URL` (loopback or HTTPS) points the check at a local feed for rehearsals.

## How updates behave

- Once the workspace opens, check for a newer stable version; repeat every six hours or when **업데이트 확인** is pressed.
- Download and verify the package. Keep the running workspace open, then apply the staged update before starting the engine on the next launch.
- **다시 시작해 적용** is an explicit immediate restart: the existing shutdown path interrupts owned work and stops the backend before scheduling the updater.
- A second launch activates the existing window before considering a staged update. Offline/download failures leave the current version usable and can be retried.
- User data remains in `%USERPROFILE%\.burnguard`, outside the application files. The 0.4.0 raw app needs a one-time switch to a new install or portable package.

The [Velopack C# integration](https://docs.velopack.io/getting-started/csharp) and [update source documentation](https://docs.velopack.io/integrating/update-sources) describe the library integration. Actual CLI options were checked with the pinned local tool.

## Original collections

Four invented identities—SONNEL, FOLIOVER, ODDWARD, and VELUNE—each include a web design, six-slide deck, 1080 × 1350 graphic, and published design system. Web designs have at least seven sections. Design systems include CSS tokens, a generation skill, a README, and an HTML preview. Images and copy were authored for these concepts; no source-site logos, product images, or marketing copy are included. See [provenance and prompts](../samples/original/README.md).

New collections appear under Examples. Selecting an original system as a template allows choosing web, slides, or graphic; graphic creation retains the Codex authentication requirement. Each copy includes its local image, ready to edit and export. Durable seed receipts prevent deleted examples from returning and preserve edits during later starts.

## Verification boundary

Focused backend integration checks cover 12 seeds, 12 template copies, canonical digests, local images, graphic dimensions, Examples/Mine classification, and preservation of edits/deletions. Native updater checks cover portable development mode, smoke mode, current version, offline errors, staged updates, and failed downloads.

A separate local Velopack fixture exercised a real 0.1.0 → 0.2.0 package update: a corrupted package was rejected by SHA256 verification; the correct package applied and restarted a new process while preserving profile data and releasing/reacquiring the mutex. That rehearsal is not a public GitHub feed test. Public update delivery remains unverified until releases are published; external AI calls, code signing, and fresh-machine installation require separate verification.

PPTX retains the existing text/background conversion scope. A structurally valid PPTX is not a visual reproduction of these HTML decks: image and arbitrary CSS layout export are unsupported. Use PDF or HTML when preserving the complete design matters.

Local checks on September 9, 2026:

- Typecheck, frontend build, backend/native compilation, and whitespace lint passed.
- Original sample/catalog tests verified that root-level `preview.html` is listed in the app, image assets are served, and graphic examples use Codex sessions.
- Browser inspection covered all 12 examples and four design-system previews: web at 1440/390px without horizontal overflow; six-slide keyboard navigation; exact graphic dimensions; loaded images; no page JavaScript errors. One poster contrast issue was corrected and checked again.
- Real app checks covered all 12 canvas documents, four system cards/previews, and copying web/slide templates. A shared canvas fix loads local images through the authorized parent and embeds them in the opaque frame, including inline CSS images. It keeps the iframe sandbox, limits fetched image bytes, and cancels stale loads. The isolated profile also verified the graphic Codex sign-in gate; no external generation request was sent.
- Export testing uncovered missing compiled native dependencies: the Windows package now carries matching canvas bindings and PDF.js files, with an explicit runtime loader for Bun's virtual compiled paths. Source PDF/PNG/Pinterest and export-validation tests passed. Geometry checks now distinguish visible ink outside a tight line box from actual clipping, and ordinary web content below the fold from fixed-canvas overflow; real clipping and off-canvas cases remain tested.
- The compiled Windows engine successfully generated and downloaded all four graphics as 1080 × 1350 PNGs, all four web designs as HTML ZIPs, and a six-slide VELUNE PDF/PPTX. PPTX was checked for its six-slide structure within the conversion limits above. All four web designs also passed required contrast/clipping checks at 1280px and 375px.
- Relocated backend package checks passed with Bun/Node removed from PATH, including all 12 originals, four systems, images, and bundled rendering support.
- The actual Velopack portable ZIP was extracted into an isolated path and its WebView2 app executed successfully: model selection, LOW/vanilla defaults, port-collision refusal, and shutdown of the owned backend passed. The installer was built; installing on a separate clean Windows machine remains outside this local verification.

Re-run package checks after building:

```powershell
node scripts/qa/package-smoke.mjs
node scripts/qa/windows-native-smoke.mjs --release
dotnet run --project packages/desktop-windows/qa/UpdateChecks.csproj -c Release
```
