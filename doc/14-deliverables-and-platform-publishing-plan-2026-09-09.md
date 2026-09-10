# Deliverable Types, Output Formats, and Cafe24/Imweb Publishing Plan (2026-09-09)

## Implementation TODO list — full plan and review additions (2026-09-10)

Reviewed against repository commit `0641552` (0.5.4). This checklist covers the whole document, including implementation gaps identified during review. All items remain open until their acceptance criteria are met; existing HTML navigation, export infrastructure, and Vercel sharing are foundations to reuse, not new features to rebuild. **[Review addition]** marks a correction or additional requirement not adequately specified in the original plan. The original plan and references are preserved below.

Priority: **P0** resolves contract, correctness, or delivery blockers; **P1** delivers the main user flows; **P2** extends supported deliverables or improves usability. Dependencies determine implementation order. External platform claims retain their original verification status; this review does not upgrade them to newly verified facts.

### A. Resolve scope and specification conflicts first — P0

- [ ] **T01 — Define the platform delivery promise. [Review addition]** Distinguish downloadable platform packages, guided manual installation, and authenticated direct publishing in requirements and UI. Do not mark the original direct-upload request complete when only a ZIP is delivered; record any agreed scope reduction explicitly. Reuse the existing Vercel precedent when evaluating a future authenticated channel. Covers sections 1, 3.4, 9.1, and 12.
- [ ] **T02 — Refresh repository facts and ownership. [Review addition]** Replace the obsolete HEAD reference and stale line citations, reconcile the blanket no-deployment/no-outbound statements with existing Vercel sharing and other current integrations, and reserve migration/ADR numbers from the implementation branch rather than assuming 0014/ADR-015 remain free. Record the implementation owner and evidence location for each phase.
- [ ] **T03 — Resolve persisted-schema evolution before merging fields.** Follow ADR-013's versioning requirement for the changed design brief, define legacy V1 reading/upgrading and unsupported-version behavior, and document how `GraphicSetV1` is introduced. Do not silently turn malformed or future graphic-set data into a different deliverable through the existing stored-options fallback. Covers sections 8.5, 10, and 12.6.
- [ ] **T04 — Separate product limits from platform recommendations. [Review addition]** Correct section 4.1's unverified Kakao hard cap and distinguish organic posts from paid-ad placements. A BurnGuard 40-frame resource limit must not be described as a verified vendor limit; unknown specifications produce warnings, while supported internal contracts remain enforceable.
- [ ] **T05 — Correct geometry contradictions. [Review addition]** `860x18604` fits the pixel budget but exceeds the proposed 16384 height limit. Small banner presets such as `300x250`, `750x160`, and `112x112` also conflict with current canvas minimums. Specify valid dimensions per deliverable, integer validation, DPR-aware pixel budgets, and a separate policy for long pages without weakening existing single-image limits globally.
- [ ] **T06 — Reconcile content and format semantics. [Review addition]** Resolve section 4.2's “features after Q3” versus section 10's “features last”; define one authoritative Q1–Q8 sequence. Decide how a one-frame card set exports when `png_zip` currently requires more than one frame, how mixed-size banner PDFs work, and how the UI names ZIPs containing JPEG slices despite the internal `png_zip` identifier.
- [ ] **T07 — Resolve the remaining product choices.** Record defaults for classic Smart Design/Easy support, Cafe24 asset paths and blocking lint, secondary-kind order, detail-brief collection, and platform font fallbacks. Keep the user's Codex-only image-generation requirement; clarify whether other providers may compose HTML while generated imagery still uses Codex, rather than treating removal of the image gate as an undecided requirement. Covers section 12.
- [ ] **T08 — Establish platform verification gates.** Obtain suitable test sites before claiming upload compatibility; recheck official sources for editor modes, plan gates, URL patterns, limits, asset uploads, fonts, widget behavior, and API access. Track source URL, placement, `verified_on`, and confidence per claim. Until verified, label affected exports as documentation-tested rather than platform-validated. Covers sections 2, 6, 7, and 13.

### B. Shared contracts, persistence, and export lifecycle — P0/P1

- [ ] **T09 — Add the graphic-set contract.** Implement strict parsing of kind, frame count, optional frame dimensions/labels, preset ID, and bounded detail-brief fields; require finite integer sizes, match `frames.length` to count, reject kind-incompatible fields, and preserve legacy single-canvas projects. Wire creation, stored options, project reads, and request DTOs together. Covers section 10.
- [ ] **T10 — Add export contracts consistently.** Introduce `png_zip`, `cafe24_package`, `imweb_package`, and artboard PDF across shared types, route parsers, options, backend guards, and frontend availability. Validate format/kind combinations and reject unrelated options; retain the current behavior of existing formats. Covers sections 5 and 10.
- [ ] **T11 — Add safe export metadata and migration.** Extend the database enum/CHECK through a row-preserving migration, naming/MIME/extension helpers, attempt and receipt parsers, retry, recovery, download verification, and garbage collection. Verify old rows and receipts remain readable and invalid new formats fail explicitly.
- [ ] **T12 — Define per-output receipts. [Review addition]** Record each frame/slice's relative filename, dimensions, image format, byte size, digest, sequence, and source region; mixed-size banners cannot use only one shared width/height pair. Bind transformed platform outputs to the source revision/digest, options, and transformation version, and reverify those identities on download.
- [ ] **T13 — Validate platform asset destinations by target. [Review addition]** Cafe24 may use a root-relative path; Imweb assets requiring external hosting need usable HTTPS URLs or an explicit per-asset mapping. Reject credentials, protocol-relative URLs, traversal, encoded path separators, control characters, and unsafe schemes; apply context-appropriate HTML/CSS/JS escaping. URL rewriting must not introduce server-side fetching.
- [ ] **T14 — Preserve transaction and recovery boundaries.** Reuse staged export publication, cancellation, timeouts, receipts, and atomic rename. Add bounded frame/platform scratch cleanup, duplicate-request handling, restart recovery, stale-revision rejection, and download re-verification. Never publish a partial batch as a successful complete export.
- [ ] **T15 — Preserve private document and filesystem boundaries. [Review addition]** Exclude `docs/attachments`, processing attachments, private metadata, and secrets from new site maps, rewrites, archives, and public publishing. Reuse canonical-tree membership and safe path helpers; test symlink/junction escapes, traversal, and originals surviving export failure and undo.

### C. Multi-page website foundation — P1; depends on T03

- [ ] **T16 — Derive the site map from managed HTML files.** Implement home-first, navigation-order, then alphabetical ordering, page titles, home flags, links, and dangling targets. Resolve paths relative to the owning page, preserve Unicode and fragments, and expose one typed page summary to UI, prompts, audit, and platform exporters. Covers section 8.1.
- [ ] **T17 — Define page-count overflow behavior. [Review addition]** Keep the 12-page creation and 24-page summary/audit limits explicit. Do not silently omit additional existing pages from export or label a truncated audit as complete; expose overflow and either refuse the affected operation or provide a bounded continuation policy.
- [ ] **T18 — Carry active-page identity through chat.** Add and validate `active_rel_path` against the current project's indexed HTML before prompt assembly. Preserve it across send/retry and reject stale or cross-project targets; an explicit comment-edit file remains authoritative. Show the selected page in the composer. Covers sections 8.5–8.6.
- [ ] **T19 — Extend bounded prompt context.** Include the active-page structural summary and derived site map with missing targets, while retaining total prompt budgets and the navigation contract exactly once. Apply the same behavior in full and compact context modes.
- [ ] **T20 — Implement shared markup and CSS conventions.** Define header/nav/footer/content markers and shared/page CSS blocks, normalize active-link differences for comparison, and add an explicit legacy fallback. Reuse existing visual-craft rules; preserve shared identity while giving subpages distinct content layouts unless the user requests repetition. Covers sections 8.2 and 8.5.
- [ ] **T21 — Extend safe preview navigation.** Resolve indexed `dir` and `dir/` links to `dir/index.html` consistently in the bridge and parent resolver. Preserve fragments and query behavior, reject external/cross-project/malformed targets, and keep strict source-envelope checks and the opaque iframe sandbox.
- [ ] **T22 — Add page creation and selection UI.** Provide a page dropdown, creation-time page chips/presets, and a missing-page action that prefills a request with validated source and target paths. Define whether the 12-page cap includes the implied home page, reject duplicate/unsafe names, and leave rename/move unavailable until references can be migrated safely.
- [ ] **T23 — Audit every supported page.** Add shared-navigation, active-link, missing-block, dangling-link, and root-absolute-asset findings with the owning `rel_path`. Keep advisory consistency findings separate from existing `must_fix` failures, and bind aggregate audit caches to artifact identity and audit policy.
- [ ] **T24 — Make shared changes reviewable across pages. [Review addition]** Verify propagation after generation, report pages that diverge, and support targeted AI repair and undo through existing artifact operations. A prompt instruction alone is not proof that all pages were updated.

### D. Common platform package pipeline — P0/P1; depends on B and C

- [ ] **T25 — Implement one transformation pipeline.** Reuse canonical staging, source audit, closure validation, and Chromium preflight, then derive the site map, lint, rewrite, generate the static guide and manifests, ZIP, validate, and publish. Use the actual project entrypoint rather than hardcoding `index.html`. Covers section 9.1.
- [ ] **T26 — Validate the transformed output independently.** Build the planned package validator for layout/fragment/common-code roles; validate transformed asset references, package-relative paths, required files, digests, and generated external URL allowlists. Do not reuse the canonical source closure as proof that rewritten fragments work.
- [ ] **T27 — Rewrite all supported references without losing content. [Review addition]** Cover nested HTML, `srcset`, CSS `url()`/imports, linked stylesheets, fonts, script/module references, Unicode names, and filename collisions. Preserve landmark/ID structure needed by CSS and JS when splitting `<main>`; reject or report unsupported dynamic references rather than silently breaking them.
- [ ] **T28 — Implement platform lint with truthful readiness.** Maintain verified/unverified thresholds centrally and show actionable findings. Treat missing required assets, invalid markup, and unresolved required destinations as product completeness failures, even when vendor size limits remain warnings; never call a placeholder-filled package upload-ready.
- [ ] **T29 — Generate guides from one static source.** Use shared static guide data for the ZIP and app modal, including upload order, target editor, assets/fonts, menus, preview/publish steps, backup/rollback, unsupported features, and verification status. Never render arbitrary archive HTML inside the trusted app UI.

### E. Cafe24 Smart Design package — P1; depends on D

- [ ] **T30 — Export a dedicated layout and page fragments.** Emit exactly one contents insertion point in the new BurnGuard layout and a matching layout directive at the start of every page fragment. Preserve page-specific styles, ship rewritten assets and font notices, and never overwrite the shop's existing shared layout. Covers section 9.2.
- [ ] **T31 — Complete page and asset URL mapping. [Review addition]** Preserve nested paths or map them explicitly to target screen URLs; validate navigation after mapping. Keep destination URLs user-configurable until actual shop behavior is verified, and report unresolved links instead of assuming `./page.html` works on every skin.
- [ ] **T32 — Add Cafe24-specific diagnostics.** Detect duplicate jQuery, potentially unsupported extensions including WOFF2, oversized files, excessive folder counts, and problematic filenames. Separate source closure rejection of remote scripts from platform duplicate-library warnings so one check does not make another unreachable.
- [ ] **T33 — Verify the manual installation sequence.** Confirm classic Smart Design, upload assets, create the dedicated layout, create screens, configure links, preview desktop/mobile, and test rollback on a test shop. Record actual uploader/font/charset/URL behavior and distinguish Easy support from classic support.

### F. Imweb code-widget package — P0/P1; depends on D

- [ ] **T34 — Produce scoped page fragments and common code.** Remove document wrappers and shared navigation, retain valid page content, and emit per-page widgets plus common header/footer files. Strip comments as required by the chosen editor; keep Imweb's own page/menu navigation. Covers section 9.3.
- [ ] **T35 — Isolate CSS and assess script compatibility. [Review addition]** Use existing PostCSS with `map: false`; handle root/body selectors, nested at-rules, keyframe names and animation references, font-family collisions, and repeated exports on one host page. Audit global selectors, duplicate IDs, document-wide scripts, and load timing; do not imply that selector prefixing isolates arbitrary JavaScript.
- [ ] **T36 — Implement image embedding and per-asset hosting mapping. [Review addition]** Measure the final fragment after Base64 encoding and rewriting, not just individual image bytes. Support different board-hosted URLs for different files; a single base URL cannot represent unrelated attachment URLs. Preserve alt text and responsive references and require resolution of missing images before marking the package complete.
- [ ] **T37 — Resolve fonts without a silent runtime-policy exception.** Choose verified font hosting, permitted embedded fonts within the payload budget, or an explicit system-font fallback. Only add Google Fonts links after recording the policy exception and external dependency; preserve required license notices and make visual differences visible.
- [ ] **T38 — Enforce the correct widget contract and guide.** Distinguish code widgets from custom widgets, validate final character limits using the target's counting rule, explain forms/iframes and script limitations, and verify preview plus published behavior on a test site. Include common-code placement, asset attachment steps, page URLs, and staging visibility in the guide.

