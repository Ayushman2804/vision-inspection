CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'operator',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inspections (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source        TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'video')),
  image_path    TEXT,
  status        TEXT NOT NULL CHECK (status IN ('pass', 'fail')),
  defect_count  INT NOT NULL DEFAULT 0,
  latency_ms    REAL,
  model_version TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inspections_user_created ON inspections (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS defects (
  id            SERIAL PRIMARY KEY,
  inspection_id INT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  class_name    TEXT NOT NULL,
  confidence    REAL NOT NULL,
  bbox          JSONB NOT NULL,
  area_pct      REAL,
  reviewed      BOOLEAN NOT NULL DEFAULT false,
  review_label  TEXT
);
CREATE INDEX IF NOT EXISTS idx_defects_inspection ON defects (inspection_id);
CREATE INDEX IF NOT EXISTS idx_defects_class ON defects (class_name);

CREATE TABLE IF NOT EXISTS alerts (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule         TEXT NOT NULL,
  details      JSONB,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alerts_user_time ON alerts (user_id, triggered_at DESC);
