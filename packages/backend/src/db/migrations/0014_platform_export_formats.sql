CREATE TABLE exports_platform_formats_v1 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  format TEXT NOT NULL CHECK(format IN ('html_zip','pdf','png','pptx','handoff','cafe24_package','imweb_package','png_zip')),
  status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed')),
  output_path TEXT,
  error_message TEXT,
  size_bytes INTEGER,
  options_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

INSERT INTO exports_platform_formats_v1(
  id,project_id,format,status,output_path,error_message,size_bytes,options_json,created_at,completed_at
)
SELECT
  id,project_id,format,status,output_path,error_message,size_bytes,options_json,created_at,completed_at
FROM exports;

DROP TABLE exports;
ALTER TABLE exports_platform_formats_v1 RENAME TO exports;
CREATE INDEX idx_exports_project ON exports(project_id, created_at DESC);
