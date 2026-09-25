# Contributing to BurnGuard Design

This document defines how we develop BurnGuard Design: environment setup, coding conventions, commit style, testing requirements, and documentation rules.

## 1. Development Setup

### Prerequisites

- **Bun 1.1+** — install from https://bun.sh
- **Node.js 20+** — required for Playwright and some dev tooling (not the main runtime)
- **Git**
- **Claude Code CLI** OR **Codex CLI** — at least one must be installed locally for end-to-end testing
- **.NET 8 SDK** (Windows only) — builds the process host that owns every provider and browser child process. `bun run scripts/dev-launcher.ts` builds it into `dist/windows-process-host/` when it is missing; before running `bun run dev` directly, run `bun scripts/build-windows-process-host.ts` once.
- Windows 10/11 (primary target; macOS/Linux support arrives in Phase 3)

### Bootstrap

```bash
git clone https://github.com/<org>/BurnGuard.git
cd BurnGuard
bun install
bun run dev
```

`bun run dev` runs:
- Vite dev server (frontend) on an auto-selected port
- Hono server (backend) on 127.0.0.1:14070 with watch mode
- Both are proxied under a single port in dev

### Build a binary

```bash
bun run build:frontend          # Vite build → packages/frontend/dist
bun run build:backend           # bun build --compile → dist/burnguard-design.exe
```

### Running tests

```bash
bun test                        # unit + integration
bun run test:e2e                # Playwright E2E (requires installed Playwright)
```

## 2. Workspace Layout

```
packages/
├── shared/      # TypeScript types shared by frontend + backend
├── backend/     # Bun + Hono + LLM harness
└── frontend/    # Vite + React SPA
```

See [01-architecture.md §4](./01-architecture.md) for the full tree.

## 3. Coding Conventions

### 3.1 Language rules

- **TypeScript everywhere.** No plain JS in source (test fixtures exempt).
- **`strict: true`** in tsconfig. No `any` without an inline comment justifying it.
- **ESM only.** Import extensions explicit (`.ts` for cross-package imports resolved by tsconfig paths).
- **No default exports** except for React components and plugin entry points.

### 3.2 Immutability & error handling

Follow the user-level global rules in `~/.claude/rules/common/coding-style.md`:
- Prefer immutable data; return new copies instead of mutating in place
- Handle errors explicitly at every level
- Validate all external input at system boundaries (CLI output, REST body, file upload)
- Never silently swallow errors

### 3.3 File size guidelines

- Files typically 200–400 lines; 800 is a hard ceiling. Split before hitting it.
- One concept per file. Utilities in a dedicated `lib/` directory.

### 3.4 Naming

- Files: `kebab-case.ts` for utilities, `PascalCase.tsx` for React components
- Types/interfaces: `PascalCase`
- Variables/functions: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE` only for true compile-time constants
- React component files export both the component and its props interface

### 3.5 Imports

```typescript
// 1. Node / Bun builtins
import { readFile } from "node:fs/promises";

// 2. External packages
import { Hono } from "hono";

// 3. Workspace packages (shared types)
import type { NormalizedEvent } from "@bg/shared";

