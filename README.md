<p align="right">
  <a href="README.ko.md"><img alt="한국어 README" src="https://img.shields.io/badge/한국어-README-004fff?style=for-the-badge" /></a>
</p>

# BurnGuard Design

BurnGuard Design is a local-first AI design workspace. It wraps the `claude` and `codex` CLIs you already have installed into a chat plus canvas workflow for building prototypes and slide decks, and it keeps every project file, design system, and export on your own machine.

Version: `0.4.0`. License: [Apache-2.0](LICENSE).

## The problem it solves

Generating a landing page or a pitch deck with a coding agent is easy. Getting *consistent, defensible* output is not. Three things usually go wrong:

1. The agent invents a new palette, a new type scale, and a new layout on every turn.
2. Design advice comes from nowhere in particular. You cannot tell which claim is a hard accessibility constraint and which is one vendor's house style.
3. Anything you feed the agent for context (brand decks, PDFs, internal sites) ends up in someone else's tenant.

BurnGuard makes design systems first-class inputs and references their tokens in every turn. Its research catalog gives injected rules citations, authority classes, confidence levels, and limitations. The backend runs on `127.0.0.1` and stores data under `~/.burnguard/`. Generation sends prompts and selected context to the provider configured by your local CLI; website extraction and Figma integration also make their requested network calls.

## Architecture

A Bun monorepo with three workspace packages plus scripts.

| Path | What it is |
|---|---|
| `packages/backend` | Hono HTTP server on Bun, SQLite persistence, CLI adapters, extraction, exports, research |
| `packages/frontend` | React 18 + Vite SPA (Home, Project, Design system, Settings) |
| `packages/shared` | Versioned contracts and parsers shared by both sides |
| `scripts/` | Build, dev launcher, and QA harness entry points |

Runtime shape:

- The backend listens on `127.0.0.1:14070` by default (`BG_PORT` overrides it, `BG_SCAN_PORT=1` scans 14070 to 14170).
- Every `/api` route except `/api/health` is guarded by a per-launch capability. `GET /api/bootstrap` hands the capability to a same-origin caller as an `HttpOnly` cookie and in the JSON body; mutations additionally require a matching `Origin` header and the `X-Burnguard-Capability` header. A mismatched `Host` gets `421`.
- SQLite is the source of truth for projects, sessions, events, comments, exports, catalog, learning, and research. Migrations live in `packages/backend/src/db/migrations/` and run at bootstrap; research state comes from `0010_research.sql`.
- The frontend talks to the backend only through `/api`, and the canvas renders project artifacts in a sandboxed iframe.

Data on disk:

```text
~/.burnguard/
  config.json          # local settings, chmod 600 after each save
  burnguard.db         # SQLite database
  data/
    projects/
    systems/
  cache/
    exports/
  logs/
```

## End-to-end flow of one turn

1. You send a message in the chat pane. The backend records the user event and snapshots the project tree as a checkpoint.
2. `packages/backend/src/harness/prompt-builder.ts` assembles the prompt deterministically: project facts, the project-type skill, the versioned design brief, design-system tokens, open comment pins, attachment summaries, an optional reference-layout contract, an optional structural map of the entrypoint, and a `<burnguard-research-context-v1>` block.
3. The adapter (`adapters/claude-code` or `adapters/codex`) spawns the CLI, streams stdout, and normalizes it into typed events: chat deltas, tool start and end, file changes, usage, status.
4. Events are sequenced into SQLite and fanned out over SSE (`GET /api/sessions/:id/stream`). The canvas iframe reloads when watched files change.
5. You review on canvas, drop comment pins, patch elements through the GUI, revert the turn, or export.

The research context block is built per turn by `services/research-purpose.ts`. It routes on project type and request text, selects catalog rules, and emits routing, rules, advice, output profile, precedence, and an `assembly: "fixed_captured_state"` marker so the agent knows the context is a snapshot rather than a live lookup.

## The research catalog

The repository ships a source-grounded catalog under `packages/backend/src/research-data/`. It is reference data for generation and review, not a substitute for accessibility testing or legal review. `doc/research.md` is the authoring guide.

### Source ledger

`sources.json` holds 45 `S-***` records. Each one carries the URL (https only), the retrieval date, the owner or title, sorted tags, a paraphrase under twenty words, a `license_usage` note, a confidence level, and a limitation. No vendor assets, fonts, templates, or component code are copied into this repo; only paraphrased principles with attribution pointers.

