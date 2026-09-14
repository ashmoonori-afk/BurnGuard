# Project Review and Roadmap, Final (2026-09-11)

Snapshot reviewed: `main` at `01c42be` (merge of PR #47), version 0.5.9, 341 commits. This is the final version of the review started against 0.5.6 (`5521e65`) on 2026-09-10; it adds a review of the 66-commit delta (PRs #35 to #47), a fact-check of `doc/16`, a fresh measurement of every test file, and a global-market research pass. It supersedes the interim 0.5.6 review.

Product identity, as set by the product owner on 2026-09-11: **an SMB marketing deliverable tool for many countries, not only Korea.** Every judgement and the roadmap below are made against that identity. The technical judgements of the interim review still hold; the priorities change.

## 1. Verdict

BurnGuard 0.5.9 is a **solid beta in its core loop, a late alpha in operations, and an early alpha as a global product.**

- Core loop (create, chat, canvas, export): well above the usual bar for a single-user local app, and the doc/14 delta kept that bar. Crash-safe artifact publishing, cross-platform subprocess teardown, the child-process Chromium probe, loopback API defenses, a sandboxed canvas with a scoped CSP, and now eight export formats with receipts, budgets, and atomic publish.
- Operations: the backend suite still cannot run in one process on Windows, CI executes 14 of 148 backend test files and none of the browser fixtures, five tests drifted during the last two weeks without CI noticing, coverage is declared but unmeasured, Windows packages are unsigned, and the overview and milestone documents still describe April.
- Global product: the feature set is real (multi-frame sets, product detail slices, site packages, presets with verification status), but the market coding is Korean: 11 of 28 presets are Naver GFA, the two site packages are Cafe24 and Imweb, every UI string and every generated placeholder is Korean, and there is no locale, font, or direction handling for other markets.

Velocity remains very high: 140 commits in the last two weeks, all through `codex/*` branches merged as PRs. That pace is only safe once the verification gap in section 5.4 is closed, so the roadmap still starts with stabilization, but the second phase is now internationalization rather than local polish.

## 2. What the global identity changes

| Area | Korea-first product (implicit until 2026-09-10) | Global SMB deliverable tool (from 2026-09-11) |
|---|---|---|
| UI language | Hardcoded Korean copy in components, toasts, guides, templates | Message catalog with English as the base and Korean as the first locale; generated copy follows the brief locale |
| Presets | 28 placements, 11 Naver GFA, Kakao, Coupang, Smart Store, plus Meta, Google, YouTube, one print size | Keep the Korean set as one region; add LinkedIn, Pinterest, vertical 9:16 (Shorts, TikTok, Reels), YouTube banner, marketplace squares (Amazon, Etsy, Google Merchant Center), Google Business Profile, email header, US and ISO print sizes |
| Site packages | Cafe24 Smart Design and Imweb code widget | Shopify, WordPress, Wix, Squarespace, Webflow packages built on the same transformation pipeline; Cafe24 and Imweb stay as the Korea region |
| Typography | Six Google families plus Pretendard for Korean | Noto families per script (CJK, Thai, Arabic) under the same OFL bundling rule; text-expansion aware layouts |
| Layout | LTR only | `dir` attribute and CSS logical properties in the skills; RTL check in the design audit |
| Numbers and dates | Korean formats in templates | `Intl.NumberFormat` and `Intl.DateTimeFormat` with the brief locale |
| Marketplace rules | Smart Store and Coupang byte and height caps | Per-market validators (Amazon white background and 85 percent fill, Google Merchant Center minimums) as warnings with a checked date, same status model as today |
| Competitive frame | Claude Design reimplementation | Canva, Adobe Express, and Figma Buzz for brand kits, translation, and bulk variants; BurnGuard's edge is local-first, HTML-first, code packages, and design-system import |

## 3. Measurements

| Measurement (Windows 11, Bun 1.3.13) | 0.5.6 (`5521e65`, 2026-09-10) | 0.5.9 (`01c42be`, 2026-09-11) |
|---|---|---|
| `bun run typecheck` | clean | clean |
| Frontend `bun test` | 196 tests, 32 files, all pass | 290 tests, 38 files, all pass |
| Backend tests, file by file from the repo root | 128 of 132 files green, 971 pass, 4 fail | 143 of 148 files green, 1,118 pass, 5 fail, 1 file excluded (known hang) |
| Full backend `bun test` in one process | Bun panic | Bun panic (unchanged) |
| Source lines: backend, frontend, shared | 27,939 / 16,194 / 2,767 | 30,216 / 17,946 / 3,140 |
| Largest files | `design-system-extract.ts` 2,157; `ProjectView.tsx` 1,680 | 2,157; 1,721 |
| CI backend test files | 14 | 14 |
| Tracked `.omo/` evidence | 59 files, 18,856 lines | 0 (PR #43 untracked `.omo/`, `devplan/`, `ref/`) |

The five failing backend tests are test drift, not product defects, and two of them drifted inside the doc/14 delta:

- `design-brief-prompt.test.ts:86` expects the old one-artboard graphic block; the prompt now emits `kind` and `frames` (`harness/prompt-graphic-set.ts`).
- `graphic-canvas-contract.test.ts:35` expects a height above 4,096 to be rejected; the limit is now 16,384 (`shared/src/graphic.ts:12`).
- `serve-path-boundary.test.ts:302,487` expect HTML without the auto-inserted `data-bg-node-id` and a bare `PathBoundaryError` that is now wrapped in `CanonicalTreeManifestError`.
- `daisyui-seed-themes.test.ts:67` expects an attribution header the theme CSS no longer starts with.

A sixth failure seen during the sweep, `bundled-fonts.test.ts:54`, comes from an uncommitted local edit to that test (a new cross-check expecting `assets/fonts/fonts.md` and at least 27 families); the committed version at `01c42be` passes and the failure is not counted here.

That tests could drift through three releases is the clearest evidence that CI does not gate what ships.

## 4. Scores by dimension

| Dimension | 0.5.6 | 0.5.9 | Reason for the change |
|---|---|---|---|
| Backend architecture | B+ | B+ | The delta follows every existing pattern (contracts in shared, receipts, atomic publish, child-process Chromium); no per-turn timeout yet; the 2,157-line extractor is untouched. |
| Frontend | B- | B- | 94 new tests and well-validated new modules, but still no error boundary, and `ProjectView.tsx` grew by 41 lines instead of being split. |
| Security | A- | A- | Three new untrusted-input surfaces (import, preview, DOCX) all ship with bounded, tested checks. |
| Testing, CI, release | C+ | C | Same CI, five drifted tests, and the new `imweb_package` and `png_zip` paths have no end-to-end fixture. |
| Product and documentation | B- | B | doc/14, doc/15, doc/16, ADR-015, and both READMEs are current for the new features; doc/00 and doc/06 remain stale; research subsystem still dead. |
| Simplicity | C+ | B- | `.omo/`, `devplan/`, and `ref/` untracked; the rest of the audit list still stands. |
| Global readiness | not scored | D+ | Real multi-frame and package machinery, but Korean-only UI, presets, packages, fonts, and formats. |

## 5. Findings

### 5.1 Backend architecture

Unchanged strengths: `adapters/owned-process-tree.ts` and `process-streams.ts` (tree kill and guaranteed teardown), `services/artifact-coordinator.ts:121-193` (snapshot, stage, publish with compare-and-swap and rollback), `services/chromium-capability.ts` and `chromium-node-launch.ts` (Chromium never blocks the Bun loop), zero `TODO` and zero `as any`.

Still open:

- No wall-clock timeout around the adapter call in `services/turns.ts`.
- `services/design-system-extract.ts` (2,157 lines) mixes four ingestion sources with templating and path safety.
- `readLines()` duplicated in both adapters; `ok()`/`fail()` in 12 route files; `isRecord()` in 18 files although `@bg/shared/contract-parser.ts:45` exports it.
- Whole-turn allow or abort for tool permissions (`routes/session.ts:369-386`).
- Directory listings logged on every turn (`services/turns.ts:380-393`).

New in the delta (PRs #35 to #47), all low or medium:

- `platform_missing_asset`, `platform_invalid_markup`, and `platform_unresolved_destination` exist in the `PlatformLintCode` union (`services/platform-lint.ts:10`) but are never emitted; those conditions fail hard before lint runs.
- The per-output `receiptWriter` passed to the batch and package renderers is `async () => undefined` in production (`services/exports.ts:175,180`); the real receipt is written separately at `exports.ts:135-136`, so nothing is lost, but the parameter is test-only.
- `recordPlatformFindings` and `recordRenderFindings` do a non-transactional read-modify-write of `export_attempts.findings_json` (`exports.ts:57-64`); safe under one writer per attempt.
- Product detail rules in `harness/prompt-graphic-set.ts:85-101` are a large instruction surface that must be kept in sync with the harness by hand.

### 5.2 Frontend

Unchanged strengths: no `any` in 18k lines, TanStack Query for all server state, a bridge with source checks in both directions, code-split `three`.

Still open: no error boundary in `App.tsx`; `views/ProjectView.tsx` (1,721 lines, 49 hook calls) re-renders the whole tree on every SSE envelope because nothing is wrapped in `React.memo`; `api/client.ts:105` trusts payload shapes; `hooks/useSessionEvents.ts` has no reconnect with backoff.

New in the delta, done well: `lib/creation-draft.ts` validates every field and wraps `localStorage` in try/catch; `lib/frame-navigation.ts` and `lib/canvas-zoom.ts` are small, pure, and tested; export options, delivery status, guide dialog, and import dialog each have tests.

### 5.3 Security

Posture unchanged: adequate to strong for a single-user loopback app, with `doc/01-architecture.md` section 7 documenting the accepted risks honestly.

The delta added three untrusted-input surfaces and all three are bounded:

- `services/project-import.ts`: symlink entries rejected, per-segment safe names, one shared byte budget across all entries (so many small entries cannot form a compression bomb), file and folder caps, executable extensions blocked, `wx` writes into a fresh stage.
- `services/attachment-image-word.ts`: only five known DOCX XML parts are read, `<!DOCTYPE` and `<!ENTITY` rejected, byte-bounded reads, no relationship or media parsing.
- `services/turn-preview.ts`: `O_NOFOLLOW`, per-segment symlink rejection, inode and mtime re-verification around the read, and a SHA-256 filter that stops private source bytes leaking through the preview channel; the report file is validated field by field and written by temp file plus rename.
- `services/platform-package-rewrite.ts:31-43` `safeAssetUrl` rejects protocol-relative, backslash, encoded separators, control characters, credentials, query, hash, and non-HTTPS input.

Open items carried over: add a DNS-rebinding regression test for the design-system import fetch (`services/extraction-website.ts:23` implements pinned-IP fetching, but nothing tests it); `config.json` permissions on Windows; unsigned Windows packages (`scripts/package-windows-release.ts:22`).

### 5.4 Testing, CI, and release

Strengths: profile isolation with a self-test (`scripts/test-preload.ts`, `tests/test-isolation.test.ts`), injected fakes instead of `mock()`, self-verifying release packaging (semver, four-way version equality, `SHA256SUMS.txt`, tag equals version), and the delta added 16 backend and 7 frontend test files plus `scripts/qa/deliverables-fixtures.mjs`.

Gaps:

- No one-command backend run on Windows; CI runs 14 backend files on Ubuntu (`.github/workflows/security.yml:27-42`) and the frontend suite not at all; releases are gated by two files per platform.
- Five drifted tests shipped through 0.5.7, 0.5.8, and 0.5.9 (section 3).
- `imweb_package` and `png_zip` have no end-to-end fixture; only `cafe24_package` is driven through a real render session (`scripts/qa/deliverables-fixtures.mjs:42-90`); `renderPlatformPackage` and the `exports.ts` branches at `:170-181` have typecheck coverage only.
- `bunfig.toml` declares an 80 percent coverage threshold that nothing measures.
- `tests/export-render-lifecycle.test.ts:17-20` hangs (forced close without a deadline); `codex-runner.test.ts:29` returns silently on Windows.
- `scripts/package-mac-release.ts:37-40` refuses to build without signing secrets; 0.5.8 shipped an unsigned macOS build through a workflow change instead of a script fix.
- No `CHANGELOG.md`; `CONTRIBUTING.md:40,122-123,247` references a `test:e2e` script and `tests/e2e/` that do not exist.

### 5.5 Product and documentation

Verified in code (selection): DOM-backed selector, edit, tweaks with handles, comments with send-to-AI, draw, site-wide design audit at two viewports, checkpoints, resumable SSE, structured Codex events, design-system import from website, git, Figma, and PDF/PPTX upload, Pinterest mood, four original sample collections, three.js scenes, eight export formats, Vercel share, Windows and macOS shells with update checks, and from the delta: graphic sets with 28 presets, product detail brief and Q1 to Q8 starter, site map and active page, live turn previews with DOM reports, Word and image attachments, project import, platform packages with lint and guides.

doc/16 review result: accuracy 8.5 of 10 on a 46-row sample; all 84 evidence paths resolve and every numeric limit matches the code. Five corrections were applied on 2026-09-11 (PR range #35 to #47 and version 0.5.9 in the header, the literal error code `graphic_requires_authenticated_codex`, wheel-zoom mechanics, the `frames` filename tag, a graphic starter template row, a coverage paragraph, and two new remaining-gap bullets: deck copy review is advisory only, and import infers only `prototype` or `slide_deck`, so an exported graphic project re-imports as a prototype and loses its `graphic_set`, `services/project-import.ts:72`).

Still stale or thin:

- `doc/00-overview.md` section 2 (April 22 snapshot) and the `doc/06-milestones.md` status banner (2026-04-24) describe gaps that have been closed for months.
- Research subsystem: full run and recovery state machine, canned observations (`routes/research.ts:104`), `services/research-purpose.ts` has no importer, no UI. Ship or delete.
- `other` falls back to the prototype template with no skill; `from_template` projects are classified as examples and hidden from "내 프로젝트".
- Graphics require an authenticated Codex backend in three places and the reason is undocumented (doc/14 Q5 remains open).
- PPTX carries text runs and solid backgrounds only; undo is single-step; Vercel status needs a manual re-check; PDF text extraction has no OCR.
- No first-run onboarding; the CLI-missing modal and seeded samples carry that role.
- Every platform figure marked "not verified" in doc/14 section 13 is still unverified because no Cafe24 shop or Imweb site was available (doc/15 T33 and T61).

### 5.6 Simplicity

`.omo/`, `devplan/`, and `ref/` are no longer tracked (PR #43). The remaining audit list from the interim review still applies: about 20 `BG_*_FAULT` and QA env hooks compiled into production (`services/export-qa-barrier.ts`, `extraction-qa-adapter.ts`, `routes/artifacts.ts:178-190`, `routes/session.ts:463-469`, `services/turns.ts:322`), about 880 lines of QA evidence-manifest scripts pinned to a dead session, roughly 1,700 lines of test-only modules with no source importer (`db/export-attempt-repository.ts`, `db/learning-repository.ts`, `db/artifact-operation-repository.ts`, `db/research-schema.ts`, `services/research-selection.ts`, `services/file-change-broker.ts`, `services/broker.ts` `EventBroker`, `db/events.ts:55-105`, `harness/assets/lucide/icons.ts`, frontend `mocks/*`, `SystemHeader.tsx`, `FileRefCard.tsx`), duplicated helpers, a hand-rolled router in front of Hono (`server.ts:173-217`), a body limiter where `hono/body-limit` exists, a PNG chunk parser beside `@napi-rs/canvas`, micro-file sprawl in the export and artifact layers, never-read config keys, and two removable dependencies. Net about 3,800 removable lines.

### 5.7 The delta itself (PRs #35 to #47)

The delta is at the same quality bar as the base: 257 files, +9,326 and -9,450 lines, no deviation from the receipt, atomic-publish, or child-process-Chromium architecture; every new untrusted-input surface has explicit tested boundaries; the hard logic (slice planning, lint, package building, import) has unit tests. Its weaknesses are the ones listed above: no end-to-end fixture for two of three new formats, three dead lint codes, a test-only parameter in the production call path, and two drifted tests.

## 6. Global readiness

What is already global: the HTML-first pipeline, Chromium capture with per-frame budgets, the preset data model with confidence and checked dates, the Meta, Instagram, Facebook, Google display, YouTube, and business-card presets, the Vercel share, design-system import from any HTTPS site, and the transformation pipeline behind the platform packages (stage, site map, tree build, lint, guide, zip, validate).

What is Korea-coded, with the file that proves it:

- UI copy: every user-facing string is a Korean literal (`views/HomeView.tsx:50`, `components/Bootstrap.tsx:23`, export labels in `components/export/export-option-entries.ts:81-92`, guides in `packages/shared/src/platform-guides.ts`); backend messages too (`services/turn-error-sanitizer.ts:4-19`, `services/ux-review.ts:45`).
- Generated placeholders: the graphic starter and product-detail skeleton emit Korean guidance (`db/templates/graphic.ts:15,26,31,40`); prompt rules assume Korean marketplaces.
- Presets: 11 of 28 are Naver GFA, plus Kakao, Coupang, and Smart Store (`packages/shared/src/platform-presets.ts`).
- Packages: Cafe24 and Imweb only (`services/platform-package-cafe24.ts`, `platform-package-imweb.ts`).
- Fonts: Pretendard for Korean body text; no CJK-JP, CJK-SC, Thai, or Arabic coverage (`assets/fonts/README.md`, doc/05 section on bundled typography).
- Layout and formatting: no `dir` handling, no logical CSS properties in the skills, no `Intl` formatting.

Research findings that shape the next packages and presets (each carries the verification status from the research pass; "Unverified" means search-snippet evidence only):

| Target | Documented embed path | Whole page or block | Status |
|---|---|---|---|
| Shopify | Theme editor "Custom Liquid" section; section `.liquid` file with `{% schema %}`; theme ZIP upload | Both (section, or JSON template plus sections; full theme via ZIP) | Verified (sections), Unverified (ZIP limit) |
| WordPress | Custom HTML block; page template or HTML file via theme; `<script>` needs `unfiltered_html` or a paid WordPress.com plan | Both | Unverified (help pages returned 404 to the fetcher) |
| Wix | HTML iFrame element (sandboxed, no character limit, HTTPS only); custom code needs a connected domain | Block only | Verified (custom code page), Unverified (embed page) |
| Squarespace | Code Block per page; JavaScript and iframes need Core or higher plans; CSS in `<style>` on every plan | Block only | Verified |
| Webflow | Code Embed, 50,000 characters per embed and per code area; custom code needs a paid Site plan | Block, chained | Unverified (403) |
| Framer, Carrd, GoDaddy, Google Sites, Notion | Embed components or iframes | Block only | Unverified |

| Preset to add | Size and limit | Status |
|---|---|---|
| LinkedIn post image | 1200x627; page images up to 3 MB | Unverified |
| LinkedIn document carousel | PDF, 100 MB, 300 pages (reuses card news plus artboard PDF) | Unverified |
| Pinterest standard pin | 1000x1500 (2:3), 20 MB | Unverified |
| Vertical 9:16 (YouTube Shorts, TikTok, Reels) | 1080x1920; TikTok carousel 4 to 35 images | Unverified (third-party only) |
| YouTube channel banner | 2560x1440, safe area 1235x338, 6 MB | Unverified |
| Amazon main image | pure white background, product at least 85 percent of frame, 1000 px minimum and 1600 px or more for zoom, no text or logos | Unverified (help page needs a login) |
| Marketplace square (Etsy, eBay, Shopee, Lazada, Google Merchant Center) | Etsy 2000 px shortest side; eBay 500 px minimum; Google Merchant Center 500x500 floor enforced from 2027-01-31 | Google Merchant Center Verified, others Unverified |
| Google Business Profile post | 1200x900 (4:3), 10 KB to 5 MB | Unverified |
| Email header | 600 px (Mailchimp legacy) or 660 px (new builder) | Unverified |
| Print | US business card 3.5x2 in with 0.125 in bleed; A4 versus US Letter; A5; DL; 3 mm bleed | Unverified |

Localization facts to design against (W3C and MDN, Verified): English-to-European text expansion of 130 to 300 percent depending on string length, taller line boxes for CJK, `dir="rtl"` with logical properties for right-to-left scripts, and `Intl.NumberFormat` and `Intl.DateTimeFormat` for locale output. Noto covers about 1,000 languages under the OFL, which fits the existing bundled-font and license-notice rule (Unverified: the Google Fonts page returned only a title).

Competitive frame: Canva offers brand kits, translation into 134 languages with page quotas, bulk create, and "Canva Websites"; Adobe Express offers brands and translation into 46 languages; Figma Buzz offers bulk create from CSV for localized variants (all Unverified, help pages blocked). None of them exports a code package for a site builder or runs locally; that and design-system import from a URL are BurnGuard's differentiators to keep.

## 7. Roadmap

Order follows dependency and risk. Each phase names the verification that proves it done.

### Phase 0: stabilize (about one week)

- Fix the five drifted tests; give `export-render-lifecycle` a forced-close deadline (`services/export-browser-registry.ts:25`). Verify: the file-by-file sweep is 148 of 148 green.
- Add `scripts/test-backend.ts`: run each backend test file in its own `bun test` child (concurrency 2 to 3, per-file kill at 120 s, JSON summary, quarantine list); expose it as `test:backend`; run it and the frontend suite in `security.yml` on a Windows and Ubuntu matrix. Verify: a green CI run on `main`.
- Add end-to-end fixtures for `imweb_package` and `png_zip` in `scripts/qa/deliverables-fixtures.mjs`; wire or delete the three dead lint codes; drop the production `receiptWriter` parameter.
- Add an error boundary in `App.tsx`, a per-turn timeout in `services/turns.ts`, and reconnect with backoff in `hooks/useSessionEvents.ts`. Verify: one test each.
- Add `CHANGELOG.md`; fix `CONTRIBUTING.md`; refresh `doc/00-overview.md` section 2 and the `doc/06-milestones.md` banner; delete the test-only modules listed in section 5.6.

### Phase 1: harden and lay the international foundation (three to four weeks)

- Internationalization foundation: a message catalog for UI strings (English base, Korean first locale) replacing literals in components, toasts, export labels, guides, and backend user messages; generated copy language driven by the brief `locale` already stored in `DesignBriefV1`; `Intl` formatting in templates; `dir` and logical properties in the prototype and graphic skills; an RTL and text-expansion check in the design audit. Verify: the app runs fully in English and Korean; a right-to-left brief renders a mirrored layout in the audit.
- Fonts: add Noto Sans CJK JP and SC, Noto Sans Thai, and Noto Sans Arabic under the existing bundling and license-notice rule; select by brief locale. Verify: `bundled-fonts.test.ts` cross-checks the new families.
- Frontend: extract `useDrawMode`, `useTweaksMode`, `useDesignAudit`, `useDesignDirections`, `useFileTabs`, and the live-preview and platform-fix wiring from `ProjectView.tsx`; wrap `ChatPane`, `Canvas`, and mode panels in `React.memo`; validate payloads at `api/client.ts:105`.
- Backend: split `design-system-extract.ts` by source; extract the shared helpers; move the QA fault hooks behind dependency injection; measure coverage in CI as a non-blocking artifact; add the DNS-rebinding regression test; decide Windows signing; let `package-mac-release.ts` build unsigned verification packages with a warning.

### Phase 2: global deliverables (one to two months)

- Platform packages, in this order: Shopify (Custom Liquid section plus a JSON template for a whole page, mirroring the Cafe24 layout-plus-fragments shape), WordPress (Custom HTML block fragment plus a page template file, with a `<script>`-free variant for restricted roles and plans), Wix (self-contained iframe fragment with inline CSS and HTTPS assets), Squarespace (Code Block fragment, JavaScript-free variant for the Basic plan), Webflow (fragment splitter under 50,000 characters). All reuse `buildPlatformPackage`, `lintForPlatform`, the guide model, and the verification-status rule; each gets an end-to-end fixture on day one.
- Presets: the ten in section 6, each with `confidence`, `verified_on`, and `rule_source`; a per-market validator model for Amazon (white background, fill ratio) and Google Merchant Center (minimum size) as warnings.
- Localized variants: one design, many locales. Reuse the brief locale and the message catalog to generate the same frame set in several languages as separate `png_zip` batches; this is the feature Canva sells as translation and bulk create, and BurnGuard can do it locally.
- Email newsletter export: a 600 or 660 px table-safe HTML variant of a single page, validated for inline CSS only.
- Product detail page: keep the Q1 to Q8 rules as the generic sales-page blueprint; add marketplace width presets beyond Smart Store and Coupang (Amazon A+ 970 px is a candidate, unverified).
- Cafe24 and Imweb: validate the existing packages on a real shop and site when accounts exist (doc/15 T33 and T61); they remain the Korea region of the same feature.
- Research subsystem: ship a minimal UI or remove it.

### Phase 3: reach (the following quarter)

- Direct publishing where a documented endpoint exists, using the Vercel share pattern (token in memory, verified `html_zip`, no persistence): the WordPress REST API and the Shopify Admin API are the first candidates to evaluate; Cafe24 and Imweb stay package-only until they document one.
- First-run onboarding in the catalog language: CLI detection, Chromium install, Python and pypdf, sample walkthrough.
- Revisit the Codex-only gate for graphics (document the reason or allow Claude Code).
- PPTX with images and shapes; automatic Vercel status polling; multi-step undo with redo; import that restores `graphic_set`.
- Signed and notarized macOS releases in every version; a Linux build once CI runs on Linux.

## 8. Decisions needed from the product owner

1. Base UI language for the message catalog: English base with Korean as the first locale (assumed above), or Korean base.
2. Which region ships second after Korea: English-speaking markets (Shopify, WordPress, Amazon, LinkedIn) or Japan (Shopify Japan, Rakuten, LINE), which changes the font and preset order.
3. Whether the QA fault-injection hooks stay in production builds or move behind dependency injection (Phase 1 assumes the move).
4. Windows signing budget and identity.
5. Research subsystem: ship or delete.
6. Whether `other` and `from_template` remain project types or collapse into `prototype` with a template option.
7. Whether Cafe24 and Imweb validation waits for test accounts or is dropped from the acceptance criteria for 1.0.

## 9. What "1.0" requires under this identity

- One command runs every test on Windows and in CI; CI gates releases with the full suites and the browser fixtures.
- Signed Windows packages; macOS releases with and without signing secrets.
- The app runs fully in at least two UI languages, generates copy in the brief locale, and bundles fonts for the shipped locales.
- At least three non-Korean site packages and the ten global presets, each with an end-to-end fixture and a verification status.
- Documentation whose status sections match the code, plus a changelog.
- No dead subsystem: research shipped or removed; dead lint codes and test-only modules gone.

## 10. Method and sources

- Review passes on 0.5.6: backend architecture, frontend, security, testing/CI/release, product feature verification (two passes), over-engineering audit. Review passes on the 0.5.9 delta: code review of PRs #35 to #47, fact-check of doc/16 (46 rows plus every remaining-gap bullet), global-market research (14 fetches; blocked pages are marked Unverified).
- Measurements: `bun run typecheck`; `bun test` in `packages/frontend`; every `packages/backend/tests/*.test.ts` run separately from the repo root with a 150 s kill, at both commits.
- Repository facts: `git log`, `git diff --stat 5521e65..01c42be`, `git ls-files`, `.github/workflows/*.yml`, `package.json`, `bunfig.toml`.
- Related documents: doc/09 (2026-09-08 remediation), doc/13 (release process), doc/14 (plan), doc/15 (implementation record), doc/16 (before and after, corrected 2026-09-11), ADR-015 in doc/07.
