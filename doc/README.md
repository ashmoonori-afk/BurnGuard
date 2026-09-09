# Documentation Index

This folder contains product and engineering documentation for BurnGuard. Some specifications are historical snapshots; use the dated implementation records for current behavior.

## Start Here

- [Product introduction and setup](../README.md), also available in [Korean](../README.ko.md).
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
