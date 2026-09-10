# Architecture Decision Records

Append-only log of significant architectural decisions. Each entry captures **context**, **decision**, and **consequences**. Superseded decisions are marked but never deleted.

Current note as of April 22, 2026:
- this file mixes decisions that are already reflected in code with decisions that still describe the intended target architecture
- when an ADR conflicts with the current implementation, treat [01-architecture.md](./01-architecture.md) and [03-backend-adapters.md](./03-backend-adapters.md) as the source of truth for what is actually shipped today
- most notably, PTY-oriented plans described here have **not** landed yet; the current runtime uses per-turn `Bun.spawn` subprocess execution

Format: one entry per decision, newest at the bottom. Numbering never reused.

---

## ADR-001: Backend execution strategy = self-hosted over Messages API, not Managed Agents proxy

**Date**: 2026-04-22  
**Status**: Accepted

**Context.** Three options surfaced for how BurnGuard Design talks to Claude:
- (A) Proxy Anthropic's Managed Agents API — highest fidelity to the real Claude Design product
- (B) Use Messages API + our own sandbox/tool-loop/container/SSE — maximum control
- (C) Hybrid

**Decision.** **Neither (B) nor (C) at the API level.** Instead we wrap **locally-installed CLIs** (Claude Code, Codex) as LLM backends. This sits below (B) — we don't even use the Messages API directly. The user's CLI is already authenticated and the user owns the API spend.

**Consequences.**
- No API keys managed by our application
- Works offline with a local-LLM CLI adapter (Ollama in Phase 4+)
- We must implement per-CLI output parsers (see ADR-004)
- We cannot use Anthropic's prompt caching, compaction, or built-in tool runtime — we rebuild what we need in the harness
- Binary ships without any bundled LLM weights or API credentials

---

## ADR-002: Implementation language = TypeScript end-to-end (Bun)

**Date**: 2026-04-22  
**Status**: Accepted · **Verified 2026-04-22** on Windows 11 x64 with Bun 1.3.13 (Phase 0 smoke build produced a working `.exe`)  
**Supersedes**: an earlier in-conversation plan to use Python + PyInstaller

**Context.** The harness was originally slated to be Python + `subprocess` + PyInstaller. Partway through design, we decided the harness must be "very powerful" and specifically in TypeScript. That created two options:
- (B) Python main app + TypeScript harness subprocess with IPC
- (C) All TypeScript on Bun

**Decision.** **Option C — all TypeScript on Bun runtime.** The harness is the heart of the product; splitting it from the main process behind IPC adds cost to context injection, tweak-diff propagation, and stream replay. Bun's `bun build --compile` produces a single Windows `.exe` comparable to PyInstaller.

