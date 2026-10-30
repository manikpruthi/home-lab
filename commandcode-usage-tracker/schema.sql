-- CommandCode Usage Tracker — D1 schema (one-time bootstrap)
-- Run once in D1 Console: Storage & Databases → D1 → cc-usage-db → Console
-- The Worker intentionally contains no CREATE TABLE statements (saves 3 D1 reads per request).

CREATE TABLE IF NOT EXISTS cc_daily_model_usage (
  usage_date TEXT NOT NULL,
  model TEXT NOT NULL,
  requests_count INTEGER DEFAULT 0,
  failed_wasted_count INTEGER DEFAULT 0,
  tokens_in_total INTEGER DEFAULT 0,
  tokens_in_fresh INTEGER DEFAULT 0,
  tokens_cached INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  plan_cost REAL DEFAULT 0,
  input_cost REAL DEFAULT 0,
  cache_cost REAL DEFAULT 0,
  output_cost REAL DEFAULT 0,
  actual_api_cost REAL DEFAULT 0,
  duration_ms_total INTEGER DEFAULT 0,
  PRIMARY KEY (usage_date, model)
);

CREATE TABLE IF NOT EXISTS cc_seen_requests (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cc_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Useful indexes for dashboard reads (optional)
-- CREATE INDEX IF NOT EXISTS idx_daily_date ON cc_daily_model_usage(usage_date DESC);
-- CREATE INDEX IF NOT EXISTS idx_seen_created ON cc_seen_requests(created_at);
