CREATE TABLE IF NOT EXISTS insight_subjects (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS insight_events (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES insight_subjects(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  name TEXT NOT NULL,
  screen TEXT NOT NULL,
  school TEXT NOT NULL,
  properties TEXT NOT NULL,
  country TEXT,
  region TEXT,
  consent_version INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS insight_events_time ON insight_events(received_at);
CREATE INDEX IF NOT EXISTS insight_events_subject_time ON insight_events(subject_id, received_at);
CREATE TABLE IF NOT EXISTS insight_content (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES insight_subjects(id) ON DELETE CASCADE,
  received_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS insight_content_time ON insight_content(received_at);
CREATE INDEX IF NOT EXISTS insight_content_subject ON insight_content(subject_id);
