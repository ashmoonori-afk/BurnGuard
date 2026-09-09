# Generation and canvas update — 2026-09-09

This followup to the UI redesign connects generation choices, project intake, and direct canvas work. User-visible “prototype” is now “웹디자인”; the persisted `prototype` discriminant remains compatible with existing projects.

## Implemented request map

| Request | Result | Primary implementation |
|---|---|---|
| 1. Model and CommandCode controls | Per-backend model selection; supported effort values; write-only CommandCode key save/delete; Claude models routed through the installed Claude CLI | `GenerationControls.tsx`, `generation-options.ts`, CLI adapters |
| 2. Upload during creation | Existing attachment validation and roles in the new-project dialog; sources and brief become the new session's editable draft | `NewProjectPanel.tsx`, `useComposerDraft.ts` |
| 3. Graphic connection gate | Codex installation and login checked in UI and again on server creation/turn start; failed checks leave files untouched | `routes/home.ts`, `services/backends.ts`, `services/turns.ts` |
| 4. Complete templates | Five sample landings and Splash use at least six substantive sections; published template-specific colors, typography, rules, and previews are linked during creation | `sample-landing-sections.ts`, seed services |
| 5. Web design and sections | Web design label and an integer section count from 1 to 30; count passed into the generation brief | shared `design-brief.ts`, `prompt-design-brief.ts` |
| 6. Scroll in styles | Validated iframe bridge scrolls the nearest scroll container or document while style selection is active | `frame-bridge.ts`, `TweaksLayer.tsx` |
| 7. Three.js | AI-authored managed scene contract and direct editor for cube/sphere/torus, selection, colors, position, rotation, scale, and orbit controls | `ThreeScenePanel.tsx`, `three-scene-runtime.ts`, `services/three-scene.ts` |
| 8. Pinterest mood | Up to 12 public pin URLs; sampled image palettes, inferred brightness mood, explicit defaults, partial-unavailable reporting, and canonical draft publication | `pinterest-mood.ts`, `PinterestImportDialog.tsx` |
| 9. BI | Generated folded-canvas B mark in sidebar, project header, favicon, and both READMEs | `doc/brand-identity.md`, `public/brand/` |
| 10. Graphic failures | Prompt requires previewable HTML plus PNG; unchanged starter output cannot become a successful published result; permission/error/abort paths remain visible | `prompt-builder.ts`, `services/turns.ts` |
| 11. Preview field | 25–300% zoom, pan mode, reset, and matching coordinates across edit/style/comment/draw/select overlays | `Canvas.tsx`, `canvas-coordinates.ts` |
| 12. Vanilla execution | Default isolated personal configuration using native CLI flags; an explicit opt-out uses personal configuration | Codex and Claude adapters |
| 13. LOW effort | LOW on defaults and model changes, explicit user selection, server validation, and CLI argument propagation | shared `generation.ts`, `GenerationControls.tsx` |
| 14. Local fonts | Explicit local-font loading through browser permission, with Windows installed-family fallback; existing style patch flow applies the choice | `local-fonts.ts`, `TweaksPanel.tsx` |
| 15. Comment to AI | One action saves current comment text, carries persisted target/file context and current generation settings into chat, and tracks execution without automatically marking the comment resolved | `CommentPanel.tsx`, `ProjectView.tsx` |

## Behavior and boundaries

New-project submission creates the project and a draft; it does not start a paid model request. IndexedDB failure retains the in-memory draft for the current page and displays a persistence warning. Existing landing files are not overwritten when startup seeds are updated.

Codex model metadata comes from its local model catalog, without reading or returning authentication secrets. Claude model aliases are Sonnet and Opus. CommandCode currently offers the two configured Claude 4.6 models through its [Anthropic-compatible provider endpoint](https://commandcode.ai/docs/provider); GPT routing and a standalone CommandCode agent are outside this implementation. The API key is stored in local configuration and passed only to the child process environment, not prompts, API responses, or event payloads.

Vanilla flags were checked against installed Codex 0.153.4 and Claude Code 2.1.261. Codex ignores user configuration and disables plugin/host-skill discovery and project-document loading. Claude uses safe mode. BurnGuard still supplies its own project brief and generation instructions. Older CLIs may reject these flags and need updating. LOW controls reasoning, not total execution time, network access, or export cost. Claude runs with edit permission and noninteractive permission prompts; this one-shot CLI adapter does not implement an interactive permission round trip.

Three.js is bundled locally under its MIT license. Each managed scene supports up to 16 bounded objects. Saving a scene uses the existing artifact coordinator, revision/digest/file-hash checks, and Undo. The runtime is included inside the HTML so exported HTML can display it offline without a CDN or a new sandbox exception. WebGL is required; unsupported browsers receive a visible error. This is a basic scene editor, not arbitrary mesh/model-file import. Font-family names are applied locally; font files and font licenses are not packaged with output.

Pinterest drafts use supported JPEG/PNG images and a coarse palette histogram. Mood currently describes average palette brightness; typography, spacing, and components are scaffold defaults, clearly labeled in provenance. Pin boards, private content, shortened links, and WebP decoding are not supported. No source image bytes are copied into authored output. Acquisition retains DNS/public-address checks, redirect validation, byte limits, and a 60-second deadline.

The reported poster session completed after approximately 9 minutes 36 seconds and produced final HTML and `poster.png`; it was not still running at inspection. That observation does not prove all graphic requests succeed or attribute the delay to a particular personal plugin. The new LOW/default-vanilla path and unchanged-starter guard are separate fixes.

## Validation

Validation is performed against this branch, separately from the earlier UI PR. Final command results are recorded below after the integrated run. Evidence is kept in the ignored `.omo/evidence/next-branch-2026-09-09/` directory; tests use an isolated profile and do not overwrite the user's project data.

- Shared, backend, and frontend TypeScript build: passed.
- Focused generation, creation, Pinterest, local-font, canvas-coordinate, and Three scene/CAS tests: passed during implementation.
- Full regression, browser, build, and portable runtime results: pending final integrated run.
- Real CommandCode generation: unverified because no test API key was supplied.
- Public Pinterest acquisition: two real public pins passed image acquisition and palette analysis in 3.2 seconds after repairing the Windows DNS fallback. Direct DNS returned `ECONNREFUSED` for Pinterest and a control host while OS lookup worked; the fallback still validates every address and pins the TLS request. The live check did not publish into the user's database. Mocked publication tests are a separate result.
- The previous file-level 80% coverage gate remains unresolved; this change does not claim to repair it. macOS, Narrator, and full external-provider coverage remain outside the local test result.

See the [UI redesign record](10-ui-redesign-2026-09-09.md) for the preceding PR and the [brand guide](brand-identity.md) for image provenance.
