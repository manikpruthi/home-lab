-- CommandCode Usage Tracker — D1 schema (one-time bootstrap)
-- Run once: npm run db:init   (or paste into D1 Console: Storage & Databases → D1 → cc-usage-db → Console)
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

-- Per-request credit ledger AND dedupe record (PK id): the credit basis in effect
-- when the Worker first observed each request. Freezing model_cap_usd /
-- credit_weight / credits here is what stops a later allowance or plan change
-- (e.g. GOAT -> Go) from retroactively re-pricing requests that were already
-- billed. The 5-hour and weekly window fallbacks read the last 7 days; rows are
-- kept 8 days (the usage feed only re-serves the last 24h, so older IDs can never
-- come back to be double-counted).
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
-- 2026-11-02 plan-aware build: cc_seen_requests is no longer read or written
-- (cc_request_credits is the dedupe ledger). Drop it to reclaim the space:
--
-- 4) DROP TABLE IF EXISTS cc_seen_requests;
--
-- Obsolete meta keys (old rolling ledger blob, inheritance flags, GOAT-only caps,
-- OpenRouter sync stamps) are deleted by the Worker's daily retention pass.