### G. Graphic sets, presets, and artboard PDF — P1/P2; depends on B

- [ ] **T39 — Share preset data without importing backend services into the frontend. [Review addition]** Put serializable preset definitions in a shared module or expose a typed API; include kind, placement, dimensions, confidence, checked date, limits, and safe zones. Distinguish internal defaults from platform rules. Covers sections 4 and 10.
- [ ] **T40 — Build multi-artboard templates and generation rules.** Produce stable, ordered frame identities; card news uses cover/message/CTA structure and consistent dimensions, while banners retain one message across explicit per-frame sizes. Validate generated frame count and geometry before publication, preserving the existing Codex image-generation behavior.
- [ ] **T41 — Add frame-aware editing and navigation. [Review addition]** Provide frame selection, preview, safe-zone overlays, and frame-local element targeting for resize, style, comments, and AI edits. Keep zoom/scroll usable on stacked artboards and exclude editor overlays from exported pixels.
- [ ] **T42 — Implement sequential PNG batch export.** Support the declared slide-deck and graphic-set sources with the appropriate selectors, wait for fonts/images and render readiness, capture frames in order, and emit zero-padded filenames. Validate every image, report progress, and enforce count, pixel, byte, time, and cancellation budgets.
- [ ] **T43 — Generalize PDF rendering beyond its selector. [Review addition]** Update deck-only readiness, viewport, print CSS, paper dimensions, and PDF validation as well as the element selector. Use artboard dimensions in points, prevent clipping/extra blank pages, and explicitly support or reject mixed-size pages.
- [ ] **T44 — Reconcile PDF and batch resource ceilings. [Review addition]** Account for `PDF_RASTER_SCALE`, the current 16-million-pixel per-page and 64-million-pixel aggregate validation budgets, not just source canvas pixels. A 40-frame set may fit the creation limit yet exceed PDF validation; show format-specific limits or adopt a measured bounded strategy instead of failing unexpectedly at the end.
- [ ] **T45 — Add secondary deliverables in the agreed order.** Implement the selected banner placements, thumbnail presets using existing single PNG export where valid, and print presets with millimetre/DPI/bleed semantics. Clearly label print PDFs as RGB and never claim CMYK/PDF-X compliance. Keep unsupported presets unavailable rather than silently resizing them.

### H. Long product-detail pages — P1; depends on B and G

- [ ] **T46 — Add the detail-page creation flow.** Offer a verified or clearly advisory marketplace-width preset, a bounded long canvas, and the seven detail-brief fields with useful hints. Persist/restore the brief, distinguish required information from optional evidence, and keep frame count/format options consistent with a single long page.
- [ ] **T47 — Implement the complete conversion-content rules.** Start with the customer's scene, state the offer and outcome, follow the agreed Q1–Q8 order, translate claims into benefits, cover the four value signals, address objections in place, and place features/CTA consistently. Reuse visual-craft and design-system context without replacing the content structure. Covers section 4.2 and section 10's prompt rules.
- [ ] **T48 — Preserve content truthfulness and scoped iteration.** Mark absent evidence, testimonials, refund terms, and urgency as data still needed; never invent them. Include the skeptical-customer self-review and default to changing one requested region while honoring explicit multi-region requests. Flag unresolved placeholders before public delivery.
- [ ] **T49 — Implement section-aware slicing.** Choose explicit top-level section boundaries rather than every nested node ID, prevent gaps/overlap and zero-height slices, and record any forced cut through content. Verify the `860x12000` example yields boundaries at 4800, 9600, and 12000, with every slice inside its independent pixel budget.
- [ ] **T50 — Enforce actual JPEG/PNG byte constraints. [Review addition]** Add JPEG decoding/dimension validation, define transparency flattening, and measure output bytes. A fixed quality of 85 does not guarantee an upload cap: use bounded quality/slice adjustments or a clear failure/retry path, never silent text degradation or a false success claim.
- [ ] **T51 — Keep long-page rendering bounded. [Review addition]** Avoid allocating a giant full-page bitmap for thumbnails or audit; use clipped thumbnails and bounded section/viewport work. Stabilize fonts, image loading, lazy content, animations, sticky/fixed elements, and 3D content before capture; define unsupported cases and deterministic fixture checks.

### I. Export UX, quality repair, and failure recovery — P1

- [ ] **T52 — Expose only valid export choices.** Add labels/icons, target asset inputs, frame/artboard PDF options, detail-page JPEG quality, and clear disabled reasons. Persist options across retries and explain when the same project can export PNG but not a larger PDF batch.
- [ ] **T53 — Make delivery status actionable.** Show saving/rendering/validating/ready/failure progress, frame or slice counts, warnings, guide access, download, and retry/cancel actions. Keep “package downloaded” distinct from “uploaded and published on the target platform.”
- [ ] **T54 — Connect lint and audit findings to existing repair flows.** Send bounded findings with page/frame identity to the existing AI repair request, respect busy-session behavior, and re-audit the resulting revision. Do not duplicate the quality-fix workflow or force a pass because the content was AI-generated.
- [ ] **T55 — Verify accessibility and draft retention.** Make new selectors, chips, frame controls, guides, and status messages keyboard-accessible and labelled; retain drafts and options across navigation/reload. Ensure errors do not lose attached originals, entered URLs, or the user's active page/frame.

### J. Acceptance tests and platform evidence — P0 release gates

- [ ] **T56 — Test boundary and compatibility contracts.** Cover old briefs/options/receipts, unknown versions and keys, invalid format/kind pairs, fractional/oversized dimensions, one-frame and 41-frame cases, mixed banners, unsafe filenames/URLs, preserved migration rows, and malformed stored state.
- [ ] **T57 — Test multi-page behavior end to end.** Cover three-page creation, nested/Unicode paths, directory index links, fragments, missing-page requests, page caps, active-page precedence, shared-block divergence, safe navigation rejection, and prompts in both context modes.
- [ ] **T58 — Test transformed package correctness.** Assert Cafe24 layout directives and insertion points, full asset/page mapping, Imweb scoping and payload limits, font behavior, unresolved-image failures, canonical private-file exclusion, transformed receipts, and tamper rejection on download.
- [ ] **T59 — Test rendering and crash recovery.** Verify frame counts, decoded dimensions, PDF page sizes and aggregate budgets, long-page cuts, JPEG byte handling, incomplete assets, cancellation, process timeout, restart recovery, and scratch cleanup. Keep mock-based checks separate from actual Chromium execution.
- [ ] **T60 — Run real desktop export acceptance.** On Windows, keep `BG_CHROMIUM_ASSUME_USABLE` unset and verify the UI/event loop stays responsive during multi-frame, PDF, long-page, and platform-package exports. Run the corresponding packaged macOS paths separately; isolated profiles must not modify current user projects.
- [ ] **T61 — Run real destination acceptance before claiming compatibility.** Install a sample package on classic Cafe24 and Imweb; verify mobile/desktop rendering, navigation, assets, fonts, scripts, and publish/rollback. Upload a card set and product-detail slices through the relevant user-owned test accounts and record exact outcomes and remaining unknowns.
- [ ] **T62 — Refresh templates and examples against the new contracts. [Review addition]** Add complete examples for the supported kinds and a multi-page website with distinct page layouts; include design systems, usable assets/fonts, and a landing page with at least six sections. Run actual audit/export checks on each and preserve real failures instead of bypassing validators.

### K. Documentation, release, and deferred scope — P1/P2

- [ ] **T63 — Record implementation and architectural decisions as they land.** Add the implementation record planned in section 11, the schema/export ADR, and any changed service conventions. Link each TODO to its PR and verification evidence; document unresolved vendor claims and chosen defaults before dependent implementation merges.
- [ ] **T64 — Update user-facing documentation together.** Synchronize README/README.ko, overview and architecture export tables, font policy, manual smoke instructions, and the documentation index. Describe the actual generated files, supported editor/plan, manual publishing steps, privacy exclusions, limits, and known unsupported cases.
- [ ] **T65 — Complete the release gates.** Run relevant tests, typecheck/lint, packaged smoke checks, and Daybreak security review of the final source and artifacts before publication. Verify CI, merge/tree identity, installer/update-feed versions and hashes, then check the real update flow; report platform-specific gaps accurately.
- [ ] **T66 — Keep deferred features explicit.** Track direct Cafe24/Imweb push as unresolved until a supported channel and authorization flow are established. Keep WebP, MP4/GIF, CMYK/PDF-X, automatic WOFF conversion, arbitrary page rename/move, and new hosting/credential infrastructure outside this implementation unless separately approved; do not silently count them as completed requirements.

**Suggested execution order:** resolve A, then B; implement C and the graphic-set foundation independently where possible; build D–F on C, and H on G; complete I alongside each feature and require J–K before its release. Do not block independent work on an unavailable platform test account, but keep the corresponding compatibility claim open.

---

## 1. Summary

BurnGuard should add three deliverable families and three export formats without adding a project type, a network destination, or a credential store. Card news (카드뉴스), product detail pages (상세페이지), and banner/thumbnail sets become kinds of the existing `graphic` project, described by a new versioned `options_json.graphic_set` block, and they export through a new `png_zip` format (one PNG per frame, or section-aware slices for a long page, with an optional JPEG slice mode for detail pages) plus the existing PDF renderer with an artboard-sized paper. Multi-page websites keep the loose-file model that already ships; a derived site map, an `active_rel_path` hint in chat turns, an optional `pages` list in the design brief, and a shared-block markup convention (`data-bg-shared`, `data-bg-content`) give the AI and the user a stable page model without a page table.

Decision on the "direct upload" requirement. The request asked for web designs to be uploaded directly to Cafe24 (카페24) and Imweb (아임웹). This plan reinterprets that requirement as "one guided package per platform" and does not deliver a push from BurnGuard into either platform. The reason is that neither platform documents a path that a local desktop tool could use without vendor approval or an unverified API: Cafe24's page-writing Admin API is restricted to approved clients [4], and Imweb has no FTP, no file API, and no page-creation API [16] [19]. Section 9.2 tabulates every candidate channel and why each is rejected. Direct FTP or OAuth push was also rejected for now because there is nothing documented to push to. The app already has one credential-carrying publish path, the Vercel share (README.md:52; packages/backend/src/routes/artifacts.ts:36-50; packages/backend/src/services/vercel-publish.ts:43-58), which keeps the token in memory only; a future Cafe24 push could follow that pattern if a documented endpoint appears. Other outbound traffic is limited to HTTPS-only design-system imports and the first-run Chromium download (doc/01-architecture.md:220-277, ADR-007 in doc/07-decisions.md:195-212), and the no-hosting, no-automatic-deployment scope statement stands (README.md:195).

What ships instead is package-first platform export: two new zip formats, `cafe24_package` and `imweb_package`, are produced by the existing `html_zip` branch, rewrite the page tree into the shape each platform pastes (a dedicated Smart Design (스마트디자인) layout file plus screen fragments; Imweb code widget (코드 위젯) fragments plus common code), run a platform linter, and ship a Korean step-by-step guide inside the zip and in the export status row. The user uploads assets and pastes fragments through the platform admin UI.

The internal product detail page design rules were read and are folded into section 4.2 in full and into the generation prompt rules in section 10 as a distilled list. Several platform figures remain unverified because the vendor help sites returned HTTP 403 to fetchers; every such figure ships as a warning threshold with a `verified_on` date, never as a hard error. The work is phased so that the sub-page foundation and the platform packages can ship before the graphic kinds; the priority column in sections 4 and 5 marks demand, and the phase order in section 11 follows dependency (section 11 explains the difference).

## 2. Scope and method

Sources used in this plan fall into three types. Codebase facts come from the four codebase maps (exports, project-types, multi-page, docs-roadmap) and cite `path:line`. External platform facts come from the research passes on Cafe24, Imweb, card news, the Korean deliverable catalog, output formats, and sub-page tooling; each carries a reference `[n]` that resolves to section 13. Internal product guidance for detail pages comes from the product owner and carries no external citation.

All external references were checked or attempted on 2026-09-09; many vendor pages answered HTTP 403 or a JavaScript-only shell. Each reference in section 13 carries one of three status labels:

- "Verified": the fetched page contains the quoted statement.
- "Unverified": one of the following holds. The page could not be fetched (typically HTTP 403 or a JavaScript-only shell); the figure appears only in a search snippet; or the page was fetched but is a third-party restatement of a vendor figure whose official page was not fetched. Where it matters, the parenthetical after the label says which case applies.
- "Contradicted by source": the fetched page says something different from the claim that was researched; the corrected statement is given with the reference. Absence of a figure on a page is not a contradiction and is labelled Unverified instead.

In sections 6 and 7 the facts are further sorted into "Verified", "Inferred" (a conclusion drawn from what a verified page does not say), and "Unverified". Numbers that were not confirmed are stated as unconfirmed. No URL or figure in this document was invented; where a spec is unknown the text says so.

## 3. Current state

### 3.1 Project types and export formats

`ProjectType` is the closed union `prototype | slide_deck | graphic | from_template | other` (packages/shared/src/app.ts:10-15), mirrored by hand in roughly nine places including the drizzle enum (packages/backend/src/db/pipeline-authorities.ts:46), the SQL CHECK rebuilt by migration 0011 (packages/backend/src/db/migrations/0011_graphic_project_type.sql:1-32), the template switch (packages/backend/src/db/templates/index.ts:14-30), and frontend labels (packages/frontend/src/lib/format.ts:25-31). Adding a type costs a table-rebuild migration because SQLite cannot alter a CHECK.

`ExportFormat` is `html_zip | pdf | png | pptx | handoff` (packages/shared/src/export.ts:4) with `parseExportOptions` as an exhaustive switch (packages/shared/src/export.ts:17-46). PDF and PPTX are gated to `slide_deck` (packages/backend/src/services/exports.ts:142-158, packages/backend/src/routes/artifacts.ts:127). PNG is a single viewport screenshot, `fullPage:false`, bounded 320-4096 by 240-4096 at DPR 1 or 2 and at most 16,000,000 pixels (packages/backend/src/services/export-png.ts:6-26, export-png-validation.ts:2). No per-frame or batched PNG exists. PDF loops over `[data-slide]`, hides the other slides, and calls `page.pdf()` once per slide (packages/backend/src/services/export-pdf.ts:47-57). Graphic projects can export only one PNG locked to the persisted canvas (packages/frontend/src/components/export/export-options.ts:88-107).

`GraphicCanvasV1` bounds are 320-4096 wide, 240-4096 tall, 16,000,000 pixels (packages/shared/src/graphic.ts:7-13). Project options are parsed from `options_json` and unknown JSON falls back to defaults (packages/backend/src/services/project-options.ts:10-22, 43-59). Graphic projects require an authenticated Codex backend in three places (packages/backend/src/routes/home.ts:135-138, routes/session.ts:110, services/turns.ts:300); the reason is not documented.

### 3.2 Export pipeline

Every format opens a Chromium render session through `openRenderSession` (packages/backend/src/services/export-render-session.ts:19-21), which first awaits the child-process launch probe (export-render-session.ts:67-71, chromium-capability.ts:54-93) because `chromium.launch()` blocks the Bun event loop on Windows (doc/09-review-findings-2026-09-02.md:44-57). `html_zip` stages the whole canonical tree, smoke-renders the entrypoint, writes `burnguard-export.json`, zips, and validates by re-running the static closure from the manifest entrypoint (exports.ts:130-133, export-html-validation.ts:26-56). The design audit runs before rendering and `must_fix` findings abort the export as `validation_failed` (exports.ts:84-88). No href or asset rewriting happens except the deck runtime path (export-stage.ts:6-13). Root-absolute asset paths pass the closure but are never rewritten (export-closure.ts:112). Remote fonts fail the closure as `remote_asset` (export-closure.ts:98-116). A new format touches about eighteen places (shared parser, DB enum and CHECK plus migration, route guard, `exports.ts` extension and switch, three naming switches, receipt literal, receipt validation, recovery row type, frontend label, icon, menu, tests).

The only network publishing path is the Vercel share: `POST /api/exports/:id/vercel` takes a user-entered token, re-verifies a succeeded `html_zip` export against its receipt digests, filters the archive to public browser assets, uploads them to the Vercel deployments API, and never persists the token (packages/backend/src/routes/artifacts.ts:36-50; packages/backend/src/services/vercel-publish.ts:16-58; packages/frontend/src/components/export/VercelShare.tsx:20-43). Nothing targets FTP or a site builder; local export publishing is the staging-to-attempts rename (exports.ts:110-116).

### 3.3 Multi-page support and the "prototype navigation" change

Any number of `.html` files can live in a project; each is indexed as category `html` (packages/backend/src/services/managed-project-files.ts:82) and `projects.entrypoint` is a single text column (pipeline-authorities.ts:49). The HEAD commit 7350c47 ("prototype navigation") added a click interceptor in the canvas bridge that posts same-origin `.html` links to the parent (packages/frontend/src/components/canvas/frame-bridge.ts:632-653), a trust boundary `resolveCanvasNavigation` that only accepts indexed `.html` paths (packages/frontend/src/lib/canvas-source.ts:29-43), and tab activation with a "페이지를 열 수 없어요" toast on rejection (packages/frontend/src/views/ProjectView.tsx:871-902). The prompt side is `PROTOTYPE_NAVIGATION_CONTRACT` (packages/backend/src/harness/skills/prototype-skill.ts:117-122), appended exactly once for prototype projects (prompt-builder.ts:255-262, tests/prototype-spatial-layout.test.ts:23-46).

What is missing: no page model beyond the file list; no shared layout or partials (the sandbox has no `allow-same-origin` and only images, fonts, and linked CSS are inlined: Canvas.tsx:311-322, canvas-images.ts:53-113); the structural summary and design audit cover only the entrypoint (prompt-builder.ts:176-197, design-audit.ts:72); the `user.message` payload carries no active page (ProjectView.tsx:1021-1026); `dir/` links fall through to raw iframe navigation and fail (frame-bridge.ts:647-653); `comments.rel_path` and `tweaks.file_path` are free text with no FK (schema.ts:65-104).

### 3.4 Constraints that bind this plan

- Local-first, no hosting or automatic deployment (README.md:195; doc/00-overview.md:76-82).
- Precedent for network publishing: the Vercel share keeps the token in memory, uploads only a verified `html_zip`, and clears the token once the deployment is ready (README.md:52; packages/backend/src/services/vercel-publish.ts:43-58; packages/frontend/src/components/export/VercelShare.tsx:39-43).
- Loopback-only server, sandboxed canvas, no outbound fetch from artifacts; outbound requests from the backend are limited to HTTPS-only design-system imports with private-address rejection (doc/01-architecture.md:220-277) and the first-run Chromium download (ADR-007, doc/07-decisions.md:195-212).
- Chromium must go through the child-process probe (packages/backend/src/services/AGENTS.md:26).
- Bundled fonts are OFL and must travel with license notices; no Google Fonts at runtime (doc/05-design-system-format.md:43-55).
- Versioned brief schema (ADR-013, doc/07-decisions.md:232-286).
- Minimal speculative features (CLAUDE.md sections 2 and 3).

## 4. Deliverable types to add

| Deliverable | Primary platforms | Dimensions | Required output formats | Priority | Reference |
|---|---|---|---|---|---|
| Card news (카드뉴스) set | Instagram, Facebook, KakaoTalk Channel (카카오톡 채널), Naver Blog (네이버 블로그) | 1080x1080, 1080x1350, 1080x1440 (derived), 1080x1920 | PNG per frame in ZIP; PDF one page per frame | P1 | [22] [24] [25] [26] [29] |
| Product detail page (상세페이지) | Naver Smart Store (스마트스토어), Coupang (쿠팡) | 860 or 780 wide, long | PNG or JPEG slices in ZIP (max 5000 or 3000 px tall) | P1 | [33] [34] |
| Banner / ad set (광고 소재) | Meta, Naver GFA (네이버 성과형 디스플레이 광고), Kakao | 1200x628, 1200x1200, 1250x560, 1200x680, 1080x1080 and others | PNG per frame in ZIP | P2 | [24] [37] |
| Thumbnails (썸네일) | YouTube, marketplaces | 1280x720, 1000x1000 | Single PNG (existing) | P3 | [36] [35] [40] |
| Print (명함, 포스터) | Print shops | 94x53 mm at 300 dpi and similar | RGB PDF with a CMYK warning | P3 | [41] [42] [45] |

All five are `graphic` projects with `options_json.graphic_set.kind` set (section 10); thumbnails need presets only. The priority column ranks demand, not build order: card news and detail pages are P1 but land in Phases 4 and 5 because they depend on `GraphicSetV1`, which waits on open question 6 (ADR-013 versioning), while the sub-page foundation and the platform packages (Phases 1 to 3) have no such dependency and are also P1.

### 4.1 Card news (카드뉴스)

Per-platform specs, in order of confidence:

- Instagram feed carousel: up to 20 photos or videos per post (Verified [22]). Feed image ads: JPG or PNG, recommended 4:5 at 1440x1800, supported range 4:5 to 1.91:1, minimum width 500 px, maximum 30 MB (Verified [24]). Instagram added 3:4 support for single photos and carousels, reported 2025-05-29 via Adam Mosseri on Threads and relayed by a photography blog; no official Meta page was fetched for it (Unverified [23]). At Instagram's 1080 px maximum width, 3:4 works out to 1080x1440 px; this pixel size is a derivation and is stated by no source (Unverified, derived [23]).
- Facebook feed carousel: 1:1, 1080x1080 or larger, 2 to 10 cards, 30 MB per image (Verified [25]). Stories carousel: 9:16 recommended, keep about 14 percent (250 px) of top and bottom free of text (Verified [26]).
- X: GIF, JPEG, and PNG are accepted and BMP and TIFF are not (Verified [27]). The figures "1 to 4 photos per post" and "5 MB per photo" appear in the research evidence quote for the same page, but help.x.com blocks non-browser fetchers, so they ship as warning thresholds only (Unverified [27]).
- KakaoTalk Channel post card view (카드뷰): up to 40 images, 20 MB each, 1:1 at 720x720 or larger, 3:4 at 720x960 or larger (Unverified [29]). Kakao Moment (카카오모먼트) 1:1 safe area 89 px top/bottom and 47 px left/right, legal text 24 px or larger (Unverified [30]).
- LinkedIn document posts: PDF, 100 MB, 300 pages (Unverified [28]).
- Naver Blog column widths 693 px (default layout) and 886 px (wide layout), title image 966 px (Unverified, third-party [51]; not hardcoded).

Page counts and structure: default 6 frames (the common template default, Unverified [31]); soft warning at 10 (Facebook carousel cap [25]); hard limits of 20 frames for Instagram [22] and 40 for Kakao [29], enforced as the `frame_count` bound. One aspect ratio across all frames of a set. First frame is the cover, last frame is the call to action, one message per frame; the minimum text size on a 1080 px canvas is a BurnGuard default, not a sourced rule.

Export: `png_zip` with zero-padded `01.png` to `NN.png` at DPR 1, and PDF with one page per frame at the artboard size (for LinkedIn documents). Bounds: `frame_count` 1 to 40.

### 4.2 Product detail page (상세페이지)

Platform specs from research:

- Naver Smart Store: recommended width 860 px, 20 MB per image, JPG/PNG/GIF, no height cap, practical guidance to split images at 5,000 px or less (Unverified: third-party restatement of Seller Center (판매자센터) figures; the official Seller Center page was not fetched [33]).
- Coupang: 780 px is the commonly used width, 3,000 px maximum height per image, GIF not allowed (Unverified: third-party page fetched, no official Coupang page found [34]); "1000 px maximum width", "5 MB per image", and "20 images maximum" were seen only in search snippets (Unverified, snippet only [34]).

Export: `png_zip` with section-aware slicing. Cut points are chosen at `[data-bg-node-id]` section bottoms that keep each slice at or under `slice_height` (5000 for Smart Store, 3000 for Coupang); when no section boundary fits, the slicer cuts at `slice_height` and records a `cut_through_content` finding. Each slice is at most 860x5000 = 4,300,000 pixels, under `MAX_PIXELS` (export-png-validation.ts:2). The pixel cap bounds dimensions, not bytes: a PNG slice's byte size depends on its content, so the per-image byte caps above (20 MB [33], 5 MB Unverified [34]) cannot be guaranteed with PNG alone. Section 5 therefore adds a JPEG slice mode for this kind. The page has a locked width and a free height; the canvas height limit is raised (section 10).

#### Detail page design rules (internal guidance)

These rules govern content order, copy, and section composition of a detail page or sales landing page. Visual styling is subordinate to them. They are reproduced here in full; section 10 carries the distilled generator-facing version.

Core thesis. A detail page that is only pretty but does not convert is "pretty garbage" (예쁜 쓰레기); the goal is payment, not beauty. The page is a salesperson answering the customer's questions in the order the customer asks them, not a product manual. The protagonist is the hesitating customer, not the founder or the product. Building a product and selling it are different skills: the same product with a different page order and copy produces very different revenue.