### Common rules versus purpose references

Two different things, deliberately kept apart.

- **Common rules** (`common-rules.json`, 15 `CR-***` records) are reusable and cite ledger IDs. Each declares an `authority_class`:
  - `normative_web_constraint` paraphrases WCAG material. Limitations preserve criterion level, scope, and exceptions. A rule must not be strengthened by dropping those qualifications.
  - `sampled_system_guidance` synthesizes what recurs across a bounded sample of public design systems. Recurrence supports guidance, not universal law. Exact spacing values, grids, fonts, colors, breakpoints, radii, and vendor token names stay system-specific.
- **Purpose references** (`purpose-references.json`) are ten prompt selector records: `deck.company`, `deck.pitch`, `deck.report`, `deck.sales`, `deck.training`, `prototype.dashboard`, `prototype.diagram`, `prototype.editorial`, `prototype.landing`, and `prototype.sandbox`. A purpose is a selector over four axes (`project_type`, `request_intent`, `creation_mode`, `fallback`), never a new project type. Each purpose lists its own guidance, the common rules it pulls in, its citations, a confidence level, and its limitations. The deck records are medium confidence on purpose: the sources support bounded communication principles, not a universal narrative for any deck kind.

Normative constraints win when both classes apply. Sampled guidance may pick an implementation pattern; it cannot weaken a normative constraint. When a request matches no selector, routing falls back to the common baseline (`CR-001` through `CR-005`, `CR-008`, `CR-009`) and reports `request_intent: "unspecified"`.

The catalog loader (`services/research-catalog.ts`) is strict. It rejects unknown keys, wrong schema versions, non-https URLs, malformed IDs, unsorted or duplicated IDs, unresolved citations, and any purpose set that is not exactly the ten supported prompt IDs.

The persisted mass-research contract remains narrower: it accepts the five prototype purposes plus `deck.pitch`. The four added deck selectors are prompt-catalog purposes only and are not accepted as persisted research-result purposes.

### Precedence and overrides

The prompt context declares precedence explicitly as `["research", "design_system", "project", "user_request"]`. Read it as layer order: research is the baseline, the linked design system overrides it, project-level decisions override that, and the user's request is the last word. Layer resolution lives in `resolveResearchRuleLayers` (`services/research-selection.ts`):

- Later layers override earlier layers on the same axis, and one rule may reference another by ID instead of restating it.
- Every override is recorded as a `LayerConflict` with the winning rule ID and the overridden ones, so nothing disappears silently.
- Duplicate rule IDs, unresolvable references, and reference cycles are hard errors.

Two invariants survive an override: normative accessibility limitations stay attached to the rule text, and conflicts are preserved rather than averaged into a false universal.

## Bounded mass research

Beyond the shipped catalog, the backend can run a bounded research job against structured sources and persist a cited result set. The whole lifecycle is durable, cancellable, and restart-safe.

### Contract

`packages/shared/src/research-contract.ts` defines the versioned request. Limits are validated, not advisory:

| Limit | Accepted range |
|---|---|
| `concurrency` | 1 to 8 |
| `per_source_timeout_ms` | 1000 to 120000 |
| `max_sources` | 1 to 200 |
| `max_bytes_per_source` | 1 to 10000000 |

`purposes` must be sorted, unique, and drawn from the six persisted-research purposes. `mode` is `fixture` or `live`, and `fixture_id` must be present exactly when the mode is `fixture`. In live mode every source must be an `https` URL of kind `web` or `repository`, with no embedded credentials.

### Routes

| Route | Behavior |
|---|---|
| `POST /api/research/dry-run` | Plans the request and returns ordinal, canonical locator, duplicate mapping, canonical source count, and a digest. No database write, no network call. |
| `POST /api/research/runs` | Idempotent start keyed by `request_key`. Returns `202` with the run record. Re-posting the same key returns the existing run instead of a second one. |
| `GET /api/research/runs/:id` | Run status, per-source status, progress counters, and the result once it exists. |
| `POST /api/research/runs/:id/cancel` | Persists the cancellation intent first, then aborts the in-flight work. Body must be `{}`. |

### Execution

