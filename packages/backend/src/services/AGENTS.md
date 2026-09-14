# SERVICES KNOWLEDGE BASE

## OVERVIEW

Core artifact, extraction, export, research, and runtime workflows; earned this guide at score 14 for 152 flat TypeScript modules plus the `chromium-node-bridge.mjs` child entry (~17.7k LOC, no barrel `index.ts`), high symbol density, broad exports, and dominant reference centrality.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Artifact mutation | `artifact-coordinator.ts`, `artifact-tree-storage.ts` | Snapshot, stage, validate, publish, commit |
| Design-system extraction | `design-system-extract.ts`, `extraction-*` | 2k-line orchestrator delegates bounded trust boundaries |
| User turn lifecycle | `turns.ts`, `context.ts`, `broker.ts` | CLI process, attachments, events, checkpoints |
| Multi-format export | `exports.ts`, `export-*.ts` | Authority first; publish only validated output and receipt |
| Path/file policy | `managed-project-files.ts`, `canonical-tree-manifest.ts` | Canonical names, limits, symlink rejection |
| Research execution | `research-orchestrator.ts`, `research-selection.ts` | Evidence digests, bounded sources, quarantine |
| Design directions | `design-direction-workflow.ts` | One active generation per session, monotonic state |
| Watchers/recovery | `watchers.ts`, `*-recovery.ts` | Startup convergence and external-write conflicts |
| Catalog two-phase ops | `catalog-lifecycle.ts`, `catalog-service.ts` | Filesystem plus DB copy/trash/restore/purge with receipts |
| Chromium availability | `chromium-capability.ts`, `playwright-runtime.ts` | Child-process probe; `playwright-core` pinned at 1.59.1 |
| Chromium launch host | `chromium-node-bridge.mjs` | Node child owns the browser; in-process launch freezes the Bun loop on Windows |

## CONVENTIONS

- Model mutations as explicit prepare/stage/validate/publish/commit phases with rollback or startup recovery.
- Carry `AbortSignal` through browser, worker, child-process, network, and long filesystem loops.
- Canonicalize paths and JSON before hashing; identity usually combines revision, digest, owner, and byte size.
- Validate filesystem identity before and after sensitive reads; reject symlinks, forbidden hard links, and escapes.
- Keep browser launch behind capability probing and registry-owned cleanup.
- Use typed domain errors with stable codes; sanitize them before they become client-visible events.
- Preserve deterministic ordering and bounded counts/bytes/depth at every acquisition or archive boundary.
- Highest local fan-in is `canonical-tree-manifest.ts`, `export-receipt.ts`, `extraction-acquisition.ts`, and `../security/path-boundary`.

## ANTI-PATTERNS

- Do not weaken limits or path checks in one extractor without checking shared publication invariants.
- Do not copy or overwrite immutable visual-reference bytes in authored output.
- Do not publish output before receipt, digest, renderer identity, and canonical tree validation succeed.
- Do not treat in-memory locks, watcher suppression, or browser registries as durable authority.
- Do not launch Chromium on the Bun server event loop before the child-process probe succeeds.
- Do not put backticks or `${` into `upload-extractor-py.ts` embedded `String.raw` content.
- Do not swallow cleanup errors when they affect authority; distinguish cleanup from correctness-critical rollback.