Rule 1, the first screen sells the customer's scene. Never open with the product name, a brand introduction, or feature slogans ("AI-based", "fast analysis", "personalized", "all-in-one", "first in Korea"). Open with the customer's concrete pain scene or the final scene they want to reach, vivid and specific. "AI-powered X service" is the worst possible opening. Target one sharp persona with the strongest pain; broaden later.

Rule 2, section order. Hook (the customer's problem and the promise to solve it, in one sentence), evidence (proof shown immediately: numbers, results, real screenshots), expertise (why this seller can deliver), mechanism (how it is implemented and how it connects to the customer's result), offer (what the customer receives, which anxieties are removed, why now), features last. Features are supporting evidence at the end, never the lead.

Rule 3, translate every boast into the customer's outcome. Do not delete boasts ("20 years of experience"); translate them into how the customer's problem gets solved. Every sentence must survive "그래서 나한테 뭐가 좋은데?" (so what is in it for me?). Product composition is listed as benefits, not inventory.

Rule 4, four value signals. Clear result (선명한 결과), "I can do it too" (가능성), speed (속도), low effort (수고). When all four are present, perceived value rises and price sensitivity falls. Without a stated difference from existing methods the customer compares on price only and picks the cheapest.

Rule 5, the eight questions the page must answer in order:

| # | Customer's silent question | Section content |
|---|---|---|
| Q1 | Is this for me? | The persona's scene, not the product name. |
| Q2 | What do I get? | The concrete, tangible arrival scene the product can actually deliver. |
| Q3 | Why this method? | What was wrong with existing approaches and how this mechanism solves it. |
| Q4 | Can I really do it? | Cases, previews, before/after, the actual process; a teaser of what the customer receives after paying. |
| Q5 | How hard is it and how long? | The stages, how quickly it becomes easy, the templates, feedback, and manuals that cut trial and error. |
| Q6 | Exactly what do I receive? | The journey in order, not a list: what arrives first, what happens next, support when stuck, the final deliverable. |
| Q7 | What if it fails? | Precise risk reducers: refund rule, exact scope of feedback and support. |
| Q8 | Why pay now? | A concrete urgency device. |

After eight "yes" answers the payment call to action is a natural conclusion.

Rule 6, fix the offer before the page. The offer (오퍼) is the whole promise: what the customer receives, which anxieties are removed, and why now. Features first and customers later is the typical failure order. A weak offer with new copy may raise clicks but not payments. Write the change and the result on paper before writing the page.

Rule 7, answer each anxiety at the scroll position where it appears. The page is a sequence of anxiety-removal devices.

Rule 8, copy discipline. Remove every word the customer does not need for the decision. Longer is not better. Promises must be keepable while still hooking. Emphasize how fast the change starts.

Rule 9, review with the skeptical customer's eyes. Method-act a suspicious version of the persona and attach "so what is in it for me?" to every sentence.

Rule 10, improve one change at a time. Change the first screen, measure, then the middle, then the end; collect the customer's own words as the next hypotheses.

Consequences for generation: the brief must capture persona and pain scene, arrival scene, mechanism and why old methods failed, available evidence, the deliverable journey (Q6), risk reducers, and the urgency device. The generator produces Q1 to Q8 sections by default, places features after Q3 as evidence, refuses feature-slogan and brand-introduction heroes for this kind, runs a skeptical-customer pass on its own copy, and marks evidence, refund rule, and urgency placeholders as "supply real data" rather than inventing them.

### 4.3 Banner sets, thumbnails, print

Banner and ad presets: Meta 1080x1080 / 1080x1350 / 1080x1920 (Verified [24] [25]); Naver GFA (네이버 성과형 디스플레이 광고), as listed by a third-party agency article dated 2025-11-24: mobile DA image banner 1250x560, native banner 16:9 1200x628 and 1:1 1200x1200, native thumbnail 342x228, image feed 1200x680, smart channel 750x160 or 750x200, special DA 750x280, collection 600x600, comment 112x112, plus a legacy mobile DA size 1250x370 (Unverified: third-party page fetched, no official ads.naver.com spec fetched [37]); Kakao Bizboard (카카오 비즈보드) 1029x258 at 300 KB or less (Unverified: 2023 third-party article; the "transparent PNG-24" detail is supported by no readable source [38]); Google display 300x250 and the other standard sizes at 150 KB (Unverified [39]). A banner set uses `GraphicSetV1.frames[]` with per-frame sizes. Thumbnails: YouTube 16:9, minimum 640 px wide, the official page now lists 3840x2160 and 50 MB (Unverified [40]); marketplace thumbnails 1000x1000 recommended with a 500x500 minimum for Coupang (Unverified, third-party [36]), and 1000x1000 as a practical recommendation (실무 권장) for Smart Store, where the same source says no official single value is confirmed (Unverified, third-party [35]). Print: business card 90x50 mm with 94x53 mm working size at 300 dpi and CMYK (Unverified [41] [42]); Chromium PDF is RGB and the guide must say "RGB, 인쇄소에서 CMYK 변환 필요" [45].

## 5. Output formats to add

| Format | Use | Feasible with Chromium? | Pipeline touch points | Priority | Reference |
|---|---|---|---|---|---|
| `png_zip` | Card news frames, banner sets, detail page slices | Yes: `page.screenshot({clip})` per frame or slice | export.ts:4,17-46; exports.ts:72,129-139,142-158,162; export-naming.ts:17-63; export-receipt.ts:33; export-receipt-validation.ts:7-24; export-recovery.ts:22; routes/artifacts.ts:30-32; migration 0014; frontend label/icon/menu | P1 | [53] |
| `cafe24_package` | Dedicated Smart Design layout plus screen fragments plus `web/` assets | Yes: reuses the html_zip smoke render | the same ripple points as `png_zip` plus new export-platform-package.ts, platform-lint.ts, export-package-validation.ts | P1 | [1] [2] |
| `imweb_package` | Code widget fragments plus common code | Yes: same | the same as `cafe24_package` | P1 | [13] [15] |
| PDF for graphic sets | LinkedIn documents, print | Yes: existing per-slide loop with `[data-graphic-artboard]` selector and custom paper | export-pdf.ts:47-57; export-pdf-contract.ts:9-24; exports.ts:144 gate; export-receipt-validation.ts:16-24 | P2 | [45] [54] |
| JPEG slices inside `png_zip` (detail page only) | Byte-capped marketplace uploads | Yes: `page.screenshot` `type` accepts `png`, `jpeg`, `webp` and `quality` applies to `jpeg` and `webp` (Contradicted by source for the earlier "png and jpeg only" claim [53]) | `slice_format` and `jpeg_quality` options in export.ts:9-15; a JPEG decoder-based validator beside export-png-validation.ts:20-44; receipt `image_format` | P1 with Phase 5 | [53] [33] [34] |
| WebP single image | Size-capped uploads | Yes (same API [53]) | export-png.ts:19 sibling plus validator | Rejected | [53] |
| MP4 / GIF | Animated card news | Weak: `recordVideo` is a test feature, file appears only after context close, default size fits 800x800 | none | Not planned | [46] |
| CMYK / PDF-X | Print-ready | No sourced Chromium option | none | Not planned | [54] |

Decision on lossy output. JPEG is accepted for detail-page slices only, because that is the one deliverable in section 4 whose target platforms publish per-image byte caps (20 MB Smart Store [33]; 5 MB Coupang, Unverified [34]) that a PNG of a photographic 860-px-wide slice cannot be guaranteed to meet. The `png_zip` format keeps its name because the frame path (card news, banners) stays PNG-only; for `product_detail` the option `slice_format: "png" | "jpeg"` (default `png`) and `jpeg_quality: 60..95` (default 85, a BurnGuard default: no source gives a quality figure for text-heavy graphics) are accepted, and the receipt records `image_format`. WebP is rejected because no platform in section 4 lists WebP among accepted upload formats (Smart Store JPG/PNG/GIF [33]; Coupang JPG/PNG [34]; Meta JPG/PNG [24] [25]; X GIF/JPEG/PNG [27]). MP4 and GIF are not planned: the only evidence that animated card news is a deliverable is that Korean template tools offer the download (Mangoboard (망고보드) lists image, print, PPT, PDF, video, and GIF downloads, Unverified [31] [55]; MiriCanvas (미리캔버스) lists PDF, PPT, JPG, PNG, MP4, and GIF and excludes PSD, AI, and EPS, Unverified [56]), and Playwright's `recordVideo` is a test-recording feature [46].

The single-file exports (zip, PDF, PPTX, standalone HTML) already match the export list in the Claude Design support article, which reads "Download as .zip, Export as PDF, Export as PPTX, Send to Canva, Export as standalone HTML" (Verified [43]) and the launch post's "export to Canva, PDF, PPTX, or standalone HTML files" (Verified [44]); per-page PNG export at a scale multiplier is standard in Canva and Figma (Unverified [32] [47]) and in the Korean card-news tools above (Unverified [55] [56]), and is what `png_zip` adds. `html_zip` already matches the per-page static folder shape Webflow exports (Unverified, snippet plus third-party confirmation [50]). Figma handoff points users to the html.to.design plugin instead of a writer (Unverified [48]).

## 6. Cafe24 publishing research

Verified facts:

- A Smart Design page declares its layout on its first line with `<!--@layout(/layout.html)-->`; the layout must contain `<!DOCTYPE>`, `<html>`, `<head>`, `<body>` and marks the injection point with `<!--@contents-->`; changing the layout propagates to every page that references it; multiple layout files can be created and selected per screen; the guide recommends leaving `<head>` as is [1].
- The Smart Design editor (편집창) has "쇼핑몰 화면 추가", which creates a new screen that includes `layout.html` automatically, and an HTML view (HTML보기) for direct source editing with save, save-as, preview, and history [2].
- Smart Design Easy (스마트디자인 Easy) has the same structure as classic Smart Design but "HTML을 전혀 수정할 필요가 없습니다" (no HTML editing is needed); sections are reordered by drag, added with "섹션 추가", hidden with the view/hidden button, and deleted from each section's settings [3].
- Admin API "Themes pages": GET reads page source (scope `mall.read_design`); POST, PUT, and DELETE carry the note "Access to this API is limited to certain clients only" [4].
- Admin API Scripttags installs an external script by URL only (`src`, `display_location`, `exclude_path`, `skin_no`, `integrity`); no inline HTML or CSS field [5].
- Design backup/restore stores HTML only, no images, with a filename bound to mall id and skin code; it is not documented as an import channel [6].

Inferred (from what the verified pages do not say):

- Smart Design Easy exposes no HTML editing path: the Easy guide [3] documents only section operations, and no fetched page shows a code editor for Easy. This is an inference from absence.
- jQuery 1.4.4 is built into Smart Design and loading another jQuery risks conflicts: the layout guide [1] states the conflict warning; one research pass confirmed the 1.4.4 figure on the page and another could not, and the guide is undated legacy content, so the exact version may not match every current skin.
- Scripttags cannot carry design markup: inferred from the property list of [5], which has no content field.

Constraints derived from the verified facts: the package must be a layout file plus page fragments, must not bundle jQuery, and must target classic Smart Design only.

Unverified items (support.cafe24.com and shopnotice pages returned HTTP 403; wording comes from search snippets):

- FTP per-file limit of 30 MB since 2023-08-31, not applying to the admin file uploader (파일업로더) [7].
- File uploader extension allowlist (JPG, JPEG, PNG, GIF, BMP, HTML, CSS, JS, EOT, WEBP, WOFF, TTF, OTF) and a 1,000-files-per-folder cap [8]. WOFF2 is not in the snippet's list; all seven bundled BurnGuard font files are `.woff2`, which section 9.2 handles.
- Uploaded files are served from the mall origin under `/web/`, for example `https://{mall_id}.cafe24.com/web/upload/image.PNG`; Korean filenames may break [9].
- Menu links are edited through 컨트롤 패널 > 메뉴 with a "URL 입력" tab [10].
- Skin folder layout under `/design/skin/<skin>/` with `layout/`, `css/`, `js/` folders and `<!--@css(...)-->` / `<!--@js(...)-->` directives (third-party blog) [11].
- The URL pattern of a newly added screen, charset (EUC-KR or UTF-8), whether skin HTML is reachable over FTP, and the admin uploader's per-file size limit: no source found.

## 7. Imweb publishing research

Verified facts:

