# CommandCode Usage Tracker

A single-file [Cloudflare Worker](https://workers.dev/) + [D1](https://developers.cloudflare.com/d1/) dashboard that tracks Command Code usage against your credit-pool subscription (Go, GOAT, Pro …): live rolling quota windows, per-model costs, billing-cycle ROI, daily trends, a model catalog advisor, and system diagnostics — all in one deploy with zero hardcoded prices or plan limits.

## Features

- **Plan-aware** — detects your plan (Go, GOAT, Pro, Max …) by matching Command Code's live 5-hour/weekly caps against the per-plan credit limits on the usage-limits docs (Go 3/6, GOAT 14/35, Pro 16/40). Caps, monthly pool, price, the model catalog and every allowance follow the detected plan; switching plans re-scrapes automatically. `CC_PLAN` forces a plan.
- **Live quota windows** — 5-hour and 7-day rolling credit bars that mirror the provider's own limits endpoint exactly (used / cap / reset time), with a local request-ledger fallback. A cached snapshot whose reset time has already passed falls back to ledger usage since that reset (replaying the provider's open-on-first-request rule) until the next sync, so a rollover can never leave the bar pinned at 100%.
- **Plan value & break-even tracker** — compares extracted API value in the current billing cycle against the subscription cost, with ROI multiplier and net savings.
- **Per-model breakdown** — requests, wasted turns, total tokens, cache-hit rate, allowance cap, leverage, credit burn, credits used, real cost and net savings. Models are resolved by their official IDs (see [Model identity](#model-identity)); free models are labelled `Free (0 cr)` and never burn pool credits.
- **Date-wise trends** — daily spend chart (IST) plus a day-by-day model rollup over a 90-day rolling window.
- **Plan advisor** — every model on your plan scraped from `/docs/plans/<plan>` (rates, allowances, intelligence, roles, peak/off-peak schedules) with a Smart Score ranking, one best-pick card, search, and sortable columns. Models the docs don't list individually get the plan's "standard" allowance.
- **System info tab** — four cards: auth probe (never exposes the token), sync coverage + detected plan, D1 rows + storage, and latencies.
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
              │  plan docs   │   │ cc_request_  │
              └──────────────┘   │  credits     │
                                 │ cc_meta      │
                                 └──────────────┘
```

- **Sync engine** (`syncUsageData`) — reads the usage feed (one page: the last 100 entries of the last 24 h), reads authoritative window state from the billing-limits endpoint, detects the plan, scrapes the usage-limits + plan docs on a 10 AM IST daily schedule (24 h TTL, or immediately on a plan change), ingests into D1 batches, and enforces retention. A full page of 100 never-seen requests raises a `USAGE_FEED_GAP` alert: requests between syncs were missed.
- **Market cost** — comes straight from each usage entry (`meta.totalCost`, the market-billed amount); no external price list is fetched.
- **Credit model** — pool drain is paced on *sticker* usage-value at list rates, not billed dollars: `credit burn per $1 = monthly pool / model cap`. On GOAT (70-credit pool) a $10-cap model burns 7× and a $70-cap model 1×; on Go (10-credit pool) a $6-cap model burns ~1.67×. Free models and tool pings drain 0. Each request's cap, weight and credits are **frozen when it is first observed** (see [D1 schema](#d1-schema)), so a later allowance change only affects new requests instead of re-pricing history.
- **Dashboard** — server-rendered HTML with 4 tabs (Dashboard · Date-Wise & Trends · Plan Advisor · System Info), billing-cycle default everywhere, lazy-loaded history, and a manual-refresh modal (admin-gated, force-catalog checkbox, cookie fallback, mobile bookmarklet generator). An open page re-fetches `/api/data` at most once every 15 minutes.
- **Paid amount** — plan price from the docs plus a 7.8 % processing fee (GOAT: $10 → $10.78, Go: $1 → $1.08). Set `PLAN_PAID_USD` if your charge differs.

### Plan detection

- The billing API returns window caps but no plan name. The usage-limits docs state each plan's caps in credits, and the live caps are matched against them. If no single plan matches, the previous detection (or `goat`) is kept.
- `CC_PLAN` (e.g. `go`, `goat`, `pro`) overrides detection. The plan key is also the docs page scraped: `https://commandcode.ai/docs/plans/<key>`.
- Every request's credits are frozen with the pool and allowance in effect when it was ingested, so a plan switch never re-prices history. Known limitation: the daily rollup stores credits, not the pool they were measured against, so after a switch the *Real Cost* of older-plan days (30D/90D views) is scaled by the new plan's pool and price.
- Go has no API access, so `CC_API_KEY` routes may fail there; the session-cookie routes cover usage and window bars, and the billing cycle falls back to a 30-day window (marked "est.") when no summary is available.

### Model identity

- Every catalog entry keeps two keys: a display name (`Beam 1.0`) and the official model ID from the docs' `/models/<id>` link (`beam-free`). The usage feed reports the ID, so lookups match on that before falling back to fuzzy prefix matching. This is what keeps models whose display name differs from their ID (`Qwen 3.8 Max` → `qwen3-8-max`, `Nemotron 3 Ultra` → `nemotron-3-ultra-550b-a55b`) out of the `[UNMAPPED]` alert and off the 1× pool fallback.
- Fuzzy matching only accepts a catalog key that is a whole-token prefix of the usage slug followed by release tags (`-latest`, `-exp`, `-preview`, `-free`, build numbers). Speed/contributor variants (`-fast`, `-highspeed`, `-contributor`) never borrow their base model's allowance — the docs give them their own.
- Canonical slugs collapse dotted versions (`v4.1` → `v41`) but never repeated version numbers (`llama-3.3` stays `llama-3-3`).
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
npm run db:init        # runs schema.sql against the remote cc-usage-db

# 4. Set production secrets (Dashboard → Worker → Settings → Variables and Secrets)
#    ADMIN_USER, ADMIN_PASS, CC_COOKIE, CC_API_KEY  (+ optional CC_PLAN, PLAN_PAID_USD)

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
| `CC_API_KEY` | Same | API key (the `user_…` key from `~/.commandcode/auth.json`); used for the billing-cycle summary and as a window-limits fallback. Rotates on CLI re-login — re-paste when the Summary API 401s. Go plans have no API access |
| `CC_PLAN` *(optional)* | Same (plain variable) | Force the plan key (`go`, `goat`, `pro`, `max-10x` …) instead of detecting it from the live window caps |
| `PLAN_PAID_USD` *(optional)* | Same (plain variable) | What you actually pay per month, if it differs from docs price + 7.8 % fee |
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
| `POST /api/refresh` | admin + optional `cookie`, `forceCatalogSync` | Forced sync; returns `{ ok, syncResult, data }`. Surfaces the real upstream auth error instead of a false "Synced!" |
| `POST /api/dismiss-alert` | admin + `alertKeys[]` (or a single `alertKey`; `__ALL__` = persisted errors) | Snoozes alerts for 24 h, synced across devices via D1. The page's Dismiss All sends every key it shows, derived alerts included |
| `POST /api/push` | admin + `usages[]`, `windowLimits`, `byModel[]` | Bookmarklet ingest from inside a logged-in provider session (`credentials: 'include'`); keeps bars exact with zero dependence on the stored cookie. Records its own `last_push_*` status and never clears the cron sync's errors or auth badge |
| `OPTIONS *` | — | CORS preflight for the bookmarklet origin |

## D1 schema

See [`schema.sql`](./schema.sql) — three tables:

- `cc_daily_model_usage(usage_date, model, …, credits_consumed)` — per-day per-model rollup (tokens, costs, durations, frozen pool credits). PK: `(usage_date, model)`. `credits_consumed = -1` marks a row written before credit freezing; the Worker derives those from the current catalog instead.
- `cc_request_credits(id, created_at, usage_date, model, sticker_usd, billed_usd, model_cap_usd, pool_usd, credit_weight, credits, observed_at)` — per-request credit ledger **and** dedupe record (PK `id`; indexed on `created_at`). Each sync checks only the IDs it just fetched. The rolling 5 h / 7 d window fallbacks read the last 7 days. A request's ledger row and its daily-rollup upsert always commit in the same D1 batch.
- `cc_meta(key, value)` — plan limits + detected plan, catalog cache, window limits, sync status/errors, latencies, table counts (computed at sync time), dismissed alerts, auth probe, last bookmarklet push. Page loads read a fixed key list and never load the stored cookie.

**Credits are frozen at ingest, not recomputed.** `sticker_usd` is the request's sticker usage-value, `model_cap_usd` / `pool_usd` are the allowance and pool in effect when the Worker first saw it, and `credits = sticker_usd × pool_usd / model_cap_usd` is stored on the row. A later allowance change (e.g. DeepSeek V4.1 Flash $60/$70 → $100) therefore only affects requests served after it — it never retroactively re-prices history. Free/tool requests store `credit_weight = 0` and `credits = 0`.

Retention: daily rows purged past 90 days, `cc_request_credits` rows past 8 days (the feed only re-serves the last 24 h and the windows read 7 days); obsolete meta keys from older builds are deleted too. The retention pass runs at most once per day.

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

Statements 2 and 3 are idempotent; statement 1 errors harmlessly if the column already exists.

The 2026-11-02 plan-aware build no longer uses `cc_seen_requests`. Nothing breaks if it stays, but you can reclaim the space:

```sql
DROP TABLE IF EXISTS cc_seen_requests;
``` The old `rolling_window_ledger_json` meta blob is no longer read; the daily retention pass deletes it (or run `DELETE FROM cc_meta WHERE key = 'rolling_window_ledger_json';` yourself). Requests observed before the upgrade stored only an ID and timestamp, so they cannot be attributed retroactively — the per-request ledger fills in as new requests are observed (the 5-hour window rebuilds within 5 hours). The authoritative 5-hour/weekly bars come from the provider's limits endpoint, so they are unaffected by the migration.

## Development

```bash
npm run dev      # local worker with .dev.vars
npm run deploy   # deploy to production
npm run db:init        # run schema.sql against the remote (production) D1 — idempotent
npm run db:init:local  # same, against the local dev D1 used by `npm run dev`
```

Manual refresh flow (browser): **Manual Refresh** button → admin login → optionally paste a fresh session cookie → tick *Force re-detect plan and fetch its model list* if needed → **Sync Now**. **Copy Mobile Bookmarklet** generates a `javascript:void(…)` bookmarklet — run it while logged in on the provider site; its alert reports per-leg statuses (`usage / bars / by-model / push`).

## Security notes

- Secrets live only in Worker Secrets / `.dev.vars` (git-ignored). Nothing sensitive is in this repo — grep for `ADMIN_`, `CC_COOKIE`, `CC_API_KEY` finds only *references*, never values.
- Admin comparison is timing-safe; auth failures return generic `Invalid credentials`.
- All scraped/API-derived strings are HTML-escaped before rendering; alert dismissal uses `data-*` attributes, not inline handlers.
- The auth probe stores only a cookie *fingerprint* (length, pair presence, last 4 chars) — never the token.

## License

MIT — see [LICENSE](./LICENSE). This project scrapes public pricing/catalog documentation at runtime; respect those sites' terms of use.
