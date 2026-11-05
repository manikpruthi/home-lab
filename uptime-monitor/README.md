# Uptime Monitor

A single-file [Cloudflare Worker](https://workers.dev/) that probes an IPv6 endpoint on a schedule,
keeps its state and a 24-hour history in [D1](https://developers.cloudflare.com/d1/), ships uptime
points to InfluxDB, and posts to Slack **only when the confirmed state changes**.

Built for the case a plain ping cannot cover: a host that is powered on and online but has lost its
IPv6 path. The Worker probes from Cloudflare's edge, so a successful response proves the route works
from outside the LAN.

## Features

- **Edge-side probing** — 3 attempts with a 3 s timeout each, so a single dropped packet is not a
  failed check. Redirects are not followed: any 2xx/3xx answer from the endpoint itself counts as up,
  so a redirect to an IPv4-reachable host can't hide a dead IPv6 path.
- **Debounced state** — up is confirmed by one good run; down needs `DOWN_AFTER_RUNS` failed runs in a
  row (default 2, i.e. about 5 minutes). A one-off blip shows as a red bar in the sparkline but sends
  no alert. The outage is dated from its first failed check.
- **Reliable, state-based alerting** — Slack fires on `up → down` and `down → up` only. The last state
  Slack was told about is stored separately from the real state, so a failed Slack call is retried on
  the next run instead of being lost. Recovery messages include the outage length.
- **Respects the dashboard's mute** — when the `network` category is muted in homelab-dashboard, no
  alert is sent. An outage that is still ongoing when you unmute alerts then; a recovery that happened
  while muted is dropped.
- **24-hour history** — points older than 24 hours are dropped by timestamp, so the dashboard's "24h"
  sparkline is accurate whatever the cron cadence.
- **Durable Influx queue (optional)** — points accumulate in their own D1 row (up to 1,000, about
  3.5 days at `*/5`) and the whole queue is replayed on the next successful write, so an InfluxDB
  outage loses nothing. Without `INFLUX_URL` and `INFLUX_TOKEN` the Influx step is skipped entirely.
- **Fails safe** — if D1 can't be read, the run stops without writing, so a transient error can't wipe
  the history or re-send an alert. An unparseable state row is copied to `ipv6_data_corrupt` before a
  fresh one is started. Every outbound call (probe, Slack, InfluxDB) has a timeout.
- **Read-only status page** — `GET /` returns the stored state as JSON and never probes. Manual runs
  need `POST /run` with a secret.

## Architecture

```text
  cron (*/5)       ──┐
  POST /run (secret)─┴──► probe PI_IPV6_URL (3 tries, 3s timeout, no redirects)
                                  │
                                  v
                 ┌─────────────────────────────────┐
                 │ D1 `store`                      │
                 │ ipv6_data          (owned)      │  state, since, notified, fail_streak, history[24h]
                 │ ipv6_influx_queue  (owned)      │  points not yet acknowledged by InfluxDB
                 │ mute_prefs         (read only)  │  homelab-dashboard's mutes
                 └──────┬──────────────────┬───────┘
                        │                  │
          state change  │                  │  queued points
          not yet told  v                  v
                     Slack            InfluxDB (line protocol, 10s timeout)
```

Order of operations per run: probe → read D1 (abort on error) → update state and history → send a
pending Slack alert → flush the Influx queue → write `ipv6_data` and `ipv6_influx_queue` in one D1
batch. Points leave the queue only after InfluxDB acknowledges them.

## Project structure

```text
uptime-monitor/
├── worker.js            # The entire Worker: probe, state machine, Influx writer, Slack, status page
├── schema.sql           # One-time D1 bootstrap (store table)
├── wrangler.toml        # Worker name, cron schedule, D1 binding
├── package.json         # npm scripts (dev / deploy / db:init)
├── .dev.vars.example    # Template for local secrets (copy to .dev.vars, never commit)
├── LICENSE              # MIT
└── README.md            # This file
```

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- A Cloudflare account with Workers + D1
- [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) CLI
- An InfluxDB v2 endpoint and token (optional)
- A Slack incoming webhook (optional)

## Quickstart

```bash
cd uptime-monitor

npm install

# 1. Create the D1 database and bootstrap the schema
#    This is shared with homelab-dashboard — create it once and use the same
#    database_id in both Workers' wrangler.toml.
npx wrangler d1 create homelab-health-db
# → paste the returned database_id into wrangler.toml
npm run db:init

# 2. Set production secrets (Dashboard → Worker → Settings → Variables and Secrets)
#    PI_IPV6_URL, and optionally INFLUX_URL, INFLUX_TOKEN, INFLUX_SECRET, SLACK_WEBHOOK,
#    RUN_SECRET, DOWN_AFTER_RUNS

# 3. Deploy (the cron trigger starts probing immediately)
npm run deploy

# Local development (uses .dev.vars for secrets):
cp .dev.vars.example .dev.vars   # then fill in your values
npm run dev
```

Upgrading from the previous version needs no migration step: the first run reads the old
`ipv6_data` row (including its embedded `influxQueue`), moves the queue to `ipv6_influx_queue`, and
trims the history to 24 hours.

## Configuration

| Secret / variable | Required | Purpose |
|---|---|---|
| `PI_IPV6_URL` | yes | Endpoint probed each run; any 2xx/3xx counts as up. Use an IPv6 literal or a hostname with only an AAAA record, otherwise the edge may connect over IPv4 |
| `INFLUX_URL` | no | InfluxDB v2 write URL, without `precision` (the Worker appends it). Unset skips InfluxDB |
| `INFLUX_TOKEN` | no | Write-scoped InfluxDB API token. Unset skips InfluxDB |
| `INFLUX_SECRET` | no | Optional `x-worker-secret` header value on Influx writes |
| `SLACK_WEBHOOK` | no | Incoming webhook; blank disables alerting (state is still tracked) |
| `RUN_SECRET` | no | Enables `POST /run` with `Authorization: Bearer <RUN_SECRET>`. Unset disables manual runs |
| `DOWN_AFTER_RUNS` | no | Consecutive failed runs before the state flips to down. Default `2`; `1` alerts on the first failed run |
| D1 binding `HEALTH_DB` | yes | Case-sensitive binding name — the code reads `env.HEALTH_DB` |

Cron cadence is set in `wrangler.toml` (`crons = ["*/5 * * * *"]`). The history window is 24 hours
regardless of cadence; homelab-dashboard flags the data as stale after 15 minutes without a check, so
keep the cadence at 5 minutes or shorter.

## HTTP endpoints

| Method & path | Auth | Description |
|---|---|---|
| `GET /` | — | Read-only JSON: `state`, `since`, `last_check`, `fail_streak`, `notified`, `last_outage`, `history_points`, `influx_queued`. Never probes |
| `POST /run` | `Authorization: Bearer <RUN_SECRET>` | Runs one probe now and returns the run summary (500 if D1 failed) |
| anything else | — | 404 |

```bash
curl -X POST -H "Authorization: Bearer $RUN_SECRET" https://<your-worker-host>/run
```

## D1 schema

See [`schema.sql`](./schema.sql) — one table, `store(key TEXT PRIMARY KEY, value TEXT)`, shared with
`homelab-dashboard`. This Worker uses these keys:

- `ipv6_data` (owned) — `{ state, since, notified, fail_streak, first_fail, last_check, last_outage, history[] }`.
  `history` holds `{ time, status }` points (unix seconds, `1` up / `0` down) for the last 24 hours;
  homelab-dashboard draws it as the IPv6 sparkline and shows `state` / `since`.
- `ipv6_influx_queue` (owned) — `{ time, status }[]` waiting for InfluxDB.
- `ipv6_data_corrupt` (owned) — written only when `ipv6_data` held invalid JSON.
- `mute_prefs` (read only) — owned by homelab-dashboard, which also owns `dashboard_data` and
  `alert_state`.

## Known limitations

- A manual `POST /run` that overlaps a cron run can lose one history point (both runs read the same
  row; the second write wins). Runs are otherwise serialised by the cron schedule.
- The Slack text names the monitored host (`Pi5`); see Security notes.

## Security notes

- Every secret is read from `env`; nothing sensitive is in this repo. `wrangler.toml` carries only a
  `REPLACE_WITH_D1_DATABASE_ID` placeholder.
- `GET /` is public and reveals only the up/down state and timestamps. Manual probes need
  `RUN_SECRET` (compared in constant time); without it they are disabled.
- Slack messages name the monitored host (`Pi5` in the committed copy) — edit `worker.js` if you would
  rather not disclose the hostname in a shared channel.
- Keep the `*.workers.dev` route disabled so dashboard-side WAF rules on a custom domain cannot be
  bypassed.

## License

MIT — see [LICENSE](./LICENSE).
