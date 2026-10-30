-- Uptime Monitor — D1 schema (one-time bootstrap)
-- Run once in D1 Console: Storage & Databases → D1 → uptime-monitor-db → Console
-- The Worker keeps its whole state in a single row of `store` under the key 'ipv6_data'.

CREATE TABLE IF NOT EXISTS store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