- Pages are menus; adding a menu creates an empty page built from sections and widgets; changes go live only after 게시하기; global menu pages cannot be added or deleted [12].
- The code widget (코드 위젯) accepts client-side HTML, JavaScript, and CSS only; jQuery and Bootstrap are already loaded; HTML comments are stripped on save; the content limit is 1,000,000 characters (최대 100만자); inside design mode the widget renders only in preview mode ("미리보기모드에서만 확인할 수 있습니다"); Imweb gives no support for user code [13].
- The code widget is not isolated from Imweb's global styles (h1 to h6 sizing leaks in) and shows as an empty box in design mode; the newer custom widget (커스텀 위젯) is isolated, has a live preview, and is limited to "HTML, CSS, Javascript 각각 1만 자까지" (10,000 characters per tab, 30,000 total), Handlebars syntax, no CDN, no fetch, no iframe [14].
- Site-wide code lives at 설정 > SEO > 고급 설정 > 공통 코드 삽입 with four slots: Header Code 상단 (site-verification tags), Header Code, Body Code, and Footer Code; CSS goes in `<style>`, JS in `<script>`; Imweb recommends putting shared CSS/JS there and keeping per-page widgets minimal. The literal `<head>` and `<body>` insertion points are the obvious reading but are not printed on the page [15].
- Imweb does not support FTP; the documented workaround for an image URL is to attach the image in a board (게시판) post and copy its URL [16].

Inferred:

- The code widget renders on the published site: the verified page states only that design mode shows it in preview; rendering after 게시하기 is implied by Imweb's own widget tutorials and by the widget's purpose, not stated as a rule [13].
- A raw-HTML page type does not exist: the menu guide describes pages only as sections and widgets [12]; inference from omission.
- The image attached in a board post is stored as soon as it is inserted and the post need not be published: this detail is on a linked guide ("빠른 이미지 주소 획득 방법") that the research pass attributes to the FAQ at [16] but could not list as a separate URL; treat it as stated by Imweb but not independently fetched.

Constraints derived: a page must ship as one self-contained fragment under 1,000,000 characters with scoped CSS, no document wrapper, and images either inlined or hosted elsewhere; site navigation is Imweb's own.

Unverified items (imweb.me returned HTTP 403 to fetchers except where a browser user agent was used):

- New pages get a numeric URL; the slug can be changed in 메뉴 설정 > URL and the old URL stops working; 메뉴 숨김 hides the page from the top menu, menu widget, and mobile drawer while the URL still loads [12]. A related FAQ, 메뉴 상단 숨김, hides the header section on a page [21].
- Free plan abolished 2025-07-30; whether 공통 코드 삽입 is plan-gated [17].
- Custom font upload is not allowed; Google Fonts via Header Code is the documented alternative [18].
- The Open API has no page, menu, design, or file endpoints; the Script resource `POST /script` with `position: m{menuCode}` exists; whether visible HTML in `scriptContent` renders is unknown [19].
- Template import from a file is impossible (inferred from absence across [16], [19], and [20]) [20].
- Whether `<script>` and `<style>` inside a code widget survive save is implied by examples, not stated [13].
- Board post attachments up to 150 MB; product detail-description images up to 10 MB and 8,000x8,000 px [57].

## 8. Design: sub-page web projects

### 8.1 Page model

- Pages stay loose `.html` files (managed-project-files.ts:82). Nothing is persisted about pages beyond `projects.entrypoint`.
- A derived site map is computed by a new pure helper `packages/backend/src/services/site-map.ts`: `buildSiteMap(files, entrypoint, readHtml)` returns `{ pages: [{ rel_path, title, is_home, nav_order }], nav_links, dangling: [{ from, href }] }`.
- Order: entrypoint first, then the href order inside the entrypoint's `[data-bg-shared="nav"]` (fallback: first `<nav>`), then remaining html files alphabetically.
- Cap: 24 pages. This is a BurnGuard default chosen to bound the "## Site map" prompt block and the per-page audit loop; it is twice the 12-page brief cap in section 8.5 so that a brief-created site always fits with room for pages the AI adds in later turns. Neither number is sourced; both are constants in `site-map.ts` and `design-brief.ts`.
- It is exposed as `ArtifactSummary.pages` (packages/shared/src/artifact.ts:3-16) so the prompt builder, the design audit loop, the platform linter, and the frontend page dropdown read one source.
- No DB change: `files` stays flat (schema.ts:42-63) and the existing `comment_target_unavailable` guard (ProjectView.tsx:1043-1051) covers renamed pages.
- Page rename or move is not offered because it would orphan `comments.rel_path` and `tweaks.file_path` (schema.ts:65-104).

### 8.2 Shared layout and navigation

- No partials and no runtime includes: the sandbox cannot run them (Canvas.tsx:311-322, canvas-images.ts:53-113) and the two platforms need different splits anyway.
- Every page stays self-contained (prototype-skill.ts:89-91) and duplicates the chrome inside marked blocks: `<header data-bg-shared="header">`, `<nav data-bg-shared="nav">` with `aria-current="page"` on the current link, `<footer data-bg-shared="footer">`, and page content in `<main data-bg-content>`.
- The single top `<style>` is split by the marker comments `/* @bg-shared-css */` and `/* @bg-page-css */` so the platform exporter can lift shared CSS into the Cafe24 layout or the Imweb header code.
- Consistency is checked by a site lint in the design audit loop (design-audit.ts:72 extended to iterate site-map pages) with findings `site_nav_mismatch`, `site_missing_aria_current`, `site_dangling_link`, `site_missing_shared_block`, and `site_root_absolute_asset`.
- All site findings carry severity `recommended` (the union is `must_fix | recommended`, packages/shared/src/design-audit.ts:8), so `html_zip` exports still succeed because only `must_fix` findings abort an export (exports.ts:84-88); the platform packages gate on their own linter (section 9).
- Legacy fallback: projects without the blocks use the first `<header>`/`<nav>`, `<main>` or body minus header and footer, and emit a finding instead of failing.

### 8.3 File structure

`index.html` plus sibling or nested pages (`about.html`, `products/detail.html`), assets under relative paths, bundled fonts under `fonts/`. No `site.json`; the site map is always derived.

### 8.4 Link resolution in the sandboxed preview

- The trust boundary stays `frame-bridge.ts:632-653` plus `resolveCanvasNavigation` (canvas-source.ts:29-43).
- Addition 1: resolve `dir/` and `dir` hrefs to `dir/index.html` when that file is indexed, mirrored in both places.
- Addition 2: the rejection toast (ProjectView.tsx:896-899) gains an action "이 페이지 만들기" that prefills chat with "Create `<rel_path>` linked from `<active page>`, sharing the same header/nav/footer" through the existing `user.message` path.
- No back/forward history; tabs already cover it.

### 8.5 Brief and prompt changes

- `DesignBriefV1` gains an optional `pages?: string[]` (prototype only, 1 to 12, slug-like filenames ending in `.html`, `index.html` implied; rejected for other output types like `section_count` at design-brief.ts:80-81). The 12-page cap is a BurnGuard default for one creation turn and is half the site-map cap (section 8.1). Whether this additive field needs a `DesignBriefV2` under ADR-013 is open question 6 and blocks Phase 1 (section 11).
- `appendDesignBriefContext` (prompt-design-brief.ts:3-13) emits "Create exactly these pages as real local files linked from the shared nav: ...".
- The `user.message` payload (ProjectView.tsx:1021-1026) gains `active_rel_path?: string`, validated at the session route as an indexed html path.
- The harness emits "## Active page: about.html" and runs `summarizePrototypeHtml` on that page in addition to the entrypoint (prompt-builder.ts:176-197); a "## Site map" block lists pages in nav order with dangling links marked "MISSING".
- `PROTOTYPE_NAVIGATION_CONTRACT` (prototype-skill.ts:117-122) gains the shared-block convention, the CSS markers, "no root-absolute asset paths, no jQuery include", "propagate shared-block changes to every page in the site map", and "when ## Active page is present, edit that file unless the request names another". The compact variant (prompt-compact-skills.ts:23-28) mirrors it in two lines.
- Comment edits keep their explicit file JSON (comment-edit-request.ts:6-8); it stays authoritative when both exist.

### 8.6 UI changes

- A "페이지" dropdown in the canvas toolbar built from `ArtifactSummary.pages` calling `openFileAsTab` (ProjectView.tsx:1460-1484).
- A composer chip "보고 있는 페이지: about.html" when the active page is not the entrypoint.
- A "페이지 구성" chip list with a preset row (회사소개, 서비스, 포트폴리오, 문의, 공지 mapping to `about.html`, `services.html`, `portfolio.html`, `contact.html`, `notice.html`) in `NewProjectPanel.tsx` for prototype projects, validated in `project-creation.ts` `buildCreateProjectRequest` (:164-259). The default set follows common SMB guidance (Unverified [49]) and is a default only.

### 8.7 Export

`html_zip` is unchanged: every page and asset ships as is. The platform packages consume the same tree through the shared-block convention.

## 9. Design: Cafe24/Imweb publishing

### 9.1 Chosen approach and rationale

Decision: the "direct upload" requirement is delivered as one guided package per platform, not as a push. Package-first platform export. Two zip formats, `cafe24_package` and `imweb_package`, are produced by the `html_zip` branch (exports.ts:130-133) plus one rewrite module (`export-platform-package.ts`), one lint module (`platform-lint.ts`), and one validator (`validatePlatformPackage` in `export-package-validation.ts`, because `validateHtmlArchive` re-runs the closure from `manifest.entrypoint` over the canonical entries and cannot validate a transformed tree: export-html-validation.ts:47-53). The smoke render session on the entrypoint is kept so the Chromium probe gate and console/failed-request findings are inherited. No credentials, no outbound network, no new raw-serving route, and no new rendering surface: the "가이드 보기" modal in the export status row renders the static Korean guide strings from `export-platform-guides.ts` (the same strings that are written into `GUIDE.html`), never content read back from the archive, so the PR #21 security surface (doc/01-architecture.md:220-277) is untouched. The user performs the platform steps by hand following `GUIDE.html` in the zip or the modal.

Rejected alternative: overloading `html_zip` with an `html_target` option, a platform-constraint preview route (`/fs-preview`), and a flagged FTP/OAuth direct publish. Rejected because the option overload still needs its own validator while hiding format identity in options across recovery, garbage collection, labels, and filenames; the preview route serves transformed HTML whose asset URLs point at platform paths the canvas inliner cannot fetch inside the opaque sandbox and adds a raw-serving route to the security surface for a simulated frame with unverified widths; and direct publish contradicts the no-automatic-deployment scope statement (README.md:195), would add a second credential path beside the Vercel share for platforms that document no endpoint, and rests on an unverified Imweb Script API [19].

### 9.2 Cafe24 flow

Direct-upload feasibility per channel. This table gathers the channels examined in sections 6 and 7 so the reinterpretation in section 1 can be checked against each one.

| Channel | Platform | Status | Reason it is not used for a push |
|---|---|---|---|
| FTP or web FTP | Cafe24 | Not used (manual step only) | Would need stored credentials; whether skin HTML (not only `/web/` assets) is reachable over FTP is unverified [7] [9]; plan gating unverified. |
| Admin file uploader (파일업로더) | Cafe24 | Manual step in the guide | Browser UI only; extension allowlist and folder cap unverified [8]. |
| Admin API Themes pages (POST/PUT) | Cafe24 | Rejected | "Limited to certain clients only" [4]; OAuth needs a registered app and a client secret that cannot be embedded in a desktop binary. |
| Admin API Scripttags | Cafe24 | Rejected | Installs an external script by URL only; no inline HTML or CSS field [5]; requires app installation on the shop. |
| Design backup/restore | Cafe24 | Rejected | HTML only, no images, mall-bound filename, not documented as an import channel [6]. |
| Smart Design Easy | Cafe24 | Not supported | No documented HTML editing path (inferred, section 6) [3]. |
| FTP or file API | Imweb | Does not exist | "아임웹은 FTP 방식을 지원하지 않습니다" [16]; the Open API has no file or design endpoints (Unverified [19]). |
| Open API Script (`POST /script`) | Imweb | Rejected for now | Unverified whether visible HTML renders and no documented size limit [19]; would add a credential path (the Vercel share pattern could be reused) for an endpoint whose behavior is unverified. |
| Board post image attach | Imweb | Manual step in the guide | Browser UI only [16]. |
| Code widget paste | Imweb | Manual step in the guide | The only documented way to place outside HTML on a page [13]. |

Flow:

