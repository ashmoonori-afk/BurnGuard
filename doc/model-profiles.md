# Model capability profiles

BurnGuard adapts its design-system guidance to the model that runs a turn. The profile is derived from the already-validated backend and model selection (`resolveModelCapabilityProfile` in `packages/shared/src/model-profile.ts`) and selects which prompt blocks the turn receives (`packages/backend/src/harness/prompt-model-profile.ts`). Every turn with a selected model carries a machine-readable `<burnguard-model-profile-v1>` envelope; the prose blocks below are emitted only when the profile enables them.

| Profile | Models | Logo | Imagery | Effort note |
|---------|--------|------|---------|-------------|
| `claude-frontier` | Claude Opus and Sonnet on Claude Code or CommandCode, including the tool default | CSS/SVG logo when none is supplied | Real web assets (no image tool) | Medium or higher recommended |
| `gpt-image` | GPT models on Codex, including the tool default | Supplied logo or plain-text wordmark | Generated with the built-in image tool | None |
| `standard` | Everything else (Haiku, Gemini, Copilot, unknown ids) | Supplied logo or plain-text wordmark | Supplied images only | None |

A logo project keeps its own image-generation contract; the CSS logo block never applies to it.

## CSS/SVG logos

For `claude-frontier`, when neither the project nor the design system supplies a logo file, the model designs the mark as one inline `<svg data-bg-css-logo role="img" aria-label="...">` from design-system tokens and sets any wordmark as live text. The construction rules have stable ids so they can be checked:

| Rule | Requirement | Checked |
|------|-------------|---------|
| `LOGO_FORM` | Basic shapes only, at most 5 (3 preferred) | Measured: shape element count |
| `LOGO_LINE` | One stroke weight; corners all rounded or all sharp | Measured: distinct stroke widths and join/radius treatment |
| `LOGO_NEGATIVE_SPACE` | Exactly one hidden second meaning in the negative space | Model self-check; named in the closing summary |
| `LOGO_GRID` | On a grid; edges at 0/45/90 degrees wherever possible | Measured: at least two thirds of straight segments within 3 degrees of a multiple of 45 |
| `LOGO_COUNTERS` | Counters never close; strokes and gaps stay at least 1 px at 16 px | Measured: thinnest stroke scaled to a 16 px mark |
| `LOGO_COLOR` | At most 2 colours; works in black and white | Measured: distinct paint values; black-and-white is a self-check |
| `LOGO_SIMPLIFY` | Recognisable at 16 px; remove any detail that is not needed | Model self-check |

`packages/backend/src/services/css-logo-check.ts` measures the entrypoint after a successful turn and writes the result to the session trace as `css_logo_check`. It is advisory and never refuses a turn.

## Web asset sourcing

Claude Opus and Sonnet cannot generate images, so for the `claude-frontier` profile BurnGuard registers a local MCP server (`burnguard_assets`) with the Claude Code CLI and pre-approves its two tools:

- `search_assets { query, kind: photo | illustration | icon, limit? }` returns licensed candidates.
- `import_asset { id }` downloads one candidate into `assets/web/` of the project and records it in `assets/web/credits.json` (`schema_version`, `file`, `source_url`, `creator`, `license`, `license_url`, `attribution_required`, `retrieved_at`). Licence data is always re-read from the provider at import time.

The server is a worker mode of the backend executable (`--bg-web-assets-mcp --dir <stage>`), dispatched before any application module loads. It writes only inside the turn's stage directory, returns only stable error codes to the model, and sends requests only to two fixed HTTPS hosts with redirects refused, so a provider response cannot steer a download elsewhere.

### Providers

| Provider | Used for | Key | Licence handling |
|----------|----------|-----|------------------|
| [Openverse](https://api.openverse.org/v1/) | Photos, illustrations | None (anonymous; rate limited, e.g. 1000 thumbnail requests per day) | Searches only `license_type=commercial,modification` (CC0, PDM, CC BY, CC BY-SA); downloads through the Openverse thumbnail endpoint (`/v1/images/<id>/thumb/?full_size=true`) instead of the original host |
| [Iconify](https://iconify.design/docs/api/) | Icons | None | Keeps only icon sets under MIT, Apache-2.0, ISC, CC0-1.0, CC-BY-3.0/4.0, OFL-1.1, BSD or Unlicense; the SVG is refused if it contains scripts, event handlers, external references or embedded images |

Unsplash and Pexels were considered and not wired: both require a registered API key (and Unsplash requires hotlinking with download tracking), which conflicts with a local-first app that must work without secrets. Either can be added later behind a user-provided key without changing the tool contract.

### Settings, privacy and offline behaviour

Settings > Generation tools has "Let Opus and Sonnet search Openverse and Iconify" (`web_asset_search`, on by default). When it is off, no MCP server is registered, no query leaves the machine, and the prompt tells the model to use supplied images, the bundled Lucide icons and CSS/SVG compositions. When the network is unavailable the tools return `network_unavailable` and the model falls back the same way and names the placements that still need a real image. Codex, Gemini and Copilot runs never receive the tools.

When an imported asset has `attribution_required: true`, the model shows its attribution in a visible credits line, caption or footer.
