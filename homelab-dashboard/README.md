# HomeLab Dashboard

A single-file [Cloudflare Worker](https://workers.dev/) + [D1](https://developers.cloudflare.com/d1/)
that polls a Raspberry Pi and four Oracle Cloud VMs, stores the merged snapshot, and renders a two-tab
status board — compute, storage, network, tunnels, services, and a 24-hour IPv6 sparkline.

It is the read side of a small NOC: each node runs a bash health script that emits JSON, the Worker
aggregates them at the edge, and Slack gets the alerts.

## Features

- **Two tabs** — Pi5 server and the four Oracle VMs, each rendered as a grid of cards.
- **Severity-aware cards** — a card's border turns red when anything inside it crosses a threshold
  (RAM ≥ 85 %, disk ≥ 90 %, TCP OOM kills, throttling, a down tunnel, an `ERR` volume read).
- **Trend tails** — the last five temperature / RAM / CPU-steal samples are kept and rendered inline
  with a colour hint against the recent average.
- **24-hour IPv6 sparkline** — 480 bars read from the `ipv6_data` row that the companion
  `uptime-monitor` Worker writes into the same database.
- **Stale-while-revalidate** — `/api/data` serves the cached snapshot and only re-polls when the cached
  copy is more than 30 minutes old, so page loads never block on five outbound fetches.
- **Per-category mute** — knob per card; muted categories are filtered out of the alert list and out of
  Slack, persisted in D1 so the setting is shared across devices.
- **Grabbed-instance dedupe** — the transient "ARM instance grabbed" alert fires once, then stays off
  until the condition clears.

## Architecture

```text
        hourly cron ──┐
        GET /api/data ┴──► fetchWithRetry (12s timeout, 1 retry, x-worker-secret)
                                │
                    ┌───────────┴────────────┐
                    v                        v
            PI5_HEALTH_URL            VM1..VM4_URL
            (health.sh --json)        (vm_health.sh relays)
                    │                        │
                    └───────────┬────────────┘
                                v
                     ┌──────────────────────┐
                     │ D1 `store`           │
                     │ dashboard_data       │ ← this Worker
                     │ mute_prefs           │ ← this Worker
                     │ ipv6_data            │ ← uptime-monitor
                     └──────────┬───────────┘
                                v
                    GET /  → server-rendered HTML
                    GET /api/data → JSON
                                │
                                v
                       Slack (on alerts only)
```

The database is **shared** with `uptime-monitor`. That Worker owns the `ipv6_data` row; this one owns
`dashboard_data` and `mute_prefs`. Both bind to the same `HEALTH_DB`.

Per poll: read the cached snapshot → fetch only the requested targets in parallel → recompute the
trend arrays → upsert `dashboard_data` → post the filtered alert list to Slack if anything survived
the mute filters.

## Project structure

```text
homelab-dashboard/
├── worker.js            # The entire Worker: poller, aggregation, HTML UI, API
├── schema.sql           # One-time D1 bootstrap (store table)
├── wrangler.toml        # Worker name, hourly cron, D1 binding
├── package.json         # npm scripts (dev / deploy / db:init)
├── .dev.vars.example    # Template for local secrets (copy to .dev.vars, never commit)
├── LICENSE              # MIT
└── README.md            # This file
```

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- A Cloudflare account with Workers + D1
- [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) CLI
- Five endpoints that return the expected JSON shape — the Pi's `health.sh --json` on the Pi side, and
  the `vm_health.sh` output on each VM
- A Slack incoming webhook (optional)

## Quickstart

```bash
cd homelab-dashboard

npm install

# 1. Create (or reuse) the shared D1 database and bootstrap the schema
npx wrangler d1 create homelab-health-db
# → paste the returned database_id into wrangler.toml
# → bind the SAME database_id in uptime-monitor/wrangler.toml
npm run db:init

# 2. Set production secrets (Dashboard → Worker → Settings → Variables and Secrets)
#    ADMIN_USER, ADMIN_PASS, WORKER_SECRET, PI5_HEALTH_URL, VM1_URL..VM4_URL, SLACK_WEBHOOK

# 3. Deploy
npm run deploy

# Local development (uses .dev.vars for secrets):
cp .dev.vars.example .dev.vars   # then fill in your values
npm run dev
```

## Configuration

| Secret | Required | Purpose |
|---|---|---|
| `ADMIN_USER` / `ADMIN_PASS` | yes | HTTP Basic credentials for `POST /api/mute` and `?force=` syncs. Unset means every authenticated action 401s |
| `PI5_HEALTH_URL` | yes | Pi5 health JSON endpoint |
| `VM1_URL` … `VM4_URL` | yes | The four Oracle VM health endpoints |
| `WORKER_SECRET` | no | Sent as `x-worker-secret` to every health endpoint; blank omits the header |
| `SLACK_WEBHOOK` | no | Incoming webhook; blank disables alerting |
| D1 binding `HEALTH_DB` | yes | Must point at the database shared with `uptime-monitor` |

Cron cadence is `0 * * * *` (hourly) in `wrangler.toml`. The UI also refreshes opportunistically:
`/api/data` triggers a full poll whenever the cached snapshot is older than 30 minutes.

## API reference

| Method & path | Auth | Description |
|---|---|---|
| `GET /` | — | Dashboard HTML (no-store) |
| `GET /api/data` | — | Cached snapshot + `ipv6_monitor` + `_mutes`; re-polls if stale |
| `GET /api/data?force=all\|pi5\|vms` | admin | Forces a live poll for that target set |
| `POST /api/mute` | admin | Toggles a category mute; body `{ "category": "compute" }` |

## Security notes

- **The dashboard and `/api/data` are unauthenticated.** They expose hostnames, service names, disk
  usage, and error strings. Put the hostname behind Cloudflare Access, a WAF rule, or an origin-side
  password before pointing a public DNS record at it.
- Admin auth is a timing-safe comparison against `ADMIN_USER`/`ADMIN_PASS` secrets. Nothing is
  hardcoded — the committed copy contains no credentials.
- All endpoint URLs live in `env`, so no hostname, tunnel domain, or private IP is committed.
- `/api/data?force=` and `/api/mute` are the only write-ish paths and both require admin.
- The inline `onclick` handlers build strings from health data. That data comes from your own scripts,
  but if any of it can carry user-controlled text, escape it before rendering.

## License

MIT — see [LICENSE](./LICENSE).
