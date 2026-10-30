-- HomeLab Dashboard — D1 schema (one-time bootstrap)
-- Run once in D1 Console: Storage & Databases → D1 → homelab-health-db → Console
--
-- SHARED DATABASE: the uptime-monitor Worker writes the 'ipv6_data' row that this
-- dashboard renders as the IPv6 sparkline, and the dashboard owns 'dashboard_data'
-- and 'mute_prefs'. Run this bootstrap against the SAME database for both Workers.

CREATE TABLE IF NOT EXISTS store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
