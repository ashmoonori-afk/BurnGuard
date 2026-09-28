CREATE TABLE visual_alternative_generations (
  id TEXT NOT NULL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('generating','ready','partial','failed')),
  base_revision INTEGER NOT NULL CHECK(base_revision >= 0),
  base_digest TEXT NOT NULL CHECK(length(base_digest) = 64),
  -- NULL while the base tree is being staged; the row is the durable owner of that tree.
  base_manifest_json TEXT,
  base_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(id, project_id)
);
CREATE INDEX idx_visual_alternative_generations_project
  ON visual_alternative_generations(project_id, created_at DESC);
CREATE UNIQUE INDEX uq_visual_alternative_generation_active
  ON visual_alternative_generations(project_id)
  WHERE status = 'generating';

CREATE TABLE visual_alternatives (
  id TEXT NOT NULL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  generation_id TEXT NOT NULL,
  name TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 3),
  status TEXT NOT NULL CHECK(status IN ('pending','generating','ready','failed')),
  source_revision INTEGER NOT NULL,
  source_digest TEXT NOT NULL,
  result_revision INTEGER,
  result_digest TEXT,
  operation_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(generation_id, ordinal),
  UNIQUE(generation_id, name),
  FOREIGN KEY(generation_id, project_id)
    REFERENCES visual_alternative_generations(id, project_id) ON DELETE CASCADE,
  CHECK((status = 'ready') = (result_revision IS NOT NULL AND result_digest IS NOT NULL)),
  CHECK(result_digest IS NULL OR length(result_digest) = 64)
);
CREATE INDEX idx_visual_alternatives_project
  ON visual_alternatives(project_id, created_at DESC, ordinal);
