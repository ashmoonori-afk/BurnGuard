# Documentation Index

Start with the [product introduction and setup](../README.md), available in [Korean](../README.ko.md) and [Chinese](../README.zh-CN.md). Release changes are listed in the [changelog](../README.md#changelog).

[User guide](user-guide.md): make a first website, fix an image, move a project to another computer and locate your files.

## Architecture and development

- [Product overview](../README.md): current product scope, supported platforms and setup. The retired internal-alpha overview is available in Git history.
- [Architecture](01-architecture.md): runtime topology, data flow and security boundaries.
- [Data model](02-data-model.md): filesystem layout, SQLite schema and persistence.
- [Backend adapters](03-backend-adapters.md): orchestration and normalized events.
- [Contributing](CONTRIBUTING.md): development, validation and packaging.

## Design and generation

- [Design guidance](design-craft.md)
- [Native charts](charts.md)
- [Per-OS matrix](os-matrix.md)
- [Image production](image-production.md)
- [Research catalog](research.md)
- [Brand identity](brand-identity.md)
- [Logo design deliverable](logo-design.md)
- [Deterministic PNG logo tracing: design and measured results](24-logo-tracer-2026-10-23.md)
- [Geometry-first logo marks: the source record and its compiler](25-logo-geometry-2026-11-09.md)
- [The construction view of a geometric mark](26-logo-construction-2026-11-09.md)
- [Measured self-review of a geometric mark](27-logo-geometry-review-2026-11-09.md)
- [The gated flow of the geometric logo method](28-logo-geometric-flow-2026-11-09.md)
- [The server side of one geometric logo step](29-logo-geometric-step-2026-11-09.md)
- [Wiring the geometric logo method into a turn](30-logo-geometric-turn-2026-11-09.md)
- [The geometric logo panel](31-logo-geometric-panel-2026-11-09.md)
- [The wordmark and the lockup of the geometric logo method](32-logo-wordmark-lockup-2026-11-09.md)
- [Model capability profiles, CSS logos and web asset sourcing](model-profiles.md)
- [Edit scope and revision comparison](edit-scope.md)
- [Sample design system](<../design system sample/README.md>)
- [Bundled themes](<../design system themes/>)
- [Original sample collections](../samples/original/README.md)
- [Image provenance](images/README.md) and [image recipes](images/image-recipes/README.md)

## Local reference documents

Historical numbered documents 04–23 and `reference-*.md` are intentionally untracked and ignored. Existing local copies are preserved; they are not required for a fresh checkout or a release package. Root `ref/`, `devplan/` and `.omo/` are also local-only.

Documentation in this folder is English. Dated notes describe their recorded state; current source and tests determine shipped behavior. Git history retains earlier tracked revisions.