**Consequences.**
- Single-language stack (TS) → lower context-switch cost for future contributors
- Export stack moves from Python (python-pptx, Pillow, fontTools) to Node (pptxgenjs, sharp, fontkit) — all MIT, actively maintained
- SQLite driver is `bun:sqlite` (no native compile)
- `node-pty` is the PTY library; Bun Windows PTY support is on us to validate early (ADR-006 risk #3)
- PyInstaller is formally abandoned

---

## ADR-003: Canvas rendering strategy = R1 + R3 hybrid (Artifacts-compatible React + semantic tree)

**Date**: 2026-04-22  
**Status**: Accepted

**Context.** The canvas must render whatever the LLM emits. Three options:
- R1 — iframe + React 18 + Vite-style ESM transpile, Artifacts-compatible
- R2 — full multi-file project (Next.js-like)
- R3 — semantic JSON tree → React substitution

**Decision.** **R1 with an R3 overlay.** The primary render path is R1 (iframe + `esbuild-wasm` in-browser transpile of JSX). R3 (semantic tree) is additional metadata the LLM emits alongside JSX so the UI can map DOM nodes back to artifact nodes for Tweaks / Comments / Edit.

**Consequences.**
- LLM output is natural React/JSX, which is what Claude Code produces anyway
- Inline comments and Tweaks (Phase 3) have a stable mapping via `data-bg-node-id`
- Export to HTML zip is direct (the iframe content + styles)
- "Send to Claude Code" handoff includes both the JSX and the semantic spec (Phase 3)

---

## ADR-004: LLM CLI abstraction = per-CLI adapter with shared `NormalizedEvent` schema

**Date**: 2026-04-22  
**Status**: Accepted

**Context.** Claude Code and Codex have different output formats (stream-json vs. loosely-structured text) and different interaction models (`--print` vs. interactive). We need one UI, one DB, one SSE stream on top.

**Decision.** Every backend implements the `LLMBackend` interface (see [03-backend-adapters.md §2](./03-backend-adapters.md)). Every per-CLI parser emits the same `NormalizedEvent` union type (see [03-backend-adapters.md §3](./03-backend-adapters.md)). All upstream consumers (broker, UI, export, context builder) only see normalized events.

**Consequences.**
- Adding a new CLI = writing one adapter + one parser + one fixture set. No upstream changes.
- Tests are fixture-driven: replayable inputs for each adapter
- Codex support is best-effort in Phase 1 with a "raw mode" fallback that passes stdout through as `chat.delta`
- Third-party adapters (Phase 3+) are loadable from `~/.burnguard/plugins/`

---

## ADR-005: Tweaks panel ships in Phase 3, not Phase 1

**Date**: 2026-04-22  
**Status**: Accepted  
**Supersedes**: an earlier decision (also same date) to include Tweaks in Phase 1

**Context.** The Tweaks panel (screenshot 6 of `ref/`) is the direct-manipulation CSS inspector that makes Claude Design different from "chat-to-code generator." Initially we pulled it into Phase 1. On reconsideration, Phase 1 has four novel, unvalidated components (harness, CLI parsing, canvas sandbox, Tweaks). Four risks at once crowds out the primary Phase 1 goal: proving the harness.

**Decision.** Tweaks moves to **Phase 3**. Phase 1 ships only the foundation: click element → read-only computed-style display + Refresh button. Refinement in Phase 1 is done via chat ("make the title bigger") or Refresh.

**Consequences.**
- Phase 1 scope shrinks by ~1 week
- `data-bg-node-id` auto-injection must still land in Phase 1 so Phase 3 has it ready
- Phase 1 users refine with chat, which is 80% of the user value anyway
- Tweaks table in the DB schema is reserved but unused until Phase 3

---

## ADR-006: Primary OS = Windows; macOS/Linux in Phase 3

**Date**: 2026-04-22  
**Status**: Accepted

**Context.** The project owner runs Windows 11 primarily. Cross-platform binary builds exist (`bun build --compile` supports macOS arm64 and Linux x64), but node-pty behavior differs by platform.

**Decision.** **Windows x64 only for Phase 1 and Phase 2.** macOS arm64 and Linux x64 builds land in Phase 3.

**Consequences.**
- Early testing and CI target Windows 11
- Path handling uses forward slashes internally, converted at OS boundary
- node-pty on Windows uses ConPTY (Windows 10 1809+)
- Binary signing is out of scope for Phase 1; SmartScreen bypass is documented in the install guide

---

## ADR-007: Playwright = first-run download, not bundled

**Date**: 2026-04-22  
**Status**: Accepted

**Context.** Playwright's Chromium is ~130 MB. Bundling it into the `.exe` would double binary size. The only users who need Playwright are those exporting PDF or PPTX (Phase 2+).

**Decision.** Do **not** bundle Chromium. Download on first PDF/PPTX export request. Store in the standard Playwright cache path (`~/.cache/ms-playwright/`).

**Consequences.**
- Binary stays under 100 MB
- First export has a ~30 second installation step with progress toast
- Export fails gracefully if offline during first-run download
- Power users can pre-install by setting `PLAYWRIGHT_BROWSERS_PATH` before launching the binary

---

## ADR-008: All documentation in `doc/` is English

**Date**: 2026-04-22  
**Status**: Accepted

**Context.** The project owner is Korean; the product README for the Northvale Capital sample DS is mixed Korean/English. Earlier doc drafts were written in Korean, then re-written in English on request.

**Decision.** **English is the single official language for `doc/`.** Inline source comments may use any language. The sample DS contents (`design system sample/`) stay as-is because they are example content, not project documentation.

**Consequences.**
- Wider collaborator pool (open source friendliness)
- Translations (if ever wanted) go into `doc/i18n/{lang}/` — not inline
- Korean-centric DS content (e.g. Pretendard, KoPub Batang references) remain in the sample verbatim

---

## ADR-009: Sample design system = Northvale Capital, bundled and preloaded

**Date**: 2026-04-22  
**Status**: Accepted

**Context.** A user creating their first project needs something usable immediately. Shipping an empty state requires the user to either extract a DS (Phase 3 only) or hand-author one.

**Decision.** The Northvale Capital sample DS (`design system sample/`) is **embedded into the binary at build time** and copied to `~/.burnguard/data/systems/northvale-capital/` on first run. Status is locked to `published`. Users can edit the files (they are local) and Reset restores from the embedded copy.

**Consequences.**
- Phase 1 binary is usable without any additional setup
- Binary includes ~30 MB of font files (acceptable)
- Legal: only OFL / public-use fonts included (Pretendard, KoPub, Zen Serif)
- The sample doubles as an executable spec of the DS format

---

## ADR-010: DS format = Claude Code Skill-compatible (`SKILL.md` + `README.md` + `colors_and_type.css`)

**Date**: 2026-04-22  
**Status**: Accepted

**Context.** Early proposals considered a BurnGuard-specific format (DESIGN.md + tokens.json + components/). Inspection of `design system sample/` showed the real Claude Design emits a format that doubles as a Claude Code `user-invocable` skill.

**Decision.** Adopt the observed format verbatim: a directory containing `SKILL.md` (frontmatter with `name`, `description`, `user-invocable: true`), `README.md` (content + visual rules), `colors_and_type.css` (design tokens as CSS custom properties), plus `fonts/`, `assets/`, `preview/`, `ui_kits/`, `uploads/`.

**Consequences.**
- Any DS created in BurnGuard is installable as a Claude Code skill by `cp -r` into `~/.claude/skills/`
- Skills installed in Claude Code are loadable as BurnGuard DSs by symlink or copy
- Context injection (see [03-backend-adapters.md §5.4](./03-backend-adapters.md)) can use the same files whether the CLI sees them as a skill or we inject them manually
- Extraction pipeline (Phase 3) must emit this exact layout

---

## ADR-011: Canvas sandbox = iframe with `allow-scripts allow-same-origin`

**Date**: 2026-04-22  
**Status**: Accepted

**Context.** The canvas runs LLM-generated code. We must sandbox it to prevent data exfiltration from the parent SPA and to limit network calls, while still allowing:
- React / ESM execution
- Tailwind CDN loading
- parent ↔ iframe postMessage

**Decision.** Use a standard sandboxed iframe with `sandbox="allow-scripts allow-same-origin"`. Enforce network allow-list via CSP meta tag injected into the iframe HTML (Tailwind CDN + self-host only). Keep local storage isolated.

**Consequences.**
- LLM code cannot exfiltrate data to third-party endpoints
- Tailwind utility classes still work via CDN
- If the LLM tries to fetch a random CDN, it fails with a clear CSP violation in the console
- Tweaks (Phase 3) works because parent ↔ iframe postMessage is allowed

---

## ADR-012: Storage = SQLite + filesystem, no external DB

**Date**: 2026-04-22  
**Status**: Accepted

**Context.** Local single-user tool. Options: SQLite, DuckDB, Postgres (via Docker), flat JSON files.

**Decision.** **SQLite** for metadata (projects, sessions, events, attachments). **Filesystem** for file content (project trees, DS directories, exports). DB file at `~/.burnguard/burnguard.db`; content under `~/.burnguard/data/`.

**Consequences.**
- Zero-config startup; no external services
- WAL mode for concurrent reads (useful when export worker runs while user is in the app)
- Backup is "copy `~/.burnguard/`"
- If we ever add multi-user later, migration to Postgres is a substantial rewrite — and explicitly out of scope

---

## ADR-013: Project creation persists a versioned design brief

**Date**: 2026-08-25
**Status**: Accepted

**Context.** Project creation previously persisted only loose type-specific
options and could silently select the first design-system row, including a
draft. Korean non-designers need a bounded brief that survives creation and
reaches the agent prompt. The product also exposes a `from_template` type, but
real installs do not seed any row with `is_template = 1`.

**Decision.** Persist a parsed `DesignBriefV1` inside `projects.options_json`
alongside snake-case type-specific options. Require an explicit user choice
before applying a design system. Ordinary projects may use a published
non-template system or none; `from_template` requires an explicit published
system and treats that system as the template source, regardless of its
`is_template` flag.

**Consequences.**
- Audience, objective, locale, brand mode, visual mood, density, content
  source, and output size reach the prompt as machine-readable context
- Draft and review systems cannot silently become a project's brand
- Template creation remains usable on a default install without inventing
  template-marked seed data
- The brief schema must be versioned when its persisted shape changes

---

## ADR-014: Reference layout is a versioned advisory prompt contract

**Date**: 2026-08-25
**Status**: Accepted

**Context.** A selected drawing or plan plus page requirements must preserve
dimensions, units, orientation, scale, bleed, safe margins, aspect ratio, and
stable anchors without mutating the source. Treating every selected image as a
drawing would misclassify ordinary logos and screenshots, while exporter
support is limited to specific presets and dimensions.

**Decision.** Derive `ReferenceLayoutContextV1` only from explicit
layout/reference request intent or a selected attachment whose filename
identifies a drawing, plan, layout, sketch, or reference. Keep selected
attachment paths inside the existing attachment boundary. Mark the reference
as an immutable underlay in the prompt contract, preserve missing measurements
as explicit unknowns, use normalized top-left anchors, and report exporter
limitations without coercing custom sizes.

**Consequences.**
- Ordinary content images do not trigger `layout-spec.json` work
- Drawing filenames still activate the contract when request text is generic
- Repeated inputs produce byte-stable layout context
- Immutability is advisory to the coding agent; the filesystem does not enforce
  a write lock on attachment bytes
- Export support remains a declared capability rather than an inferred promise

---

## ADR-015: Deliverable kinds, platform packages, and additive brief fields

**Date**: 2026-09-10
**Status**: Accepted

**Context.** BurnGuard needs multi-frame graphics, long product-detail
exports, and guided delivery to Cafe24 (카페24) and Imweb (아임웹) without
adding another project type or promising an undocumented authenticated push.
The persisted design brief also needs an optional page list, while ADR-013
requires intentional versioning of persisted brief shapes. Platform dimensions
and limits have mixed evidence quality, and Imweb cannot host BurnGuard's
bundled fonts through the documented package flow.

**Decision.** Add `png_zip`, `cafe24_package`, and `imweb_package` as export
formats through migration 0014. Represent graphic deliverable kinds in the new
versioned `options_json.graphic_set` block (`GraphicSetV1`, `schema_version: 1`)
rather than adding a `ProjectType`; absence preserves the legacy `single` kind,
and malformed or unsupported versions fail with a typed contract error. Add
`DesignBriefV1.pages` as an optional additive field without introducing V2,
consistent with ADR-013's versioning rule. Deliver platform support as guided
downloadable packages with manual installation; defer direct push until a
documented endpoint exists. Keep platform presets in one data module with
`verified` or `unverified` status and a checked date; unverified vendor figures
produce warnings rather than hard limits. Imweb packages use a system-font
fallback by default and may offer Google Fonts links only as an explicit,
guide-flagged opt-in exception to the runtime font policy in doc/05.

**Consequences.**
- Existing graphic projects remain readable without migration to a new project
  type or brief version
- Migration 0014 changes export-format persistence while leaving project-type
  persistence unchanged
- Package download is not represented as successful platform publication, and
  Cafe24/Imweb credentials are not collected or stored
- Platform claims remain auditable and cannot become blocking vendor rules
  without verified evidence
- Opting into Google Fonts for Imweb creates a disclosed runtime network
  dependency and possible visual variance; the default package does not

---

## Template for new ADRs

```
## ADR-NNN: {short decision}

**Date**: YYYY-MM-DD  
**Status**: Proposed | Accepted | Superseded by ADR-MMM

**Context.** What forces are at play? What problem or choice are we facing?

**Decision.** What did we decide?

**Consequences.** What becomes easier or harder? What is locked in?
```
