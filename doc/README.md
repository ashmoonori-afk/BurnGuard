# Documentation Index

This folder contains product and engineering documentation for BurnGuard. Some specifications are historical snapshots; use the dated implementation records for current behavior.

## Start Here

- [Product introduction and setup](../README.md), also available in [Korean](../README.ko.md).
- [Native charts](./charts.md): eight original chart types, data editing, generation contracts and portable SVG output.
- [Image production](./image-production.md): original purpose recipes, visual treatments, bounded prompt assembly and saved preferences.
- [Project review and roadmap, final, September 11, 2026](./17-project-review-and-roadmap-2026-09-11.md): review of v0.5.9 across architecture, frontend, security, testing/CI, product/docs, simplicity, and global readiness, with measured test baselines and a phased roadmap for a multi-country SMB deliverable tool.
- [Generation, edit, and export logic before and after, September 10, 2026](./16-generation-edit-export-before-after-2026-09-10.md): concern-by-concern comparison of 0641552 and 01c42be with evidence paths, remaining gaps, and the coverage that backs each row.
- [Design task decomposition and prompt presets by model and reasoning effort, September 14, 2026](./18-design-task-and-reasoning-presets-plan-2026-09-14.md): task structure, draft presets selected by model and effort, shared-prompt conflict cleanup, and the evaluation design that separates prompt assembly from unmeasured model quality.
- [Task preset implementation and evidence gates, September 14, 2026](./19-task-preset-implementation-2026-09-14.md): shipped prompt behavior, example eligibility and CI verification, comparison planning, and the live evaluation work that remains.
- [Platform packages and graphic sets, September 10, 2026](./15-platform-packages-and-graphic-sets-2026-09-10.md): implementation record for the plan below — site map and active page, graphic set kinds and presets, PNG bundle and slice exports, artboard PDF, Cafe24/Imweb packages, and what stays blocked or deferred.
- [Deliverables and platform publishing plan, September 9, 2026](./14-deliverables-and-platform-publishing-plan-2026-09-09.md): accepted defaults, implementation checklist, package-first Cafe24/Imweb delivery, graphic sets, and product-detail exports.
- [Windows updates and original samples](./13-windows-updates-and-original-samples.md): installer publication, safe update application, and four original collections across three formats.
- [Windows native app, September 9, 2026](./12-windows-native-2026-09-09.md): portable WebView2 window, engine ownership, packaging, and verification.
- [Generation and canvas update, September 9, 2026](./11-creation-tools-and-canvas-2026-09-09.md): models, LOW effort, source intake, 3D, fonts, comments, Pinterest, and validation boundaries.
- [Brand identity](./brand-identity.md): generated mark, palette, and usage rules.
- [UI redesign and verification, September 9, 2026](./10-ui-redesign-2026-09-09.md): current navigation, creation, workspace, settings, and runtime fixes.
- [Review remediation, September 8, 2026](./09-review-remediation-2026-09-08.md): R01–R37, regression evidence, and remaining coverage/platform checks.
- [Research catalog](./research.md): source contracts and their limits.

The original milestones and screen specification below describe earlier plans; they are not a current release checklist.

## Read In Order

1. [00-overview.md](./00-overview.md)
   Product definition, scope, current implementation snapshot, and roadmap
2. [01-architecture.md](./01-architecture.md)
   Actual runtime topology, data flow, source tree, and current technical constraints
3. [02-data-model.md](./02-data-model.md)
   Filesystem layout, SQLite schema, and persistence model
4. [03-backend-adapters.md](./03-backend-adapters.md)
   Current turn orchestration, Claude Code/Codex adapter behavior, and event normalization
5. [04-ui-spec.md](./04-ui-spec.md)
   Screen-by-screen UI specification
6. [05-design-system-format.md](./05-design-system-format.md)
   Design system directory format and authoring contract
7. [06-milestones.md](./06-milestones.md)
   Current delivery stage, remaining Phase 1 work, and forward roadmap
8. [07-decisions.md](./07-decisions.md)
   Architectural decisions log

## Jump By Topic

| Topic | Where |
|---|---|
| Product scope and non-goals | [00-overview.md](./00-overview.md) |
| Current runtime topology | [01-architecture.md](./01-architecture.md) |
| SQLite schema | [02-data-model.md](./02-data-model.md) |
| Normalized event types and adapter behavior | [03-backend-adapters.md](./03-backend-adapters.md) |
| Current UI flow and evidence | [10-ui-redesign-2026-09-09.md](./10-ui-redesign-2026-09-09.md) |
| Original UI specification | [04-ui-spec.md](./04-ui-spec.md) |
| Design system sample format | [05-design-system-format.md](./05-design-system-format.md) |
| Phase status and remaining work | [06-milestones.md](./06-milestones.md) |
| Deliverables and Cafe24/Imweb publishing plan | [14-deliverables-and-platform-publishing-plan-2026-09-09.md](./14-deliverables-and-platform-publishing-plan-2026-09-09.md) |
| Current quality assessment, global readiness, and roadmap | [17-project-review-and-roadmap-2026-09-11.md](./17-project-review-and-roadmap-2026-09-11.md) |
| What changed in generation, edit, and export (0.5.4 to 0.5.9) | [16-generation-edit-export-before-after-2026-09-10.md](./16-generation-edit-export-before-after-2026-09-10.md) |
| Task guidance presets by model and reasoning effort | [18-design-task-and-reasoning-presets-plan-2026-09-14.md](./18-design-task-and-reasoning-presets-plan-2026-09-14.md) |
| Implemented presets, evidence gates, and evaluation status | [19-task-preset-implementation-2026-09-14.md](./19-task-preset-implementation-2026-09-14.md) |
| Engineering decisions | [07-decisions.md](./07-decisions.md) |
| Dev setup and conventions | [CONTRIBUTING.md](./CONTRIBUTING.md) |

## Out-of-Band References

Stored at repo root, outside `doc/`:

| Folder | Purpose |
|---|---|
| `ref/` | Reference screenshots of the real Claude Design UI |
| `design system sample/` | Canonical Northvale Capital sample design system |
| `devplan/` | Execution plans and implementation notes |

## Document Conventions

- Documents may be written in English or Korean; the root README is available in both
- Code blocks use fenced triple-backtick blocks with a language hint when useful
- Relative links are preferred for cross-references
- Concrete dates are used when describing status snapshots to avoid ambiguity
- `git log` remains the source of truth for document history