1. The user picks "카페24 스마트디자인 패키지" in the export menu; `asset_base_url` defaults to the root-relative `/web/upload/burnguard/<project-slug>/` (the `/web/` serving path is Unverified [9]) and can be edited.
2. `POST /api/projects/:id/exports { format: "cafe24_package", options: { asset_base_url } }`; `exportContext` rejects `slide_deck` and `graphic` projects with `format_requires_web`.
3. `runExport` stages the tree, runs the design audit and the static closure (remote fonts and CDN scripts already fail as `remote_asset`), builds the site map, runs `lintForPlatform("cafe24")`, smoke-renders `index.html`, rewrites and splits, writes `GUIDE.html`, `lint.json`, and the manifest, zips, validates, writes the receipt, and publishes atomically. Download name: `<slug>-cafe24-r<rev>.zip`.
4. The user uploads `web/<slug>/` through 관리자 > 디자인 > 파일업로더 or an FTP client (limits Unverified [7] [8]).
5. The user creates the BurnGuard layout first: in the editor's HTML view the user saves `layout/burnguard-layout.html` from the package as a new layout file at `/layout/burnguard-layout.html` (multiple layout files can be created and selected per screen, Verified [1]; the `layout/` folder name is third-party, Unverified [11]). The skin's own `layout.html` is not touched, because a change to it propagates to every screen of the shop (Verified [1]).
6. The user then runs 쇼핑몰 화면 추가 per page and pastes `pages/<page>.html` into HTML보기 (Verified [2]). Each fragment's first line is `<!--@layout(/layout/burnguard-layout.html)-->`, which replaces the automatically inserted `layout.html` reference; if the user saved the layout under another path, the guide says to edit that first line to match.
7. The user links pages via 컨트롤 패널 > 메뉴 > URL 입력 (Unverified [10]), previews, and saves.

Steps 5 and 6 are in this order on purpose: a fragment pasted before its layout exists renders without the shared CSS that the layout carries.

