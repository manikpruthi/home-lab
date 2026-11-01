# HomeLab Dashboard

A single-file [Cloudflare Worker](https://workers.dev/) + [D1](https://developers.cloudflare.com/d1/)
that polls a Raspberry Pi and four Oracle Cloud VMs, stores the merged snapshot, and renders a two-tab
status board — compute, storage, network, tunnels, services, and a 24-hour IPv6 sparkline.

It is the read side of a small NOC: each node runs a bash health script that emits JSON, the Worker
aggregates them at the edge, and Slack gets the alerts.

## Features

- **Two tabs** — Pi5 server and the four Oracle VMs, each rendered as a grid of cards.
- **Severity-aware cards** — a card's border turns red when anything inside it crosses a threshold
  (RAM ≥ 85 %, disk ≥ 90 %, OOM kills, > 5 zombies, *current* throttling, a down tunnel, a failed
  DNS/IP check, a read-only root, an `ERR` volume read). Throttle bits that only occurred earlier since
  boot show amber, not red.
- **Trend tails** — the last five temperature / RAM / CPU-steal samples are kept and rendered inline
  with a colour hint against the recent average.
- **24-hour IPv6 sparkline** — 480 bars read from the `ipv6_data` row that the companion
  `uptime-monitor` Worker writes into the same database.
- **Stale-while-revalidate** — `/api/data` always answers from the cached snapshot; when any host's
  last poll is older than 20 minutes it kicks off a background refresh (`ctx.waitUntil`), deduplicated
  per isolate so concurrent viewers don't stampede the hosts.
- **Honest staleness** — each host keeps `fetched_at` (last success) and `attempted_at` (last try). An
  unreachable host shows `OFFLINE (last ok …)` and contributes a single *Host unreachable* alert instead
  of its stale cached alerts.
- **Per-category mute** — each alert is assigned exactly one category (global, network, storage,
  services, compute) by word-boundary rules. Muted alerts are kept off Slack and shown dimmed with 🔕 in
  the Global Alerts card. Persisted in D1 so the setting is shared across devices.
- **Change-based Slack** — only the cron run posts. It sends new and resolved alerts, then a reminder of
  still-active alerts every 6 hours. Numbers are ignored when comparing, so `RAM (86%)` → `RAM (87%)` is
  not a new alert. "ARM instance grabbed" is notified once and never re-reminded.
- **Escaped rendering** — every value from the health scripts is HTML-escaped; interaction uses event
  delegation with `data-*` attributes instead of inline `onclick` strings.

## Architecture

```text
      cron (*/15) ──┐
 stale GET /api/data┴──► fetchHealth (12s timeout, 1 retry, x-worker-secret)
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
                     │ alert_state          │ ← this Worker (Slack dedupe)
                     │ ipv6_data            │ ← uptime-monitor
                     └──────────┬───────────┘
                                v
                    GET /  → server-rendered HTML
                    GET /api/data → JSON
                                │
                                v
                  Slack (cron only, on change + 6h reminder)
```

The database is **shared** with `uptime-monitor`. That Worker owns the `ipv6_data` row; this one owns
`dashboard_data`, `mute_prefs` and `alert_state`. Both bind to the same `HEALTH_DB`.

Per poll: fetch the requested targets in parallel (a payload without a `system` object counts as a
failure) → read the stored snapshot, mute prefs and alert state in one query → merge and recompute the
trend arrays → on cron runs, diff the unmuted alerts against `alert_state` and post to Slack → write
everything back in one D1 batch.

## Project structure

```text
homelab-dashboard/
├── worker.js            # The entire Worker: poller, aggregation, HTML UI, API
├── schema.sql           # One-time D1 bootstrap (store table)
├── wrangler.toml        # Worker name, cron, D1 binding (only needed if you deploy with wrangler)
├── package.json         # npm scripts (dev / deploy / db:init)
├── .dev.vars.example    # Template for local secrets (copy to .dev.vars, never commit)
├── LICENSE              # MIT
└── README.md            # This file
```

## Deploying without wrangler

`worker.js` has no build step and no hardcoded values, so the committed file is exactly what you paste
into **Cloudflare Dashboard → Workers & Pages → homelab-dashboard → Edit code**. Before the first paste
of this version, add the variables below under **Settings → Variables and Secrets** (use *Secret* for
`ADMIN_PASS`, `WORKER_SECRET` and `SLACK_WEBHOOK`), and set **Settings → Triggers → Cron** to
`*/15 * * * *`. The D1 binding must be named `HEALTH_DB`.

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
| `VM1_URL` … `VM4_URL` | yes | The four Oracle VM health endpoints. A host whose URL is unset is skipped |
| `WORKER_SECRET` | no | Sent as `x-worker-secret` to every health endpoint; blank omits the header |
| `SLACK_WEBHOOK` | no | Incoming webhook; blank disables alerting |
| `DASHBOARD_TITLE` | no | Page title and header text; defaults to `HomeLab Dashboard` |
| D1 binding `HEALTH_DB` | yes | Must point at the database shared with `uptime-monitor` |

Cron cadence is `*/15 * * * *`. The UI also refreshes opportunistically: `/api/data` starts a background
poll whenever any host's last attempt is older than 20 minutes. Admin credentials typed into the page
are kept in memory for that tab only and dropped on a 401.

## Health script contract

The Worker treats any response without a top-level `system` object as a failed fetch. The node
scripts (Pi `~/scripts/health.sh --json`, VM `~/vm_health.sh --api`) build their JSON with `jq`, so
journal lines and process names can't produce invalid JSON. Fields the UI reads beyond the basics:

| Field | Source | Used for |
|---|---|---|
| `network.dns4` / `dns6` / `ipv4` / `ipv6` | Pi | `✓` / `✗`; any `✗` turns the network card red |
| `network.oci_vmN` | Pi | `VMn [REACHABLE\|UNREACHABLE] HS: <handshake>` |
| `network.tailscale_state` | Pi | Tailscale `BackendState`; anything but `Running` is an error |
| `system.throttle` / `throttle_desc` | Pi | Raw `get_throttled`; bits 0–3 (now) are red, bits 16–19 (since boot) amber |
| `system.iowait`, `io_speeds.*` | Pi | Last-second `iostat -y` sample, not the since-boot average |
| `system.oom_victims` | Pi + VM | Process names from `Out of memory: Killed process` kernel lines |
| `storage.filesys` | Pi | `READ-ONLY` only when the root mount has the bare `ro` option |
| `system.cpu_steal` | VM | Average steal since the previous poll (`/proc/stat` delta) |
| `network.pi_tunnel_ip` | VM | Shown next to the Pi5 tunnel row |
| `services.arm-grabber.grabbed` | VM | `yes` once the success log exists, whether or not the grabber is still running |

## API reference

| Method & path | Auth | Description |
|---|---|---|
| `GET /` | — | Dashboard HTML (no-store) |
| `GET /api/data` | — | Cached snapshot + `ipv6_monitor` (last 480 points) + `_mutes` + `_alerts` (categorised, with `muted` flag); refreshes in the background if stale |
| `GET /api/data?force=all\|pi5\|vms` | admin | Forces a live poll for that target set (no Slack); any other value is a 400 |
| `POST /api/mute` | admin | Toggles a category mute; body `{ "category": "global\|compute\|storage\|network\|services" }`; unknown category is a 400 |

## Security notes

- **The dashboard and `/api/data` are unauthenticated.** They expose hostnames, service names, disk
  usage, and error strings. Put the hostname behind Cloudflare Access, a WAF rule, or an origin-side
  password before pointing a public DNS record at it.
- Admin auth is a timing-safe comparison against `ADMIN_USER`/`ADMIN_PASS` secrets. Nothing is
  hardcoded — the committed copy contains no credentials.
- All endpoint URLs live in `env`, so no hostname, tunnel domain, or private IP is committed.
- `/api/data?force=` and `/api/mute` are the only write-ish paths and both require admin.
- All health data is HTML-escaped before rendering, so a journal line containing `<` or `'` cannot
  break the page or inject markup.

## License

MIT — see [LICENSE](./LICENSE).