// 4. Relative imports (same package)
import { broker } from "./harness/broker";
```

### 3.6 Comments

Default to **no comments**. Only add a comment when the *why* is non-obvious:
- A hidden constraint
- A workaround for a specific bug (reference the bug)
- Subtle invariant that would surprise a reader

Don't add a comment that explains *what* the code already does via naming.

## 4. Testing Requirements

Per `~/.claude/rules/common/testing.md`, enforce:
- **Unit tests first.** TDD encouraged: write the failing test, then the implementation.
- **80%+ coverage** target on new code. Lower is acceptable only with a written justification in the PR.
- **Three test types**, each required at least once per user-facing feature:
  1. Unit — pure functions and components
  2. Integration — harness + CLI stub, DB migrations, API handlers
  3. E2E — critical user flows via Playwright

### Test structure

- Colocate unit tests: `foo.ts` and `foo.test.ts` side by side
- Integration tests: `packages/backend/tests/integration/*.test.ts`
- E2E: `tests/e2e/*.spec.ts`
- Fixtures: `tests/fixtures/{adapter_id}/*.jsonl`

### Fixture-driven parser tests

Parser tests follow this pattern:
```typescript
test("parses tool_use and tool_result for Edit", () => {
  const fixture = readFixture("claude-code/edit-basic.jsonl");
  const events = parse(fixture);
  expect(events).toMatchSnapshot();
});
```

Fixtures are recorded from real CLI runs. Update them only when the CLI's output format genuinely changes.

## 5. Commit Style

Follows `~/.claude/rules/common/git-workflow.md` — conventional commits:

```
<type>: <description>

<optional body>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

Examples:
```
feat: add Codex adapter parser for tool_use blocks
fix: prevent fs-watcher from triggering on .attachments writes
docs: extend 03-backend-adapters.md with retry timing table
refactor: extract context-builder prompt renderer
```

### PR rules

- One logical change per PR
- PR description includes **what** and **why**, never just **what**
- Link the relevant issue or identify the local milestone task.
- All checks green before requesting review
- Do not merge your own PR without at least self-review pass on the diff

## 6. Documentation Rules

### 6.1 Language

**All documentation in `doc/` is written in English.** Inline source comments may be in any language the author chooses (though English is preferred for shared code).

### 6.2 When to update docs

Update `doc/` in the **same PR** as the code when:
- You change an event type in `NormalizedEvent`
- You change a SQLite table
- You change a REST endpoint
- You change an adapter's interface
- You add or remove a dependency
- You change the distribution format or build command

### 6.3 When to add an ADR

When making an architectural decision that:
- Is irreversible or costly to reverse
- Narrows the design space for future work
- Affects more than one package

…document the decision in the PR and add a new entry to the local architectural decision log. ADRs are append-only; supersede rather than edit.

### 6.4 Diagrams

- ASCII box diagrams for topology and flow (see `01-architecture.md` §1 and §5)
- No external diagram renderer (no Mermaid, no PlantUML); the goal is that docs render correctly in any Markdown viewer
- Screenshots only for UI references, stored under `ref/`

## 7. Dependency Policy

### Adding a dependency

Before adding a new dependency, ask:
1. Is there a standard library function that covers 80%+ of the need?
2. Is it actively maintained (last release within 12 months)?
3. License compatibility (MIT / Apache-2 / BSD preferred; AGPL forbidden)
4. Install footprint — avoid anything > 5 MB without justification

Document the rationale in the PR description.

### Updating dependencies

- Minor/patch updates via `bun update` are fine, run tests afterwards
- Major updates need a dedicated PR + ADR if the API surface changed

## 8. Performance Budget

| Metric | Budget |
|---|---|
| Binary size (excluding Playwright) | < 100 MB |
| Cold start to first paint | < 2 seconds |
| First chat response delay (SSE first event) | < 1 second after CLI returns something |
| Memory at idle (no sessions) | < 200 MB |
| Memory per active session | < 100 MB additional |

CI enforces binary size; runtime budgets are spot-checked manually each phase.

## 9. Security Checklist

Per `~/.claude/rules/common/security.md`, every PR that adds user-facing functionality must confirm:

- [ ] No hardcoded secrets
- [ ] All user input validated at the boundary
- [ ] No path traversal in file operations
- [ ] No injection in CLI command construction
- [ ] CLI command execution respects the project-dir jail
- [ ] Error messages don't leak sensitive data (paths, tokens)

If the PR touches the harness, also confirm:
- [ ] Permission gate rules still hold
- [ ] Session raw log doesn't leak unredacted secrets

## 10. Release Checklist

Per phase (see the project delivery plan):

- [ ] All phase DoD items met
- [ ] CHANGELOG updated (append-only, per version)
- [ ] `meta_schema.version` bumped if DB changed
- [ ] Binary builds reproducibly on a clean machine
- [ ] Tutorials work end to end on a fresh install
- [ ] GitHub Release draft prepared with binary attached
- [ ] Install guide validated (README install steps followed verbatim)

## 11. Getting Help

- Open an issue with the `question` label for ambiguity
- Check the local architectural decision log before challenging an architectural choice — chances are the rationale is already recorded
- Attach `~/.burnguard/logs/session-{id}.log` when reporting harness bugs