`services/research-orchestrator.ts` plans sources, deduplicates them by canonical locator (hash stripped, trailing slash normalized, NFC applied), and runs canonical sources through a worker pool sized by `concurrency`. Each source gets its own timeout and abort signal. Fetching goes through `services/research-source-loader.ts`, which blocks private and loopback hosts, refuses redirects, requires `application/json`, and enforces the byte ceiling both from `Content-Length` and while streaming.

Everything is digested. `sha256` over canonical JSON produces a request digest, a per-source content digest, a finding digest, an evidence set digest over all canonical source outcomes, and a result digest. A worker output is discarded unless its `source_id` and `content_digest` match the source it claims to describe.

Synthesis has to earn its keep. `requireUsable` rejects a result that misreports the run ID, request digest, evidence digest, or source summary; that produces no common rules; that leaves a requested purpose empty; that cites a source which did not succeed; or that emits two rules on the same axis with different directives without an explaining conflict entry.

### Provenance, confidence, conflicts

Every rule in a result carries `source_ids`, and every ID resolves to a source row that belongs to the same run and reached `succeeded`. Confidence is a number on runtime rules and a `high | medium | low` band on catalog rules; anything below the threshold is surfaced as `low_confidence` rather than quietly dropped. Conflicts stay in the result and are filtered to the ones touching the selected purpose when a prompt context is built. If a persisted result ever fails re-validation, `selectResearchPromptContext` quarantines that run as `corrupt` and moves to the next usable one instead of serving unverifiable rules.

### Failure, partial, cancellation, restart

- **Per-source failure** is typed: `source_timeout`, `fetch_failed`, `malformed_source`, `worker_failed`, `invalid_worker_output`, `user_cancelled`, `persisted_data_corrupt`.
- **Partial** is a real outcome. If at least one canonical source succeeds and at least one fails, the run finishes as `partial` with `stop_reason: "partial_sources"`, and the result is still usable.
- **No usable result**: zero successes ends the run as `failed` with `no_usable_result`. An orchestration throw ends it as `failed` with `orchestration_failed`.
- **Cancellation** persists intent before aborting, so a crash between the two cannot produce a run that looks live but is not. Sources still pending or running become `cancelled` with `user_cancelled`.
- **Restart** runs `reconcileResearchState` at bootstrap. It re-parses and re-digests every persisted run and source, terminalizes runs that had a cancellation request, moves interrupted work through `recovering` back to `pending` for re-enqueue, synthesizes runs whose sources already finished, and quarantines rows that fail validation as `corrupt` instead of trusting them.
- **Offline** work is fully supported through fixture mode, which never touches the network. Live mode surfaces a network failure as `fetch_failed` on that source and lets the rest of the run continue.

## Install and setup

Prerequisites:

- [Bun](https://bun.sh)
- Node.js (Vite and the Playwright CLI use it)
- At least one agent CLI on `PATH`: `claude` or `codex`
- Chromium, if you want PDF or PPTX export. Install it from Settings, or run `npx playwright install chromium`
- Python 3.10+ with `pypdf`, only for PDF and PPTX ingest. See [`packages/backend/requirements.txt`](packages/backend/requirements.txt), or use the one-click install in Settings

There are no BurnGuard API keys, no key file, and no secrets form. The app reuses the login state of the CLI you already authenticated. A Figma personal access token, if you configure one, is stored only in `~/.burnguard/config.json` and is never echoed back through the API.

```sh
bun install --frozen-lockfile
bun run typecheck
```

Run both processes:

```sh
bun run dev
```

Or separately:

```sh
bun run dev:backend
bun run dev:frontend
```

Double-click launchers exist for people who would rather not open a terminal: `Start-BurnGuard.bat` on Windows and `Start-BurnGuard.command` on macOS. Both call `scripts/dev-launcher.ts`, which health-gates the backend before starting Vite and tears both children down on exit. Set `BG_LAUNCHER_NO_OPEN=1` to skip opening the browser.

Build:

```sh
bun run build          # frontend bundle + backend binary
bun run build:frontend
bun run build:mac      # add build:mac:dmg for a disk image
```

On Windows, distribute the complete `dist/windows/` folder: `burnguard-design.exe` needs its sibling `resources/` directory, which contains the frontend, migrations, sample design systems, CSS worker, Playwright, and a Node runtime for browser rendering. Packaging obtains the exact Node version's redistribution license and caches it under `.bun/`; the packaged copy lives at `resources/node/LICENSE`. The application can run from a different directory, including paths with spaces or Korean characters. Chromium/Chrome/Edge and the selected agent CLI remain runtime prerequisites.

## Using it

### UI

The SPA has four routes: `/` (Home), `/projects/:id`, `/systems/:id`, and `/settings`.

- **Home** lists projects and design systems, with sample restore and prompt-sample shortcuts.
- **Project** is the chat pane plus canvas. The canvas ships Select, Comment, Edit, Tweaks, Draw, and Present overlays, a single-step undo for GUI patches, and an inline error overlay with retry when an artifact fails to load. Each user message can be reverted to its pre-turn snapshot.
- **Design system** shows the imported bundle, its preview pages, and extraction caveats.
- **Settings** covers backend selection, Chromium and Python install status, the interrupt delay, chat context mode, and Figma access.

Research currently has no dedicated UI surface. It reaches you two ways: through the research context block that the prompt builder injects into every turn, and through the HTTP API below.

### API

Every mutating call needs the launch capability. Fetch it once from a same-origin caller:

```sh
BG=http://127.0.0.1:14070
CAP=$(curl -s -H "Origin: $BG" $BG/api/bootstrap | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["capability"])')
```

Plan a request without touching the database or the network:

```sh
curl -s -X POST $BG/api/research/dry-run \
  -H "Origin: $BG" -H "X-Burnguard-Capability: $CAP" \
  -H 'content-type: application/json' \
  -d '{"schema_version":1,"purposes":["prototype.landing"],
       "sources":[{"kind":"fixture","locator":"fixture-a"},{"kind":"fixture","locator":"fixture-a"}],
       "limits":{"concurrency":2,"per_source_timeout_ms":10000,"max_sources":10,"max_bytes_per_source":262144},
       "orchestrator_version":"research-v1","mode":"fixture","fixture_id":"mass-research-v1"}'
```

The plan reports the second source as `"duplicate_of": 0` and `"canonical_sources": 1`.

Start a fixture run and read it back:

```sh
curl -s -X POST $BG/api/research/runs \
  -H "Origin: $BG" -H "X-Burnguard-Capability: $CAP" \
  -H 'content-type: application/json' \
  -d '{"request_key":"demo-1","request":{"schema_version":1,"purposes":["prototype.landing"],
       "sources":[{"kind":"fixture","locator":"fixture-a"},{"kind":"fixture","locator":"fixture-b"}],
       "limits":{"concurrency":2,"per_source_timeout_ms":10000,"max_sources":10,"max_bytes_per_source":262144},
       "orchestrator_version":"research-v1","mode":"fixture","fixture_id":"mass-research-v1"}}'

curl -s -H "Origin: $BG" -H "X-Burnguard-Capability: $CAP" $BG/api/research/runs/<id>
curl -s -X POST -H "Origin: $BG" -H "X-Burnguard-Capability: $CAP" \
  -H 'content-type: application/json' -d '{}' $BG/api/research/runs/<id>/cancel
```

A completed fixture run reports `status: "completed"`, progress counters, per-source status, and a result whose rules cite the source row IDs from the same run.

### Live structured sources

Switch `mode` to `live`, drop `fixture_id` to `null`, and pass `https` sources of kind `web` or `repository`. A live source must serve `application/json` shaped as `{ "schema_version": 1, "title": string, "claims": [{ "axis": string, "text": string }] }` with at least one claim. Anything else is `malformed_source`. Redirects, private hosts, oversized bodies, and non-JSON content types are refused before parsing.

### Fixture and dry-run QA

`scripts/qa/mass-research-dry-run.ts` produces a deterministic receipt without a server:

```sh
bun run scripts/qa/mass-research-dry-run.ts \
  --fixture scripts/qa/fixtures/mass-research.json --purpose prototype \
  --evidence-dir /tmp/bg-research-happy

bun run scripts/qa/mass-research-dry-run.ts \
  --fixture scripts/qa/fixtures/mass-research-adversarial.json --scenario failures \
  --evidence-dir /tmp/bg-research-failures
```

The happy receipt carries the digest, the selected common and purpose rules, per-rule provenance, and per-rule explanations with confidence. The adversarial fixture names eight product-backed QA cases: timeout, fetch failure, malformed duplicate, partial worker failure, cancellation, restart recovery, override precedence, and unknown purpose. The product-backed CLI exercises the applicable behavior, while restart recovery runs through the production bootstrap reconciliation path. Both write `receipt.json` atomically and exit non-zero if any case fails.

## Verification commands

```sh
bun run typecheck                                  # tsc --build across the workspace
bun run build:frontend                             # required before the static-serving tests
bun run test                                      # whole suite, explicit 30s default deadline
bun run test:coverage                              # separate per-file 80% coverage gate
bun run lint                                       # whitespace/error check
node scripts/qa/e2e-smoke.mjs                       # real browser, isolated local profile
node scripts/qa/package-smoke.mjs                   # Windows portable build, relocated fixture
bun test packages/backend/tests/research-catalog.test.ts   # catalog validator alone
```

Run tests from the repository root. The test preload creates a fresh temporary `BG_APP_ROOT` and migrates its database; it overrides inherited profile paths and removes only its own fixture afterward. A test process without that isolation fails closed. Passing unit tests and meeting the per-file 80% coverage gate are separate results; the overall percentage alone does not satisfy that gate. Run `bun run build:frontend` before static-serving or browser tests. Browser smoke uses synthetic API fixtures and a separate seeded local profile; it does not send model requests. QA harness manifest cases additionally depend on repository, branch, and evidence preconditions.

If Bun is installed through a Windows npm command shim, pass `--bun <absolute-path-to-bun.exe>` to the browser smoke. Run browser-heavy checks sequentially so independent launches do not compete for the same machine resources.

## Limitations

- **No arbitrary HTML research parsing.** A live research source must be structured JSON in the documented claim shape. BurnGuard will not scrape a web page for design rules. Design-system extraction from HTML and CSS is a separate subsystem with its own contract.
- **No research UI.** There is no screen for starting, watching, or browsing research runs. Use the API or the QA CLI.
- **Run results do not feed the prompt yet.** The per-turn research block is built from the shipped catalog. The machinery to select a persisted run result for a purpose exists and is tested (`selectResearchPromptContext`), but the prompt builder does not consume it today.
- **The catalog is bounded.** 45 sources, 15 common rules, ten prompt purposes, and six persisted-research purposes, all retrieved on a single date. Rules carry limitations for a reason; read them before treating one as universal.
- **Sampled guidance is not law.** Values, grids, and vendor token names from the sampled systems stay system-specific.
- **PDF and PPTX export need Chromium.** Rendering goes through `playwright-core`, which launches bundled Chromium and falls back to installed Chrome or Edge channels. Without one of those, those export jobs fail with a Chromium hint.
- **PDF and PPTX ingest need Python.** Design-system uploads and chat attachments of those types go through a Python extractor with `pypdf`.
- **Data records prove nothing about your artifact.** Conformance still requires testing the rendered result on its real surface.

### Licensing and attribution

BurnGuard is Apache-2.0 (see [LICENSE](LICENSE)). Third-party attribution lives in [NOTICE](NOTICE): converted theme data derived from daisyUI (MIT) and 38 bundled Lucide icons (ISC, full text at `packages/backend/src/harness/assets/lucide/LICENSE`). Research sources keep their own terms in the `license_usage` field of each ledger record. Follow that note before reusing anything beyond a paraphrased principle, and do not assume repository-level licensing where a source has path-specific terms.

## Roadmap

Not shipped. Listed so nobody mistakes it for current behavior.

- Linux packaging and release path
- Installer packages for Windows and macOS, plus signing and notarization
- Managed auto-update channel
- Full browser end-to-end automation
- A research surface in the UI, and prompt selection from persisted run results

## Contributing and development

Read [doc/CONTRIBUTING.md](doc/CONTRIBUTING.md) first, then the documentation index at [doc/README.md](doc/README.md). Research-specific authoring rules are in [doc/research.md](doc/research.md).

Working agreements that matter in this repo:

- Contracts live in `packages/shared` and are parsed at the boundary. Add a field to the parser, not an `any` cast at the call site.
- Catalog JSON is canonical: `JSON.stringify(value, null, 2)` plus one trailing newline, records sorted by stable ID, citation arrays sorted, IDs never recycled. The validator enforces all of it.
- Add a source only after checking the primary page, its usage terms, and a counterexample search. Keep evidence paraphrased and under twenty words.
- Tests should fail for the right reason. No fixed sleeps, no timing luck, no pinning prose.
- Run `bun run lint`, `bun run typecheck`, and the relevant `bun test` target before opening a pull request.
