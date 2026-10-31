CREATE TABLE design_system_canonical_transfers (
  receipt_id TEXT PRIMARY KEY NOT NULL REFERENCES design_system_receipts(id) ON DELETE CASCADE,
  proof_version INTEGER NOT NULL CHECK (typeof(proof_version) = 'integer' AND proof_version = 1),
  emitter_version TEXT NOT NULL CHECK (typeof(emitter_version) = 'text' AND length(CAST(emitter_version AS BLOB)) BETWEEN 1 AND 64 AND instr(emitter_version, char(0)) = 0 AND emitter_version NOT GLOB '*[^a-zA-Z0-9._-]*'),
  json_size_bytes INTEGER NOT NULL CHECK (typeof(json_size_bytes) = 'integer' AND json_size_bytes BETWEEN 1 AND 262144),
  json_sha256 TEXT NOT NULL CHECK (typeof(json_sha256) = 'text' AND length(json_sha256) = 64 AND length(CAST(json_sha256 AS BLOB)) = 64 AND json_sha256 NOT GLOB '*[^0-9a-f]*'),
  css_size_bytes INTEGER NOT NULL CHECK (typeof(css_size_bytes) = 'integer' AND css_size_bytes BETWEEN 1 AND 262144),
  css_sha256 TEXT NOT NULL CHECK (typeof(css_sha256) = 'text' AND length(css_sha256) = 64 AND length(CAST(css_sha256 AS BLOB)) = 64 AND css_sha256 NOT GLOB '*[^0-9a-f]*'),
  skill_size_bytes INTEGER NOT NULL CHECK (typeof(skill_size_bytes) = 'integer' AND skill_size_bytes BETWEEN 1 AND 65536),
  skill_sha256 TEXT NOT NULL CHECK (typeof(skill_sha256) = 'text' AND length(skill_sha256) = 64 AND length(CAST(skill_sha256 AS BLOB)) = 64 AND skill_sha256 NOT GLOB '*[^0-9a-f]*')
);
