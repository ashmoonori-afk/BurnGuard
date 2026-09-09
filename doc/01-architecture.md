# Architecture

## 1. Runtime Topology

As of April 22, 2026, BurnGuard runs as a single Bun backend process plus a React frontend:

```text
burnguard-design.exe or bun run src/index.ts
  |
  +-- Bun runtime
      +-- Hono HTTP server on 127.0.0.1:14070 by default
      +-- SQLite via drizzle-orm
      +-- Static frontend serving from packages/frontend/dist
      +-- Bootstrap (config, sample design system, migrations, seed data)
      +-- Session/event services
      +-- File watchers for project directories
      +-- Export worker logic
      +-- CLI child processes launched with Bun.spawn
            +-- claude
            +-- codex
```

Important current constraint:
- the implementation does **not** use `node-pty`
- the implementation does **not** keep a long-lived interactive CLI session per project
- each user turn is executed as a fresh subprocess invocation

## 2. Boot Sequence

Current startup flow:

1. Create the local BurnGuard app directories
2. Ensure config exists
3. Seed the bundled sample design system if missing
4. Run SQLite migrations
5. Seed core DB data
6. Attach file watchers to existing projects
7. Start the Hono server
8. In non-dev mode, open the local URL in the default browser

Relevant implementation files:
- `packages/backend/src/index.ts`
- `packages/backend/src/bootstrap.ts`
- `packages/backend/src/server.ts`
- `packages/backend/src/lib/paths.ts`

## 3. Tech Stack

### 3.1 Backend

| Area | Current choice |
|---|---|
| Runtime | Bun |
| HTTP server | Hono |
| Persistence | SQLite + drizzle-orm |
| Streaming | native SSE via Hono |
| Child process execution | `Bun.spawn` |
| Project watching | `node:fs.watch` |

### 3.2 Frontend

| Area | Current choice |
|---|---|
| Framework | React 18 |
| Bundler | Vite 5 |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Server-state cache | `@tanstack/react-query` |
| Local UI state | Zustand |

### 3.3 Export

Current export implementation:

| Format | Status |
|---|---|
| `html_zip` | Implemented |
| `pdf` | Schema/UI placeholder only |
| `pptx` | Schema/UI placeholder only |
| `handoff` | Schema/UI placeholder only |

The HTML zip export currently shells out to Windows PowerShell `Compress-Archive`.

## 4. Source Tree

```text
BurnGuard/
  packages/
    shared/
      src/
        app.ts
        artifact.ts
        events.ts
        export.ts
        harness.ts
        project.ts
    backend/
      src/
        adapters/
          claude-code/
          codex/
        db/
          migrations/
          templates/
        harness/
          prompt-builder.ts
        routes/
          artifacts.ts
          health.ts
          home.ts
          project.ts
          runtime.ts
          session.ts
          system.ts
        runtime/
          deck-stage.ts
        services/
          attachments.ts
          backends.ts
          broker.ts
          checkpoints.ts
          context.ts
          exports.ts
          files.ts
          trace.ts
          turns.ts
          watchers.ts
        bootstrap.ts
        config.ts
        index.ts
        server.ts
    frontend/
      src/
        api/
        components/
          canvas/
          chat/
          export/
          files/
          home/
          modes/
          project/
          settings/
          systems/
          ui/
        state/
        views/
          HomeView.tsx
          ProjectView.tsx
          DesignSystemView.tsx
          DesignFilesView.tsx
          SettingsView.tsx
```

## 5. Current Data Flow

### 5.1 Project creation

1. Frontend posts to `/api/projects`
2. Backend creates the project row and initial session row
3. Backend writes starter artifact files from DB template helpers
4. File watcher is attached to the new project
5. Frontend navigates to `/projects/:id`

### 5.2 User turn

1. Frontend posts `user.message` to `/api/sessions/:id/events`
2. Backend rejects the request if another turn is already running for that session
3. `services/turns.ts`:
   - persists the raw user event
   - emits `chat.user_message` and `status.running`
   - builds prompt context
   - invokes the selected adapter
   - persists and publishes normalized events
   - re-indexes project files
   - writes a turn checkpoint
4. Frontend consumes the event stream over SSE and renders chat/canvas updates

### 5.3 File updates

There are two current paths:

- immediate `file.changed` events from the Claude Code parser when write/edit-style tools succeed
- background re-indexing through `services/watchers.ts` using `fs.watch`

The watcher currently refreshes DB file state only. It does not emit chat timeline events.

### 5.4 Canvas rendering

The center pane renders project files through `/api/projects/:id/fs/*`.

Current behavior:
- if a specific file tab is active, the canvas loads that file
- otherwise it falls back to the artifact entrypoint
- when the active file receives `file.changed`, the iframe is reloaded
- selector mode is still a placeholder overlay and does not inspect the real iframe DOM

## 6. Current Route Surface

Important backend routes today:

| Route | Purpose |
|---|---|
| `GET /api/health` | health metadata |
| `GET /api/home` family | home/dashboard data |
| `POST /api/projects` | create project |
| `GET /api/projects/:id` | project detail |
| `GET /api/projects/:id/session` | latest session |
| `GET /api/projects/:id/files` | indexed file list |
| `GET /api/projects/:id/artifacts` | artifact summary |
| `POST /api/projects/:id/refresh` | re-index and rebuild artifact summary |
| `POST /api/projects/:id/exports` | queue export |
| `GET /api/projects/:id/exports` | list export jobs |
| `POST /api/sessions/:id/events` | send user turn |
| `GET /api/sessions/:id/events` | replay session history |
| `GET /api/sessions/:id/stream` | live SSE stream |
| `POST /api/sessions/:id/interrupt` | currently only marks idle/interrupted |
| `GET /runtime/deck-stage.js` | slide deck runtime script |

