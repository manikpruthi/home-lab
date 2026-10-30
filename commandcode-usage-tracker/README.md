# CommandCode Usage Tracker

A single-file [Cloudflare Worker](https://workers.dev/) + [D1](https://developers.cloudflare.com/d1/) dashboard that tracks API usage against a credit-pool subscription: live rolling quota windows, per-model costs, billing-cycle ROI, daily trends, a model catalog advisor, and system diagnostics — all in one deploy with zero hardcoded prices.

## Features

- **Live quota windows** — 5-hour and 7-day rolling credit bars that mirror the provider's own limits endpoint exactly (used / cap / reset time), with a local request-ledger fallback.
- **Plan value & break-even tracker** — compares extracted API value in the current billing cycle against the subscription cost, with ROI multiplier and net savings.
- **Per-model breakdown** — requests, wasted turns, fresh vs. cached vs. output tokens, cache-hit rate, allowance cap, leverage, credit burn, and real cost.
- **Date-wise trends** — daily spend chart (IST) plus a day-by-day model rollup over a 90-day rolling window.
- **Model catalog advisor** — ~70 usable plan models scraped dynamically (rates, caps, intelligence, roles, peak/off-peak schedules) with Smart Score ranking, search, and sortable columns.
- **System info tab** — D1 row counts, storage, API/SQL latencies, sync coverage, and an auth probe (never exposes the token).
- **Resilient syncing** — 15-minute cron, stale-while-revalidate dashboard loads, D1-backed sync lease (no overlapping syncs), session-cookie rotation capture, and a logged-in-session bookmarklet push that works even when the stored cookie is dead.
- **Secure by default** — timing-safe admin auth via Worker secrets, XSS-escaped rendering, dismissible alerts with 24-hour snooze synced across devices.

## Architecture

```text
                    ┌─────────────────────────┐
                    │  Cloudflare Worker      │
                    │  worker.js (single file)│
                    │  ┌──────┐ ┌───────────┐  │
                    │  │ cron │ │  fetch    │  │
                    │  │/15m  │ │ / , /api/*│  │
                    │  └──┬───┘ └─────┬─────┘  │
                    └─────┼───────────┼────────┘
                          │           │
              ┌───────────▼──┐   ┌────▼─────────┐
              │  Provider    │   │  D1 (SQLite) │
              │  usage /     │   │ cc_daily_    │
              │  billing /   │   │  model_usage │
              │  catalog APIs│   │ cc_seen_     │
              └──────────────┘   │  requests    │
                                 │ cc_meta      │
                                 └──────────────┘
```

- **Sync engine** (`syncUsageData`) — paginates the usage feed (last 100 entries / 24 h), reads authoritative window state from the billing-limits endpoint, scrapes the model catalog + pricing docs on a 10 AM IST daily schedule (24 h TTL), ingests daily rollups in D1 batches, and enforces 90-day retention.
- **Credit model** — pool drain is paced on *sticker* usage-value at list rates, not billed dollars: `credit burn per $1 = monthly pool / model cap`. A $10-cap model burns 7×; a $70-cap model burns 1×. Free models and tool pings drain 0.
- **Dashboard** — server-rendered HTML with 4 tabs (Dashboard · Date-Wise & Trends · Advisor · System Info), billing-cycle default everywhere, lazy-loaded history, and a manual-refresh modal (admin-gated, 2 force checkboxes, cookie fallback, mobile bookmarklet generator).

## Project structure

```text
commandcode-usage-tracker/
├── worker.js            # The entire Worker: API + sync engine + dashboard UI
├── schema.sql           # One-time D1 bootstrap (CREATE TABLEs + optional indexes)
├── wrangler.toml        # Worker name, cron schedule, D1 binding
├── package.json         # npm scripts (dev / deploy / db:init)
├── .dev.vars.example    # Template for local secrets (copy to .dev.vars, never commit)
├── LICENSE              # MIT
└── README.md            # This file
```

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- A [Cloudflare account](https://dash.cloudflare.com/) with Workers + D1
- [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) CLI (`npx wrangler` works without a global install)
- Your provider credentials: a session cookie and an API key (see [Configuration](#configuration))

## Quickstart

```bash
# 1. Enter the project
cd commandcode-usage-tracker

# 2. Install the deploy CLI
npm install

# 3. Create the D1 database and bootstrap the schema
npx wrangler d1 create cc-usage-db
# → paste the returned database_id into wrangler.toml
npm run db:init        # runs schema.sql against cc-usage-db

# 4. Set production secrets (Dashboard → Worker → Settings → Variables and Secrets)
#    ADMIN_USER, ADMIN_PASS, CC_COOKIE, CC_API_KEY  (see Configuration below)

# 5. Deploy (cron triggers the first sync automatically)
npm run deploy

# Local development (uses .dev.vars for secrets):
cp .dev.vars.example .dev.vars   # then fill in your values
npm run dev
```

## Configuration

| Secret | Where to set | Purpose |
|---|---|---|
| `ADMIN_USER` / `ADMIN_PASS` | Worker → Settings → Variables and Secrets | Gates `/api/refresh`, `/api/dismiss-alert`, `/api/push` |
| `CC_COOKIE` | Same (or the dashboard's Manual Refresh modal) | Session cookie (`__Secure-…session_token=<token>`); auto-rotated in place from `Set-Cookie` responses |
| `CC_API_KEY` | Same | API key (the `user_…` key from `~/.commandcode/auth.json`); used only for the billing-cycle summary. Rotates on CLI re-login — re-paste when the Summary API 401s |
| D1 binding `DB` | `wrangler.toml` → `cc-usage-db` | Case-sensitive binding name |

Optional hardening used in production (Cloudflare dashboard, not in code):

- **WAF geo-block** — custom rule blocking non-home-country traffic to the tracker's hostname.
- **Rate limiting** — e.g. 7 requests / 10 s per IP on the tracker hostname.
- **Disable `*.workers.dev` route** — otherwise the default Workers URL bypasses the custom-domain WAF rules.

## API reference

| Method & path | Auth | Description |
|---|---|---|
| `GET /` | — | Full dashboard (stale-while-revalidate; cold start syncs inline) |
| `GET /api/data` | — | JSON payload behind the dashboard (stale-while-revalidate) |
| `POST /api/refresh` | admin + optional `cookie`, `forcePriceSync`, `forceCatalogSync` | Forced sync; returns `{ ok, syncResult, data }`. Surfaces the real upstream auth error instead of a false "Synced!" |
| `POST /api/dismiss-alert` | admin + `alertKey` (`__ALL__` = all) | Snoozes an alert for 24 h, synced across devices via D1 |
| `POST /api/push` | admin + `usages[]`, `windowLimits`, `byModel[]` | Bookmarklet ingest from inside a logged-in provider session (`credentials: 'include'`); keeps bars exact with zero dependence on the stored cookie |
| `OPTIONS *` | — | CORS preflight for the bookmarklet origin |

## D1 schema

See [`schema.sql`](./schema.sql) — three tables:

- `cc_daily_model_usage(usage_date, model, …)` — per-day per-model rollup (tokens, costs, durations). PK: `(usage_date, model)`.
- `cc_seen_requests(id, created_at)` — dedupe ledger; IDs retained ≥ 91 days so re-fetched rows inside the 90-day rollup window are never double-counted.
- `cc_meta(key, value)` — catalog cache, window caps/limits, sync status/errors, latencies, dismissed alerts, rolling ledger, auth probe.

Retention: daily rows purged past 90 days; retention pass runs at most once per day.

## Development

```bash
npm run dev      # local worker with .dev.vars
npm run deploy   # deploy to production
npm run db:init  # re-run schema.sql (idempotent — CREATE TABLE IF NOT EXISTS)
```

Manual refresh flow (browser): **Manual Refresh** button → admin login → optionally paste a fresh session cookie → tick *Force pricing* / *Force catalog* as needed → **Sync Now**. **Copy Mobile Bookmarklet** generates a `javascript:void(…)` bookmarklet — run it while logged in on the provider site; its alert reports per-leg statuses (`usage / bars / by-model / push`).

## Security notes

- Secrets live only in Worker Secrets / `.dev.vars` (git-ignored). Nothing sensitive is in this repo — grep for `ADMIN_`, `CC_COOKIE`, `CC_API_KEY` finds only *references*, never values.
- Admin comparison is timing-safe; auth failures return generic `Invalid credentials`.
- All scraped/API-derived strings are HTML-escaped before rendering; alert dismissal uses `data-*` attributes, not inline handlers.
- The auth probe stores only a cookie *fingerprint* (length, pair presence, last 4 chars) — never the token.

## License

MIT — see [LICENSE](./LICENSE). This project scrapes public pricing/catalog documentation at runtime; respect those sites' terms of use.
