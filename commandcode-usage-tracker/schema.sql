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
  -- Pool credits frozen at ingest time (sticker usage-value × pool / model cap).
  -- -1 means "row predates credit freezing"; the Worker derives it from the
  -- current catalog instead. New rows always store a real value (>= 0).
  credits_consumed REAL DEFAULT -1,
  PRIMARY KEY (usage_date, model)
);

-- Dedupe ledger: IDs retained ≥ 91 days so re-fetched rows inside the 90-day
-- rollup window are never double-counted.
CREATE TABLE IF NOT EXISTS cc_seen_requests (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

-- Per-request credit ledger: the credit basis in effect when the Worker first
-- observed each request. Freezing model_cap_usd / credit_weight / credits here is
-- what stops a later allowance change (e.g. DeepSeek V4.1 Flash $60 → $100) from
-- retroactively re-pricing requests that were already billed. The 5-hour and
-- weekly window fallbacks read the last 7 days of this table.
CREATE TABLE IF NOT EXISTS cc_request_credits (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  model TEXT NOT NULL,
  sticker_usd REAL,
  billed_usd REAL,
  model_cap_usd REAL,
  pool_usd REAL,
  credit_weight REAL,
  credits REAL,
  observed_at INTEGER
);

CREATE TABLE IF NOT EXISTS cc_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_request_credits_created ON cc_request_credits(created_at);

-- ============================================================================
-- UPGRADING AN EXISTING DATABASE
-- ============================================================================
-- Run these in the D1 console (Dashboard -> Storage & Databases -> D1 ->
-- cc-usage-db -> Console), one statement at a time, BEFORE deploying the Worker
-- that writes the new table/column. Statements 2 and 3 are idempotent.
--
-- 1) ALTER TABLE cc_daily_model_usage ADD COLUMN credits_consumed REAL DEFAULT -1;
--
-- 2) CREATE TABLE IF NOT EXISTS cc_request_credits (
--      id TEXT PRIMARY KEY,
--      created_at TEXT NOT NULL,
--      usage_date TEXT NOT NULL,
--      model TEXT NOT NULL,
--      sticker_usd REAL,
--      billed_usd REAL,
--      model_cap_usd REAL,
--      pool_usd REAL,
--      credit_weight REAL,
--      credits REAL,
--      observed_at INTEGER
--    );
--
-- 3) CREATE INDEX IF NOT EXISTS idx_request_credits_created ON cc_request_credits(created_at);
--
-- Optional cleanup: the pre-2026-11-01 rolling ledger lived in a JSON meta blob.
-- The Worker stops reading it and its daily retention pass deletes it, but you can
-- reclaim the space immediately:
--
-- 4) DELETE FROM cc_meta WHERE key = 'rolling_window_ledger_json';