## 7. Security and Safety Model

Current enforcement (updated 2026-09-09 after the security assessment):

- server binds to `127.0.0.1`
- each backend launch generates a new 256-bit API capability; the frontend
  obtains it from the same-origin `/api/bootstrap` route and keeps it in memory
- API middleware rejects unknown `Host` authorities, requires an exact
  same-origin `Origin` plus the capability header for mutations, and uses an
  HttpOnly, `SameSite=Strict` launch cookie for GET and SSE requests; only
  `/api/health` is public
- development explicitly trusts the fixed Vite authority at
  `127.0.0.1:5173`, whose proxy preserves that authority
- request bodies are bounded before any route parses them
  (`security/request-limits.ts`: 1 MiB JSON, 4 MiB draw sidecars, 64 MiB
  multipart intake; `Bun.serve` carries the same 64 MiB hard ceiling); a user
  message is capped at 200,000 characters; `harness.maxConcurrentSessions` is
  enforced as a process-wide ceiling on concurrent CLI turns (HTTP 429)
- the application shell is served with `Content-Security-Policy:
  frame-ancestors 'none'`, `X-Frame-Options: DENY` and
  `X-Content-Type-Options: nosniff` (the Vite dev server sets the same headers)
- raw project, draw and design-system files (`/api/projects/:id/fs/*`,
  `/api/projects/:id/draws/*`, `/api/design-systems/:id/files/*`) are never
  rendered as a same-origin top-level document: a navigation
  (`Sec-Fetch-Dest: document`) receives `Content-Disposition: attachment`,
  every response carries `nosniff`, and HTML/SVG framed by the app carries the
  artifact Content-Security-Policy (`@bg/shared/security`)
- the canvas renders artifacts in a sandboxed `srcdoc` iframe without
  `allow-same-origin`; the same artifact policy is injected as a `<meta>` so
  artifact scripts can only reach the BurnGuard origin (plus Google Fonts for
  styles/fonts): no outbound fetch, forms, nested frames or plugins; popups stay
  sandboxed and referrers are suppressed
- project file serving normalizes and bounds relative paths through realpath
  containment; website and research imports enforce HTTPS, reject credentials
  and private addresses, and pin resolved public IPs
- untrusted CSS (imports, project files during export) is parsed with
  `map: false` so a `sourceMappingURL` comment can never read a host file
- untrusted PDF uploads are parsed only by the reviewed pypdf release pinned in
  `packages/backend/requirements.txt` (`PYPDF_REQUIRED_VERSION`); older
  installs are reported as unsupported and refused by the extractor, which also
  applies POSIX memory/CPU limits to itself
- file writing is delegated to the underlying CLI working inside the project
  directory; turn execution is serialized per session; immutable reference
  attachments are captured before a turn and restored if the CLI mutates them
- attachment summaries are inserted into the prompt inside
  `<burnguard-untrusted-document-text>` delimiters together with an explicit
  instruction to treat imported text as data, not instructions
- the Windows desktop shell cancels top-level WebView2 navigation to `/api/*`
  and `/runtime/*`; external links open in the default browser
- automatic updates (Velopack) read only the public GitHub Releases of
  `ashmoonori-afk/BurnGuard` over HTTPS, skip drafts and prereleases, verify
  each package against the SHA-256 feed before staging it, and never apply an
  update while the backend is running. Windows drives this from the native
  shell; macOS drives it from the backend (`services/mac-updates.ts`), which
  hands the verified package to the bundled `UpdateMac` after its own graceful
  shutdown. A `BG_UPDATE_FEED_URL` override is honoured only for loopback or
  HTTPS feeds and exists for local rehearsals

Accepted risks and trust assumptions:

- **Local processes are trusted.** The launch capability, Host/Origin and
  Fetch Metadata checks defend the browser boundary (CSRF, DNS rebinding,
  hostile pages). They do not authenticate other processes or OS users on the
  same host: anything that can open the loopback port and set those headers can
  call `/api/bootstrap` and receive the capability. Do not run BurnGuard on a
  shared host or a remote-development machine that untrusted users can reach.
- **The update trust root is the GitHub account, not a code-signing key.**
  Packages are not Authenticode-signed, so anyone who can publish a release in
  the repository can ship code to every installed copy. Keep the release
  workflow tag-driven, publish drafts only after checking the package, protect
  the account with 2FA and branch/tag protection, and add package signing
  before wider distribution.
- **CLI tool approval is not a pre-execution gate.** Claude Code runs with
  `acceptEdits` and no permission prompts; Codex runs with the
  `workspace-write` sandbox. A deny decision aborts the turn after the fact.
  Imported documents can still attempt prompt injection; the delimiters above
  reduce, but do not eliminate, that risk.

Not yet implemented:
- real tool confirmation gate
- hard runtime enforcement of write-deny rules outside the project directory
  for every backend
- OS-user-scoped transport for local API access

## 8. Observability

Current observability is lightweight:

- normalized events are persisted to SQLite
- turn traces are appended through `services/trace.ts`
- stderr lines are captured for adapter runs
- export failures are stored on export jobs

The docs previously described a larger logging/retry stack than what exists today. That is still future work, not current behavior.

## 9. Long-Term Architecture Items Not Yet Landed

These ideas still appear in planning docs but are **not** current implementation:

- PTY-managed interactive sessions
- permission request modal and tool approval flow
- automated retry/backoff framework
- scheduler for multiple concurrent active sessions
- plugin adapter loading
- structured test fixture suite for adapter output drift
