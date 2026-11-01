# CommandCode Usage Tracker

A single-file [Cloudflare Worker](https://workers.dev/) + [D1](https://developers.cloudflare.com/d1/) dashboard that tracks API usage against a credit-pool subscription: live rolling quota windows, per-model costs, billing-cycle ROI, daily trends, a model catalog advisor, and system diagnostics — all in one deploy with zero hardcoded prices.

## Features

- **Live quota windows** — 5-hour and 7-day rolling credit bars that mirror the provider's own limits endpoint exactly (used / cap / reset time), with a local request-ledger fallback. A cached snapshot whose reset time has already passed renders as an empty idle window until the next sync, so a rollover can never leave the bar pinned at 100%.
- **Plan value & break-even tracker** — compares extracted API value in the current billing cycle against the subscription cost, with ROI multiplier and net savings.
- **Per-model breakdown** — requests, wasted turns, fresh vs. cached vs. output tokens, cache-hit rate, allowance cap, leverage, credit burn, and real cost. Models are resolved by their official IDs (see [Model identity](#model-identity)); free models are labelled `Free (0 cr)` and never burn pool credits.
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
- **Credit model** — pool drain is paced on *sticker* usage-value at list rates, not billed dollars: `credit burn per $1 = monthly pool / model cap`. A $10-cap model burns 7×; a $70-cap model burns 1×. Free models and tool pings drain 0. Each request's cap, weight and credits are **frozen when it is first observed** (see [D1 schema](#d1-schema)), so a later allowance change only affects new requests instead of re-pricing history.
- **Dashboard** — server-rendered HTML with 4 tabs (Dashboard · Date-Wise & Trends · Advisor · System Info), billing-cycle default everywhere, lazy-loaded history, and a manual-refresh modal (admin-gated, 2 force checkboxes, cookie fallback, mobile bookmarklet generator).

### Model identity

- Every catalog entry keeps two keys: a display name (`Beam 1.0`) and the official model ID from the docs' `/models/<id>` link (`beam-free`). The usage feed reports the ID, so lookups match on that before falling back to fuzzy prefix matching. This is what keeps models whose display name differs from their ID (`Qwen 3.8 Max` → `qwen3-8-max`, `Nemotron 3 Ultra` → `nemotron-3-ultra-550b-a55b`) out of the `[UNMAPPED]` alert and off the 1× pool fallback.
- `LEGACY_MODEL_ALIASES` is intentionally empty. Command Code ships **four distinct DeepSeek Flash models** — V4 Flash ($60 cap), V4 Flash Fast ($20), V4.1 Flash ($100) and V4.1 Flash Fast ($60). Never alias a base model to its `-fast` variant: it mislabels the per-model table and paces credits against the wrong cap (70/60 instead of 70/100 is a 1.67× over-read of the rolling windows). Add an alias only for a name you have confirmed is the *same* model.
- Rows ingested while the earlier base→`-fast` alias was live remain aggregated under `deepseek-v41-flash-fast`; the daily rollup stores only the canonical key, so they cannot be re-split. They age out with the 90-day retention window.
- `CATALOG_SCHEMA_VERSION` invalidates the cached catalog when the parser changes, so a deploy re-scrapes the docs on the next sync instead of serving an old-shape cache until 10 AM IST.

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

See [`schema.sql`](./schema.sql) — four tables:

- `cc_daily_model_usage(usage_date, model, …, credits_consumed)` — per-day per-model rollup (tokens, costs, durations, frozen pool credits). PK: `(usage_date, model)`. `credits_consumed = -1` marks a row written before credit freezing; the Worker derives those from the current catalog instead.
- `cc_seen_requests(id, created_at)` — dedupe ledger. IDs are retained ≥ 91 days so re-fetched rows inside the 90-day rollup window are never double-counted.
- `cc_request_credits(id, created_at, usage_date, model, sticker_usd, billed_usd, model_cap_usd, pool_usd, credit_weight, credits, observed_at)` — per-request credit ledger. The rolling 5 h / 7 d window fallbacks read the last 7 days of this table. PK: `id`; indexed on `created_at`.
- `cc_meta(key, value)` — catalog cache, window caps/limits, sync status/errors, latencies, dismissed alerts, auth probe.

**Credits are frozen at ingest, not recomputed.** `sticker_usd` is the request's sticker usage-value, `model_cap_usd` / `pool_usd` are the allowance and pool in effect when the Worker first saw it, and `credits = sticker_usd × pool_usd / model_cap_usd` is stored on the row. A later allowance change (e.g. DeepSeek V4.1 Flash $60/$70 → $100) therefore only affects requests served after it — it never retroactively re-prices history. Free/tool requests store `credit_weight = 0` and `credits = 0`.

Retention: daily rows purged past 90 days, `cc_seen_requests` / `cc_request_credits` rows past 91 days; the retention pass runs at most once per day.

### Upgrading an existing database

The per-request ledger and the frozen daily credits are new. Run the three statements from the **UPGRADING AN EXISTING DATABASE** block of [`schema.sql`](./schema.sql) **before** deploying this build (a Worker writing a table/column that doesn't exist fails every sync). They work in the D1 dashboard console (Storage & Databases → D1 → your database → Console), one statement at a time:

```sql
ALTER TABLE cc_daily_model_usage ADD COLUMN credits_consumed REAL DEFAULT -1;

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

CREATE INDEX IF NOT EXISTS idx_request_credits_created ON cc_request_credits(created_at);
```

Statements 2 and 3 are idempotent; statement 1 errors harmlessly if the column already exists. The old `rolling_window_ledger_json` meta blob is no longer read; the daily retention pass deletes it (or run `DELETE FROM cc_meta WHERE key = 'rolling_window_ledger_json';` yourself). Requests observed before the upgrade stored only an ID and timestamp, so they cannot be attributed retroactively — the per-request ledger fills in as new requests are observed (the 5-hour window rebuilds within 5 hours). The authoritative 5-hour/weekly bars come from the provider's limits endpoint, so they are unaffected by the migration.

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
