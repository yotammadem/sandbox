CREATE TABLE IF NOT EXISTS task_blobs (
  task_id TEXT PRIMARY KEY NOT NULL,
  document_json TEXT NOT NULL CHECK (json_valid(document_json))
) STRICT;
