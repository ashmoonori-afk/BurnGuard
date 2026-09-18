# Data Model

## 1. Filesystem Layout

Root is `~/.burnguard/` (`%USERPROFILE%\.burnguard\` on Windows). Abstracted as `os.homedir() + "/.burnguard"`.

```
~/.burnguard/
├── burnguard.db                     # SQLite DB (WAL mode)
├── config.json                      # User settings
├── data/
│   ├── systems/
│   │   ├── northvale-capital/           # Sample (embedded → copied on first run)
│   │   │   ├── README.md
│   │   │   ├── SKILL.md
│   │   │   ├── colors_and_type.css
│   │   │   ├── fonts/
│   │   │   ├── assets/logos/
│   │   │   ├── preview/             # 16 preview HTML files
│   │   │   ├── ui_kits/website/
│   │   │   └── uploads/
│   │   └── {system_id}/             # User-added (Phase 3)
│   ├── projects/
│   │   └── {project_id}/
│   │       ├── index.html           # Prototype entry
│   │       ├── app.tsx              # (optional)
│   │       ├── styles.css
│   │       ├── deck.html            # Slide deck entry (P2)
│   │       ├── deck-stage.js        # Slide runtime (P2)
│   │       ├── .attachments/        # Chat-uploaded files
│   │       └── .meta/
│   │           ├── checkpoints/
│   │           │   └── turn-{n}.tar.zst
│   │           └── thumbnails/
│   │               └── latest.png
│   └── exports/
│       └── {export_id}/
│           ├── result.zip
│           ├── result.pdf
│           └── manifest.json
├── cache/
│   ├── thumbnails/                  # Project/system thumbnails (sharp)
│   └── esbuild-wasm/                # Frontend browser cache
├── plugins/                         # Phase 3+ (third-party adapters)
│   └── *.js
└── logs/
    ├── app.log                      # 10 MB rotate × 10
    └── session-{session_id}.log     # Raw CLI trace
```

### Path constraints

- `project_id`, `system_id`, `export_id` are **ULIDs** (26 chars, sortable)
- Every user-supplied path is normalized under `~/.burnguard/`; traversal (`../`) is rejected
- Max path length 260 chars (Windows compatibility)

## 2. SQLite Schema

Managed with drizzle-orm. SQLite in WAL journal mode, `busy_timeout=5000ms`.

### 2.1 `users`

Single-user locally, but defined for future expansion.

```sql
CREATE TABLE users (
  id             TEXT PRIMARY KEY,              -- "local"
  display_name   TEXT NOT NULL DEFAULT 'You',
  email          TEXT,
  created_at     INTEGER NOT NULL
);
```

Initial seed: `INSERT INTO users (id, display_name, created_at) VALUES ('local', 'You', unixepoch());`

### 2.2 `design_systems`

```sql
CREATE TABLE design_systems (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT,
  status            TEXT NOT NULL CHECK(status IN ('draft','review','published')),
  source_type       TEXT CHECK(source_type IN ('sample','github','figma','upload','manual')),
  source_uri        TEXT,                            -- Original URL if any
  is_template       INTEGER NOT NULL DEFAULT 0,      -- 0|1
  dir_path          TEXT NOT NULL,                   -- Absolute path
  skill_md_path     TEXT,
  tokens_css_path   TEXT,
  readme_md_path    TEXT,
  thumbnail_path    TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  archived_at       INTEGER
);

CREATE INDEX idx_ds_status ON design_systems(status);
```

### 2.3 `projects`

```sql
CREATE TABLE projects (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  type              TEXT NOT NULL CHECK(type IN ('prototype','slide_deck','graphic','logo','from_template','other')),
  design_system_id  TEXT REFERENCES design_systems(id),
  dir_path          TEXT NOT NULL,
  entrypoint        TEXT NOT NULL DEFAULT 'index.html',
  thumbnail_path    TEXT,
  backend_id        TEXT NOT NULL,                   -- 'claude-code' | 'codex'
  options_json      TEXT,                            -- Versioned project options; see below
  archived_at       INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX idx_projects_updated ON projects(updated_at DESC);
CREATE INDEX idx_projects_ds ON projects(design_system_id);
```

`options_json` stores snake-case project options. The current object may contain
`use_speaker_notes` for slide decks, `copy_as_is` for template-based projects,
`graphic_canvas` and `graphic_set` for graphic projects, `logo_set` for logo
projects (brand name, niche, character, logo type, symbol keywords), and a versioned `design_brief` with output type, audience, objective, content
source, locale, brand mode, visual mood, density, and output size. The HTTP
boundary rejects unknown keys and malformed brief fields before persistence;
readers treat malformed legacy JSON as absent options rather than injecting a
partial brief into an agent prompt.

Reference-layout context is not stored in this column. It is derived
deterministically per turn from the request and selected attachment metadata,
then injected as `ReferenceLayoutContextV1`. The agent is instructed to
materialize `layout-spec.json`; immutable-underlay behavior is a prompt/runtime
contract, not a filesystem write lock.

### 2.4 `sessions`

```sql
CREATE TABLE sessions (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  backend_id            TEXT NOT NULL,
  backend_session_state TEXT,                        -- CLI-specific serialized state (nullable)
  status                TEXT NOT NULL CHECK(status IN ('idle','running','awaiting_tool','error','terminated')),
  pid                   INTEGER,                     -- Current PTY PID (nullable)
  last_turn_id          TEXT,
  usage_input_tokens    INTEGER NOT NULL DEFAULT 0,
  usage_output_tokens   INTEGER NOT NULL DEFAULT 0,
  usage_cache_read      INTEGER NOT NULL DEFAULT 0,
  usage_cache_write     INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  last_active_at        INTEGER NOT NULL
);

CREATE INDEX idx_sessions_project ON sessions(project_id);
CREATE INDEX idx_sessions_status ON sessions(status);
```

### 2.5 `events` — persisted normalized stream

```sql
CREATE TABLE events (
  id            TEXT PRIMARY KEY,                    -- ULID (time-sortable)
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  direction     TEXT NOT NULL CHECK(direction IN ('up','down')),  -- up=user→agent, down=agent→user
  type          TEXT NOT NULL,                       -- NormalizedEvent.type
  payload_json  TEXT NOT NULL,
  turn_id       TEXT,                                -- Group events within same turn
  processed_at  INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_events_session_time ON events(session_id, processed_at ASC);
CREATE INDEX idx_events_turn ON events(turn_id);
CREATE INDEX idx_events_type ON events(session_id, type);
```

- `id` is a ULID, so ASC sort = chronological order
- Expected scale: thousands to tens of thousands of events per session. Old turns can be compacted into `checkpoints` and pruned.

### 2.6 `attachments`

```sql
CREATE TABLE attachments (
  id             TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id        TEXT,
  file_path      TEXT NOT NULL,                      -- Absolute path under .attachments/
  mime_type      TEXT NOT NULL,
  original_name  TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  sha256         TEXT,
  created_at     INTEGER NOT NULL
);

CREATE INDEX idx_attachments_session ON attachments(session_id);
```

### 2.7 `files` — project tree metadata

Watcher-maintained. Real content lives on disk; this table is a metadata index.

```sql
CREATE TABLE files (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rel_path    TEXT NOT NULL,                         -- 'index.html', 'styles.css', 'components/Hero.tsx'
  category    TEXT NOT NULL CHECK(category IN ('stylesheet','script','document','asset','folder','html','other')),
  size_bytes  INTEGER,
  hash        TEXT,                                  -- sha256
  updated_at  INTEGER NOT NULL,
  UNIQUE(project_id, rel_path)
);

CREATE INDEX idx_files_project ON files(project_id);
```

Category rules (UI grouping):
- `*.css` → `stylesheet`
- `*.js`, `*.ts`, `*.tsx`, `*.jsx` → `script`
- `*.md` → `document`
- `*.html` → `html`
- `*.png`, `*.jpg`, `*.svg`, `*.webp`, `*.gif` → `asset`
- Directory → `folder`
- Everything else → `other`

### 2.8 `comments` (Phase 2)

```sql
CREATE TABLE comments (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  anchor_file      TEXT NOT NULL,                    -- rel path
  anchor_node_id   TEXT NOT NULL,                    -- data-bg-node-id
  anchor_rect_json TEXT,                             -- fallback rect
  body             TEXT NOT NULL,
  author_id        TEXT NOT NULL DEFAULT 'local',
  resolved_at      INTEGER,
  created_at       INTEGER NOT NULL
);

CREATE INDEX idx_comments_project ON comments(project_id, resolved_at);
```

### 2.9 `tweaks` (Phase 3)

```sql
CREATE TABLE tweaks (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_path    TEXT NOT NULL,
  node_id      TEXT NOT NULL,
  prop         TEXT NOT NULL,                        -- 'font-size', 'color', 'padding', ...
  value        TEXT NOT NULL,
  turn_id      TEXT,                                 -- Which turn introduced this tweak
  created_at   INTEGER NOT NULL
);

CREATE INDEX idx_tweaks_project_node ON tweaks(project_id, node_id);
CREATE INDEX idx_tweaks_turn ON tweaks(turn_id);
```

### 2.10 `exports`

```sql
CREATE TABLE exports (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  format        TEXT NOT NULL CHECK(format IN ('html_zip','pdf','pptx','handoff')),
  status        TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed')),
  output_path   TEXT,
  error_message TEXT,
  size_bytes    INTEGER,
  options_json  TEXT,                                -- Format-specific
  created_at    INTEGER NOT NULL,
  completed_at  INTEGER
);

CREATE INDEX idx_exports_project ON exports(project_id, created_at DESC);
```

### 2.11 `meta_schema`

```sql
CREATE TABLE meta_schema (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
-- e.g. ('version', '3'), ('app_version', '0.1.0'), ('first_run_at', '...')
```

## 3. ERD

```
           ┌─────────┐
           │  users  │
           └────┬────┘
                │
                ▼
           ┌──────────┐       ┌──────────────────┐
           │ projects │──────►│  design_systems  │
           └────┬─────┘       └──────────────────┘
                │
        ┌───────┼───────┬─────────┬────────┬─────────┐
        ▼       ▼       ▼         ▼        ▼         ▼
   ┌────────┐ ┌─────┐ ┌─────────┐ ┌──────┐ ┌───────┐
   │sessions│ │files│ │comments │ │tweaks│ │exports│
   └────┬───┘ └─────┘ │ (P2)    │ │ (P3) │ └───────┘
        │             └─────────┘ └──────┘
        ▼
   ┌─────────┐    ┌────────────┐
   │ events  │    │attachments │
   └─────────┘    └────────────┘
```

## 4. Migration Strategy

- Drizzle-kit generates migration SQL
- Location: `packages/backend/src/db/migrations/*.sql`
- Applied at boot (`migrate()` runs before anything else)
- Local single-user assumption means **no rollback** — changes are forward-only
- Every migration is idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER ... IF NOT EXISTS`)
- Schema version is stored in `meta_schema.version`. Compatibility check on app boot:
  - App > DB: auto-migrate
  - App < DB: refuse to start, show "newer DB detected; upgrade app" message

## 5. Query Patterns

### 5.1 Home — recent projects

```sql
SELECT p.id, p.name, p.type, p.thumbnail_path, p.updated_at,
       ds.name AS design_system_name
FROM projects p
LEFT JOIN design_systems ds ON p.design_system_id = ds.id
WHERE p.archived_at IS NULL
ORDER BY p.updated_at DESC
LIMIT 50;
```

### 5.2 Session event replay (on browser refresh)

```sql
SELECT id, direction, type, payload_json, turn_id, processed_at
FROM events
WHERE session_id = ?
  AND processed_at > ?   -- lastSeenTs
ORDER BY processed_at ASC, id ASC
LIMIT 1000;
```

### 5.3 File tree grouped by category

```sql
SELECT rel_path, category, size_bytes, updated_at
FROM files
WHERE project_id = ?
ORDER BY 
  CASE category
    WHEN 'folder' THEN 0
    WHEN 'stylesheet' THEN 1
    WHEN 'script' THEN 2
    WHEN 'html' THEN 3
    WHEN 'asset' THEN 4
    WHEN 'document' THEN 5
    ELSE 6
  END,
  rel_path ASC;
```

### 5.4 Phase 3: current tweak state for a node

```sql
SELECT prop, value, created_at
FROM tweaks
WHERE project_id = ? AND node_id = ?
ORDER BY created_at DESC;
-- Multiple rows per prop: most recent is effective
```

## 6. Data Retention

| Subject | Policy |
|---|---|
| `events` | Retained while project lives. Beyond 1000 turns, oldest 1000 are compacted into a checkpoint and deleted. |
| `attachments` | Cascade-deleted on project delete (`ON DELETE CASCADE` + filesystem unlink) |
| `files` | Watcher-synced. File delete → DB row delete. |
| `exports` | Auto-deleted after 30 days (background sweep). Output file removed too. |
| `checkpoints` | Indefinite retention (they are compressed). Removed only on explicit user action. |

## 7. Backup & Migration

- **Backup**: Settings UI → "Export data" → `burnguard-backup-{ts}.zip` (DB + entire `data/`)
- **Restore**: Settings UI → "Import data" → must extract into empty `~/.burnguard/`. No merge with existing DB.
- **Migration**: Moving to another machine = copy the backup ZIP.
