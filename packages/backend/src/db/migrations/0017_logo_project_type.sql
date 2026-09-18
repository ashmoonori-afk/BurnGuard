CREATE TABLE projects_logo_v1 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('prototype','slide_deck','graphic','logo','from_template','other')),
  design_system_id TEXT REFERENCES design_systems(id),
  dir_path TEXT NOT NULL,
  entrypoint TEXT NOT NULL DEFAULT 'index.html',
  thumbnail_path TEXT,
  backend_id TEXT NOT NULL,
  options_json TEXT,
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 0,
  current_digest TEXT
);

INSERT INTO projects_logo_v1 (
  id, name, type, design_system_id, dir_path, entrypoint, thumbnail_path,
  backend_id, options_json, archived_at, created_at, updated_at,
  current_revision, current_digest
)
SELECT
  id, name, type, design_system_id, dir_path, entrypoint, thumbnail_path,
  backend_id, options_json, archived_at, created_at, updated_at,
  current_revision, current_digest
FROM projects;

DROP TABLE projects;
ALTER TABLE projects_logo_v1 RENAME TO projects;
CREATE INDEX idx_projects_updated ON projects(updated_at DESC);
CREATE INDEX idx_projects_ds ON projects(design_system_id);
