# Uptime Monitor

A single-file [Cloudflare Worker](https://workers.dev/) that probes an IPv6 endpoint on a schedule,
keeps its state in [D1](https://developers.cloudflare.com/d1/), ships uptime points to InfluxDB, and
posts to Slack **only on state transitions**.

Built for the case a plain ping cannot cover: a host that is powered on and online but has lost its
IPv6 path. The Worker probes from Cloudflare's edge, so a successful response proves the route works
from outside the LAN.

## Features

- **Edge-side probing** — 3 attempts with a 3 s timeout each, so a single dropped packet is not an
  outage.
- **Stateful alerting** — Slack fires on `up -> down` and `down -> up` only, never on every poll. The
  last known state lives in D1, so the Worker stays silent through a long outage.
- **Durable Influx queue** — points accumulate in D1 (up to 1,000) and are replayed on the next
  successful write, so an InfluxDB outage loses nothing. Trimmed from the front once acknowledged.
- **Two histories** — 480 points for the dashboard sparkline, 1,000 queued for InfluxDB.
- **Schedule or on demand** — the cron trigger runs it; `GET /` runs it inline for a manual check.

## Architecture

```text
  cron (*/5)  ──┐
  GET /      ──┴──► probe PI_IPV6_URL (3 tries, 3s timeout)
                          │
                          v
                 ┌──────────────────┐
                 │ D1 `store` row   │  state, history[480], influxQueue[1000]
                 │ key=ipv6_data    │
                 └────┬─────────┬───┘
                      │         │
             state    │         │  queued points
          transition  │         │
                      v         v
                 Slack      InfluxDB (line protocol)
```

Order of operations per run: probe -> read D1 -> decide alert -> append history -> flush Influx queue
-> upsert the row. The Influx flush happens **before** the D1 write, so points are only dropped from
the queue once they are acknowledged.

## Project structure

```text
uptime-monitor/
├── worker.js            # The entire Worker: probe, state machine, Influx writer, Slack
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
- An InfluxDB v2 endpoint and token (optional, but the queue will simply grow without one)
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
#    PI_IPV6_URL, INFLUX_URL, INFLUX_TOKEN, INFLUX_SECRET, SLACK_WEBHOOK

# 3. Deploy (the cron trigger starts probing immediately)
npm run deploy

# Local development (uses .dev.vars for secrets):
cp .dev.vars.example .dev.vars   # then fill in your values
npm run dev
```

## Configuration

| Secret | Where to set | Purpose |
|---|---|---|
| `PI_IPV6_URL` | Worker → Settings → Variables and Secrets | Endpoint probed each run; any 2xx counts as up |
| `INFLUX_URL` | Same | InfluxDB v2 write URL, without `precision` (the Worker appends it) |
| `INFLUX_TOKEN` | Same | Write-scoped InfluxDB API token |
| `INFLUX_SECRET` | Same | Optional `x-worker-secret` header value; omit if unused |
| `SLACK_WEBHOOK` | Same | Incoming webhook; blank disables alerting |
| D1 binding `HEALTH_DB` | `wrangler.toml` | Case-sensitive binding name — the code reads `env.HEALTH_DB` |

Cron cadence is set in `wrangler.toml` (`crons = ["*/5 * * * *"]`). With 480 retained history points,
`*/5` keeps about 40 hours; raise the cadence for a longer window or increase the cap in the code.

## D1 schema

See [`schema.sql`](./schema.sql) — one table:

- `store(key TEXT PRIMARY KEY, value TEXT)` — holds the single `ipv6_data` JSON document:
  `{ state, history[], influxQueue[] }`.

This database is **shared with `homelab-dashboard`**, which reads `ipv6_data` to draw its 24-hour
sparkline and owns two keys of its own (`dashboard_data`, `mute_prefs`). Bind both Workers to the same
`database_id`.

## Security notes

- Every secret is read from `env`; nothing sensitive is in this repo. `wrangler.toml` carries only a
  `REPLACE_WITH_D1_DATABASE_ID` placeholder.
- `GET /` triggers a real probe and can therefore generate Slack traffic. Put the Worker behind a WAF
  rule or an access policy if the hostname is public, or rely on cron only and remove the `fetch`
  handler.
- Slack messages name the monitored host (`Pi5` in the committed copy) — edit `worker.js` if you would
  rather not disclose the hostname in a shared channel.
- Keep the `*.workers.dev` route disabled so dashboard-side WAF rules on a custom domain cannot be
  bypassed.

## License

MIT — see [LICENSE](./LICENSE).