Package contents: `layout/burnguard-layout.html` (the entrypoint document with `<main data-bg-content>` replaced by `<!--@contents-->` and the shared CSS block inline in `<head>`), `pages/<page>.html` (first line `<!--@layout(/layout/burnguard-layout.html)-->`, then the page's `<main>` inner HTML plus its page CSS block as an inline `<style>`), `web/<slug>/{css,js,img,fonts}/` (every closure asset with rewritten references), `GUIDE.html`, `lint.json`, `burnguard-export.json`. Inter-page hrefs stay `./<page>.html` with a lint info because the new-screen URL pattern is unverified.

Fonts. The bundled fonts are seven `.woff2` files, and the uploader allowlist snippet names WOFF, TTF, OTF, and EOT but not WOFF2 (Unverified [8]). The package still ships them under `web/<slug>/fonts/` with their OFL license notices (doc/05-design-system-format.md:45-55), the generated `@font-face` keeps the web-safe fallback stack required by doc/05 (:204-208), and the lint emits `cafe24_disallowed_extension` naming `.woff2` explicitly with the guide note "파일업로더가 woff2를 거부하면 FTP 클라이언트로 올리거나 시스템 폰트로 대체". No format conversion is done; that would add a dependency for an unverified constraint.

Constraint checks (lint): `cafe24_jquery_duplicate` is a warning, not an error, because the jQuery conflict warning is on the official page but the exact built-in version is legacy content and partially unverified (section 6, [1]); `cafe24_disallowed_extension`, `cafe24_file_over_30mb`, `cafe24_folder_over_1000_files`, and `cafe24_korean_asset_filename` are warnings because their sources are Unverified [7] [8] [9]. Whether any Cafe24 lint should block is open question 4. Not offered: Admin API page writes [4], design backup as an import [6], Smart Design Easy [3], Scripttags as a design channel [5]. The first guide step tells the user to confirm the skin is classic Smart Design.

### 9.3 Imweb flow

1. The user picks "아임웹 코드위젯 패키지". `asset_base_url` is optional: images at or under a byte budget are inlined as data URIs (the closure already permits image data URIs up to about 2 MB: export-closure.ts:98-116) and only images above the budget need a hosted URL; the helper text explains the board-attach method (Verified [16]).
2. `POST { format: "imweb_package", options: { asset_base_url? } }`; same `runExport` spine; `lintForPlatform("imweb")`.
3. Rewrite per page: strip `data-bg-shared` chrome (Imweb owns navigation [12]), wrap the `<main>` inner HTML in `<div class="bg-site bg-page-<slug>">`, prefix every CSS selector with `.bg-site` using postcss, which is already a backend dependency (`"postcss": "^8.5.28"`, packages/backend/package.json:22, used for untrusted CSS parsing with `map: false` per doc/01-architecture.md:220-277), special-case `:root`, `html`, `body`, `@keyframes`, and `@font-face`, prepend a small reset for h1 to h6, p, and margins because the widget is not style-isolated (Verified [14]), strip HTML comments (Verified [13]), inline or rewrite images, keep inline scripts.
4. Outputs: `pages/<slug>.imweb.html`, `common/header-code.html` (shared CSS block plus a Google Fonts `<link>` for any bundled Google family in use, Pretendard flagged), `common/footer-code.html` (shared JS), `GUIDE.html`, `lint.json`, `burnguard-export.json`. Download name: `<slug>-imweb-r<rev>.zip`.
5. The user adds a menu per page (Verified [12]), sets the URL slug and 메뉴 숨김 while staging (both Unverified: the slug-change and hide-from-menu details are the unverified part of [12]; [21] is the separate header-hiding FAQ), adds a code widget and pastes the fragment (renders in preview [13]), pastes the common code into Header Code and Footer Code (Verified [15]), previews, and publishes with 게시하기 (Verified [12]).

Constraint checks: `imweb_page_over_1m_chars` is an error (Verified [13]); `imweb_page_over_500k_chars`, `imweb_local_font` (Unverified [18]), `imweb_form_or_iframe`, and `imweb_image_needs_hosting` (image over budget without `asset_base_url`) are warnings. Base64 data URIs inflate payload by about 33 percent (Unverified, tool-vendor article [52]), so the byte budget is chosen so that a fragment stays under the 1,000,000-character cap after inlining; image-heavy pages get the `imweb_image_needs_hosting` warning and a placeholder. Not offered: custom widgets (10,000 characters per tab, Verified [14]), Open API script push [19], design-mode automation.

### 9.4 Image hosting handling

Cafe24: assets are referenced through `asset_base_url` and uploaded by the user; the default root-relative path works on the mall origin if the `/web/` serving rule holds (Unverified [9]). Imweb: small images inline; large images require a hosted URL obtained through a board post (Verified [16]) or the user's own host. Fonts: Cafe24 packages ship the bundled OFL `.woff2` fonts and license notices under `web/<slug>/fonts/` with the WOFF2 warning of section 9.2 (doc/05-design-system-format.md:45-55); Imweb cannot host fonts (Unverified [18]), so the header code carries Google Fonts links for the six bundled Google families, which conflicts with the doc/05 runtime rule and is raised in section 12.

## 10. Contract and data changes

Shared contracts (`packages/shared/src`):

- `export.ts:4` `ExportFormat` += `cafe24_package | imweb_package | png_zip`. `ExportOptions` (:9-15) += `asset_base_url?: string` (https URL or root-relative path, no credentials, no query or hash, at most 2048 characters), `slice_height?: 3000 | 5000`, `slice_format?: "png" | "jpeg"`, and `jpeg_quality?: number` (60 to 95; accepted only with `slice_format: "jpeg"`). `parseExportOptions` (:17-46) gains three exhaustive cases; unknown keys still throw `UpgradeContractError(invalid_field)`. `PdfPaper` += `artboard` (page size = canvas px times 0.75 pt).
- `graphic.ts:7-13` `GRAPHIC_CANVAS_LIMITS.maxHeight` 4096 -> 16384 with `maxPixels` unchanged (860x18604 fits). The `png_height` bound in `export.ts:25-31` stays at 4096: a `product_detail` kind exports through `png_zip` only, never as a single PNG. Design-audit viewport for graphic projects stays canvas-sized (design-audit.ts:69-72) and thumbnails need a clip for tall canvases.
- `graphic.ts` gains `GraphicSetV1`, parsed from unknown with unknown keys rejected; absent means `single`. It is stored as `options_json.graphic_set` (project-options.ts:10-22). `CreateProjectRequest.options` (home.ts:30-41) += `graphic_set`; `home-project-input.ts:88-96` requires it exactly when type is `graphic`, defaulting to `single`. No `ProjectType` change, so no `projects` migration and no mirrored literals.

```ts
type GraphicSetV1 = {
  schema_version: 1;
  kind: "single" | "card_news" | "product_detail" | "banner_set" | "thumbnail" | "print";
  frame_count: number;                       // 1..40
  frames?: { width: number; height: number; label: string }[]; // banner_set only
  preset_id?: string;
  detail_brief?: {                           // product_detail only; each optional, <= 500 chars
    persona_pain?: string;
    arrival_scene?: string;
    mechanism?: string;
    evidence?: string;
    journey?: string;
    risk_reducers?: string;
    urgency?: string;
  };
};
```

- `design-brief.ts` `DesignBriefV1` += optional `pages?: string[]` (prototype only). Whether this needs `DesignBriefV2` under ADR-013 is open question 6 and a Phase 1 blocker.
- `artifact.ts:3-16` `ArtifactSummary` += `pages: SitePage[]`.
- Session `user.message` payload += `active_rel_path?: string`, validated in `routes/session.ts` before the harness.

Backend (`packages/backend/src`):

- `db/pipeline-authorities.ts:115,125` exports enum and CHECK; new `db/migrations/0014_platform_export_formats.sql` (0013 is the current last migration) rebuilding `exports` with `CHECK(format IN ('html_zip','pdf','png','pptx','handoff','cafe24_package','imweb_package','png_zip'))` following the 0009 pattern. No `projects` migration.
- `routes/artifacts.ts:30-32` `isExportFormat`; `:127` guards `format_requires_web` (platform packages need a web project) and `format_requires_frames` (`png_zip` needs `slide_deck` or a graphic set with `frame_count > 1` or kind `product_detail`). `services/exports.ts:142-158` mirrors the guards and relaxes `format_requires_deck` so `pdf` is allowed for graphic sets with `pdf_paper: artboard`; `:72` replaces the inline extension ternary with `formatExtension`; `:162` `captureDigest` uses the canvas viewport for `png_zip`.
- `services/export-naming.ts:17-63` three switches (zip / application/zip / tags `cafe24`, `imweb`, `frames`); `export-receipt.ts:33`; `export-receipt-validation.ts:7-24` reuses `{entries}` for the packages and adds `{ frames, width, height, dpr, image_format }` for `png_zip`; `export-recovery.ts:22` imports `ExportFormat` from `@bg/shared` instead of a local copy; recovery scratch cleanup (:47-56) adds `../platform` and `../frames`.
- New: `services/site-map.ts`, `services/platform-lint.ts`, `services/export-platform-package.ts`, `services/export-platform-guides.ts` (static Korean strings, also the source of the "가이드 보기" modal text), `services/export-png-zip.ts` (frame loop copied from export-pdf.ts:47-57 hiding other `[data-graphic-artboard]`, or clip slices for `product_detail`, each validated with `validatePng` at export-png-validation.ts:20-44 or a JPEG decoder validator, then `zipDirectory` from zip.ts:22). `export-pdf.ts` `renderDeckToPdf` gains a selector parameter and the `artboard` paper.
- Presets and lint thresholds live in one data file `services/platform-presets.ts` with `verified_on: "2026-09-09"` and `status: "verified" | "unverified"` per entry; unverified entries never produce an error.
- Templates: `db/templates/graphic.ts` renders N stacked `[data-graphic-artboard]` sections with ids `frame-{n}-{purpose}` when `frame_count > 1`; for `product_detail` it renders a single 860 px wide artboard with Q1 to Q8 section placeholders. No new starter file for sub-pages (templates/prototype.ts unchanged).

Prompt rules (`packages/backend/src/harness`):

- `prompt-builder.ts:102-123`: the graphic block becomes `<burnguard-graphic-output-v1>` with `kind`, `artboard_count = frame_count`, `frames[]`, `delivery_format: png | png_zip`. Card news rules: exactly N artboards in order, same size, cover first, CTA last, one message per frame, keep the 9:16 top and bottom 250 px clear [26]. Banner set: one artboard per size with the same message. Print: mm-accurate CSS sizes, bleed marked, no claim of print-safe color.
- Product detail rules, emitted only when `graphic_set.kind === "product_detail"`. This is the distilled generator-facing form of the internal guidance in section 4.2 and carries no external citation:
  - Structure: one artboard of locked width and free height; sections are `[data-bg-node-id]` blocks each at most `slice_height` tall so slices cut at section boundaries; no `position: fixed` or `sticky`; no critical text within 40 px of a section edge.
  - Offer first: before writing any section, restate from `detail_brief` the change and result the customer gets (what they receive, which anxieties are removed, why now); if the brief lacks it, write a marked placeholder and build the page around it rather than around features.
  - Hero: open with the persona's pain scene or arrival scene. Never open with the product name, a brand introduction, or feature slogans such as "AI-based", "fast analysis", "personalized", "all-in-one", or "first in Korea". Treat "AI-powered X" as a forbidden opening.
  - Macro order: hook, evidence, expertise, mechanism, offer, then features last as supporting evidence.
  - Section blueprint Q1 to Q8, each one section: (1) is this for me, the persona's scene; (2) what do I get, the concrete arrival scene the product can actually deliver; (3) why this method, what was wrong with existing approaches and this mechanism; (4) can I really do it, cases, previews, before/after, a teaser of the delivered screen; (5) how hard and how long, stages, speed, and the templates and manuals that cut trial and error; (6) exactly what do I receive, the journey in order, not an inventory; (7) what if it fails, refund rule and exact support scope; (8) why pay now, a concrete urgency device. Then features, then the payment call to action.
  - Copy: every sentence must answer "so what is in it for me?"; translate boasts ("20 years of experience") into the customer's outcome instead of deleting them; list product composition as benefits, not inventory; the four value signals (clear result, "I can do it too", speed, low effort) each appear at least once, and the page must state a difference from existing methods because without one the customer compares on price only; cut every word the decision does not need; promises must be keepable; emphasize how fast the change starts.
  - Anxiety placement: at each scroll position name the customer's silent objection and answer it there.
  - Placeholders: evidence, refund rule, and urgency values that are not in `detail_brief` are rendered as visibly marked "supply real data" placeholders, never invented numbers or reviews (this also matches `DESIGN_CRAFT_RULES` at design-craft.ts:2-17).
  - Self-review: before completion re-read the copy as a suspicious version of the persona and rewrite any sentence that fails the "so what" test. An automated version of this pass is out of scope for this plan.
  - Iteration: when the user asks for a change, change one region (first screen, middle, or end) per turn unless asked otherwise, so the user can attribute the effect.
- `prompt-design-brief.ts:11`: emit the pages sentence when `design_brief.pages` is non-empty; emit the `detail_brief` fields as labelled lines when present.
- `prototype-skill.ts:117-122` and `prompt-compact-skills.ts:23-28`: the shared-block convention (section 8). No platform-specific prompt text; the package rewriter handles platform constraints, and a `platform_lint_failed` retry toast offers "AI에게 수정 요청" that sends the findings as a `user.message`.

Frontend (`packages/frontend/src`):

- `api/export.ts:12-25` labels; `components/export/ExportMenu.tsx:42-48` icons; `components/export/export-options.ts:61-108` two package entries with `disabledReason: "web_only"`, an `asset_base_url` field, `png_zip` and artboard PDF entries for graphic sets, a JPEG toggle for `product_detail`, single PNG kept for `single`; `buildExportRetryRequest` (:48-56) carries options. `ExportStatusList` renders findings and the "가이드 보기" modal from the static guide strings.
- `lib/project-creation.ts:24-28` presets grouped by kind (from `platform-presets.ts` data); `components/home/NewProjectPanel.tsx` gains a "그래픽 종류" select, `frame_count`, and for `product_detail` the seven `detail_brief` text fields with a short hint per field; `GraphicCanvasFields.tsx` height max follows the new limit; frame navigator and 9:16 safe-zone overlay in the canvas (graphic-preview.ts:36-63).

Tests to extend: backend `export-naming`, `export-validation`, `export-recovery`, `export-receipt-boundary-cases`, `export-gc`, `serve-path-boundary`, `design-audit-export`, `home-project-input`, `project-options`, `graphic-template`, `graphic-export`, `prompt-builder`, `prototype-spatial-layout`, `design-brief-prompt`; frontend `graphic-export-options`, `project-creation`, `graphic-project-creation`, `canvas-source`.

## 11. Phased roadmap with verification criteria

Order versus priority: the phases follow dependency, not the P1/P2/P3 column of sections 4 and 5. Phase 1 is needed by Phases 2 and 3 (the platform packages read the site map and the shared blocks), and Phases 4 and 5 need `GraphicSetV1`, which waits on the ADR-013 decision below.

### Phase 1: sub-page foundation (no export or DB change)

Blocker: open question 6 (whether `DesignBriefV1.pages` may be added as an optional field or needs `DesignBriefV2` with a parser fallback under ADR-013). `DesignBriefV1.pages` ships in this phase, before the ADR of Phase 6 is written, so the decision must be recorded before Phase 1 merges, at least as a note in the PR that Phase 6 turns into ADR-015.

Scope:

- `site-map.ts` and `ArtifactSummary.pages`.
- `active_rel_path` in `user.message` plus session route validation.
- "## Site map" and "## Active page" prompt blocks.
- Shared-block contract in the full and compact prototype skills.
- `DesignBriefV1.pages` with the chip list and the prompt sentence.
- Page dropdown, composer chip, `dir/` resolution in both bridge and resolver, "이 페이지 만들기" toast action.
- Site lint findings at severity `recommended` in the design audit loop.

Verify:

- `site-map.test.ts`: ordering, dangling detection, unicode paths, the 24-page cap.
- `prompt-builder.test.ts` asserts both blocks and that the navigation contract still appears exactly once.
- `design-brief-prompt.test.ts` for pages; `canvas-source.test.ts` for `dir/` resolution.
- `scripts/qa/creation-canvas-fixtures.mjs:182-199` extended with a folder-index page and the create-page toast.
- Manual: a 3-page brief yields 3 linked pages with identical shared blocks and no `site_nav_mismatch`.

### Phase 2: platform package backend

Scope:

- `ExportFormat` literals and options, migration 0014, route and context guards.
- Naming, receipt, receipt validation, recovery ripple points.
- `platform-lint.ts`, `export-platform-package.ts`, `validatePlatformPackage`, `export-platform-guides.ts`, `platform-presets.ts`, legacy fallback.

Verify:

- Updated format-literal tests (section 10 list).
- New `platform-package.test.ts` with an injected browser asserting: every `pages/*.html` starts with `<!--@layout(/layout/burnguard-layout.html)-->`; `layout/burnguard-layout.html` contains exactly one `<!--@contents-->`; every asset reference is rewritten to `asset_base_url`; `.woff2` assets yield `cafe24_disallowed_extension`; Imweb fragments contain no `<html>`, `<head>`, or `data-bg-shared`; selectors are prefixed and `:root` is remapped; comments are stripped.
- A 1,000,001-character page fails with `platform_lint_failed` and `stop_reason validation_failed`; a jQuery include yields the `cafe24_jquery_duplicate` warning; an image over budget without `asset_base_url` yields `imweb_image_needs_hosting`.
- Receipt round-trip and download re-verification (export-download.ts:17-40); migration test that 0014 preserves rows.
- One real export on Windows with `BG_CHROMIUM_ASSUME_USABLE` unset confirming the event loop stays responsive.

### Phase 3: export UI and guides

Scope:

- Menu entries, icons, labels, `asset_base_url` field, retry options.
- Findings and the "가이드 보기" modal (static strings) in the export status row.
- "AI에게 수정 요청" on lint failure.

Verify:

- `platform-export-options.test.ts`: web-only disabling, retry keeps options.
- Manual end-to-end on a classic Smart Design test mall and an Imweb trial site following `GUIDE.html`, recording what the unverified steps look like (new-screen URL pattern, layout file path, uploader limits and WOFF2 handling, widget script handling) into the implementation record (doc/15).

### Phase 4: graphic kinds with `png_zip` and artboard PDF

Scope:

- `GraphicSetV1` and its plumbing, canvas `maxHeight` 16384.
- N-artboard template, `<burnguard-graphic-output-v1>` prompt block.
- `export-png-zip.ts`, PDF selector parameter and `artboard` paper, format gates.
- Menu entries, presets from `platform-presets.ts`, frame navigator and safe-zone overlay.

Verify:

- N frames produce `01..NN.png`, each passing `validatePng`.
- The PDF has N pages at width times 0.75 by height times 0.75 pt within `PDF_MAX_PAGE_PIXELS`.
- Receipt `{frames, width, height, dpr, image_format}` round-trips; 41 frames rejected at the boundary.
- `home-project-input.test.ts` for the "graphic set exactly when type is graphic" rule.
- Manual: a 6-frame 1080x1350 set uploaded as an Instagram carousel by the user.

### Phase 5: product detail page

Scope:

- `product_detail` kind, width-locked canvas (860 or 780), Q1 to Q8 starter.
- `detail_brief` fields in the creation panel and the prompt rules of section 10.
- Section-aware slicing with `slice_height` and the `cut_through_content` finding; `slice_format: "jpeg"` with `jpeg_quality` and the JPEG validator.

Verify:

- An 860x12000 page with `slice_height` 5000 and section bottoms at 4800, 9600, 12000 yields three PNGs cut at those bottoms, each under `MAX_PIXELS`, byte-stable across two runs; the same page with `slice_format: "jpeg"` yields three JPEGs whose decoded dimensions match.
- A page whose section exceeds 5000 px yields the `cut_through_content` finding.
- The generated starter opens with a persona scene and has no product name in the first section.
- Manual upload of slices to a Smart Store test product (the 20 MB and 5,000 px guidance is third-party [33]).

### Phase 6: docs and ADR

Scope:

- `doc/15-platform-packages-and-frames-<date>.md` (this plan is doc/14) in the H2-only style of doc/11 (Implemented request map, Behavior and boundaries, Validation), listing every unverified platform claim as "not verified".
- ADR-015 in doc/07-decisions.md (new formats, `graphic_set`, brief field, and the ADR-013 versioning decision taken in Phase 1).
- README and README.ko "One workspace" table and "Current scope" link; doc/01 section 3.3 export table; doc/05 font note for Imweb.
- `packages/backend/src/services/AGENTS.md` if the frame loop needs an anti-pattern note.

Verify:

- CONTRIBUTING 6.2 and 6.3 checklist; all links resolve.
- README.ko mirrors README line for line.

## 12. Open questions and decisions needed from the product owner

1. Test accounts: is a classic Smart Design Cafe24 mall and an Imweb trial site available to validate the unverified steps before Phase 3 ships? Without them the packages ship on documentation only.
2. Is telling Smart Design Easy users "not supported" acceptable [3]?
3. Cafe24 asset default: root-relative `/web/upload/burnguard/<slug>/` or a full `https://{mall_id}.cafe24.com/...` URL entered by the user?
4. Should any Cafe24 lint finding block the export (the plan makes them all warnings, including the jQuery include), and should the Imweb 1,000,000-character error stay blocking?
5. Must the graphic kinds keep the Codex-only gate at routes/home.ts:135-138, routes/session.ts:110, and turns.ts:300, or may Claude Code produce card news and detail pages? The reason for the gate is undocumented; the plan inherits it unchanged.
6. ADR-013: are optional additive fields (`DesignBriefV1.pages`, `GraphicSetV1.detail_brief`) acceptable without a V2, or is a version bump with a parser fallback required? This blocks Phase 1.
7. Which secondary kinds go first after card news and detail pages: banner set (per-frame sizes), thumbnails (presets only), or print (RGB PDF, CMYK warning)?
8. Imweb fonts: is emitting Google Fonts links for the six bundled Google families acceptable given doc/05 says not to depend on Google Fonts at runtime, or should Imweb packages fall back to system fonts?
9. Detail page brief: are the seven `detail_brief` fields at creation time the right place, or should the model collect them in chat on the first turn?
10. Cafe24 fonts: if the uploader really rejects WOFF2 [8], should the package convert to WOFF (new dependency) or keep the warning-only behavior of section 9.2?

## 13. References

References are grouped by topic to match sections 4 to 9. Numbers are stable citation keys; references added in this revision take the next free numbers and sit in their topic group.

### Cafe24 (sections 6 and 9.2)

1. https://sdsupport.cafe24.com/board/tip/read_intro.html?no=190&board_no=5, "[스마트디자인] 레이아웃이란?", checked 2026-09-09, Verified (layout tag, `<!--@contents-->`, propagation, multiple layouts per screen, jQuery conflict warning; the 1.4.4 version figure is confirmed by one pass and not the other, and the page is undated legacy content).
2. https://sdsupport.cafe24.com/board/tip/read_intro.html?no=192&board_no=5, "HTML디자인 - 편집창 알아보기", checked 2026-09-09, Verified.
3. https://serviceguide.cafe24.com/IN/ko_KR/DN.DD.DW.html, "스마트디자인 Easy 시작하기", checked 2026-09-09, Verified (no HTML editing needed; the absence of an HTML editing path is an inference).
4. https://developers.cafe24.com/docs/en/api/admin/#themes-pages, "CAFE24 Admin API, Themes pages", checked 2026-09-09, Verified.
5. https://developers.cafe24.com/docs/en/api/admin/#scripttags, "CAFE24 Admin API, Scripttags", checked 2026-09-09, Verified.
6. https://serviceguide.cafe24.com/IN/ko_KR/DN.BR.html, "디자인 백업/복구", checked 2026-09-09, Verified.
7. https://shopnotice.cafe24.com/view?no=347480&bbs_no=12, "[FTP] 파일 업로드 용량 제한 변경 안내", attempted 2026-09-09, Unverified (HTTP 403; snippet only).
8. https://support.cafe24.com/hc/ko/articles/18539094398745-%ED%8C%8C%EC%9D%BC%EC%97%85%EB%A1%9C%EB%8D%94-%EA%B4%80%EB%A0%A8-%EC%9E%90%EC%A3%BC-%EB%AC%BB%EB%8A%94-%EC%A7%88%EB%AC%B8, "파일업로더 관련 자주 묻는 질문", attempted 2026-09-09, Unverified (HTTP 403; snippet only).
9. https://support.cafe24.com/hc/ko/articles/8467004548249-%EC%9B%B9-FTP%EB%8A%94-%EC%96%B4%EB%96%BB%EA%B2%8C-%EC%82%AC%EC%9A%A9%ED%95%98%EB%82%98%EC%9A%94, "웹 FTP는 어떻게 사용하나요?", attempted 2026-09-09, Unverified (HTTP 403; snippet only).
10. https://support.cafe24.com/hc/ko/articles/9131391411865-%EB%A9%94%EB%89%B4-%EB%A7%81%ED%81%AC%EB%8A%94-%EC%96%B4%EB%96%BB%EA%B2%8C-%EC%88%98%EC%A0%95%ED%95%98%EB%82%98%EC%9A%94, "메뉴 링크는 어떻게 수정하나요?", attempted 2026-09-09, Unverified (HTTP 403; snippet only).
11. https://ppcle.com/blog/ecommerce/cafe24-smart-coding, "카페24 스마트 코딩 사용법 정리", checked 2026-09-09, Unverified (third-party blog fetched; folder names and directives not confirmed officially).

### Imweb (sections 7 and 9.3)

12. https://imweb.me/faq?mode=view&category=28&category2=31&idx=71181, "메뉴 관리하기", checked 2026-09-09, Verified for menus-as-pages, 게시하기, and global menus; Unverified for the URL slug change, 메뉴 숨김 behavior, access restriction, and noindex details (research listed those as an unverified claim on the same page).
13. https://imweb.me/faq?mode=view&category=29&category2=38&idx=329, "코드 위젯", checked 2026-09-09, Verified.
14. https://imweb.me/faq?category=28&category2=31&idx=72611&mode=view, "커스텀 위젯 만들기", checked 2026-09-09, Verified (per-tab limit "HTML, CSS, Javascript 각각 1만 자까지"; the unsupported-feature list is dated 2026-05-01 on the page).
15. https://imweb.me/faq?mode=view&category=29&category2=38&idx=71387, "사이트에 공통으로 CSS, 스크립트를 삽입하고 싶어요", checked 2026-09-09, Verified (four slot names confirmed; literal tag positions not printed on the page).
16. https://imweb.me/qna?mode=faq&q=71329, "FTP 접속을 지원하나요?", checked 2026-09-09, Verified for the FTP statement and the board-attach workaround. The "코드 보기" step and "stored on insert, no publish needed" details are attributed by the research pass to a linked guide, "빠른 이미지 주소 획득 방법", whose URL could not be listed separately; they are not independently fetched.
17. https://imweb.me/faq?mode=view&category=30&category2=46&idx=72127, "아임웹 요금제 알아보기", attempted 2026-09-09, Unverified.
18. https://imweb.me/faq?mode=view&category=29&category2=38&idx=71290, "구글 폰트 사용하기", attempted 2026-09-09, Unverified.
19. https://developers-docs.imweb.me/reference/openapi.json, "Imweb OpenAPI specification", attempted 2026-09-09, Unverified (not fetched).
20. https://imweb.me/faq?mode=view&category=29&category2=47&idx=71485, "템플릿 변경하기", attempted 2026-09-09, Unverified.
21. https://imweb.me/faq?mode=view&category=29&category2=33&idx=71130, "메뉴 상단 숨김" (the research note identifies idx=71130 as the FAQ that hides the header section; the quoted 메뉴 숨김 sentence about URLs still loading was attached to this URL by one pass and to [12] by another), attempted 2026-09-09, Unverified (HTTP 403; snippet only).
57. https://imweb.me/faq?mode=view&category=29&category2=37&idx=5953, "게시물에 파일 첨부하기", attempted 2026-09-09, Unverified (board attachment 150 MB; product detail images 10 MB and 8,000x8,000 px).

### Card news (section 4.1)

22. https://help.instagram.com/269314186824048/, "Share a post with multiple photos or videos on Instagram", checked 2026-09-09, Verified.
23. https://petapixel.com/2025/05/29/instagram-finally-adds-support-for-34-aspect-ratio-photos/, "Instagram Now Supports 3:4 Aspect Ratio", checked 2026-09-09, Unverified (a photography blog reporting a 2025-05-29 Threads post by Adam Mosseri; the page confirms 3:4 support for single photos and carousels and says the maximum width stays 1,080 px; 1080x1440 is a derivation stated by no source).
24. https://www.facebook.com/business/ads-guide/update/image/instagram-feed, "Instagram Feed image ad specs", checked 2026-09-09, Verified.
25. https://www.facebook.com/business/ads-guide/update/carousel, "Carousel ad specs on Facebook Feed", checked 2026-09-09, Verified.
26. https://www.facebook.com/business/help/201503794673956, "About Carousel Ads in Facebook Stories", checked 2026-09-09, Verified.
27. https://help.x.com/en/using-x/posting-gifs-and-pictures, "How to Post pictures or GIFs", checked 2026-09-09, Verified for accepted formats (GIF, JPEG, PNG; not BMP or TIFF); the "1 to 4 photos" and "5 MB" figures appear in the research evidence quote but the page blocks non-browser fetchers, so they are treated as Unverified.
28. https://www.linkedin.com/help/linkedin/answer/a523054, "Document uploads on LinkedIn FAQ", attempted 2026-09-09, Unverified.
29. https://kakaobusiness.gitbook.io/main/channel/run/post, "소식 | kakao business", attempted 2026-09-09, Unverified.
30. https://cs.kakao.com/helps_html/1073189601?locale=ko, "이미지(네이티브) 소재 유형의 제작 가이드", attempted 2026-09-09, Unverified (JavaScript shell).
31. https://www.mangoboard.net/templates/card-news-1-1, "인스타 카드뉴스 1:1 템플릿", attempted 2026-09-09, Unverified.
32. https://www.canva.com/help/download-file-types/, "Choose the right download file type", attempted 2026-09-09, Unverified (HTTP 403).
51. https://simplep.net/image-size-for-social-media/, "소셜 미디어, 네이버 블로그 이미지 사이즈", attempted 2026-09-09, Unverified (third-party; 693 / 886 / 966 px widths).

### Korean deliverable catalog (sections 4.2 and 4.3)

33. https://1minutesangse.com/guides/smartstore-detail-page, "스마트스토어 상세페이지 사이즈·규격 2026", checked 2026-09-09, Unverified (third-party page fetched and consistent with the figures; official Naver Seller Center page not fetched).
34. https://1minutesangse.com/guides/detail-page-size-guide, "오픈마켓별 상세페이지 사이즈 및 업로드 용량 가이드", checked 2026-09-09, Unverified (third-party page fetched: 780 px, 3,000 px, no GIF are on the page; 1000 px, 5 MB, 20 images seen only in search snippets; the planning-s.kr source returned HTTP 403 and no official Coupang page was found).
35. https://1minutesangse.com/guides/smartstore-thumbnail-size, "스마트스토어 대표이미지 규격 2026", checked 2026-09-09, Unverified (third-party; presents 1000x1000 as a practical recommendation (실무 권장) and states that no official single value is confirmed).
36. https://1minutesangse.com/guides/coupang-thumbnail-size, "쿠팡 썸네일 사이즈·규격 2026", checked 2026-09-09, Unverified (third-party; 권장 1000x1000, 최소 500x500, JPG/PNG, no GIF).
37. https://inside.ampm.co.kr/insight/13354, "네이버 성과형 디스플레이 광고 배너 소재 px", checked 2026-09-09, Unverified (third-party agency page fetched, dated 2025-11-24; no official ads.naver.com spec fetched).
38. https://inside.ampm.co.kr/insight/1727, "카카오 비즈보드 소재 제작가이드 (2023)", checked 2026-09-09, Unverified (third-party 2023 article: 1029x258, 300 KB, four creative types; PNG-24 transparency not supported by any readable source; the official cs.kakao.com page renders only a JavaScript shell and the gitbook guide returned 404).
39. https://support.google.com/google-ads/answer/1722096?hl=en, "Uploaded display ads specifications", attempted 2026-09-09, Unverified.
40. https://support.google.com/youtube/answer/72431?hl=en, "Add video thumbnails", attempted 2026-09-09, Unverified.
41. https://www.ohprint.me/blog/business-card-size-guide-90x50-85x55, "명함 사이즈 90×50 vs 85×55 (2026)", attempted 2026-09-09, Unverified.
42. https://www.redprinting.co.kr/ko/guide/view/2/56, "레드프린팅 파일 가이드", attempted 2026-09-09, Unverified.

### Output formats (section 5)

43. https://support.claude.com/en/articles/14604416, "Get started with Claude Design", checked 2026-09-09, Verified ("Download as .zip, Export as PDF, Export as PPTX, Send to Canva, Export as standalone HTML").
44. https://www.anthropic.com/news/claude-design-anthropic-labs, "Claude Design, Anthropic Labs", checked 2026-09-09, Verified.
45. https://playwright.dev/docs/api/class-page, "Page | Playwright (Node)", checked 2026-09-09, Verified for `page.pdf` print-color behavior ("generates a pdf with modified colors for printing") and `page.emulateMedia({ media: 'screen' })`; no CMYK option exists in the documented API.
46. https://playwright.dev/docs/videos, "Videos | Playwright", attempted 2026-09-09, Unverified.
47. https://help.figma.com/hc/en-us/articles/13402894554519, "Export formats and settings for static designs", attempted 2026-09-09, Unverified.
48. https://www.figma.com/community/plugin/1159123024924461424, "html.to.design", attempted 2026-09-09, Unverified (only the redirect from the html.to.design domain to this plugin page is confirmed).
53. https://playwright.dev/python/docs/api/class-page#page-screenshot, "Page | Playwright Python, page.screenshot", checked 2026-09-09, Verified for `type` accepting `png`, `jpeg`, `webp`, `quality` applying to `jpeg` and `webp`, `clip`, `omit_background`, `scale`; Contradicted by source for the earlier "png and jpeg only, quality JPEG only" claim.
54. https://playwright.dev/python/docs/api/class-page#page-pdf, "Page | Playwright Python, page.pdf", checked 2026-09-09, Verified for `format`, `width`/`height`, `margin`, `landscape`, `print_background`, `prefer_css_page_size`, `scale` (0.1 to 2), `tagged`, `outline`; three paraphrased option descriptions in the research claim were Contradicted by source and the verbatim text is used here.
55. https://www.mangoboard.net/guide/8/%EA%B2%B0%EA%B3%BC%EB%AC%BC%20%EB%8B%A4%EC%9A%B4%EB%A1%9C%EB%93%9C(%EC%9D%B4%EB%AF%B8%EC%A7%80,%EC%9D%B8%EC%87%84,PPT,%EB%8F%99%EC%98%81%EC%83%81,GIF), "결과물 다운로드 (이미지,인쇄,PPT,PDF,동영상,GIF) – 망고보드 사용가이드", attempted 2026-09-09, Unverified.
56. https://help.miricanvas.com/hc/en-us/articles/360032313611-Q-Can-I-download-the-designs-I-created-in-MiriCanvas-as-PPT-PSD-AI-or-other-file-formats, "Can I download the designs I created in MiriCanvas as PPT, PSD, AI, or other file formats?", attempted 2026-09-09, Unverified (HTTP 403; search-indexed text only).

### Sub-pages (sections 8 and 9.3)

49. https://www.networksolutions.com/blog/business-website-pages/, "Essential pages on a website", attempted 2026-09-09, Unverified.
50. https://help.webflow.com/hc/en-us/articles/33961386739347, "How do I export my Webflow site code?", attempted 2026-09-09, Unverified (HTTP 403; search snippet plus third-party confirmation).
52. https://richdevtools.com/articles/web/image-base64-data-uri, "Image to Base64 Data URIs: When to Inline and When Not To", attempted 2026-09-09, Unverified (tool-vendor article; the 33 percent inflation figure).
