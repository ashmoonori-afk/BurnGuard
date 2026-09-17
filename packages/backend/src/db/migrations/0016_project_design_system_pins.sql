CREATE TABLE project_design_system_pins (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  system_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  digest TEXT NOT NULL,
  context TEXT NOT NULL,
  tokens TEXT NOT NULL
);
