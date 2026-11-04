// ============================================================================
// Command Code Usage Tracker - Complete Cloudflare Worker (Single-File Build)
// ============================================================================
// Features Included:
// 1. 100% Dynamic GOAT Catalog & Pricing Scraper (Zero Hardcoded Model Values):
//    - Scrapes all 3 tables on https://commandcode.ai/docs/plans/goat:
//      * Table 1: Model, Context, Artificial Analysis Intelligence, Input/Output/Cache rates,
//        plus Off-Peak / Peak pricing schedules (e.g. DeepSeek UTC peak windows)
//      * Table 2: Requests / 5 hours, Requests / week, Requests / month
//      * Table 3: Exact Monthly Credits Cap ($10, $20, $40, $47, $70, $80, $100, Free)
//    - Scrapes https://commandcode.ai/docs/reference/cli/models for official roles
//    - Scrapes https://commandcode.ai/docs/resources/usage-limits by matching <th> headers
//      dynamically for 5-hour ($14), Weekly ($35), and Monthly ($70) caps
//    - Fetches https://openrouter.ai/api/v1/models for supplementary market rates
//    - Follows the 10:00 AM IST daily schedule + 24-hour manual refresh rule (guarded by CC auth)
//    - On any fetch/parse failure: uses last cached D1 values & surfaces a top red alert
// 2. Dynamic Intelligence Inheritance (Muse Contributor & DeepSeek Fast Variants):
//    - If a muse-*-contributor model has no intelligence score, inherits from base muse-spark-*
//    - If a deepseek-*-fast model has no intelligence score, inherits from base deepseek-*
// 3. Time-of-Day Flexible Pricing Support (Off-Peak vs Peak UTC Windows):
//    - Dynamically parses peak rates & UTC hour ranges from GOAT table cells
//    - Evaluates request timestamps against peak/off-peak UTC schedules for accurate token & turn math
// 4. 5-Hour ($14) & Weekly ($35) Rolling Counter Bars + Value/Break-Even Tracker:
//    - Live used ($ and %), remaining ($), and reset timers from rolling request ledger
//    - Pure GOAT Plan ($10.78 Paid) Value & Break-Even bar (Cache Excluded from Savings)
// 5. 4-Tab Blended UI Layout (Defaulting to "Billing Cycle" Everywhere):
//    - Tab 1 (Dashboard): 5h/Weekly + Value/Break-Even bars, Billing-Cycle-default KPIs & Per-Model table
//    - Tab 2 (Date-Wise & Trends): Shared Date Range Selector (Billing Cycle default) controlling both
//      Daily Spend Trend (IST) and Date-Wise Usage Breakdown (90-Day Rolling Window)
//    - Tab 3 (GOAT Advisor): Smart GOAT Plan Advisor & Next-Action Strategy (no brain icon) +
//      Full interactive table of all ~70 usable GOAT models with Smart Score, sorting & search
//    - Tab 4 (System Info): D1 row counts, storage, API/SQL latencies & 15-min sync status
// 6. Dismissible Top Alerts with 24-Hour Snooze (Synced in D1 across Laptop & Mobile)
// 7. Manual Refresh Modal (ADMIN_USER + ADMIN_PASS secrets, 2 Force Checkboxes, Cookie Fallback, Bookmarklet)
// 8. Viewport-Clamped Hover/Tap Info Tooltips with Complete Color & Gradient Explanations
// 2026-11-04:
// - The derived [UNMAPPED] banner line now has an alert key (tied to the exact
//   unmapped model set) and honours Dismiss 24h / Dismiss All. Its text no
//   longer implies a force-fetch always fixes it.
// DEPLOYED BUILD (2026-11-02 plan-aware pass):
// - PLAN-AWARE: the tracker is no longer GOAT-only. Every plan's credit windows
//   (Go 3/6, GOAT 14/35, Pro 16/40 ...), monthly pool and price are parsed from
//   the usage-limits docs; the active plan is detected by matching CC's live
//   windowLimits caps against that table (CC_PLAN env var overrides). The model
//   catalog is scraped from /docs/plans/<plan>, and a plan change forces a
//   re-scrape. Paid amount = plan price + 7.8% processing fee (PLAN_PAID_USD
//   overrides). Models without a listed allowance take the plan's "standard"
//   credits from the docs prose; speed/contributor variants no longer inherit
//   their base model's cap (docs: variants carry their own credits).
// - OpenRouter fetch removed: market-billed cost comes from the usage feed
//   itself (meta.totalCost); OpenRouter only padded the catalog with off-plan
//   models that the fuzzy lookup could mis-match (incl. free ones = 0 credits).
// - cc_seen_requests dropped: cc_request_credits (PK id) is the dedupe ledger,
//   and only the fetched IDs are checked (WHERE id IN ...) instead of loading
//   91 days of IDs every sync. Ledger retention 91 -> 8 days (feed spans 24h,
//   windows read 7d).
// - Bug fixes: canonical slugs no longer collapse repeated version numbers
//   (llama-3.3 -> llama-3, glm-4.4 -> glm-4); fuzzy lookup only matches a catalog
//   key that prefixes the usage slug at a token boundary; a re-scrape replaces
//   the catalog (delisted models disappear); a request's ledger + rollup writes
//   always land in the same D1 batch; feed gaps (>100 requests between syncs)
//   raise an alert; bookmarklet pushes no longer wipe sync errors/status;
//   cycle net savings respect unmapped rows; an expired window snapshot falls
//   back to ledger usage since the reset; Dismiss All covers derived alerts;
//   db:init targets the remote D1.
// - Perf: table counts computed at sync time (no COUNT(*) per page load), meta
//   read by key list (cookie never loaded on GET), page polling capped at one
//   /api/data fetch per 15 min; pagination loop, legacy migration, read-time
//   slug merge and old-cache self-heal paths removed.
// - UI: token columns collapsed to Total Tokens + Cache Hit %, one advisor pick,
//   four System Info cards, tooltips without hard-coded model figures.
// DEPLOYED BUILD (2026-11-01 review pass):
// - MODEL IDENTITY: deepseek-v4-flash / deepseek-v41-flash are NOT renames of the
//   "-fast" variants. CC now lists all four DeepSeek Flash models separately with
//   separate caps ($60 / $20 / $100 / $60), so LEGACY_MODEL_ALIASES no longer
//   collapses the base row into -fast. That alias both displayed the wrong model
//   name and priced the $100-cap row at the $60-cap burn rate (1.67x over-read).
// - OFFICIAL MODEL IDs: the GOAT table's display name is not the model id
//   ("Beam 1.0" ships as beam-free, "Qwen 3.8 Max" as qwen3-8-max). The parser now
//   keeps the /models/<id> link slug on each catalog entry and
//   lookupCatalogModel resolves it, so in-app usage stops being flagged
//   [UNMAPPED] and stops burning the 1x pool fallback.
// - WINDOW RESET: a cached windowLimits snapshot whose resetAt has already passed
//   belongs to the previous window. It now renders as an empty idle window instead
//   of pinning the bar at the old 100% (tracker showed "full" while CC was empty).
//   The diagnostics line also reports how old the cached window snapshot is.
// - Free catalog models are labelled Free in the per-model table instead of
//   "Unmapped (pool $)" and never take a pool-fallback burn.
// - PER-REQUEST CREDIT FREEZING: every newly observed request is written to
//   cc_request_credits with its model, sticker value, model cap, monthly pool,
//   credit weight and the resulting credits. Credits are no longer re-derived
//   from today's catalog on every page load, so an allowance change (DeepSeek
//   V4.1 Flash $60/$70 -> $100) only applies to requests served after it. The
//   daily rollup stores credits_consumed (-1 = row predates freezing, derive).
//   The 7-day rolling ledger is read from D1 (cc_request_credits) instead of the
//   old rolling_window_ledger_json meta blob, which retention deletes.
// - D1 UPGRADE REQUIRED for existing databases before deploying this build: run
//   the three statements in the "UPGRADING AN EXISTING DATABASE" block of schema.sql.
// DEPLOYED BUILD (2026-10-27 review fixes + 2026-10-27 window-accuracy pass):
// - Weekly reset renders Xd Yh (not raw 125.3h); reset timers anchor on the OLDEST
//   request of any kind (billable, free, tool ping, $0) — CC opens each window on
//   the first request, so billable-only anchoring read ~1 day long. usedCredits
//   still counts billable pool drain only.
// - Window caps parsed as CREDITS from usage-limits prose ("14 credits in any
//   5 hours and 35 in any 7 days"); the Limits table's $20/$50/$100 are
//   usage-dollars on a $100 model and convert via x70/monthly. Pool stays 70,
//   so a $10-cap model burns 7x. Stale 20/50/100 caches self-heal + force refetch.
// - Canonical slugs (provider prefixes, doubled tokens, dotted versions) at every
//   layer + one-time D1 migration merging legacy raw rows; per-model tables can
//   no longer split one model into provider-prefixed duplicates. Genuine renames
//   live in LEGACY_MODEL_ALIASES (empty today - see the 2026-11-01 note above).
// - Sync coverage (pages fetched, total entries, truncated flag, window span,
//   top credit consumers) stored per sync and shown in System Info, so a
//   truncated 7-day backfill is visible instead of a silent undercount.
// - Free models drain 0 credits in rolling windows (was weight=1 via fallback).
// - Unmapped models use monthlyPool fallback cap + unmapped flag; net savings
//   neutral (0) when no cap known instead of inflating ROI by plan_cost.
// - lookupCatalogModel: exact match first, then longest-prefix (was first-hit).
// - Pagination 50 pages x 200 (10000 entries); forced refresh backfills the full 7d,
//   and a previously-truncated sync auto-backfills on the next cron, so a short
//   backfill can't silently undercount the weekly bar / stretch the reset.
// - Cap inheritance: muse-*-contributor and deepseek-*-fast variants inherit the base
//   model's monthlyCapUsd when missing (variant_cap_inheritance_ts pass) - the old
//   pool-fallback 1x burn under-read capped variants.
// - Daily rows merge by canonical key at read time, and the legacy-row migration
//   runs on forced refresh. (Only confirmed renames belong in LEGACY_MODEL_ALIASES;
//   DeepSeek Flash variants are separate models - see the 2026-11-01 note.)
// - UI separators are plain ASCII (|, ->, -) so a Latin-1 decode can't mojibake them.
// - XSS: escHtml/escAttr on all catalog/alert/model strings; dismiss via
//   data-attribute + listener instead of inline onclick string concat.
// - COOKIE TOKEN FIX (2026-10-28): Command Code rotates its
//   __Secure-commandcode_prod_.session_token server-side, so a pasted static
//   copy authenticated exactly one sync and 401'd on every later one
//   ("updated once then immediately expired", identical on mobile & laptop
//   because both paste into the same D1 override_cookie slot). Every
//   authenticated /internal/* response is now scanned for Set-Cookie and a
//   rotated token is spliced back into override_cookie IN PLACE (other pasted
//   cookies like cf_clearance are preserved) + override_cookie_rotated_ts meta,
//   keeping the worker's copy in lockstep with the live session.
// - /api/refresh previously returned ok:true even when the CC sync itself 401'd
//   (modal said "Synced!" while the badge showed expired); it now surfaces the
//   real sync error in the modal message.
// - SETTINGS/REMEDIATION (2026-10-28 pass 2): live probing confirmed missing
//   and invalid tokens return the SAME "You're logged out" UNAUTHORIZED body,
//   so a dead token and a bad paste are indistinguishable from the 401 alone.
//   Every sync now persists one auth snapshot (last_auth_probe_json): per-endpoint
//   statuses (/internal/usage, /internal/billing/credits + which auth source
//   answered, /internal/usage/by-model), a cookie fingerprint (length, session-
//   pair presence, last-4 chars - never the token itself) and whether CC rotated
//   the token. Shown in System Info and the refresh modal; 401 bodies quoted up
//   to 240 chars (was 80).
// - BOOKMARKLET PUSH PASS (2026-10-28 pass 3): the user's cookie-update
//   bookmarklet targeted a pre-modification file ("working till yesterday",
//   previous js lost). /api/push now ALSO accepts windowLimits + byModel pushed
//   from inside the logged-in commandcode.ai session (credentials:'include') -
//   HttpOnly cookies can't be read by any bookmarklet, but they ARE sent on its
//   fetches, so the 5h/weekly bars + top-consumer diagnostics stay exactly
//   fresh with ZERO dependence on override_cookie. The modal's Copy Mobile
//   Bookmarklet now generates that full push (usage + window bars + by-model).
// - BOOKMARKLET PASS 4 (2026-10-28): void() wrapper (iOS Safari page-blank
//   guard) + per-endpoint statuses echoed in the alert (usage / bars / by-model
//   / push) so a mobile failure self-identifies instead of a bare "+0". Push
//   now also carries the by-model billing window. SUMMARY_API 401 alert now
//   says exactly how to re-paste a rotated CC_API_KEY (alpha key rotates on
//   CLI re-login; auth.json has no expiry field - verified 2026-10-28).
// - Date ranges: 7d/30d/90d inclusive fix (-6/-29/-89); retention + dashboard
//   use JS-computed IST cutoffs (was UTC date('now') vs IST usage_date).
//   daysLeft clamps to 0 (was max 1); frontend uses ?? so 0 renders.
// - Transient MISSING_MODEL / WINDOW_CAPS_MISSING no longer mutate persisted
//   syncErrors; caps-missing is a single stable-key alert.
// - LIVE WINDOW STATE (2026-10-27, verified against api.commandcode.ai):
//   /internal/usage hard-caps limit at 100 (limit=200 => HTTP 400, which killed
//   every sync) and only ever serves the last 100 entries of the last 24h with
//   NO cursor pagination - a 7-day ledger backfill from it is impossible. The
//   5h/weekly bars now mirror CC's own authoritative window state from
//   /internal/billing/credits windowLimits (session cookie; /alpha/billing/credits
//   API-key fallback): exact used/cap/resetAt for both windows + monthly pool.
//   The request ledger remains only as a fallback estimate and for 5h/per-model
//   diagnostics. Credit weighting (70 / model monthlyCap) was re-verified live
//   against /internal/usage/by-model consumedMonthlyCredits.
// ============================================================================

const BUILTIN_TOOLS = new Set(["web-search", "web-fetch", "code-search", "mcp-tool"]);
// Confirmed renames ONLY: slugs that identify the SAME model under an old name.
// Do NOT alias model variants together. Command Code ships four distinct DeepSeek
// Flash models today - V4 Flash, V4 Flash Fast, V4.1 Flash and V4.1 Flash Fast -
// with different monthly caps ($60 / $20 / $100 / $60). Merging the base row into
// its "-fast" variant mislabels the dashboard AND paces credits against the wrong
// cap (70/60 instead of 70/100 = a 1.67x over-read of the weekly window).
const LEGACY_MODEL_ALIASES = {};
// Command Code's session cookie. CC rotates this token server-side, so any
// static pasted copy goes stale fast - captureSessionCookieRotation() keeps the
// stored copy current from Set-Cookie response headers.
const SESSION_COOKIE_NAME = "__Secure-commandcode_prod_.session_token";
const CACHE_TTL_MS = 15 * 60 * 1000;            // 15 minutes usage auto-refresh TTL (matches 15m Cron)
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;     // 24 hours pricing/catalog & alert snooze TTL
// Bump when the catalog parser changes shape (keys, ids, caps). One sync after a
// deploy re-scrapes the docs regardless of the 10 AM IST rule, so a cached catalog
// written by an older parser can't keep mis-pricing models for a day.
const CATALOG_SCHEMA_VERSION = "2026-11-02-plan-aware";
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;       // 5-hour rolling window
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;  // 7-day weekly rolling window
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;     // UTC+05:30 (India Standard Time)
// Subscriptions are charged price + processing fee (GOAT: $10.00 + $0.78). The
// fee is not in the docs, so it is applied as a rate; PLAN_PAID_USD overrides.
const PROCESSING_FEE_RATE = 0.078;
const DEFAULT_PLAN_KEY = "goat";                // Used until the plan can be detected
const USAGE_FEED_LIMIT = 100;                   // /internal/usage hard-caps limit at 100 (limit > 100 => HTTP 400)
const STATEMENTS_PER_REQUEST = 2;               // ledger insert + daily rollup upsert
// D1 caps a batch at 100 statements; keep it a multiple of STATEMENTS_PER_REQUEST
// so one request's ledger row and rollup upsert always commit together.
const INGEST_BATCH_SIZE = Math.floor(100 / STATEMENTS_PER_REQUEST) * STATEMENTS_PER_REQUEST;
const D1_MAX_BOUND_PARAMS = 90;                 // stay under D1's 100 bound-parameter limit
const DOC_CACHE_OPTS = { cf: { cacheTtl: 86400 } }; // 24h edge cache for docs (still gated by 10AM IST rule)
const SYNC_LEASE_MS = 90 * 1000;                // D1 lease held by a running sync / ingest
const SYNC_LEASE_WAIT_MS = 10 * 1000;           // Manual refresh + bookmarklet push wait this long for the lease
const SYNC_RETRY_FLOOR_MS = 5 * 60 * 1000;      // Do not re-attempt a failed sync more often than this
const ROLLUP_RETENTION_DAYS = 90;               // cc_daily_model_usage window
// The usage feed (and bookmarklet push) only ever returns the last 24h, and the
// rolling windows read 7 days, so per-request ledger rows older than 8 days are
// neither re-fetchable (dedupe) nor read.
const LEDGER_RETENTION_DAYS = 8;
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000; // Run retention DELETEs at most once per day
// Meta keys the dashboard reads. Never SELECT * from cc_meta on a GET: it holds
// the session cookie, which no page render needs.
const DASHBOARD_META_KEYS = [
  "model_pricing_json", "plan_info_json", "window_limits_json", "cc_by_model_json",
  "billing_summary_json", "dismissed_alerts_json", "sync_errors_json",
  "last_sync_ts", "last_sync_status", "last_latencies_json", "last_sync_coverage_json",
  "last_auth_probe_json", "last_catalog_sync_ts", "table_counts_json",
  "last_push_ts", "last_push_status"
];
// Meta keys written by earlier builds that nothing reads any more; the daily
// retention pass deletes them.
const OBSOLETE_META_KEYS = [
  "rolling_window_ledger_json", "intelligence_inheritance_ts", "variant_cap_inheritance_ts",
  "goat_window_caps_json", "last_price_sync_ts", "last_price_sync_date_ist"
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://commandcode.ai",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
};

// Timing-safe admin auth against env secrets. Set ADMIN_USER + ADMIN_PASS
// (plain-text, stored as an encrypted Secret) in Worker Settings → Variables and Secrets.
function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(String(a ?? ""));
  const y = enc.encode(String(b ?? ""));
  if (x.byteLength !== y.byteLength) return false;
  if (typeof crypto.subtle.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(x, y);
  }
  let diff = 0;
  for (let i = 0; i < x.byteLength; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
function isAuthorizedAdmin(body, env) {
  const expectedUser = (env.ADMIN_USER || "").trim();
  const expectedPass = (env.ADMIN_PASS || "");
  if (!expectedUser || !expectedPass) return false;
  const user = String(body.username || "").trim();
  const pw = String(body.password ?? "");
  return timingSafeEqual(user, expectedUser) && timingSafeEqual(pw, expectedPass);
}

function sleepMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Cross-isolate mutation lock. The lease self-expires after SYNC_LEASE_MS so a crashed
// isolate can never wedge syncing forever. Returns the lease token on success, else null.
async function acquireSyncLease(db, waitMs = 0, recordAttempt = true) {
  const deadline = Date.now() + Math.max(0, waitMs);
  while (true) {
    const now = Date.now();
    const leaseToken = String(now + SYNC_LEASE_MS);
    const res = await db.prepare(
      `INSERT INTO cc_meta (key, value) VALUES ('sync_lock_lease', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value
       WHERE CAST(cc_meta.value AS INTEGER) < ?`
    ).bind(leaseToken, now).run();
    const changes = res && res.meta ? res.meta.changes : undefined;
    // Fail open if the runtime omits `changes`; otherwise only the winner of the
    // conditional upsert (changes > 0) may proceed.
    const acquired = changes === undefined ? true : changes > 0;
    if (acquired) {
      if (recordAttempt) { try { await setMeta(db, "last_sync_attempt_ts", String(now)); } catch (_) {} }
      return leaseToken;
    }
    if (Date.now() >= deadline) return null;
    await sleepMs(250);
  }
}

// Only clear the lease if it is still the one we acquired (another isolate may have
// taken over after our own lease expired mid-run).
async function releaseSyncLease(db, leaseToken) {
  if (!leaseToken) return;
  try {
    await db.prepare(`UPDATE cc_meta SET value = '0' WHERE key = 'sync_lock_lease' AND value = ?`)
      .bind(leaseToken).run();
  } catch (_) {}
}

// Decides whether a GET handler should kick off a sync. The retry floor keeps a dead
// cookie from triggering a fresh API call on every single page load.
async function getSyncTriggerState(db) {
  const meta = await getMetaMany(db, ["last_sync_ts", "last_sync_attempt_ts"]);
  const lastSync = Number(meta.last_sync_ts) || 0;
  const lastAttempt = Number(meta.last_sync_attempt_ts) || 0;
  const ageMs = lastSync ? Date.now() - lastSync : 0;
  const due = lastSync === 0 || ageMs >= CACHE_TTL_MS;
  const coolingDown = lastAttempt > 0 && (Date.now() - lastAttempt) < SYNC_RETRY_FLOOR_MS;
  return { lastSync, ageMs, due: due && !coolingDown, coldStart: lastSync === 0 };
}

export default {
  // 1. Background 15-Min Cron Trigger
  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncUsageData(env, false, false));
  },

  // 2. HTTP Request Handler
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const edgeColo = (request.cf && request.cf.colo) ? request.cf.colo : "UNKNOWN";

    // Handle CORS preflight for Perspective C (Mobile/Desktop Bookmarklet on commandcode.ai)
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // Database Initialization (CREATE TABLE statements removed per Step 3 optimization)

      // Endpoint A: Manual Refresh (Requires ADMIN_USER + ADMIN_PASS env secrets + 2 Force Checkboxes)
      if (url.pathname === "/api/refresh" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (!isAuthorizedAdmin(body, env)) {
          return jsonResponse({ ok: false, error: "Invalid credentials" }, 401);
        }

        // Optional: allow updating session cookie directly from UI without touching Cloudflare dashboard
        if (body.cookie && body.cookie.trim().length > 10) {
          await setMeta(env.DB, "override_cookie", body.cookie.trim());
        }

        const forceCatalogSync = Boolean(body.forceCatalogSync);
        const syncResult = await syncUsageData(env, true, forceCatalogSync);
        if (syncResult && syncResult.busy) {
          return jsonResponse({ ok: false, error: syncResult.error }, 409);
        }
        const dashboardData = await getDashboardAggregates(env.DB, edgeColo);
        return jsonResponse({ ok: true, syncResult, data: dashboardData });
      }

      // Endpoint A2: Dismiss Alert for 24 Hours (Persisted in D1 across Laptop & Mobile)
      if (url.pathname === "/api/dismiss-alert" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (!isAuthorizedAdmin(body, env)) {
          return jsonResponse({ ok: false, error: "Invalid credentials" }, 401);
        }
        // Dismiss All sends the keys of every alert the page shows (persisted sync
        // errors AND derived alerts such as WINDOW_CAPS_MISSING / USAGE_FEED_GAP),
        // so nothing it displayed reappears on the next load.
        const alertKeys = Array.isArray(body.alertKeys)
          ? body.alertKeys.map(k => String(k || "").trim()).filter(Boolean).slice(0, 50)
          : [];
        const alertKey = String(body.alertKey || "").trim();
        if (alertKey) alertKeys.push(alertKey);
        if (alertKeys.length > 0) {
          const meta = await getMetaMany(env.DB, ["dismissed_alerts_json", "sync_errors_json"]);
          const map = safeJsonParse(meta.dismissed_alerts_json, {});
          const now = Date.now();
          for (const [k, exp] of Object.entries(map)) {
            if (exp <= now) delete map[k];
          }
          for (const k of alertKeys) {
            if (k === "__ALL__") {
              for (const e of safeJsonParse(meta.sync_errors_json, [])) map[makeAlertKey(e)] = now + CATALOG_TTL_MS;
            } else {
              map[k] = now + CATALOG_TTL_MS;
            }
          }
          await setMeta(env.DB, "dismissed_alerts_json", JSON.stringify(map));
        }
        return jsonResponse({ ok: true });
      }

      // Endpoint A3: Perspective C Bookmarklet Push (Direct ingest from commandcode.ai session)
      if (url.pathname === "/api/push" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (!isAuthorizedAdmin(body, env)) {
          return jsonResponse({ ok: false, error: "Invalid credentials" }, 401, CORS_HEADERS);
        }
        const leaseToken = await acquireSyncLease(env.DB, SYNC_LEASE_WAIT_MS);
        if (!leaseToken) {
          return jsonResponse({ ok: false, error: "Another sync is already running. Please retry in a few seconds." }, 409, CORS_HEADERS);
        }
        try {
          const usages = Array.isArray(body.usages) ? body.usages : [];
          // Browser-pushed window state: the bookmarklet runs inside the logged-in
          // commandcode.ai session, so /internal/billing/credits answers with the
          // LIVE cookie. Storing it here makes the 5h/weekly bars exact with ZERO
          // dependence on the stored override_cookie - the whole tracker runs off
          // session-cookie-free pushes when the pasted copy is dead.
          if (body.windowLimits && typeof body.windowLimits === "object"
            && body.windowLimits.fiveHour && body.windowLimits.weekly
            && Number(body.windowLimits.fiveHour.cap) > 0 && Number(body.windowLimits.weekly.cap) > 0) {
            const wlIn = body.windowLimits;
            await setMeta(env.DB, "window_limits_json", JSON.stringify({
              fiveHour: { used: Number(wlIn.fiveHour.used) || 0, cap: Number(wlIn.fiveHour.cap) || 0, resetAt: Number(wlIn.fiveHour.resetAt) || 0 },
              weekly: { used: Number(wlIn.weekly.used) || 0, cap: Number(wlIn.weekly.cap) || 0, resetAt: Number(wlIn.weekly.resetAt) || 0 },
              monthlyUsed: Number(wlIn.monthlyUsed) || 0,
              monthlyGranted: (wlIn.monthlyGranted !== null && wlIn.monthlyGranted !== undefined) ? Number(wlIn.monthlyGranted) : null,
              fetchedAt: Date.now(),
              source: "bookmarklet-push"
            }));
          }
          // Per-model credit attribution pushed from the browser session.
          if (Array.isArray(body.byModel) && body.byModel.length > 0) {
            await setMeta(env.DB, "cc_by_model_json", JSON.stringify({
              window: body.byModelWindow || null,
              data: body.byModel.map(r => ({
                model: canonicalModelSlug((r && r.model) || "unknown"),
                requests: Number(r.requests) || 0,
                creditsTotal: Number(r.creditsTotal) || 0,
                consumedMonthlyCredits: Number(r.consumedMonthlyCredits) || 0
              }))
            }));
          }
          const pushMeta = await getMetaMany(env.DB, ["model_pricing_json", "plan_info_json"]);
          const catalogMap = safeJsonParse(pushMeta.model_pricing_json, {});
          const plan = safeJsonParse(pushMeta.plan_info_json, null);
          const seenSet = await getSeenIds(env.DB, usages.map(u => u && u.id));
          const { newRecordsCount } = await ingestUsageItems(env.DB, usages, seenSet, catalogMap, [], planPool(plan));
          // A push is not a cron sync: it must not clear the persisted sync errors,
          // the auth status badge or the latency stats (a dead cookie would show
          // green). It records its own result and refreshes the row counts only.
          await setMetaMany(env.DB, {
            last_push_ts: String(Date.now()),
            last_push_status: `OK (+${newRecordsCount} new requests)`,
            table_counts_json: JSON.stringify(await computeTableCounts(env.DB))
          });
          return jsonResponse({ ok: true, newRecordsCount }, 200, CORS_HEADERS);
        } finally {
          await releaseSyncLease(env.DB, leaseToken);
        }
      }

      // Endpoint B: JSON Data API (stale-while-revalidate, except on cold start)
      if (url.pathname === "/api/data") {
        const syncState = await getSyncTriggerState(env.DB);
        let syncResult = { skipped: true, background: false, ageMinutes: Math.round(syncState.ageMs / 60000) };

        if (syncState.due) {
          if (syncState.coldStart) {
            syncResult = await syncUsageData(env, false, false);
          } else {
            ctx.waitUntil(syncUsageData(env, false, false));
            syncResult = { skipped: false, background: true, ageMinutes: Math.round(syncState.ageMs / 60000) };
          }
        }

        const dashboardData = await getDashboardAggregates(env.DB, edgeColo);
        return jsonResponse({ ok: true, syncResult, data: dashboardData });
      }

      // Endpoint C: Root Webpage (Full Dashboard UI, stale-while-revalidate)
      if (url.pathname === "/") {
        const syncState = await getSyncTriggerState(env.DB);
        if (syncState.due) {
          if (syncState.coldStart) {
            await syncUsageData(env, false, false);
          } else {
            ctx.waitUntil(syncUsageData(env, false, false));
          }
        }
        const dashboardData = await getDashboardAggregates(env.DB, edgeColo);
        return new Response(renderDashboardHtml(makeSlimDashboardPayload(dashboardData)), {
          headers: { "Content-Type": "text/html; charset=utf-8", ...SECURITY_HEADERS }
        });
      }

      return jsonResponse({ ok: false, error: "Not found" }, 404);
    } catch (err) {
      try { console.error("WORKER_RUNTIME", err && err.stack ? err.stack : err); } catch (_) {}
      await recordSystemError(env.DB, "WORKER_RUNTIME", err.message);
      return jsonResponse({ ok: false, error: err.message }, 500, CORS_HEADERS);
    }
  }
};

// ============================================================================
// Core Sync Engine: Paginates /internal/usage, Syncs Catalog/Pricing & Windows
// ============================================================================
// Per-isolate dedupe: concurrent page loads share one background sync instead of
// each starting their own. Forced runs wait for the shared run, then execute.
let inFlightSync = null;

async function syncUsageData(env, forced = false, forceCatalogSync = false) {
  const background = !forced && !forceCatalogSync;
  if (background) {
    if (inFlightSync) return inFlightSync;
    inFlightSync = runSyncUsageData(env, forced, forceCatalogSync)
      .finally(() => { inFlightSync = null; });
    return inFlightSync;
  }
  if (inFlightSync) { try { await inFlightSync; } catch (_) {} }
  return runSyncUsageData(env, forced, forceCatalogSync);
}

async function runSyncUsageData(env, forced = false, forceCatalogSync = false) {
  const leaseToken = await acquireSyncLease(env.DB, forced ? SYNC_LEASE_WAIT_MS : 0);
  if (!leaseToken) {
    return { ok: false, busy: true, error: "A sync is already in progress. Please retry in a few seconds." };
  }
  try {
    return await syncUsageDataUnlocked(env, forced, forceCatalogSync);
  } finally {
    await releaseSyncLease(env.DB, leaseToken);
  }
}

async function syncUsageDataUnlocked(env, forced = false, forceCatalogSync = false) {
  const db = env.DB;
  const syncErrors = [];
  const latencies = {
    usageApiMs: 0,
    summaryApiMs: 0,
    catalogApiMs: 0,
    sqlWriteMs: 0
  };

  const savedCookie = await getMeta(db, "override_cookie");
  const rawCookie = savedCookie || env.CC_COOKIE || "";

  if (!rawCookie) {
    await recordSystemError(db, "AUTH_MISSING", "CC_COOKIE secret is not set.");
    return { ok: false, warning: "CC_COOKIE secret is not set yet." };
  }

  // Ensure cookie has key=value format if user only pasted the token value
  const cookieHeader = rawCookie.includes("=")
    ? rawCookie
    : `${SESSION_COOKIE_NAME}=${rawCookie}`;

  // One durable auth snapshot per sync: endpoint statuses + cookie fingerprint
  // (never the token itself) + whether CC rotated the token. Shown in System Info.
  const authProbe = {
    ts: Date.now(),
    cookie: cookieFingerprint(cookieHeader),
    windowStatus: null,
    windowSource: null,
    byModelStatus: null,
    usageStatus: null,
    rotated: false
  };

  // Authoritative 5h/weekly window state + per-model credit attribution come
  // straight from CC's billing service (session cookie, API-key fallback).
  // Fetched BEFORE the usage feed so an expired cookie still refreshes the bars
  // via the alpha route even when /internal/usage 401s. The window caps are
  // also what identifies the active plan (see detectPlan).
  let windowLimits = null;
  let byModelPeriod = null;
  try {
    windowLimits = await fetchCcWindowLimits(cookieHeader, env, authProbe);
    if (windowLimits) await setMeta(db, "window_limits_json", JSON.stringify(windowLimits));
    byModelPeriod = await fetchCcByModelPeriod(db, cookieHeader, authProbe);
    if (byModelPeriod) await setMeta(db, "cc_by_model_json", JSON.stringify(byModelPeriod));
  } catch (wlErr) {
    syncErrors.push({ source: "WINDOW_LIMITS", code: "EX", message: `Window limits fetch error: ${wlErr && wlErr.message}. Ledger estimate will be used.`, ts: new Date().toISOString() });
  }

  // /internal/usage serves at most the last 100 entries of the last 24h, with
  // no cursor pagination: one request per sync is all there is.
  const apiUrl = new URL("https://api.commandcode.ai/internal/usage");
  apiUrl.searchParams.set("limit", String(USAGE_FEED_LIMIT));
  const t0 = performance.now();
  const resp = await fetch(apiUrl.toString(), {
    headers: {
      "Accept": "application/json",
      "Cookie": cookieHeader,
      "Origin": "https://commandcode.ai",
      "Referer": "https://commandcode.ai/",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"
    }
  });
  latencies.usageApiMs = Math.round(performance.now() - t0);

  // A rotated session token minted on ANY response (even a 401's recovery
  // flow) is persisted for the next sync - this is what keeps a static
  // pasted copy from going stale between cron runs.
  const rotatedThisSync = await captureSessionCookieRotation(db, resp, cookieHeader, authProbe);
  authProbe.usageStatus = resp.status;

  if (!resp.ok) {
    const errText = await resp.text();
    const errMsg = `Usage API HTTP ${resp.status}: Session token expired or invalid. CC rotates its session token, so a pasted copy goes stale quickly - re-paste the current __Secure-commandcode_prod_.session_token via Manual Refresh. (${errText.slice(0, 240)})`;
    syncErrors.push({ source: "USAGE_API", code: String(resp.status), message: errMsg, ts: new Date().toISOString() });
    // Persist the auth snapshot on the error exit too - this is the state the
    // System Info probe card needs to explain a dead/bad paste.
    await setMetaMany(db, {
      last_sync_status: `ERR_AUTH HTTP ${resp.status}`,
      sync_errors_json: JSON.stringify(syncErrors),
      last_auth_probe_json: JSON.stringify(authProbe)
    });
    // Guard: Never fetch external pricing or model catalogs when Command Code token is expired
    return { ok: false, status: resp.status, error: errMsg, authProbe };
  }

  let usages = [];
  try {
    const payload = await resp.json();
    usages = Array.isArray(payload.usages) ? payload.usages : [];
  } catch (parseErr) {
    syncErrors.push({ source: "USAGE_PARSE", code: "JSON", message: `Failed to parse /internal/usage JSON: ${parseErr.message}`, ts: new Date().toISOString() });
  }
  await setMeta(db, "last_auth_probe_json", JSON.stringify(authProbe));

  // Dedupe against the per-request ledger for exactly the IDs this page holds.
  const seenSet = await getSeenIds(db, usages.map(u => u && u.id));

  // Sync coverage diagnostics. A full page (100 entries) with no request this
  // tracker has already seen means more than 100 requests happened since the
  // last sync/push: the ones in between are gone from the feed for good.
  const fetchedTsList = usages
    .map(u => (u && u.createdAt ? new Date(u.createdAt).getTime() : NaN))
    .filter(t => Number.isFinite(t));
  const hasSeen = usages.some(u => u && u.id && seenSet.has(u.id));
  const ledgerEmpty = await isLedgerEmpty(db);
  const gapSuspected = usages.length >= USAGE_FEED_LIMIT && !hasSeen && !ledgerEmpty;
  const coverageInfo = {
    totalFetched: usages.length,
    gapSuspected,
    oldestFetchedIso: fetchedTsList.length ? new Date(Math.min(...fetchedTsList)).toISOString() : null,
    newestFetchedIso: fetchedTsList.length ? new Date(Math.max(...fetchedTsList)).toISOString() : null
  };
  if (gapSuspected) {
    syncErrors.push({
      source: "USAGE_FEED_GAP",
      code: "GAP",
      message: `The usage feed returned ${usages.length} requests and none were seen before, so requests made before ${coverageInfo.oldestFetchedIso} since the last sync are missing from the daily tables. The 5h/weekly bars are unaffected (they mirror CC). Push from the bookmarklet more often during heavy use.`,
      ts: new Date().toISOString()
    });
  }

  // Plan detection + dynamic catalog sync (guarded: only after CC auth succeeded).
  const catRes = await maybeSyncDynamicCatalog(db, env, forced, forceCatalogSync, windowLimits);
  latencies.catalogApiMs = catRes.catalogLatencyMs || 0;
  const catalogMap = catRes.catalogMap;
  const plan = catRes.plan;
  if (catRes.errors && catRes.errors.length > 0) syncErrors.push(...catRes.errors);

  // Ingest into D1: per-request credit ledger + daily rollup. The credit basis
  // is the active plan's monthly pool, read AFTER the catalog sync so a
  // same-sync allowance or plan change is already reflected in frozen credits.
  let newRecordsCount = 0;
  let lastDbMeta = null;
  if (usages.length > 0) {
    try {
      const batchResult = await ingestUsageItems(db, usages, seenSet, catalogMap, syncErrors, planPool(plan));
      newRecordsCount = batchResult.newRecordsCount;
      latencies.sqlWriteMs = batchResult.writeLatencyMs;
      lastDbMeta = batchResult.dbMeta;
    } catch (ingestErr) {
      // Most likely an unapplied schema upgrade (see schema.sql): a missing
      // cc_request_credits table or credits_consumed column fails the whole
      // batch. Surface it as an alert instead of letting the cron die silently.
      syncErrors.push({
        source: "DB_SCHEMA",
        code: "INGEST",
        message: `Per-request ingest failed: ${ingestErr && ingestErr.message}. If this mentions a missing table/column, run the upgrade statements in schema.sql, then redeploy.`,
        ts: new Date().toISOString()
      });
    }
  }

  const nowTs = await enforceRetentionAndMeta(env, newRecordsCount, "OK", {
    latencies,
    syncErrors,
    dbMeta: lastDbMeta,
    coverageInfo,
    cookieHeader
  });

  return {
    ok: true,
    forced,
    forceCatalogSync,
    plan: plan ? plan.name : null,
    totalFetched: usages.length,
    gapSuspected,
    newRecordsCount,
    latencies,
    errorsCount: syncErrors.length,
    cookieRotated: rotatedThisSync,
    authProbe,
    syncedAt: new Date(nowTs).toISOString()
  };
}

// ============================================================================
// Plan Detection (Go / GOAT / Pro / Max ...) from the usage-limits docs
// ============================================================================
// The billing API returns window caps but no plan name. The usage-limits docs
// state every plan's caps in CREDITS ("14 credits in any 5 hours and 35 in any 7
// days" for GOAT, "3 ... and 6" for Go), so the live caps identify the plan.
// CC_PLAN (e.g. "go") overrides detection. Plan keys match the plan docs URL
// (/docs/plans/<key>).
function planKeyFromName(name) {
  return String(name || "").toLowerCase().replace(/×/g, "x").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function detectPlan(env, windowLimits, plansTable, previousPlan) {
  const plans = plansTable || {};
  const forcedKey = planKeyFromName(env && env.CC_PLAN);
  let key = null;
  let source = null;
  if (forcedKey) {
    key = forcedKey;
    source = "env CC_PLAN";
  } else if (windowLimits && windowLimits.fiveHour && windowLimits.weekly) {
    const cap5h = Number(windowLimits.fiveHour.cap);
    const capW = Number(windowLimits.weekly.cap);
    const matches = Object.values(plans).filter(p => p.fiveHourCredits === cap5h && p.weeklyCredits === capW);
    if (matches.length === 1) { key = matches[0].key; source = "live window caps"; }
  }
  if (!key && previousPlan && previousPlan.key) { key = previousPlan.key; source = previousPlan.source || "previous detection"; }
  if (!key) { key = DEFAULT_PLAN_KEY; source = "default"; }

  const base = plans[key] || (previousPlan && previousPlan.key === key ? previousPlan : null) || { key, name: key.toUpperCase() };
  const priceUsd = Number.isFinite(Number(base.priceUsd)) ? Number(base.priceUsd) : null;
  const paidOverride = Number(env && env.PLAN_PAID_USD);
  const paidUsd = paidOverride > 0
    ? paidOverride
    : (priceUsd !== null ? Number((priceUsd * (1 + PROCESSING_FEE_RATE)).toFixed(2)) : null);
  return {
    key,
    name: base.name || key.toUpperCase(),
    priceUsd,
    paidUsd,
    fiveHourCredits: base.fiveHourCredits ?? null,
    weeklyCredits: base.weeklyCredits ?? null,
    monthlyPoolCredits: base.monthlyPoolCredits ?? null,
    perModelCredits: base.perModelCredits !== false,
    standardCapUsd: (previousPlan && previousPlan.key === key) ? (previousPlan.standardCapUsd ?? null) : null,
    source,
    detectedAt: Date.now()
  };
}

function planPool(plan) {
  return (plan && Number(plan.monthlyPoolCredits) > 0) ? Number(plan.monthlyPoolCredits) : 70;
}

// Parses https://commandcode.ai/docs/resources/usage-limits into a per-plan map.
//  - "Limits by plan" table: Plan | Your cost | Monthly credits | 5-hour cap | Weekly cap
//    gives price and, for plans where 1 credit = $1 (Max, Team), the caps + pool.
//  - The prose is the source of truth for usage-value plans (Go/GOAT/Pro), whose
//    table cells are usage-DOLLARS on the best-allowance model, not credits:
//    "<Plan> ... N credits in any 5 hours and M in any 7 days ... out of a P-credit
//    monthly pool" or "... or $N / $M on a $P model".
function parsePlanLimitsHtml(html) {
  const plans = {};
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tm;
  while ((tm = tableRegex.exec(String(html || ""))) !== null) {
    const headers = [];
    const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
    let th;
    while ((th = thRegex.exec(tm[1])) !== null) headers.push(stripHtml(th[1]).toLowerCase());
    const idxCost = headers.findIndex(h => /cost|price/.test(h));
    const idxMonth = headers.findIndex(h => /month/.test(h));
    const idx5h = headers.findIndex(h => /5-hour|5 hour|5h/.test(h));
    const idxWeek = headers.findIndex(h => /week/.test(h));
    if (idxCost === -1 || idx5h === -1 || idxWeek === -1) continue;
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm;
    while ((rm = rowRegex.exec(tm[1])) !== null) {
      const cells = [];
      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let td;
      while ((td = tdRegex.exec(rm[1])) !== null) cells.push(stripHtml(td[1]));
      if (cells.length <= Math.max(idxCost, idx5h, idxWeek) || !cells[0]) continue;
      const name = cells[0].trim();
      const key = planKeyFromName(name);
      if (!key) continue;
      // Table caps double as credit caps only where credits are plain dollars;
      // prose overrides them below for usage-value plans.
      plans[key] = {
        key,
        name,
        priceUsd: extractLastDollarNumber(cells[idxCost]),
        monthlyPoolCredits: idxMonth !== -1 ? extractLastDollarNumber(cells[idxMonth]) : null,
        fiveHourCredits: extractLastDollarNumber(cells[idx5h]),
        weeklyCredits: extractLastDollarNumber(cells[idxWeek]),
        perModelCredits: false
      };
    }
  }

  const text = stripHtml(String(html || "").replace(/&nbsp;|&#160;/g, " ")).replace(/&#36;|&#x24;/gi, "$");
  const proseRe = /\b(Go|GOAT|Pro|Max(?:\s*\d+\s*[x×])?|Team Pro)\b[^.]{0,120}?(\d+(?:\.\d+)?)\s*credits?\s+in\s+any\s+5\s*hours?\s+and\s+(\d+(?:\.\d+)?)\s+in\s+any\s+7\s+days?(?=([^]{0,400}))/gi;
  let pm;
  while ((pm = proseRe.exec(text)) !== null) {
    const key = planKeyFromName(pm[1]);
    const fiveH = Number(pm[2]);
    const week = Number(pm[3]);
    // Only read the pool from this plan's own paragraph (stop at the next plan's).
    const tail = pm[4].split(/\b(?:Go|GOAT|Pro|Max)\s+(?:runs|works|is)\b/)[0];
    let pool = null;
    const poolMatch = tail.match(/(\d+(?:\.\d+)?)-credit\s+monthly\s+pool/i);
    if (poolMatch) pool = Number(poolMatch[1]);
    if (pool === null) {
      // "$14 / $35 on a $70 model": the model whose allowance equals the pool
      // converts credits 1:1, so its allowance IS the monthly pool.
      const re = /\$(\d+(?:\.\d+)?)\s*\/\s*\$(\d+(?:\.\d+)?)\s+on\s+an?\s+\$(\d+(?:\.\d+)?)\s+model/gi;
      let mm;
      while ((mm = re.exec(tail)) !== null) {
        if (Number(mm[1]) === fiveH && Number(mm[2]) === week) { pool = Number(mm[3]); break; }
      }
    }
    const prev = plans[key] || { key, name: pm[1], priceUsd: null };
    plans[key] = {
      ...prev,
      fiveHourCredits: fiveH,
      weeklyCredits: week,
      monthlyPoolCredits: pool !== null ? pool : (prev.perModelCredits === false ? null : prev.monthlyPoolCredits),
      perModelCredits: true
    };
  }
  return plans;
}

// "New models start at the standard $6 credits" / "all at the standard $20
// credits": the allowance every on-plan model gets unless the boosted tables
// list it.
function parseStandardCapUsd(html) {
  const text = stripHtml(String(html || ""));
  const m = text.match(/standard\s+\$(\d+(?:\.\d+)?)\s+credits?/i);
  return m ? Number(m[1]) : null;
}

// ============================================================================
// Dynamic Plan Catalog, Caps, Intelligence & Roles Scraper (Zero Hardcoding)
// ============================================================================
// Market-billed cost needs no external price list: every usage-feed entry
// carries meta.totalCost (what the request is billed at market rates) next to
// the sticker components the plan paces against.
async function maybeSyncDynamicCatalog(db, env, forced, forceCatalogSync, windowLimits) {
  const nowMs = Date.now();
  const istNow = new Date(nowMs + IST_OFFSET_MS);
  const todayIstStr = istNow.toISOString().slice(0, 10);
  const istHour = istNow.getUTCHours();

  const cached = await getMetaMany(db, [
    "model_pricing_json",
    "last_catalog_sync_ts",
    "last_catalog_sync_date_ist",
    "catalog_schema_version",
    "catalog_plan_key",
    "plan_limits_json",
    "plan_info_json"
  ]);
  const existingCatalog = safeJsonParse(cached.model_pricing_json, {});
  const lastCatSyncTs = Number(cached.last_catalog_sync_ts || 0);
  const lastCatDateIst = cached.last_catalog_sync_date_ist || "";
  let plansTable = safeJsonParse(cached.plan_limits_json, null);
  const previousPlan = safeJsonParse(cached.plan_info_json, null);
  let plan = detectPlan(env, windowLimits, plansTable, previousPlan);

  // 10:00 AM IST daily rule + 24h manual-refresh rule + explicit checkbox. A
  // plan change (or a catalog scraped for another plan) always re-scrapes.
  const hasCatalog = Object.keys(existingCatalog).length > 0;
  const needCatalog = Boolean(forceCatalogSync) ||
    (istHour >= 10 && lastCatDateIst !== todayIstStr) ||
    (forced && (nowMs - lastCatSyncTs >= CATALOG_TTL_MS)) ||
    !hasCatalog ||
    !plansTable ||
    cached.catalog_plan_key !== plan.key ||
    cached.catalog_schema_version !== CATALOG_SCHEMA_VERSION;

  const errors = [];
  const pendingMetaWrites = {};
  let catalogMap = existingCatalog;
  let catalogLatencyMs = 0;

  if (needCatalog) {
    // Explicit force bypasses the 24h edge cache; normal runs still use it.
    const fetchOpts = forceCatalogSync ? {} : DOC_CACHE_OPTS;
    const docFetch = (path) => fetch(`https://commandcode.ai${path}`, { headers: { "User-Agent": "Mozilla/5.0" }, ...fetchOpts });
    const tCat0 = performance.now();
    try {
      // Plan limits first: they decide which plan page to scrape.
      const limitsResp = await docFetch("/docs/resources/usage-limits");
      if (limitsResp.ok) {
        const parsedPlans = parsePlanLimitsHtml(await limitsResp.text());
        if (Object.keys(parsedPlans).length > 0) {
          plansTable = parsedPlans;
          pendingMetaWrites.plan_limits_json = JSON.stringify(parsedPlans);
          plan = detectPlan(env, windowLimits, plansTable, previousPlan);
        }
      } else {
        errors.push({ source: "PLAN_LIMITS_FETCH", code: String(limitsResp.status), message: `Usage-limits docs fetch failed (HTTP ${limitsResp.status}). Using last cached plan caps.`, ts: new Date().toISOString() });
      }

      const [planResp, cliResp] = await Promise.all([
        docFetch(`/docs/plans/${encodeURIComponent(plan.key)}`),
        docFetch("/docs/reference/cli/models")
      ]);
      if (!planResp.ok) {
        errors.push({
          source: "PLAN_CATALOG_FETCH",
          code: String(planResp.status),
          message: `${plan.name} plan docs fetch failed (HTTP ${planResp.status}). Using last cached catalog.`,
          ts: new Date().toISOString()
        });
      } else {
        const planHtml = await planResp.text();
        const roleMap = cliResp.ok ? parseCliRolesHtml(await cliResp.text()) : {};
        const standardCapUsd = parseStandardCapUsd(planHtml);
        plan.standardCapUsd = standardCapUsd;
        const scraped = parsePlanTablesHtml(planHtml, roleMap);
        if (Object.keys(scraped).length === 0) {
          errors.push({
            source: "PLAN_CATALOG_PARSE",
            code: "EMPTY",
            message: `${plan.name} plan docs table parser extracted 0 models. Using last cached catalog.`,
            ts: new Date().toISOString()
          });
        } else {
          // Replace, never merge: a model dropped from the docs must leave the
          // catalog (and the Advisor) instead of lingering forever.
          applyPlanDefaults(scraped, plan);
          catalogMap = scraped;
          pendingMetaWrites.model_pricing_json = JSON.stringify(scraped);
          pendingMetaWrites.last_catalog_sync_ts = String(nowMs);
          pendingMetaWrites.last_catalog_sync_date_ist = todayIstStr;
          pendingMetaWrites.catalog_schema_version = CATALOG_SCHEMA_VERSION;
          pendingMetaWrites.catalog_plan_key = plan.key;
        }
      }
    } catch (e) {
      errors.push({
        source: "PLAN_CATALOG_FETCH",
        code: "EX",
        message: `Plan catalog fetch error: ${e.message}. Using last cached catalog.`,
        ts: new Date().toISOString()
      });
    }
    catalogLatencyMs = Math.round(performance.now() - tCat0);
  }

  if (!(plan.fiveHourCredits > 0 && plan.weeklyCredits > 0 && plan.monthlyPoolCredits > 0)) {
    errors.push({ source: "PLAN_CAPS_MISSING", code: plan.key, message: `Could not read the ${plan.name} plan's credit caps from the usage-limits docs. Window bars still mirror CC; per-model credit burn assumes a 70-credit pool.`, ts: new Date().toISOString() });
  }
  pendingMetaWrites.plan_info_json = JSON.stringify(plan);
  await setMetaMany(db, pendingMetaWrites);
  return { catalogMap, plan, catalogLatencyMs, errors };
}

// Per-plan defaults applied to a freshly scraped catalog:
//  - Speed / contributor variants are separate models with their own credits
//    (docs: "never their base model's"), so they do NOT inherit the base cap;
//    unlisted models get the plan's standard allowance instead.
//  - Unscored muse-*-contributor / deepseek-*-fast variants still inherit the
//    base model's intelligence score for the Advisor ranking.
//  - Plans where 1 credit = $1 (Max, Team) price every model at the pool.
function applyPlanDefaults(catalogMap, plan) {
  const pool = planPool(plan);
  for (const [slug, item] of Object.entries(catalogMap || {})) {
    if (!item) continue;
    if (!item.isFree && (item.monthlyCapUsd === null || item.monthlyCapUsd === undefined)) {
      if (plan && plan.perModelCredits === false) item.monthlyCapUsd = pool;
      else if (plan && plan.standardCapUsd > 0) { item.monthlyCapUsd = plan.standardCapUsd; item.capIsStandard = true; }
    }
    let baseSlug = null;
    if (slug.startsWith("muse-") && slug.endsWith("-contributor")) baseSlug = slug.replace(/-contributor$/, "");
    else if (slug.startsWith("deepseek-") && slug.endsWith("-fast")) baseSlug = slug.replace(/-fast$/, "");
    const baseItem = baseSlug ? catalogMap[baseSlug] : null;
    if (baseItem && (item.intelligence === null || item.intelligence === undefined)
      && baseItem.intelligence !== null && baseItem.intelligence !== undefined) {
      item.intelligence = baseItem.intelligence;
      item.intelligenceInheritedFrom = baseItem.name || baseSlug;
    }
    // The CLI docs' "Best for" text wins; otherwise describe the allowance tier.
    if (!item.role) item.role = deriveDynamicRole(item, plan);
  }
}

// Parses time-of-day flexible peak pricing schedules from GOAT table cells
// Example cell text: "DeepSeek V4 Pro Off-peak shown (17h/day) · peak $0.30 / $1.20 01–04 & 06–10 UTC, Mon–Fri"
function parsePeakScheduleFromCell(rawCell0) {
  if (!rawCell0 || !/off-peak|peak\s*\$/i.test(rawCell0)) return null;
  const peakRatesMatch = rawCell0.match(/peak\s*\$(\d+(?:\.\d+)?)\s*\/\s*\$(\d+(?:\.\d+)?)/i);
  if (!peakRatesMatch) return null;

  const peakIn = Number(peakRatesMatch[1]);
  const peakOut = Number(peakRatesMatch[2]);
  const weekdaysOnly = /mon[–\-]fri/i.test(rawCell0);

  const ranges = [];
  const afterPeakText = rawCell0.slice(rawCell0.toLowerCase().indexOf("peak"));
  const rangeRegex = /(\d{1,2})\s*[–\-]\s*(\d{1,2})/g;
  let rm;
  while ((rm = rangeRegex.exec(afterPeakText)) !== null) {
    const startH = Number(rm[1]);
    const endH = Number(rm[2]);
    if (startH >= 0 && endH <= 24 && startH < endH) {
      ranges.push([startH, endH]);
    }
  }

  return {
    peakIn,
    peakOut,
    weekdaysOnly,
    ranges,
    note: rawCell0.match(/Off-peak shown[\s\S]*$/i)?.[0]?.trim() || "Flexible time-of-day pricing"
  };
}

// Evaluates whether a given UTC timestamp falls inside a model's scraped peak pricing window
function getActiveModelRatesAtTime(catItem, timestampMs = Date.now()) {
  if (!catItem || !catItem.peakSchedule) {
    return { ...(catItem || {}), isPeakActive: false };
  }
  const ps = catItem.peakSchedule;
  const d = new Date(timestampMs);
  const utcDay = d.getUTCDay(); // 0=Sun, 1=Mon ... 5=Fri, 6=Sat
  const utcHour = d.getUTCHours();

  if (ps.weekdaysOnly && (utcDay === 0 || utcDay === 6)) {
    return { ...catItem, isPeakActive: false };
  }

  const inPeakWindow = Array.isArray(ps.ranges) && ps.ranges.some(([startH, endH]) => utcHour >= startH && utcHour < endH);
  if (inPeakWindow) {
    return {
      ...catItem,
      in: ps.peakIn,
      out: ps.peakOut,
      isPeakActive: true
    };
  }
  return { ...catItem, isPeakActive: false };
}

// The GOAT table's first cell links every model to /models/<official-id>. The
// display name is NOT the id ("Beam 1.0" ships as beam-free, "Qwen 3.8 Max" as
// qwen3-8-max, "Nemotron 3 Ultra" as nemotron-3-ultra-550b-a55b), and the usage
// feed reports the id, so the catalog keeps it for lookups. The link text is also
// the clean display name - the rest of the cell holds the Free/deal badge and the
// peak-pricing note.
function extractDocModelId(rawCell) {
  const m = /<a[^>]+href=["'][^"']*\/models\/([^"'?#]+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(String(rawCell || ""));
  if (!m) return null;
  const modelId = canonicalModelSlug(m[1]);
  if (!modelId) return null;
  return { modelId, linkName: stripHtml(m[2]) };
}

// Parses the model tables on https://commandcode.ai/docs/plans/<plan> (same
// layout on the Go and GOAT pages): rates/intelligence, request estimates and
// one or more "Monthly credits" allowance tables.
function parsePlanTablesHtml(html, roleMap = {}) {
  const catalog = {};
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;

  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHtml = tableMatch[1];
    const headers = [];
    const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
    let thMatch;
    while ((thMatch = thRegex.exec(tableHtml)) !== null) {
      headers.push(stripHtml(thMatch[1]).toLowerCase());
    }
    const headerSig = headers.join("|");

    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const cells = [];
      let rawCell0Html = "";
      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdMatch;
      while ((tdMatch = tdRegex.exec(rowMatch[1])) !== null) {
        // The model link (and its official id) only exists in the raw first cell.
        if (cells.length === 0) rawCell0Html = tdMatch[1];
        cells.push(stripHtml(tdMatch[1]));
      }
      if (cells.length < 4) continue;

      const rawCell0 = cells[0];
      const docModel = extractDocModelId(rawCell0Html);
      const cleanName = cleanModelTitle(docModel && docModel.linkName ? docModel.linkName : rawCell0);
      const slug = normalizeModelSlug(cleanName);
      if (!slug || slug === "model") continue;
      const modelId = docModel ? docModel.modelId : null;

      const parsedPeak = parsePeakScheduleFromCell(rawCell0);

      if (!catalog[slug]) {
        catalog[slug] = {
          slug,
          modelId,
          name: cleanName,
          contextWindow: null,
          intelligence: null,
          in: null,
          out: null,
          cache: null,
          cacheWrite: null,
          monthlyCapUsd: null,
          isFree: /free/i.test(rawCell0),
          hasDeal: /-\d+%|deal|off-peak/i.test(rawCell0),
          peakSchedule: parsedPeak || null,
          reqs5h: null,
          reqsWeek: null,
          reqsMonth: null,
          role: roleMap[slug] || null,
          onPlan: true,
          source: "commandcode-plan-docs"
        };
      } else if (parsedPeak && !catalog[slug].peakSchedule) {
        catalog[slug].peakSchedule = parsedPeak;
      }
      if (modelId && !catalog[slug].modelId) catalog[slug].modelId = modelId;

      // Table 1: Model | Context | Intelligence | Input | Output | Cache read | Cache write | Caps
      if (headerSig.includes("intelligence")) {
        catalog[slug].contextWindow = cells[1] || catalog[slug].contextWindow;
        const intelNum = parseFloat(cells[2]);
        if (!Number.isNaN(intelNum) && !/not yet scored/i.test(cells[2])) {
          catalog[slug].intelligence = intelNum;
        }
        const isFreeRow = /free/i.test(cells[3]) && /free/i.test(cells[4]);
        if (isFreeRow) catalog[slug].isFree = true;
        const inR = isFreeRow ? 0 : extractLastDollarNumber(cells[3]);
        const outR = isFreeRow ? 0 : extractLastDollarNumber(cells[4]);
        const cacheR = isFreeRow ? 0 : extractLastDollarNumber(cells[5]);
        const cacheW = cells[6] ? extractLastDollarNumber(cells[6]) : null;
        if (inR !== null) catalog[slug].in = inR;
        if (outR !== null) catalog[slug].out = outR;
        if (cacheR !== null) catalog[slug].cache = cacheR;
        if (cacheW !== null) catalog[slug].cacheWrite = cacheW;
      }
      // Table 2: Model | Requests / 5 hours | Requests / week | Requests / month
      else if (headerSig.includes("5 hours") || headerSig.includes("week")) {
        catalog[slug].reqs5h = parseFormattedInt(cells[1]);
        catalog[slug].reqsWeek = parseFormattedInt(cells[2]);
        catalog[slug].reqsMonth = parseFormattedInt(cells[3]);
      }
      // Table 3: Model | Input | Output | Cache Read | Cache Write | Monthly credits
      else if (headerSig.includes("monthly credits")) {
        const capCell = cells[cells.length - 1];
        if (/free/i.test(capCell)) {
          catalog[slug].isFree = true;
          catalog[slug].monthlyCapUsd = 0;
        } else {
          const capUsd = extractLastDollarNumber(capCell);
          if (capUsd !== null) catalog[slug].monthlyCapUsd = capUsd;
        }
        const inR = extractLastDollarNumber(cells[1]);
        const outR = extractLastDollarNumber(cells[2]);
        const cacheR = extractLastDollarNumber(cells[3]);
        if (inR !== null && catalog[slug].in === null) catalog[slug].in = inR;
        if (outR !== null && catalog[slug].out === null) catalog[slug].out = outR;
        if (cacheR !== null && catalog[slug].cache === null) catalog[slug].cache = cacheR;
      }
    }
  }
  return catalog;
}

// Parses https://commandcode.ai/docs/reference/cli/models for official "Best for" role descriptions
function parseCliRolesHtml(html) {
  const roles = {};
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRegex.exec(html)) !== null) {
    const cells = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let td;
    while ((td = tdRegex.exec(m[1])) !== null) {
      cells.push(stripHtml(td[1]));
    }
    if (cells.length >= 4) {
      const slug = normalizeModelSlug(cells[0]);
      const nameSlug = normalizeModelSlug(cells[1]);
      const bestFor = cells[3];
      if (slug && bestFor) roles[slug] = bestFor;
      if (nameSlug && bestFor) roles[nameSlug] = bestFor;
    }
  }
  return roles;
}

// Allowance tier relative to the active plan's pool, so the label stays right on
// Go ($6-$10 allowances, 10-credit pool) and GOAT ($10-$100, 70-credit pool).
function deriveDynamicRole(item, plan) {
  if (item.isFree) return "Free (0 credits)";
  const cap = Number(item.monthlyCapUsd);
  if (!(cap > 0)) return "Plan Catalog Model";
  const pool = planPool(plan);
  if (cap > pool) return `Boosted Deal ($${cap} Cap)`;
  if (cap === pool) return `Full Allowance ($${cap} Cap)`;
  if (item.capIsStandard || (plan && cap === plan.standardCapUsd)) return `Standard Allowance ($${cap} Cap)`;
  return `Partial Allowance ($${cap} Cap)`;
}

function stripHtml(raw) {
  return String(raw || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanModelTitle(raw) {
  return String(raw || "")
    .replace(/Off-peak shown[\s\S]*$/i, "")
    .replace(/Decision model[\s\S]*$/i, "")
    .replace(/-\d+%$/i, "")
    .replace(/Free$/i, "")
    .trim();
}

function extractLastDollarNumber(str) {
  if (!str) return null;
  const matches = String(str).match(/\$(\d+(?:\.\d+)?)/g);
  if (!matches || matches.length === 0) return null;
  const num = Number(matches[matches.length - 1].replace("$", ""));
  return Number.isFinite(num) ? num : null;
}

function parseFormattedInt(str) {
  if (!str) return null;
  const clean = String(str).replace(/[^0-9]/g, "");
  return clean ? Number(clean) : null;
}

function normalizeModelSlug(raw) {
  return canonicalModelSlug(raw);
}

// Canonical model key shared by ledger, daily rollup, catalog lookups and the
// UI. Strips provider prefixes ("deepseek/deepseek-v4-flash" -> core id),
// collapses OpenRouter dotted versions ("v4.1" -> "v41"), squeezes doubled
// tokens from name+version collisions ("deepseek-v4-1-flash-fast" -/-> "-":
// "deepseek-v4-flash-fast" collapses to "deepseek-v4-flash"). Without this one
// model fans out into 3-4 rows and the per-model tables split its credits.
function canonicalModelSlug(raw) {
  let s = String(raw || "")
    .toLowerCase()
    .replace(/^[^/]+\//, "")
    .replace(/\(latest\)|\(exp\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s || s === "model" || s === "unknown") return s;
  // Collapse dotted versions: v4.1 -> v41, v3.8 -> v38.
  s = s.replace(/v(\d+)-(\d+)/g, "v$1$2");
  // Squeeze doubled adjacent WORD tokens from name+id collisions
  // ("deepseek-deepseek-v4" -> "deepseek-v4"). Numeric tokens are never
  // squeezed: "llama-3.3" / "glm-4.4" are versions, not duplicates, and
  // collapsing them merged distinct models (llama-3-3 -> llama-3).
  const parts = s.split("-");
  const out = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last !== undefined && last === p && !/^\d+$/.test(p)) continue;
    out.push(p);
  }
  const joined = out.join("-");
  return LEGACY_MODEL_ALIASES[joined] || joined;
}

function makeAlertKey(err) {
  return `${err.source || "ERR"}:${err.model || err.code || (err.message || "").slice(0, 32)}`;
}

// ============================================================================
// 5-Hour & 7-Day Weekly Rolling Window & Counter Computation
// ============================================================================
// The per-request ledger lives in cc_request_credits (rows are written by
// ingestUsageItems with their credit basis frozen at observation time), so the
// rolling windows read straight from D1 instead of rebuilding a JSON blob on
// every sync.

// ---------------------------------------------------------------------------
// Session-token rotation capture. CC mints a fresh session_token on its own
// cadence, so a static pasted copy 401s on the sync AFTER the one that worked.
// Every authenticated /internal/* response is scanned for Set-Cookie and a
// rotated token is spliced back into override_cookie IN PLACE - other cookies
// the user pasted alongside it (e.g. cf_clearance) are preserved verbatim.
// ---------------------------------------------------------------------------
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function responseSessionCookies(resp) {
  try {
    if (typeof resp.headers.getSetCookie === "function") {
      return resp.headers.getSetCookie().filter(Boolean);
    }
    const single = resp.headers.get("set-cookie");
    return single ? [single] : [];
  } catch (_) { return []; }
}

// Returns true only when the response actually rotated the token (persisted).
async function captureSessionCookieRotation(db, resp, cookieHeader, probe) {
  try {
    if (!db || !resp || !cookieHeader) return false;
    const tokenRe = new RegExp(escapeRegex(SESSION_COOKIE_NAME) + "=([^;\\s]+)", "i");
    let rotatedValue = null;
    for (const sc of responseSessionCookies(resp)) {
      const m = sc.match(tokenRe);
      if (m && m[1]) { rotatedValue = m[1]; break; }
    }
    if (!rotatedValue) return false;
    const sent = cookieHeader.match(tokenRe);
    if (sent && sent[1] === rotatedValue) return false; // unchanged, skip the write
    const updated = sent
      ? cookieHeader.replace(new RegExp(escapeRegex(SESSION_COOKIE_NAME) + "=[^;]*", "i"), `${SESSION_COOKIE_NAME}=${rotatedValue}`)
      : (cookieHeader.includes("=") ? `${cookieHeader}; ${SESSION_COOKIE_NAME}=${rotatedValue}` : `${SESSION_COOKIE_NAME}=${rotatedValue}`);
    await setMeta(db, "override_cookie", updated);
    await setMeta(db, "override_cookie_rotated_ts", String(Date.now()));
    if (probe) probe.rotated = true;
    return true;
  } catch (_) { return false; }
}

// Diagnostic fingerprint of the stored cookie for the auth probe - length,
// whether the expected name=value pair is present, the token's last 4 chars
// and any other pasted cookie names. NEVER stores the token itself.
function cookieFingerprint(header) {
  try {
    const raw = String(header || "");
    const tokenRe = new RegExp(escapeRegex(SESSION_COOKIE_NAME) + "=([^;\\s]+)", "i");
    const m = raw.match(tokenRe);
    const names = raw.split(";").map(s => s.split("=")[0].trim()).filter(n => n && n.toLowerCase() !== SESSION_COOKIE_NAME.toLowerCase());
    return {
      length: raw.length,
      hasSessionPair: Boolean(m),
      tokenEnd: m ? ":" + m[1].slice(-4) : null,
      otherCookies: [...new Set(names)].slice(0, 5)
    };
  } catch (_) { return { length: 0, hasSessionPair: false, tokenEnd: null, otherCookies: [] }; }
}

// CC's own limits state: /internal/billing/credits (session cookie) returns
// windowLimits {fiveHour, weekly} with used/cap/resetAt plus the monthly pool -
// exactly what the commandcode.ai usage page renders. The tracker mirrors it
// instead of re-deriving windows from the 24h request feed, which cannot span
// a 7-day rolling window. Falls back to the API-key /alpha/billing/credits
// route when the cookie fails or is missing.
async function fetchCcWindowLimits(cookieHeader, env, authProbe) {
  const parse = (d) => {
    const wl = d && d.windowLimits;
    if (!wl || !wl.fiveHour || !wl.weekly) return null;
    const c = d.credits || {};
    return {
      fiveHour: { used: Number(wl.fiveHour.used) || 0, cap: Number(wl.fiveHour.cap) || 0, resetAt: Number(wl.fiveHour.resetAt) || 0 },
      weekly: { used: Number(wl.weekly.used) || 0, cap: Number(wl.weekly.cap) || 0, resetAt: Number(wl.weekly.resetAt) || 0 },
      monthlyUsed: Number(c.monthlyCredits) || 0,
      monthlyGranted: Number(c.monthlyCreditsGranted) || null,
      fetchedAt: Date.now()
    };
  };
  if (cookieHeader) {
    try {
      const resp = await fetch("https://api.commandcode.ai/internal/billing/credits", {
        headers: {
          "Accept": "application/json",
          "Cookie": cookieHeader,
          "Origin": "https://commandcode.ai",
          "Referer": "https://commandcode.ai/",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"
        }
      });
      await captureSessionCookieRotation(env.DB, resp, cookieHeader, authProbe);
      if (authProbe) authProbe.windowStatus = resp.status;
      if (resp.ok) { const parsed = parse(await resp.json()); if (parsed) { if (authProbe) authProbe.windowSource = "cookie"; return parsed; } }
    } catch (_) {}
  }
  const apiKey = env && (env.CC_API_KEY || "");
  if (apiKey) {
    try {
      const resp = await fetch("https://api.commandcode.ai/alpha/billing/credits", {
        headers: { "Accept": "application/json", "Authorization": `Bearer ${apiKey}`, "x-api-key": apiKey }
      });
      if (resp.ok) { const parsed = parse(await resp.json()); if (parsed) { if (authProbe) authProbe.windowSource = "apikey"; return parsed; } }
    } catch (_) {}
  }
  return null;
}

// Per-model credit attribution for the billing period (CC's own aggregation),
// used for the weekly top-consumers diagnostics the 24h request feed can't span.
async function fetchCcByModelPeriod(db, cookieHeader, authProbe) {
  if (!cookieHeader) return null;
  try {
    const resp = await fetch("https://api.commandcode.ai/internal/usage/by-model", {
      headers: {
        "Accept": "application/json",
        "Cookie": cookieHeader,
        "Origin": "https://commandcode.ai",
        "Referer": "https://commandcode.ai/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"
      }
    });
    await captureSessionCookieRotation(db, resp, cookieHeader, authProbe);
    if (authProbe) authProbe.byModelStatus = resp.status;
    if (!resp.ok) return null;
    const d = await resp.json();
    if (!d || !Array.isArray(d.data)) return null;
    return {
      window: d.window || null,
      data: d.data.map(r => ({
        model: canonicalModelSlug(r.model || "unknown"),
        requests: Number(r.requests) || 0,
        creditsTotal: Number(r.creditsTotal) || 0,
        consumedMonthlyCredits: Number(r.consumedMonthlyCredits) || 0
      }))
    };
  } catch (_) { return null; }
}

function computeRollingWindows(ledgerMap, catalogMap, plan, windowLimits, byModelPeriod) {
  const fiveHourCap = (plan && plan.fiveHourCredits > 0) ? Number(plan.fiveHourCredits) : null;
  const weeklyCap = (plan && plan.weeklyCredits > 0) ? Number(plan.weeklyCredits) : null;
  const capsMissing = fiveHourCap === null || weeklyCap === null;
  const monthlyPool = planPool(plan);

  const now = Date.now();
  const cutoff7d = now - SEVEN_DAYS_MS;

  // Normalize the 7-day ledger once: each entry gets its credit weight and
  // billable flag, so the window sums below (including the "since reset"
  // fallback for an expired snapshot) are plain filters over one array.
  // Same fuzzy catalog resolution as the daily tables: a variant slug must not
  // silently fall back to weight 1.
  const windowCatMemo = new Map();
  const windowCatWarnings = [];
  const entries = [];
  for (const item of Object.values(ledgerMap || {})) {
    if (!item || typeof item.ts !== "number" || item.ts < cutoff7d) continue;
    const apiCost = Number(item.apiCost || 0);
    const sticker = (item.stickerCost !== null && item.stickerCost !== undefined)
      ? Number(item.stickerCost) : apiCost;
    const cat = lookupCatalogModel(item.slug, catalogMap, windowCatWarnings, windowCatMemo, null);
    // Billable-only accounting: free/unlimited models, builtin tool pings and
    // zero-cost turns never drain the plan pool on the CC page, so they must
    // not inflate usedCredits.
    const isToolEntry = BUILTIN_TOOLS.has(item.slug) || Boolean(cat && cat.isTool);
    const isFreeEntry = Boolean(cat && cat.isFree);
    const billable = !isToolEntry && !isFreeEntry && Number.isFinite(sticker) && sticker > 0;
    // Per-request credits are frozen at ingest against the allowance in effect
    // THEN; prefer them so a later allowance or plan change never re-prices
    // history. Only rows without frozen credits derive from today's catalog.
    const frozenCredits = (item.credits === null || item.credits === undefined) ? NaN : Number(item.credits);
    let weighted;
    if (Number.isFinite(frozenCredits)) {
      weighted = frozenCredits;
    } else {
      const modelCap = cat && cat.monthlyCapUsd ? Number(cat.monthlyCapUsd) : monthlyPool;
      // Lower-allowance models draw proportionally more pool credits per $1 of sticker usage.
      const creditWeight = (isToolEntry || isFreeEntry) ? 0 : (modelCap > 0 ? monthlyPool / modelCap : 1);
      weighted = sticker * creditWeight;
    }
    entries.push({
      ts: item.ts,
      slug: item.slug,
      api: apiCost,
      sticker: Number.isFinite(sticker) ? sticker : 0,
      credits: billable ? weighted : 0,
      billable
    });
  }

  // Ledger estimate for a window starting at `fromTs`. The window OPENS on the
  // first request of any kind (billable, free, tool ping, $0); only billable
  // drain counts toward usedCredits.
  const sumWindow = (fromTs, windowMs) => {
    let used = 0, raw = 0, sticker = 0, count = 0, oldest = Infinity;
    const byModel = {};
    for (const e of entries) {
      if (e.ts < fromTs) continue;
      raw += e.api;
      sticker += e.sticker;
      count++;
      if (e.ts < oldest) oldest = e.ts;
      if (e.billable) {
        used += e.credits;
        const m = byModel[e.slug] || (byModel[e.slug] = { slug: e.slug, credits: 0, sticker: 0, api: 0, requests: 0 });
        m.credits += e.credits;
        m.sticker += e.sticker;
        m.api += e.api;
        m.requests += 1;
      }
    }
    const resetMs = oldest !== Infinity ? Math.max(0, (oldest + windowMs) - now) : 0;
    return { used, raw, sticker, count, oldest, resetMs, byModel };
  };
  const topByCredits = (map) => Object.values(map)
    .map(e => ({ slug: e.slug, credits: Number(e.credits.toFixed(4)), sticker: Number(e.sticker.toFixed(4)), api: Number(e.api.toFixed(4)), requests: e.requests }))
    .sort((a, b) => b.credits - a.credits)
    .slice(0, 12);
  const toWindow = (s, cap) => ({
    limitCredits: cap,
    usedCredits: Number(s.used.toFixed(4)),
    leftCredits: cap !== null ? Number(Math.max(0, cap - s.used).toFixed(4)) : null,
    usedPct: cap ? Number(Math.min(100, (s.used / cap) * 100).toFixed(1)) : 0,
    rawApiUsd: Number(s.raw.toFixed(4)),
    stickerValueUsd: Number(s.sticker.toFixed(4)),
    requestsCount: s.count,
    resetsInMs: s.resetMs,
    resetsInMinutes: Math.ceil(s.resetMs / 60000),
    resetsInHours: Number((s.resetMs / 3600000).toFixed(1)),
    windowOpenedAt: s.oldest !== Infinity ? new Date(s.oldest).toISOString() : null,
    topModels: topByCredits(s.byModel),
    capsMissing
  });

  const fiveHourBase = toWindow(sumWindow(now - FIVE_HOURS_MS, FIVE_HOURS_MS), fiveHourCap);
  const weeklyBase = toWindow(sumWindow(cutoff7d, SEVEN_DAYS_MS), weeklyCap);

  // Authoritative override from CC's billing service. /internal/usage only
  // serves the last 100 requests of the last 24h (no cursor pagination), so a
  // locally rolled-up 7-day ledger can never match CC's own window state. When
  // windowLimits is cached, used/cap/percent/reset/anchor mirror the CC page
  // exactly; the ledger values stay on the object for diagnostics.
  const overrideWindow = (win, wl, windowMs) => {
    if (!wl || !Number.isFinite(wl.resetAt) || wl.resetAt <= 0 || !(wl.cap > 0)) return win;
    // A cached snapshot whose resetAt has already passed describes the PREVIOUS
    // window. CC opens the next one at zero on the first request after it, so
    // the bar shows ledger usage since resetAt (0 if idle) until the next sync
    // brings the live state - never the old snapshot's 100%.
    if (wl.resetAt <= now) {
      // Replay CC's rule from the known reset: a window opens on the first
      // request at/after the previous reset and lasts windowMs. A snapshot can
      // be several windows old (dead cookie), so walk forward to the live one.
      let windowStart = Infinity;
      let nextOpen = wl.resetAt;
      for (const ts of entries.map(e => e.ts).sort((a, b) => a - b)) {
        if (ts < nextOpen) continue;
        windowStart = ts;
        nextOpen = ts + windowMs;
      }
      const since = windowStart !== Infinity && windowStart + windowMs > now
        ? sumWindow(windowStart, windowMs)
        : sumWindow(Infinity, windowMs);
      const cap = Number(wl.cap);
      return {
        ...toWindow(since, cap),
        resetsAtIso: since.oldest !== Infinity ? new Date(since.oldest + windowMs).toISOString() : null,
        windowSource: "ledger-since-reset",
        windowExpired: true,
        capsMissing: false
      };
    }
    const used = Number(wl.used) || 0;
    const resetsInMs = Math.max(0, wl.resetAt - now);
    return {
      ...win,
      limitCredits: wl.cap,
      usedCredits: Number(used.toFixed(4)),
      leftCredits: Number(Math.max(0, wl.cap - used).toFixed(4)),
      usedPct: Number(Math.min(100, (used / wl.cap) * 100).toFixed(1)),
      resetsInMs,
      resetsInMinutes: Math.ceil(resetsInMs / 60000),
      resetsInHours: Number((resetsInMs / 3600000).toFixed(1)),
      resetsAtIso: new Date(wl.resetAt).toISOString(),
      windowOpenedAt: new Date(wl.resetAt - windowMs).toISOString(),
      windowSource: "cc-billing-limits",
      capsMissing: false
    };
  };

  // Per-model consumers for the billing period: CC's own by-model aggregation
  // (the 24h request feed cannot attribute a full week or month).
  let topModelsPeriod = weeklyBase.topModels;
  if (byModelPeriod && Array.isArray(byModelPeriod.data) && byModelPeriod.data.length > 0) {
    topModelsPeriod = byModelPeriod.data
      .map(r => ({
        slug: r.model,
        credits: Number(Number(r.consumedMonthlyCredits || 0).toFixed(4)),
        requests: Number(r.requests || 0)
      }))
      .sort((a, b) => b.credits - a.credits)
      .slice(0, 12);
  }

  return {
    fiveHour: overrideWindow(fiveHourBase, windowLimits && windowLimits.fiveHour, FIVE_HOURS_MS),
    weekly: Object.assign(overrideWindow(weeklyBase, windowLimits && windowLimits.weekly, SEVEN_DAYS_MS), { topModels: topModelsPeriod }),
    monthlyPool: windowLimits ? { used: windowLimits.monthlyUsed || 0, granted: windowLimits.monthlyGranted || monthlyPool } : null,
    // When the cached snapshot was captured - the UI shows its age, so a bar that
    // could not be refreshed (dead cookie) is visibly stale instead of "exact".
    windowLimitsFetchedAt: (windowLimits && Number(windowLimits.fetchedAt)) ? Number(windowLimits.fetchedAt) : null
  };
}

// ============================================================================
// Batched Ingestion Helper (Evaluates Time-of-Day Peak/Off-Peak Rates per Turn)
// ============================================================================
// Freezes ONE request's credit cost using the allowance in effect at ingest time.
// CC prices each request against the model's monthly allowance when it is served,
// so storing the inputs (cap, pool, weight) + result keeps a later allowance change
// from re-pricing history. Free/tool rows burn 0; a model missing from the catalog
// keeps the 1x pool fallback used by the rolling-window estimate.
function computeRequestCredits(catalogItem, stickerUsd, monthlyPoolUsd) {
  const pool = (monthlyPoolUsd && Number(monthlyPoolUsd) > 0) ? Number(monthlyPoolUsd) : 70;
  const isFree = Boolean(catalogItem && catalogItem.isFree);
  const isTool = Boolean(catalogItem && catalogItem.isTool);
  if (isFree || isTool) {
    return { credits: 0, weight: 0, modelCapUsd: isFree ? 0 : null, poolUsd: pool };
  }
  const rawCap = catalogItem ? catalogItem.monthlyCapUsd : null;
  const modelCapUsd = (rawCap !== null && rawCap !== undefined) ? Number(rawCap) : null;
  const weight = (modelCapUsd && modelCapUsd > 0) ? pool / modelCapUsd : 1;
  const sticker = Number(stickerUsd) || 0;
  return {
    credits: Number((sticker * weight).toFixed(6)),
    weight: Number(weight.toFixed(6)),
    modelCapUsd,
    poolUsd: pool
  };
}

async function ingestUsageItems(db, usages, seenSet, catalogMap, syncErrors = [], monthlyPoolUsd = null) {
  let hitAlreadySeen = false;
  let newRecordsCount = 0;
  const statements = [];
  const lookupMemo = new Map();
  const reportedMissing = buildReportedMissingSet(syncErrors);
  const observedAt = Date.now();

  for (const item of usages) {
    if (!item || !item.id) continue;
    if (seenSet.has(item.id)) {
      hitAlreadySeen = true;
      continue;
    }
    seenSet.add(item.id);

    // Convert timestamp to IST Date (UTC + 05:30)
    const createdMs = item.createdAt ? new Date(item.createdAt).getTime() : Date.now();
    const usageDate = new Date(createdMs + IST_OFFSET_MS).toISOString().slice(0, 10);

    const meta = item.meta || {};
    const model = normalizeModelSlug(meta.model || "unknown");

    const tokensInTotal = Number(item.tokensIn || 0);
    const tokensOut = Number(item.tokensOut || 0);
    const durationMs = Number(item.durationTotal || 0);

    // BILLING DECODE (verified live, R^2=1.0): meta.totalCost is the MARKET-BILLED amount
    // (OpenRouter parity, e.g. GPT-5.6 Sol $4/$20/$0.40 per M), while meta.inputCost +
    // meta.outputCost + meta.cacheCost are the STICKER usage-value at GOAT list rates
    // ($5/$30/$0.50) that credit accounting paces against. plan_cost keeps billed $.
    const planCost = Number(meta.totalCost || 0);
    const inputCost = Number(meta.inputCost || 0);
    const cacheCost = Number(meta.cacheCost || 0);
    const outputCost = Number(meta.outputCost || 0);

    const baseRates = lookupCatalogModel(model, catalogMap, syncErrors, lookupMemo, reportedMissing);
    // Evaluate exact time-of-day rate (off-peak vs peak) at createdMs for accurate token split derivation
    const activeRates = getActiveModelRatesAtTime(baseRates, createdMs);
    const freshRatePerToken = (activeRates.in || 0) / 1_000_000;

    let tokensInFresh = 0;
    let tokensCached = 0;
    if (cacheCost === 0 && inputCost > 0) {
      tokensInFresh = tokensInTotal;
      tokensCached = 0;
    } else if (freshRatePerToken > 0) {
      tokensInFresh = Math.min(tokensInTotal, Math.round(inputCost / freshRatePerToken));
      tokensCached = Math.max(0, tokensInTotal - tokensInFresh);
    } else {
      tokensInFresh = tokensInTotal;
    }

    const isFailedOrWasted =
      !baseRates.isTool && (
        (item.status && item.status !== "completed") ||
        (tokensInTotal > 0 && tokensOut === 0)
      ) ? 1 : 0;

    // Freeze the credit basis for this request NOW (see computeRequestCredits).
    // Sticker usage-value is what CC paces allowances against; fall back to the
    // billed amount for the rare turn where the sticker components are missing.
    const stickerCost = Number((inputCost + cacheCost + outputCost).toFixed(6));
    const stickerBasis = (Number.isFinite(stickerCost) && stickerCost > 0) ? stickerCost : planCost;
    const creditInfo = computeRequestCredits(baseRates, stickerBasis, monthlyPoolUsd);

    // STATEMENTS_PER_REQUEST statements, pushed together: the per-request ledger
    // row (which is also the dedupe record) and the daily rollup upsert. Batches
    // are cut on multiples of STATEMENTS_PER_REQUEST, so both commit or neither.
    statements.push(
      db.prepare(`
        INSERT OR IGNORE INTO cc_request_credits (
          id, created_at, usage_date, model, sticker_usd, billed_usd,
          model_cap_usd, pool_usd, credit_weight, credits, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        item.id, item.createdAt || new Date().toISOString(), usageDate, model,
        stickerBasis, planCost, creditInfo.modelCapUsd, creditInfo.poolUsd,
        creditInfo.weight, creditInfo.credits, observedAt
      ),
      db.prepare(`
        INSERT INTO cc_daily_model_usage (
          usage_date, model, requests_count, failed_wasted_count,
          tokens_in_total, tokens_in_fresh, tokens_cached, tokens_out,
          plan_cost, input_cost, cache_cost, output_cost, actual_api_cost, duration_ms_total,
          credits_consumed
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(usage_date, model) DO UPDATE SET
          requests_count = requests_count + 1,
          failed_wasted_count = failed_wasted_count + excluded.failed_wasted_count,
          tokens_in_total = tokens_in_total + excluded.tokens_in_total,
          tokens_in_fresh = tokens_in_fresh + excluded.tokens_in_fresh,
          tokens_cached = tokens_cached + excluded.tokens_cached,
          tokens_out = tokens_out + excluded.tokens_out,
          plan_cost = plan_cost + excluded.plan_cost,
          input_cost = input_cost + excluded.input_cost,
          cache_cost = cache_cost + excluded.cache_cost,
          output_cost = output_cost + excluded.output_cost,
          actual_api_cost = actual_api_cost + excluded.actual_api_cost,
          duration_ms_total = duration_ms_total + excluded.duration_ms_total,
          -- -1 marks a row written before credit freezing: replace it with this
          -- batch's frozen total instead of adding to the sentinel.
          credits_consumed = CASE WHEN credits_consumed < 0
            THEN excluded.credits_consumed
            ELSE credits_consumed + excluded.credits_consumed END
      `).bind(
        usageDate, model, isFailedOrWasted,
        tokensInTotal, tokensInFresh, tokensCached, tokensOut,
        planCost, inputCost, cacheCost, outputCost, planCost, durationMs,
        creditInfo.credits
      )
    );
    newRecordsCount++;
  }

  const tWrite0 = performance.now();
  let lastDbMeta = null;
  if (statements.length === 0) {
    return { hitAlreadySeen, newRecordsCount, writeLatencyMs: 0, dbMeta: null };
  }
  for (let i = 0; i < statements.length; i += INGEST_BATCH_SIZE) {
    const batchRes = await db.batch(statements.slice(i, i + INGEST_BATCH_SIZE));
    if (batchRes && batchRes.length > 0 && batchRes[batchRes.length - 1].meta) {
      lastDbMeta = batchRes[batchRes.length - 1].meta;
    }
  }
  const writeLatencyMs = Math.round(performance.now() - tWrite0);
  return { hitAlreadySeen, newRecordsCount, writeLatencyMs, dbMeta: lastDbMeta };
}

async function enforceRetentionAndMeta(env, newRecordsCount, prefix = "OK", diag = {}) {
  const db = env.DB;
  const latencies = diag.latencies || {};
  const syncErrors = diag.syncErrors || [];

  // Billing-cycle summary. The API key route is primary; Go has no API access,
  // so the session-cookie route is tried as a fallback before giving up (the
  // dashboard then falls back to a 30-day cycle).
  const summaryPromise = (async () => {
    const tSum0 = performance.now();
    let alphaStatus = null;
    if (env.CC_API_KEY) {
      try {
        const sumResp = await fetch("https://api.commandcode.ai/alpha/usage/summary", {
          headers: { "Authorization": `Bearer ${env.CC_API_KEY}`, "x-api-key": env.CC_API_KEY }
        });
        alphaStatus = sumResp.status;
        if (sumResp.ok) {
          latencies.summaryApiMs = Math.round(performance.now() - tSum0);
          return await sumResp.text();
        }
      } catch (_) { alphaStatus = "EX"; }
    }
    if (diag.cookieHeader) {
      try {
        const cResp = await fetch("https://api.commandcode.ai/internal/usage/summary", {
          headers: {
            "Accept": "application/json",
            "Cookie": diag.cookieHeader,
            "Origin": "https://commandcode.ai",
            "Referer": "https://commandcode.ai/",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"
          }
        });
        if (cResp.ok) {
          const text = await cResp.text();
          const parsed = safeJsonParse(text, null);
          if (parsed && parsed.periodStart) {
            latencies.summaryApiMs = Math.round(performance.now() - tSum0);
            return text;
          }
        }
      } catch (_) {}
    }
    latencies.summaryApiMs = Math.round(performance.now() - tSum0);
    if (alphaStatus !== null) {
      const summaryMsg = (alphaStatus === 401 || alphaStatus === 403)
        ? `/alpha/usage/summary HTTP ${alphaStatus} - CC_API_KEY is stale/rotated (it changes whenever the CLI re-logs in) or the plan has no API access (Go). Re-paste the current "user_..." apiKey from ~/.commandcode/auth.json into Worker -> Settings -> Variables -> CC_API_KEY. Only the billing-cycle dates need it; usage + bars keep working via the session cookie and bookmarklet pushes.`
        : `/alpha/usage/summary HTTP ${alphaStatus}`;
      syncErrors.push({ source: "SUMMARY_API", code: String(alphaStatus), message: summaryMsg, ts: new Date().toISOString() });
    }
    return null;
  })();

  // Retention deletes run at most once per day. usage_date rows are IST
  // calendar dates, so the daily-rollup cutoff is computed in JS (IST); the
  // ledger's created_at is an ISO UTC timestamp and compares as a string.
  const metaState = await getMetaMany(db, ["last_retention_run_ts", "last_latencies_json"]);
  const lastRetentionTs = Number(metaState.last_retention_run_ts || 0);
  const priorLatencies = safeJsonParse(metaState.last_latencies_json, {});
  const runRetention = Date.now() - lastRetentionTs >= RETENTION_INTERVAL_MS;
  const rollupCutoffIst = istDateStr(Date.now() - ROLLUP_RETENTION_DAYS * 86400000);
  const ledgerCutoffIso = new Date(Date.now() - LEDGER_RETENTION_DAYS * 86400000).toISOString();
  const retentionPromise = runRetention
    ? db.batch([
        db.prepare(`DELETE FROM cc_daily_model_usage WHERE usage_date < ?`).bind(rollupCutoffIst),
        db.prepare(`DELETE FROM cc_request_credits WHERE created_at < ?`).bind(ledgerCutoffIso),
        db.prepare(`DELETE FROM cc_meta WHERE key IN (${OBSOLETE_META_KEYS.map(() => "?").join(",")})`).bind(...OBSOLETE_META_KEYS)
      ])
    : Promise.resolve(null);

  const [billingSummaryText, retentionBatch] = await Promise.all([summaryPromise, retentionPromise]);

  const dbMeta = diag.dbMeta || (retentionBatch && retentionBatch[0] && retentionBatch[0].meta) || {};
  const coverageInfo = diag.coverageInfo || null;
  const nowTs = Date.now();

  const metaEntries = {
    last_sync_ts: String(nowTs),
    last_sync_status: `${prefix} (+${newRecordsCount} new requests)`,
    sync_errors_json: JSON.stringify(syncErrors),
    last_latencies_json: JSON.stringify({
      ...latencies,
      dbSizeBytes: dbMeta.size_after || priorLatencies.dbSizeBytes || 0
    })
  };
  // Row counts for System Info, computed here (not on every page load) and
  // only when the tables actually changed.
  if (newRecordsCount > 0 || runRetention) {
    metaEntries.table_counts_json = JSON.stringify(await computeTableCounts(db));
  }
  if (runRetention) metaEntries.last_retention_run_ts = String(nowTs);
  if (billingSummaryText) metaEntries.billing_summary_json = billingSummaryText;
  if (coverageInfo) metaEntries.last_sync_coverage_json = JSON.stringify(coverageInfo);
  await setMetaMany(db, metaEntries);

  return nowTs;
}

async function computeTableCounts(db) {
  const row = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM cc_daily_model_usage) AS daily_rows_count,
      (SELECT COUNT(*) FROM cc_request_credits) AS request_credits_count,
      (SELECT COUNT(*) FROM cc_meta) AS meta_rows_count,
      (SELECT COUNT(DISTINCT usage_date) FROM cc_daily_model_usage) AS active_days
  `).first();
  return { ...(row || {}), computedAt: Date.now() };
}

// Dedupe lookup for exactly the IDs being ingested (the feed returns <= 100),
// instead of loading every ID in the ledger. Chunked under D1's bound-param cap.
async function getSeenIds(db, ids) {
  const unique = [...new Set((ids || []).filter(Boolean).map(String))];
  const seen = new Set();
  for (let i = 0; i < unique.length; i += D1_MAX_BOUND_PARAMS) {
    const chunk = unique.slice(i, i + D1_MAX_BOUND_PARAMS);
    const res = await db.prepare(
      `SELECT id FROM cc_request_credits WHERE id IN (${chunk.map(() => "?").join(",")})`
    ).bind(...chunk).all();
    for (const r of (res.results || [])) seen.add(r.id);
  }
  return seen;
}

async function isLedgerEmpty(db) {
  const row = await db.prepare(`SELECT 1 AS present FROM cc_request_credits LIMIT 1`).first();
  return !row;
}

// ============================================================================
// Dynamic Catalog Lookup (Zero Hardcoded Values)
// ============================================================================
function lookupCatalogModel(model, catalogMap, syncErrors = [], memo = null, reportedMissing = null) {
  const slug = normalizeModelSlug(model);
  if (BUILTIN_TOOLS.has(slug)) {
    return { slug, name: slug, in: 0, out: 0, cache: 0, monthlyCapUsd: null, isTool: true };
  }
  if (memo && memo.has(slug)) return memo.get(slug);
  if (catalogMap && catalogMap[slug]) {
    const exact = catalogMap[slug];
    if (memo) memo.set(slug, exact);
    return exact;
  }
  // Official model id exact match. The plan docs key a model by its display name
  // ("Beam 1.0", "Qwen 3.8 Max") while the usage feed reports the /models/<id>
  // slug (beam-free, qwen3-8-max). Resolve that before the fuzzy prefix pass so a
  // correctly-catalogued model is never flagged unmapped / charged the 1x fallback.
  for (const v of Object.values(catalogMap || {})) {
    if (v && v.modelId && v.modelId === slug) {
      if (memo) memo.set(slug, v);
      return v;
    }
  }
  // Fuzzy pass: only a catalog key (or official id) that is a whole-token prefix
  // of the usage slug, followed by nothing but release tags ("-latest", "-exp",
  // "-preview", "-free", dates/build numbers). The old two-way prefix match let a
  // short slug ("gpt-5") pick the LONGEST unrelated key that extends it, and let
  // a variant ("-fast", "-highspeed") borrow its base model's cap - variants are
  // separate models with their own credits.
  const RELEASE_TAG_SUFFIX = /^(-(latest|exp|preview|free|\d+[a-z]?))+$/;
  let best = null;
  let bestLen = -1;
  for (const [k, v] of Object.entries(catalogMap || {})) {
    if (!v) continue;
    for (const key of [k, v.modelId]) {
      if (!key || !slug.startsWith(key) || !RELEASE_TAG_SUFFIX.test(slug.slice(key.length))) continue;
      if (key.length > bestLen) { bestLen = key.length; best = v; }
    }
  }
  if (best) {
    if (memo) memo.set(slug, best);
    return best;
  }
  // Cache misses too: an unknown model must not rescan the whole catalog per row.
  const missing = { slug, name: slug, in: null, out: null, cache: null, monthlyCapUsd: null, missing: true };
  if (memo) memo.set(slug, missing);
  const already = reportedMissing
    ? reportedMissing.has(slug)
    : syncErrors.some(e => e.source === "MISSING_MODEL_CATALOG" && e.model === slug);
  if (!already) {
    if (reportedMissing) reportedMissing.add(slug);
    syncErrors.push({
      source: "MISSING_MODEL_CATALOG",
      model: slug,
      message: `Model "${slug}" not found in the cached plan catalog. Its credits use the 1x pool fallback until the docs list it.`,
      ts: new Date().toISOString()
    });
  }
  return missing;
}

function buildReportedMissingSet(syncErrors) {
  return new Set((syncErrors || []).filter(e => e.source === "MISSING_MODEL_CATALOG").map(e => e.model));
}

async function recordSystemError(db, source, message) {
  try {
    const raw = await getMeta(db, "sync_errors_json");
    const arr = raw ? JSON.parse(raw) : [];
    arr.unshift({ source, code: "RUNTIME", message, ts: new Date().toISOString() });
    await setMeta(db, "sync_errors_json", JSON.stringify(arr.slice(0, 15)));
  } catch (_) {}
}

// ============================================================================
// Dashboard Aggregations, Billing Cycle Window, 5h/7d & Smart GOAT Advisor
// ============================================================================
async function getDashboardAggregates(db, edgeColo = "UNKNOWN") {
  const tSql0 = performance.now();
  // usage_date is an IST calendar date: compute the cutoff in JS (IST).
  const rollupCutoffIst = istDateStr(Date.now() - ROLLUP_RETENTION_DAYS * 86400000);
  // Per-request ledger for the rolling windows (7 days).
  const ledgerCutoffIso = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const [dailyRowsRes, metaRowsRes, ledgerRowsRes] = await db.batch([
    db.prepare(`SELECT usage_date, model, requests_count, failed_wasted_count, tokens_in_total, tokens_in_fresh, tokens_cached, tokens_out, plan_cost, input_cost, cache_cost, output_cost, credits_consumed FROM cc_daily_model_usage WHERE usage_date >= ? ORDER BY usage_date DESC, plan_cost DESC`).bind(rollupCutoffIst),
    // Named keys only: cc_meta also holds the session cookie, which no page needs.
    db.prepare(`SELECT key, value FROM cc_meta WHERE key IN (${DASHBOARD_META_KEYS.map(() => "?").join(",")})`).bind(...DASHBOARD_META_KEYS),
    db.prepare(`SELECT id, created_at, model, sticker_usd, billed_usd, credits FROM cc_request_credits WHERE created_at >= ?`).bind(ledgerCutoffIso)
  ]);
  const sqlReadLatencyMs = Math.round(performance.now() - tSql0);

  const metaMap = {};
  for (const r of (metaRowsRes.results || [])) metaMap[r.key] = r.value;

  const catalogMap = safeJsonParse(metaMap.model_pricing_json, {});
  const plan = safeJsonParse(metaMap.plan_info_json, null);
  // Until the first catalog sync detects the plan, price as the default plan.
  const paidUsd = (plan && plan.paidUsd > 0) ? Number(plan.paidUsd) : Number((10 * (1 + PROCESSING_FEE_RATE)).toFixed(2));
  const planName = (plan && plan.name) || DEFAULT_PLAN_KEY.toUpperCase();
  const monthlyPoolUsd = planPool(plan);

  // Rebuild the rolling-window ledger shape from the per-request rows. `credits`
  // is the frozen per-request cost.
  const ledgerMap = {};
  for (const row of (ledgerRowsRes.results || [])) {
    const ts = new Date(row.created_at).getTime();
    if (!Number.isFinite(ts)) continue;
    const frozen = row.credits === null || row.credits === undefined ? null : Number(row.credits);
    ledgerMap[row.id] = {
      ts,
      slug: row.model,
      apiCost: Number(row.billed_usd) || 0,
      stickerCost: row.sticker_usd === null || row.sticker_usd === undefined ? null : Number(row.sticker_usd),
      credits: frozen !== null && Number.isFinite(frozen) ? frozen : null
    };
  }
  const dismissedMap = safeJsonParse(metaMap.dismissed_alerts_json, {});
  const rawErrors = safeJsonParse(metaMap.sync_errors_json, []);
  const syncErrors = rawErrors.filter(e => !(e.model && BUILTIN_TOOLS.has(e.model)));
  const lastSyncCoverage = safeJsonParse(metaMap.last_sync_coverage_json, null);
  const authProbe = safeJsonParse(metaMap.last_auth_probe_json, null);

  // Enrich rows strictly using the dynamic plan catalog (cache-hit savings
  // excluded from ROI/savings). Pool drain uses STICKER usage-value (input +
  // cache + output components at plan list rates) - what Command Code paces
  // allowances against. plan_cost stays the market-billed amount.
  // NOTE: enrichment lookups report into a throwaway per-request array, never the
  // persisted syncErrors - unmapped-model warnings must not flicker as banner
  // alerts on every GET.
  const lookupWarnings = [];
  const enrichMemo = new Map();
  const reportedMissing = buildReportedMissingSet(lookupWarnings);
  const rawRows = dailyRowsRes.results || [];
  // Turn profile for the Advisor (needs the fresh/cached/output split, which
  // the page itself no longer shows).
  let totReqsRaw = 0, totInAll = 0, totInFresh = 0, totInCached = 0, totOut = 0;
  const enrichedRows = rawRows.map(r => {
    totReqsRaw += Number(r.requests_count || 0);
    totInAll += Number(r.tokens_in_total || 0);
    totInFresh += Number(r.tokens_in_fresh || 0);
    totInCached += Number(r.tokens_cached || 0);
    totOut += Number(r.tokens_out || 0);

    const cat = lookupCatalogModel(r.model, catalogMap, lookupWarnings, enrichMemo, reportedMissing);
    const isFreeModel = Boolean(cat.isFree);
    let capUsd = (cat.monthlyCapUsd !== null && cat.monthlyCapUsd !== undefined) ? Number(cat.monthlyCapUsd) : null;
    // Unmapped models: fall back to the monthly pool so pool drain stays
    // dimensionally sane, but flag the row and keep net savings neutral (0)
    // instead of crediting the full market value as fake ROI.
    const unmappedAllowance = !isFreeModel && !(capUsd && capUsd > 0);
    if (unmappedAllowance) capUsd = monthlyPoolUsd;
    const stickerValue = Number(r.input_cost || 0) + Number(r.cache_cost || 0) + Number(r.output_cost || 0);
    // Frozen credits (>= 0) were captured with the allowance in effect when those
    // requests were ingested; -1 marks a row written before credit freezing.
    const storedCredits = (r.credits_consumed === null || r.credits_consumed === undefined) ? NaN : Number(r.credits_consumed);
    const hasStoredCredits = Number.isFinite(storedCredits) && storedCredits >= 0;
    // Credit burn: pool credits consumed per $1 of sticker usage = monthlyPool / modelCap.
    // For frozen rows, use the actual blended ratio so the column reflects the
    // allowance that was live at the time.
    const creditBurnPerUsd = isFreeModel ? 0
      : (hasStoredCredits && stickerValue > 0
          ? Number((storedCredits / stickerValue).toFixed(3))
          : ((capUsd && capUsd > 0) ? Number((monthlyPoolUsd / capUsd).toFixed(3)) : null));
    const creditsConsumed = isFreeModel ? 0
      : (hasStoredCredits
          ? Number(storedCredits.toFixed(4))
          : ((creditBurnPerUsd !== null) ? Number((stickerValue * creditBurnPerUsd).toFixed(4)) : 0));
    const poolDrainFraction = isFreeModel ? 0 : (creditsConsumed / monthlyPoolUsd);
    const realPocketCost = poolDrainFraction * paidUsd;
    const netPlanSavings = unmappedAllowance ? 0 : (Number(r.plan_cost || 0) - realPocketCost);
    const leverage = (capUsd && capUsd > 0) ? Number((capUsd / paidUsd).toFixed(2)) : null;

    return {
      usage_date: r.usage_date,
      model: r.model,
      requests_count: Number(r.requests_count || 0),
      failed_wasted_count: Number(r.failed_wasted_count || 0),
      // The page shows total tokens + cache-hit % only.
      tokens_total: Number(r.tokens_in_total || 0) + Number(r.tokens_out || 0),
      tokens_in_total: Number(r.tokens_in_total || 0),
      tokens_cached: Number(r.tokens_cached || 0),
      plan_cost: Number(r.plan_cost || 0),
      model_allowance_usd: capUsd,
      is_free_model: isFreeModel,
      unmapped_model_allowance: unmappedAllowance,
      credit_burn_per_usd: creditBurnPerUsd,
      credits_consumed: creditsConsumed,
      pool_drain_pct: Number((poolDrainFraction * 100).toFixed(2)),
      effective_real_usd: realPocketCost,
      net_plan_savings_usd: netPlanSavings,
      leverage_multiplier: leverage,
      role: cat.role || null
    };
  });

  const billingSummary = safeJsonParse(metaMap.billing_summary_json, null);
  const savedLatencies = safeJsonParse(metaMap.last_latencies_json, {});
  const counts = safeJsonParse(metaMap.table_counts_json, {});

  // Compute 5-Hour & Weekly Rolling Windows. Authoritative CC windowLimits
  // (cached at sync time) override the ledger estimate when present.
  const windowLimits = safeJsonParse(metaMap.window_limits_json, null);
  const byModelPeriod = safeJsonParse(metaMap.cc_by_model_json, null);
  const rollingWindows = computeRollingWindows(ledgerMap, catalogMap, plan, windowLimits, byModelPeriod);

  // Billing cycle from the summary (falls back to a rolling 30-day window). The
  // summary only carries periodStart, so the end is one calendar month later.
  const periodStartMs = (billingSummary && billingSummary.periodStart)
    ? new Date(billingSummary.periodStart).getTime()
    : (Date.now() - 30 * 86400000);
  let periodEndMs;
  if (billingSummary && billingSummary.periodEnd) {
    periodEndMs = new Date(billingSummary.periodEnd).getTime();
  } else if (billingSummary && billingSummary.periodStart) {
    const s = new Date(periodStartMs);
    periodEndMs = Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, s.getUTCDate(), s.getUTCHours(), s.getUTCMinutes(), s.getUTCSeconds());
  } else {
    periodEndMs = periodStartMs + 30 * 86400000;
  }
  const cycleLengthDays = Math.max(1, Math.round((periodEndMs - periodStartMs) / 86400000));
  const cycleStartDateIst = istDateStr(periodStartMs);
  const daysElapsed = Math.max(0, (Date.now() - periodStartMs) / 86400000);
  // Cycle end reached: 0 days left (never force to 1; the UI falls back via ?? not ||).
  const daysLeft = Math.max(0, Math.ceil((periodEndMs - Date.now()) / 86400000));

  // Rows belonging to the active billing cycle, for cycle-level break-even & ROI.
  const cycleRows = enrichedRows.filter(r => r.usage_date >= cycleStartDateIst);
  const cyclePoolUsedPct = Number(Math.min(100, cycleRows.reduce((s, r) => s + Number(r.pool_drain_pct || 0), 0)).toFixed(1));
  const cyclePoolRemainingPct = Number(Math.max(0, 100 - cyclePoolUsedPct).toFixed(1));
  const poolRemainingRealUsd = Number(((cyclePoolRemainingPct / 100) * paidUsd).toFixed(2));

  const trackedApiValueExtracted = cycleRows.reduce((s, r) => s + Number(r.plan_cost || 0), 0);
  const trackedRealPocketCost = cycleRows.reduce((s, r) => s + Number(r.effective_real_usd || 0), 0);
  // Sum the per-row savings: unmapped rows are neutral (0) there, and must not
  // come back as savings through value-minus-cost on the cycle total.
  const trackedNetPlanSavings = cycleRows.reduce((s, r) => s + Number(r.net_plan_savings_usd || 0), 0);
  const roiMultiplier = Number((trackedApiValueExtracted / paidUsd).toFixed(2));

  // User's average turn profile for the Advisor's per-model cost estimates.
  const totReqs = Math.max(1, totReqsRaw);
  const avgInFresh = Math.round(totInFresh / totReqs) || 1500;
  const avgInCached = Math.round(totInCached / totReqs) || 50000;
  const avgOut = Math.round(totOut / totReqs) || 600;
  const avgTotalTokens = Math.round((totInAll + totOut) / totReqs) || (avgInFresh + avgInCached + avgOut);
  const avgCacheHitPct = totInAll > 0 ? Number(((totInCached / totInAll) * 100).toFixed(1)) : 95.0;

  const poolRemainingFraction = Math.max(0.01, cyclePoolRemainingPct / 100);
  const safeDaysLeft = Math.max(1, daysLeft);
  const safeDailyPoolBudgetPct = Number((cyclePoolRemainingPct / safeDaysLeft).toFixed(2));

  // Full plan model list from the scraped catalog (current UTC peak/off-peak rates).
  const nowMs = Date.now();
  const planCatalogModels = Object.values(catalogMap)
    .filter(m => m && (m.onPlan || m.onGoatPlan))
    .map(m => {
      const liveRates = getActiveModelRatesAtTime(m, nowMs);
      const inR = Number(liveRates.in || 0);
      const outR = Number(liveRates.out || 0);
      const cacheR = Number(liveRates.cache !== null && liveRates.cache !== undefined ? liveRates.cache : inR * 0.1);
      const capUsd = m.monthlyCapUsd !== null && m.monthlyCapUsd !== undefined ? Number(m.monthlyCapUsd) : null;
      const leverage = m.isFree ? 999 : (capUsd ? Number((capUsd / paidUsd).toFixed(2)) : null);
      // Credit burn per $1 sticker usage on this model (pool / cap).
      const creditBurnPerUsd = (!m.isFree && capUsd && capUsd > 0) ? Number((monthlyPoolUsd / capUsd).toFixed(3)) : (m.isFree ? 0 : null);
      const estTurnCost = m.isFree ? 0 :
        ((avgInFresh * inR) + (avgInCached * cacheR) + (avgOut * outR)) / 1_000_000;
      const poolDrainPer10TurnsPct = (!m.isFree && capUsd && capUsd > 0) ? ((estTurnCost * 10) / capUsd) * 100 : 0;
      const remainingModelBudgetUsd = capUsd ? (capUsd * poolRemainingFraction) : 0;
      const safeTurnsPerDay = m.isFree ? 99999 :
        (estTurnCost > 0 && remainingModelBudgetUsd > 0 ? Math.floor((remainingModelBudgetUsd / estTurnCost) / safeDaysLeft) : null);
      const intel = (m.intelligence !== null && m.intelligence !== undefined) ? Number(m.intelligence) : null;
      const smartScore = intel !== null && leverage !== null
        ? Number(((intel * Math.min(10, leverage)) / Math.max(0.05, estTurnCost * 100)).toFixed(1))
        : null;

      return {
        slug: m.slug,
        name: m.name || m.slug,
        role: m.role || deriveDynamicRole(m, plan),
        contextWindow: m.contextWindow || "-",
        intelligence: intel,
        intelligenceInheritedFrom: m.intelligenceInheritedFrom || null,
        isPeakActive: Boolean(liveRates.isPeakActive),
        peakNote: m.peakSchedule ? m.peakSchedule.note : null,
        monthlyCapUsd: capUsd,
        isFree: Boolean(m.isFree),
        leverage,
        creditBurnPerUsd,
        estTurnCost: Number(estTurnCost.toFixed(4)),
        poolDrainPer10TurnsPct: Number(poolDrainPer10TurnsPct.toFixed(2)),
        safeTurnsPerDay,
        smartScore
      };
    })
    .sort((a, b) => (b.smartScore || 0) - (a.smartScore || 0));

  // One Advisor pick: the best Smart Score among paid models with an
  // intelligence score (the list is already sorted by Smart Score).
  const advisorPick = planCatalogModels.find(m => !m.isFree && m.intelligence !== null && m.smartScore !== null) || planCatalogModels[0] || null;

  // Filter out alerts dismissed within the last 24 hours.
  const activeAlerts = syncErrors
    .map(e => ({ ...e, alertKey: e.alertKey || makeAlertKey(e) }))
    .filter(e => !dismissedMap[e.alertKey] || dismissedMap[e.alertKey] <= nowMs);
  const unmappedModels = [...new Set((lookupWarnings || [])
    .filter(e => e.source === "MISSING_MODEL_CATALOG")
    .map(e => e.model))].sort();
  // The banner's UNMAPPED line is derived per load, so it carries its own key
  // (tied to the exact model set) and honours the same 24h dismissal map.
  const unmappedAlertKey = unmappedModels.length ? `UNMAPPED:${unmappedModels.join(",").slice(0, 120)}` : null;
  const unmappedAlertDismissed = Boolean(unmappedAlertKey && dismissedMap[unmappedAlertKey] && dismissedMap[unmappedAlertKey] > nowMs);

  const lastSyncTs = Number(metaMap.last_sync_ts || 0);
  const dbSizeBytes = savedLatencies.dbSizeBytes || 0;

  return {
    lastSyncTs,
    lastSyncIso: lastSyncTs ? new Date(lastSyncTs).toISOString() : null,
    lastSyncStatus: metaMap.last_sync_status || "Never synced",
    lastPushTs: Number(metaMap.last_push_ts || 0) || null,
    lastPushStatus: metaMap.last_push_status || null,
    alerts: activeAlerts,
    unmappedModels,
    unmappedAlertKey,
    unmappedAlertDismissed,
    rollingWindows,
    lastSyncCoverage,
    authProbe,
    planSummary: {
      planKey: plan ? plan.key : DEFAULT_PLAN_KEY,
      planName,
      planDetectedBy: plan ? plan.source : "default",
      priceUsd: plan ? plan.priceUsd : null,
      paidUsd,
      monthlyPoolUsd,
      fiveHourCredits: plan ? plan.fiveHourCredits : null,
      weeklyCredits: plan ? plan.weeklyCredits : null,
      cycleStartDateIst,
      cycleStartIso: (billingSummary && billingSummary.periodStart) ? billingSummary.periodStart : null,
      cycleEndIso: new Date(periodEndMs).toISOString(),
      cycleFromSummary: Boolean(billingSummary && billingSummary.periodStart),
      cycleLengthDays,
      daysElapsed: Number(daysElapsed.toFixed(1)),
      daysLeft,
      cyclePoolUsedPct,
      cyclePoolRemainingPct,
      poolRemainingRealUsd,
      safeDailyPoolBudgetPct,
      trackedApiValueExtracted: Number(trackedApiValueExtracted.toFixed(4)),
      trackedRealPocketCost: Number(trackedRealPocketCost.toFixed(4)),
      trackedNetPlanSavings: Number(trackedNetPlanSavings.toFixed(4)),
      roiMultiplier,
      breakEvenPct: Number(Math.min(100, (trackedApiValueExtracted / paidUsd) * 100).toFixed(1)),
      avgTurnProfile: { avgTotalTokens, avgCacheHitPct },
      advisorPick
    },
    planCatalogModels,
    systemInfo: {
      edgeColo,
      tables: {
        cc_daily_model_usage: counts.daily_rows_count || 0,
        cc_request_credits: counts.request_credits_count || 0,
        cc_meta: counts.meta_rows_count || 0,
        totalRows: (counts.daily_rows_count || 0) + (counts.request_credits_count || 0) + (counts.meta_rows_count || 0),
        activeDays: counts.active_days || 0
      },
      storage: {
        sizeKb: Number((dbSizeBytes / 1024).toFixed(2))
      },
      latenciesMs: {
        usageApiMs: savedLatencies.usageApiMs || 0,
        summaryApiMs: savedLatencies.summaryApiMs || 0,
        catalogApiMs: savedLatencies.catalogApiMs || 0,
        sqlWriteMs: savedLatencies.sqlWriteMs || 0,
        sqlReadMs: sqlReadLatencyMs
      },
      catalog: {
        planModelsCount: planCatalogModels.length,
        lastCatalogSyncTs: Number(metaMap.last_catalog_sync_ts || 0)
      }
    },
    billingSummary,
    dailyModelRows: enrichedRows
  };
}

async function getMeta(db, key) {
  const row = await db.prepare("SELECT value FROM cc_meta WHERE key = ?").bind(key).first();
  return row ? row.value : null;
}

async function setMeta(db, key, value) {
  await db.prepare(`INSERT INTO cc_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(key, String(value)).run();
}

// Batched D1 meta read: 1 query instead of N sequential getMeta() calls.
async function getMetaMany(db, keys) {
  if (!keys || keys.length === 0) return {};
  const placeholders = keys.map(() => "?").join(",");
  const rows = await db.prepare(`SELECT key, value FROM cc_meta WHERE key IN (${placeholders})`).bind(...keys).all();
  const map = {};
  for (const r of (rows.results || [])) map[r.key] = r.value;
  return map;
}

// Batched D1 meta write: 1 db.batch instead of N sequential setMeta() calls.
async function setMetaMany(db, entries) {
  const keys = Object.keys(entries || {});
  if (keys.length === 0) return;
  await db.batch(keys.map(k =>
    db.prepare(`INSERT INTO cc_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(k, String(entries[k]))
  ));
}

function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (_) { return fallback; }
}

// Server-side IST calendar date (YYYY-MM-DD). usage_date rows are stored in
// IST, so every cutoff/retention predicate must use this — never UTC date('now').
function istDateStr(ms) {
  return new Date(Number(ms) + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function jsonResponse(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders }
  });
}

// ============================================================================
// Dashboard UI Renderer (4 Blended Tabs, Billing Cycle Default, Smart Tooltips)
// ============================================================================
// The embedded initial payload only needs the billing-cycle rows (the default view).
// Wider ranges are fetched from /api/data on demand, keeping the HTML payload small.
function makeSlimDashboardPayload(data) {
  const rows = Array.isArray(data.dailyModelRows) ? data.dailyModelRows : [];
  const cycleStart = data.planSummary && data.planSummary.cycleStartDateIst;
  if (!cycleStart || rows.length === 0) return data;
  const cycleRows = rows.filter(r => r.usage_date >= cycleStart);
  if (cycleRows.length === rows.length) return data;
  return { ...data, dailyModelRows: cycleRows, rowsPartial: true };
}

function renderDashboardHtml(initialData) {
  const safeJson = JSON.stringify(initialData).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Command Code Usage Tracker</title>
  <style>
    :root {
      --bg: #0b0f17;
      --card: #151c28;
      --border: #263147;
      --text: #e2e8f0;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --green: #22c55e;
      --amber: #f59e0b;
      --red: #ef4444;
      --purple: #a855f7;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 16px;
      max-width: 1340px;
      margin: 0 auto;
    }
    header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 16px;
    }
    .title-group h1 { font-size: 1.35rem; font-weight: 700; }
    .sync-meta { font-size: 0.82rem; color: var(--muted); margin-top: 4px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .badge { padding: 2px 8px; border-radius: 999px; font-weight: 600; font-size: 0.74rem; display: inline-block; }
    .badge-ok { background: rgba(34,197,94,0.15); color: var(--green); }
    .badge-amber { background: rgba(245,158,11,0.18); color: var(--amber); }
    .badge-err { background: rgba(239,68,68,0.2); color: var(--red); }
    .badge-purple { background: rgba(168,85,247,0.18); color: #c084fc; }

    /* Blended Navigation Tab Bar */
    .nav-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      background: rgba(21, 28, 40, 0.75);
      padding: 6px;
      border-radius: 10px;
      border: 1px solid var(--border);
    }
    button {
      background: var(--accent);
      color: #0f172a;
      border: none;
      padding: 8px 14px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      font-size: 0.84rem;
      transition: all 0.15s ease;
    }
    button.secondary { background: var(--card); color: var(--text); border: 1px solid var(--border); }
    button.tab-btn { background: transparent; color: var(--muted); border: 1px solid transparent; padding: 7px 13px; }
    button.tab-btn:hover { color: var(--text); background: rgba(255,255,255,0.04); }
    button.tab-btn.active { background: var(--accent); color: #0f172a; font-weight: 700; }
    button.period-btn.active { background: var(--accent); color: #0f172a; border-color: var(--accent); }
    button.sm { padding: 3px 8px; font-size: 0.72rem; border-radius: 6px; }

    /* Dismissible 24h Error Banner on Main Page */
    .error-banner {
      display: none;
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid var(--red);
      color: #fca5a5;
      padding: 12px 14px;
      border-radius: 10px;
      margin-bottom: 16px;
      font-size: 0.82rem;
    }
    .error-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 8px; }
    .alert-item { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid rgba(239,68,68,0.25); }

    .tab-pane { display: none; }
    .tab-pane.active { display: block; }

    /* Viewport-Aware Hover (Laptop) & Tap (Mobile) Info Tooltip */
    .info-tip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: rgba(148, 163, 184, 0.22);
      color: var(--text);
      font-size: 0.68rem;
      font-weight: 700;
      margin-left: 5px;
      cursor: pointer;
      position: relative;
      vertical-align: middle;
      user-select: none;
      --tip-shift-x: -50%;
    }
    .info-tip::after {
      content: attr(data-tip);
      position: absolute;
      bottom: 140%;
      left: 50%;
      transform: translateX(var(--tip-shift-x, -50%));
      width: min(280px, 86vw);
      background: #0f172a;
      color: var(--text);
      border: 1px solid var(--accent);
      border-radius: 8px;
      padding: 9px 11px;
      font-size: 0.74rem;
      font-weight: 400;
      text-transform: none;
      letter-spacing: normal;
      line-height: 1.4;
      text-align: left;
      box-shadow: 0 10px 25px rgba(0,0,0,0.8);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.15s ease;
      z-index: 999;
      white-space: normal;
    }
    /* Header / Top-of-page tooltips open downward and left-aligned so they never clip */
    .info-tip.tip-down::after {
      bottom: auto;
      top: 140%;
      left: 0;
      transform: translateX(var(--tip-shift-x, 0));
    }
    .info-tip:hover::after, .info-tip:focus::after, .info-tip:active::after { opacity: 1; }

    /* Top 2 Rolling Limit Bars + Value/Break-Even Tracker */
    .window-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr)); gap: 12px; margin-bottom: 14px; }
    .roi-card {
      background: linear-gradient(135deg, rgba(21,28,40,0.95), rgba(30,41,59,0.9));
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 15px 16px;
      margin-bottom: 16px;
    }
    .roi-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
    .roi-track { height: 13px; background: rgba(255,255,255,0.07); border-radius: 999px; overflow: hidden; margin: 8px 0; }
    .roi-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--green)); border-radius: 999px; transition: width 0.3s; }

    .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
    .card-label { font-size: 0.76rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; display: flex; align-items: center; justify-content: space-between; }
    .card-val { font-size: 1.45rem; font-weight: 700; margin: 6px 0 4px; }
    .card-sub { font-size: 0.8rem; color: var(--muted); }
    .prog-track { height: 12px; background: rgba(255,255,255,0.07); border-radius: 999px; overflow: hidden; margin: 8px 0; }
    .prog-fill { height: 100%; border-radius: 999px; transition: width 0.3s; }

    /* Smart GOAT Plan Advisor & Next-Action Strategy Box */
    .advisor-box {
      background: linear-gradient(180deg, rgba(16,24,39,0.95), rgba(13,19,31,0.95));
      border: 1px solid #1e3a5f;
      border-radius: 14px;
      padding: 16px;
      margin-bottom: 22px;
    }
    .advisor-strip {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 14px;
      margin-bottom: 14px;
      border-bottom: 1px solid var(--border);
      font-size: 0.84rem;
      color: var(--muted);
    }
    .advisor-picks-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .pick-card {
      background: rgba(21, 28, 40, 0.9);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 13px 15px;
    }
    .pick-tag { font-size: 0.72rem; font-weight: 700; color: var(--accent); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
    .pick-title { font-size: 1.15rem; font-weight: 700; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
    .pick-desc { font-size: 0.8rem; color: var(--muted); line-height: 1.4; }

    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 18px; }
    .filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 16px; background: rgba(21,28,40,0.5); padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border); }
    input, select { background: var(--card); color: var(--text); border: 1px solid var(--border); padding: 7px 10px; border-radius: 8px; font-size: 0.84rem; }
    .section-title { font-size: 1.02rem; font-weight: 600; margin: 18px 0 10px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
    .table-wrap { overflow-x: auto; background: var(--card); border: 1px solid var(--border); border-radius: 12px; margin-bottom: 20px; max-height: 560px; overflow-y: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.82rem; min-width: 860px; }
    th, td { padding: 9px 11px; text-align: right; border-bottom: 1px solid var(--border); }
    th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align: left; }
    th { color: var(--muted); font-weight: 600; font-size: 0.72rem; text-transform: uppercase; background: #111722; position: sticky; top: 0; z-index: 5; cursor: pointer; user-select: none; }
    tr:last-child td { border-bottom: none; }

    .bar-wrap { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 0.8rem; }
    .bar-date { width: 88px; color: var(--muted); flex-shrink: 0; }
    .bar-track { flex: 1; height: 15px; background: rgba(255,255,255,0.05); border-radius: 4px; overflow: hidden; }
    .bar-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--purple)); border-radius: 4px; }
    .bar-amt { width: 78px; text-align: right; font-weight: 600; flex-shrink: 0; }

    .modal-backdrop { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.75); align-items: center; justify-content: center; padding: 16px; z-index: 50; }
    .modal { background: var(--card); border: 1px solid var(--border); border-radius: 12px; max-width: 460px; width: 100%; padding: 20px; }
    .form-row { margin-bottom: 11px; }
    .form-row label { display: block; font-size: 0.8rem; color: var(--muted); margin-bottom: 4px; }
    .form-row input[type="text"], .form-row input[type="password"] { width: 100%; }
    .checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 0.82rem; color: var(--text); margin-bottom: 9px; cursor: pointer; }

    @media (max-width: 640px) {
      body { padding: 10px; }
      .title-group h1 { font-size: 1.15rem; }
      .card-val { font-size: 1.25rem; }
    }
  </style>
</head>
<body>
  <header>
    <div class="title-group">
      <h1>Command Code Usage Tracker <span id="planBadge" class="badge badge-purple" style="vertical-align:middle;">-</span></h1>
      <div class="sync-meta">
        <span id="syncStatusBadge" class="badge badge-ok">Synced</span>
        <span class="info-tip tip-down" tabindex="0" data-tip="Green = last cron sync reached Command Code and D1. Red = the session cookie was rejected (HTTP 401/403) or the network failed. Bookmarklet pushes are shown separately.">i</span>
        <span id="lastSyncText">Loading...</span>
      </div>
    </div>
    <div class="nav-bar">
      <button class="tab-btn active" id="tabBtnDash" onclick="switchTab('dash')">Dashboard</button>
      <button class="tab-btn" id="tabBtnTrends" onclick="switchTab('trends')">Date-Wise &amp; Trends</button>
      <button class="tab-btn" id="tabBtnAdvisor" onclick="switchTab('advisor')">Plan Advisor</button>
      <button class="tab-btn" id="tabBtnInfo" onclick="switchTab('info')">System Info</button>
      <button onclick="openModal()">&#x21bb; Manual Refresh</button>
    </div>
  </header>

  <!-- Dismissible 24-Hour Alert Banner on Main Page -->
  <div id="errorBanner" class="error-banner">
    <div class="error-header">
      <strong style="color:var(--red)">&#x26A0; Active Fetch / Catalog Alerts (Dismissal snoozes identical alert for 24h)</strong>
      <button class="secondary sm" onclick="dismissAllAlerts()">Dismiss All (24h)</button>
    </div>
    <div id="errorList"></div>
  </div>

  <!-- ==================================================================== -->
  <!-- TAB 1: CONCISE LANDING DASHBOARD (Default: Current Billing Cycle)    -->
  <!-- ==================================================================== -->
  <div id="tabDash" class="tab-pane active">
    <div class="window-grid">
      <div class="card">
        <div class="card-label">
          <span>5-Hour Rolling Limit (<span id="w5hCapLabel">-</span> Credit Cap) <span class="info-tip tip-down" tabindex="0" data-tip="Credits of usage-value, not API dollars. Each $1 of sticker usage costs (plan pool / model allowance) credits, so low-allowance models fill the window faster. Opens on your first request and resets 5 hours later. Green under 60%, amber 60-85%, red 85% and up.">i</span></span>
          <span id="w5hReset" style="text-transform:none;">Resets: -</span>
        </div>
        <div class="prog-track"><div class="prog-fill" id="w5hBar" style="width:0%"></div></div>
        <div class="card-sub" id="w5hText">-</div>
      </div>

      <div class="card">
        <div class="card-label">
          <span>Weekly (7-Day) Rolling Limit (<span id="w7dCapLabel">-</span> Credit Cap) <span class="info-tip tip-down" tabindex="0" data-tip="Same credit math as the 5-hour window over 7 days. Used, cap and reset mirror Command Code's live window state; extra pay-as-you-go credits never count. A snapshot past its reset shows ledger usage since the reset until the next sync.">i</span></span>
          <span id="w7dReset" style="text-transform:none;">Resets: -</span>
        </div>
        <div class="prog-track"><div class="prog-fill" id="w7dBar" style="width:0%"></div></div>
        <div class="card-sub" id="w7dText">-</div>
        <div class="card-sub" id="w7dAnchor" style="opacity:0.75"></div>
        <div class="card-sub" id="w7dTop" style="opacity:0.85"></div>
      </div>
    </div>

    <!-- Window Coverage & Diagnostics (which models burned the credits, sync span) -->
    <div class="card" style="margin-bottom:14px;">
        <div class="card-label"><span>Window Diagnostics <span class="info-tip" tabindex="0" data-tip="Bars come from Command Code's own limits endpoint. The request feed only exposes the last 100 requests of the last 24h, so the local ledger is a fallback estimate.">i</span></span></div>
      <div class="card-sub" id="windowDiagText">Loading...</div>
    </div>

    <!-- Plan Value & Break-Even Tracker -->
    <div class="roi-card">
      <div class="roi-header">
        <div>
          <strong><span class="plan-name">-</span> Plan Value &amp; Break-Even Tracker (<span class="plan-paid">-</span> Paid)</strong>
          <span class="info-tip" tabindex="0" data-tip="Market-billed API value of this billing cycle's requests against what you paid for the plan (cache savings excluded). The bar fills toward break-even. Green badge = net savings of $0 or more, amber = below break-even.">i</span>
        </div>
        <div id="roiHeaderBadges"></div>
      </div>
      <div class="roi-track"><div class="roi-fill" id="roiProgressBar" style="width:0%"></div></div>
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:0.82rem;color:var(--muted);" id="roiSubText"></div>
    </div>

    <!-- Dashboard Filter Strip (Default: Current Billing Cycle) -->
    <div class="filters">
      <span style="font-size:0.8rem;color:var(--muted);font-weight:600;">Period:</span>
      <button class="secondary period-btn dash-period-btn active" data-period="cycle" onclick="setDashPeriod('cycle')">Billing Cycle</button>
      <button class="secondary period-btn dash-period-btn" data-period="today" onclick="setDashPeriod('today')">Today (IST)</button>
      <button class="secondary period-btn dash-period-btn" data-period="7d" onclick="setDashPeriod('7d')">7D</button>
      <button class="secondary period-btn dash-period-btn" data-period="30d" onclick="setDashPeriod('30d')">30D</button>
      <button class="secondary period-btn dash-period-btn" data-period="90d" onclick="setDashPeriod('90d')">90D (3M)</button>
      <input type="date" id="dashDateFrom" onchange="setDashPeriod('custom')" />
      <span style="color:var(--muted)">to</span>
      <input type="date" id="dashDateTo" onchange="setDashPeriod('custom')" />
      <select id="dashModelFilter" onchange="renderDashboardTab()"><option value="all">All Used Models</option></select>
      <span id="dashCycleMeta" class="badge badge-purple" style="margin-left:auto;">Cycle: -</span>
    </div>

    <div class="kpi-grid">
      <div class="card">
        <div class="card-label"><span>API Value Extracted <span class="info-tip" tabindex="0" data-tip="Market-billed dollar value of the requests in the selected period, including peak/off-peak pricing.">i</span></span></div>
        <div class="card-val" id="kpiPlanCost">$0.00</div>
        <div class="card-sub" id="kpiRealPocket">Real Pocket Cost: $0.00</div>
      </div>
      <div class="card">
        <div class="card-label"><span>Net Plan Savings <span class="info-tip" tabindex="0" data-tip="API value minus the share of your plan payment those requests used up. Unmapped models count as 0. Green = positive, amber = negative.">i</span></span></div>
        <div class="card-val" id="kpiNetSavings">$0.00</div>
        <div class="card-sub" id="kpiPoolShare">Pool Drained in Period: 0.0%</div>
      </div>
      <div class="card">
        <div class="card-label"><span>Cache Hit Rate <span class="info-tip" tabindex="0" data-tip="Share of input tokens served from cache. Diagnostic only; never counted as savings.">i</span></span></div>
        <div class="card-val" id="kpiCacheHit">0.0%</div>
        <div class="card-sub">of input tokens served from cache</div>
      </div>
      <div class="card">
        <div class="card-label"><span>Total Tokens <span class="info-tip" tabindex="0" data-tip="All tokens processed (input, cached and output combined) and the count of failed or zero-output turns.">i</span></span></div>
        <div class="card-val" id="kpiTotalTokens">0</div>
        <div class="card-sub" id="kpiTokenSplit">Wasted turns: 0</div>
      </div>
    </div>

    <div class="section-title">
      <span>Per-Model Usage &amp; Plan Leverage <span class="info-tip" tabindex="0" data-tip="Cap = the model's monthly allowance on your plan; leverage = cap / amount paid. Credit burn = pool credits per $1 of sticker usage (pool / cap). Credits used is what Command Code paces the 5h, weekly and monthly limits against.">i</span></span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th>Role / Tier</th>
            <th>Reqs (Wasted)</th>
            <th>Total Tokens</th>
            <th>Cache Hit %</th>
            <th>API Value ($)</th>
            <th>Plan Cap (Leverage)</th>
            <th>Credit Burn ($1 = ? cr)</th>
            <th>Credits Used</th>
            <th>Real Cost</th>
            <th>Net Plan Savings</th>
          </tr>
        </thead>
        <tbody id="modelTableBody"></tbody>
      </table>
    </div>
  </div>

  <!-- ==================================================================== -->
  <!-- TAB 2: DATE-WISE USAGE & DAILY SPEND TRENDS (Default: Billing Cycle) -->
  <!-- ==================================================================== -->
  <div id="tabTrends" class="tab-pane">
    <div class="filters">
      <span style="font-size:0.8rem;color:var(--muted);font-weight:600;">Date Range Selector:</span>
      <button class="secondary period-btn trend-period-btn active" data-period="cycle" onclick="setTrendPeriod('cycle')">Billing Cycle</button>
      <button class="secondary period-btn trend-period-btn" data-period="today" onclick="setTrendPeriod('today')">Today (IST)</button>
      <button class="secondary period-btn trend-period-btn" data-period="7d" onclick="setTrendPeriod('7d')">7 Days</button>
      <button class="secondary period-btn trend-period-btn" data-period="30d" onclick="setTrendPeriod('30d')">30 Days</button>
      <button class="secondary period-btn trend-period-btn" data-period="90d" onclick="setTrendPeriod('90d')">90 Days (3M)</button>
      <input type="date" id="trendDateFrom" onchange="setTrendPeriod('custom')" />
      <span style="color:var(--muted)">to</span>
      <input type="date" id="trendDateTo" onchange="setTrendPeriod('custom')" />
      <select id="trendModelFilter" onchange="renderTrendsTab()"><option value="all">All Used Models</option></select>
      <span id="trendCycleMeta" class="badge badge-purple" style="margin-left:auto;">Cycle: -</span>
    </div>

    <div class="section-title">
      <span>Daily Spend Trend (IST) <span class="info-tip" tabindex="0" data-tip="Market-billed API value per day for the selected range, scaled to the highest day.">i</span></span>
    </div>
    <div class="card" id="dailyChart" style="margin-bottom:20px;"></div>

    <div class="section-title">
      <span>Date-Wise Usage Breakdown (90-Day Rolling Window) <span class="info-tip" tabindex="0" data-tip="Day-by-day model rollup for the selected range. Rows older than 90 days are purged.">i</span></span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date (IST)</th>
            <th>Model</th>
            <th>Reqs</th>
            <th>Wasted</th>
            <th>Total Tokens</th>
            <th>Cache Hit %</th>
            <th>API Value ($)</th>
            <th>Credit Burn</th>
            <th>Credits Used</th>
            <th>Real Cost</th>
          </tr>
        </thead>
        <tbody id="dateTableBody"></tbody>
      </table>
    </div>
  </div>

  <!-- ==================================================================== -->
  <!-- TAB 3: PLAN ADVISOR & NEXT-ACTION STRATEGY                            -->
  <!-- ==================================================================== -->
  <div id="tabAdvisor" class="tab-pane">
    <div class="section-title">
      <span><span class="plan-name">-</span> Plan Advisor <span class="info-tip" tabindex="0" data-tip="Scraped daily (10 AM IST) from your plan's docs page. * = intelligence inherited from the base model. Est. cost per turn uses your own average turn and the current peak/off-peak rate. Leverage = cap / amount paid; credit burn = pool / cap.">i</span></span>
      <input type="text" id="catalogSearch" placeholder="Search plan models or roles..." oninput="renderCatalogTable()" style="width:270px;" />
    </div>
    <div class="advisor-box">
      <div class="advisor-strip" id="advisorStrip"></div>
      <div class="advisor-picks-grid" id="advisorPicksGrid"></div>
      <div class="table-wrap" style="margin-bottom:0;">
        <table>
          <thead>
            <tr>
              <th onclick="sortCatalog('name')">Model</th>
              <th onclick="sortCatalog('role')">Role / Tier</th>
              <th onclick="sortCatalog('intelligence')">Intelligence</th>
              <th onclick="sortCatalog('monthlyCapUsd')">Plan Cap (Leverage)</th>
              <th onclick="sortCatalog('creditBurnPerUsd')">Credit Burn</th>
              <th onclick="sortCatalog('estTurnCost')">Est. Cost / Turn (Live UTC)</th>
              <th onclick="sortCatalog('poolDrainPer10TurnsPct')">Pool Drain / 10 Turns</th>
              <th onclick="sortCatalog('safeTurnsPerDay')" id="thSafeTurns">Safe Turns / Day</th>
              <th onclick="sortCatalog('smartScore')">Smart Score &#x25BC;</th>
            </tr>
          </thead>
          <tbody id="catalogTableBody"></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ==================================================================== -->
  <!-- TAB 4: SYSTEM INFO & DIAGNOSTICS                                     -->
  <!-- ==================================================================== -->
  <div id="tabInfo" class="tab-pane">
    <div class="section-title"><span>Cloudflare D1 Database &amp; Endpoint Diagnostics</span></div>
    <div class="kpi-grid" id="sysInfoGrid"></div>
  </div>

  <!-- Manual Refresh Modal -->
  <div class="modal-backdrop" id="refreshModal">
    <div class="modal">
      <h3 style="margin-bottom:12px;">Manual Sync &amp; Dynamic Cache Controls</h3>
      <div class="form-row">
        <label>Username</label>
        <input type="text" id="authUser" placeholder="Enter username" />
      </div>
      <div class="form-row">
        <label>Password</label>
        <input type="password" id="authPass" placeholder="Enter password" />
      </div>
      <div class="form-row">
        <label>Optional: New Session Cookie (if expired)</label>
        <input type="text" id="authCookie" placeholder="Paste __Secure-commandcode_prod_.session_token" />
      </div>
      <label class="checkbox-row">
        <input type="checkbox" id="forceCatalogCheck" />
        <span>Force re-detect plan and fetch its model list, caps, roles &amp; intelligence</span>
      </label>
      <div id="modalMsg" style="font-size:0.82rem;margin:10px 0;color:var(--amber);"></div>
      <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;">
        <button class="secondary" onclick="copyBookmarklet()">Copy Mobile Bookmarklet</button>
        <div style="display:flex;gap:8px;">
          <button class="secondary" onclick="closeModal()">Cancel</button>
          <button onclick="submitRefresh()">Sync Now</button>
        </div>
      </div>
    </div>
  </div>
  <script>
    let rawData = ${safeJson};
    // Default period is "cycle" (Current Billing Cycle) everywhere per requirement
    let dashPeriod = 'cycle';
    let trendPeriod = 'cycle';
    let catalogSortKey = 'smartScore';
    let catalogSortAsc = false;
    let activeTab = 'dash';
    let adminCreds = null;
    // Last time this page pulled /api/data. Polling is capped at one fetch per
    // 15 minutes, so a dead cookie (lastSyncTs stuck in the past) can't make the
    // page hit the Worker every minute forever.
    let lastDataFetchTs = Date.now();
    const DATA_REFRESH_MS = 15 * 60 * 1000;

    function fmtUsd(n) { return '$' + Number(n || 0).toFixed(4); }
    function fmtNum(n) {
      n = Number(n || 0);
      if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
      if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
      return String(n);
    }
    function pctOf(part, whole) { return whole > 0 ? ((part / whole) * 100).toFixed(1) + '%' : '0%'; }
    // XSS guard: model slugs/names, roles, peak notes and alert messages all
    // originate from scraped docs or API text and are injected via innerHTML.
    function escHtml(s) {
      return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function escAttr(s) { return escHtml(s).replace(/\x60/g, '&#96;'); }
    function planSummary() { return rawData.planSummary || {}; }
    function paidUsd() { return Number(planSummary().paidUsd || 0); }
    // Weekly reset as "Xd Yh" (matches the CC page's "3d 21h" style), not raw total hours.
    function fmtResetDuration(ms) {
      const totalH = Math.max(0, Math.ceil((Number(ms) || 0) / 3600000));
      const d = Math.floor(totalH / 24);
      const h = totalH % 24;
      return d > 0 ? d + 'd ' + h + 'h' : h + 'h';
    }
    // One-line summary of the last sync's auth snapshot (never includes the token).
    function authProbeText(p) {
      if (!p) return '';
      const c = p.cookie || {};
      return 'usage=' + (p.usageStatus ?? '-') + ' | window=' + (p.windowStatus ?? '-') + '(' + (p.windowSource || 'n/a') + ')' +
        ' | cookie ' + (c.length ?? 0) + ' chars, pair=' + (c.hasSessionPair ? 'yes' : 'no') + ', token ends ' + (c.tokenEnd || '-') +
        ' | rotated: ' + (p.rotated ? 'yes' : 'no');
    }
    function barColor(pct) {
      if (pct >= 85) return 'var(--red)';
      if (pct >= 60) return 'var(--amber)';
      return 'var(--green)';
    }
    // Cap badge relative to the plan's pool (Go's $6-$10 and GOAT's $10-$100
    // allowances both read correctly): full/boosted = green, half+ = purple.
    function capBadgeClass(cap, isFree) {
      const pool = Number(planSummary().monthlyPoolUsd || 70);
      if (isFree || cap >= pool * 0.57) return 'badge-ok';
      if (cap >= pool * 0.28) return 'badge-purple';
      return 'badge-amber';
    }

    // Prevents any tooltip from truncating off the top, left, or right screen edges on Laptop & Mobile
    function initSmartTooltips() {
      document.querySelectorAll('.info-tip').forEach(tip => {
        if (tip.dataset.tipBound === '1') return;
        tip.dataset.tipBound = '1';
        const adjust = () => {
          const rect = tip.getBoundingClientRect();
          if (rect.top < 140) tip.classList.add('tip-down');
          else tip.classList.remove('tip-down');

          const vw = window.innerWidth || 360;
          if (rect.left < 150) {
            tip.style.setProperty('--tip-shift-x', '-10%');
          } else if (vw - rect.right < 150) {
            tip.style.setProperty('--tip-shift-x', '-90%');
          } else {
            tip.style.setProperty('--tip-shift-x', tip.classList.contains('tip-down') ? '0%' : '-50%');
          }
        };
        tip.addEventListener('mouseenter', adjust);
        tip.addEventListener('focus', adjust);
        tip.addEventListener('touchstart', adjust, { passive: true });
      });
    }

    function switchTab(tab) {
      activeTab = tab;
      const map = {
        dash: ['tabDash', 'tabBtnDash'],
        trends: ['tabTrends', 'tabBtnTrends'],
        advisor: ['tabAdvisor', 'tabBtnAdvisor'],
        info: ['tabInfo', 'tabBtnInfo']
      };
      for (const [k, [paneId, btnId]] of Object.entries(map)) {
        document.getElementById(paneId).classList.toggle('active', k === tab);
        document.getElementById(btnId).classList.toggle('active', k === tab);
      }
      // Lazy-render: only build the visible tab. Initial load renders dashboard only.
      renderActiveTab();
      initSmartTooltips();
    }

    function renderActiveTab() {
      if (activeTab === 'trends') renderTrendsTab();
      else if (activeTab === 'advisor') renderAdvisorTab();
      else if (activeTab === 'info') renderSysInfo();
      else renderDashboardTab();
    }

    // Dismisses the given alert keys for 24h. Dismiss All sends every key the
    // banner shows, derived alerts included, so none of them reappear on reload.
    async function dismissAlerts(alertKeys) {
      if (!alertKeys.length) return;
      try {
        let creds = adminCreds;
        if (!creds) {
          const username = prompt('Admin username:');
          if (!username) return;
          const password = prompt('Admin password:');
          if (!password) return;
          creds = { username, password };
        }
        const res = await fetch('/api/dismiss-alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alertKeys, username: creds.username, password: creds.password })
        });
        if (!res.ok) {
          adminCreds = null;
          alert('Dismiss failed: invalid admin credentials.');
          return;
        }
        adminCreds = creds;
        rawData.alerts = (rawData.alerts || []).filter(a => !alertKeys.includes(a.alertKey));
        if (rawData.unmappedAlertKey && alertKeys.includes(rawData.unmappedAlertKey)) rawData.unmappedAlertDismissed = true;
        renderHeaderAndAlerts();
      } catch (_) {}
    }
    function dismissAlert(alertKey) { return dismissAlerts([alertKey]); }
    function dismissAllAlerts() {
      const keys = (rawData.alerts || []).map(a => a.alertKey);
      if (rawData.unmappedAlertKey && !rawData.unmappedAlertDismissed) keys.push(rawData.unmappedAlertKey);
      return dismissAlerts(keys.filter(Boolean));
    }

    function sortCatalog(key) {
      if (catalogSortKey === key) catalogSortAsc = !catalogSortAsc;
      else { catalogSortKey = key; catalogSortAsc = false; }
      renderCatalogTable();
    }

    function initModelDropdowns() {
      const models = [...new Set((rawData.dailyModelRows || []).map(r => r.model))];
      // Escape display text; values are matched by strict equality in the filter.
      const opts = '<option value="all">All Used Models</option>' +
        models.map(m => '<option value="' + escAttr(m) + '">' + escHtml(m) + '</option>').join('');
      for (const id of ['dashModelFilter', 'trendModelFilter']) {
        const sel = document.getElementById(id);
        const cur = sel.value;
        sel.innerHTML = opts;
        if (models.includes(cur)) sel.value = cur;
      }
    }

    async function fetchData() {
      lastDataFetchTs = Date.now();
      const res = await fetch('/api/data');
      const out = await res.json();
      return (out && out.ok && out.data) ? out.data : null;
    }

    // The HTML only embeds billing-cycle rows; pull the full 90-day history on demand.
    async function ensureFullRows() {
      if (!rawData.rowsPartial) return true;
      try {
        const data = await fetchData();
        if (data) {
          rawData = data;
          initModelDropdowns();
          return true;
        }
      } catch (_) {}
      alert('Could not load the full history. Showing the current billing cycle only.');
      return false;
    }

    async function setDashPeriod(p) {
      dashPeriod = p;
      document.querySelectorAll('.dash-period-btn').forEach(b => b.classList.toggle('active', b.dataset.period === p));
      if (p !== 'cycle' && p !== 'today') await ensureFullRows();
      renderDashboardTab();
    }

    async function setTrendPeriod(p) {
      trendPeriod = p;
      document.querySelectorAll('.trend-period-btn').forEach(b => b.classList.toggle('active', b.dataset.period === p));
      if (p !== 'cycle' && p !== 'today') await ensureFullRows();
      renderTrendsTab();
    }

    function istDateStr(ms) {
      return new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);
    }

    function filterRowsByPeriod(period, fromId, toId, modelSelectId) {
      const rows = rawData.dailyModelRows || [];
      const modelSel = document.getElementById(modelSelectId).value;
      const nowMs = Date.now();
      const todayStr = istDateStr(nowMs);
      const cycleStartStr = planSummary().cycleStartDateIst || todayStr;

      let minDate = '0000-00-00', maxDate = '9999-99-99';
      if (period === 'cycle') minDate = cycleStartStr;
      else if (period === 'today') { minDate = todayStr; maxDate = todayStr; }
      // Inclusive N-day windows: 7d = today + previous 6 days (not 8 calendar dates).
      else if (period === '7d') minDate = istDateStr(nowMs - 6 * 86400000);
      else if (period === '30d') minDate = istDateStr(nowMs - 29 * 86400000);
      else if (period === '90d') minDate = istDateStr(nowMs - 89 * 86400000);
      else if (period === 'custom') {
        minDate = document.getElementById(fromId).value || '0000-00-00';
        maxDate = document.getElementById(toId).value || '9999-99-99';
      }
      return rows.filter(r => r.usage_date >= minDate && r.usage_date <= maxDate && (modelSel === 'all' || r.model === modelSel));
    }

    function renderHeaderAndAlerts() {
      const g = planSummary();
      document.getElementById('planBadge').textContent = (g.planName || '-') + ' plan';
      document.getElementById('planBadge').title = 'Detected by: ' + (g.planDetectedBy || '-');
      document.querySelectorAll('.plan-name').forEach(el => { el.textContent = g.planName || '-'; });
      document.querySelectorAll('.plan-paid').forEach(el => { el.textContent = '$' + paidUsd().toFixed(2); });

      const badge = document.getElementById('syncStatusBadge');
      const statusStr = rawData.lastSyncStatus || 'Unknown';
      const isErr = statusStr.includes('ERR') || statusStr.includes('401') || statusStr.includes('403');
      badge.className = 'badge ' + (isErr ? 'badge-err' : 'badge-ok');
      badge.textContent = isErr ? 'Cookie Expired / Auth Error' : statusStr;
      document.getElementById('lastSyncText').textContent = 'Last Sync: ' + (rawData.lastSyncTs ? new Date(rawData.lastSyncTs).toLocaleString() : 'Never') + ' (Auto-sync: 15m)' +
        (rawData.lastPushTs ? ' | Last push: ' + new Date(rawData.lastPushTs).toLocaleString() + ' ' + (rawData.lastPushStatus || '') : '');

      const alerts = Array.isArray(rawData.alerts) ? rawData.alerts : [];
      const errBanner = document.getElementById('errorBanner');
      // Unmapped models burn at the 1x pool fallback, which UNDER-reads vs CC if
      // their real cap is lower - surface as an informational (non-error) line.
      const unmapped = Array.isArray(rawData.unmappedModels) ? rawData.unmappedModels : [];
      const infoLines = (unmapped.length > 0 && !rawData.unmappedAlertDismissed)
        ? [{ source: 'UNMAPPED', alertKey: rawData.unmappedAlertKey, message: 'Not in the plan model list, so credits use the 1.00x pool fallback: ' + unmapped.join(', ') + '. Force-fetch only helps if the docs list them; otherwise these are off-plan models.' }]
        : [];
      const allLines = alerts.concat(infoLines);
      if (allLines.length > 0) {
        errBanner.style.display = 'block';
        document.getElementById('errorList').innerHTML = allLines.map(a =>
          '<div class="alert-item">' +
            '<span><strong>[' + escHtml(a.source) + ']</strong> ' + escHtml(a.message) + '</span>' +
            (a.alertKey
              ? '<button class="secondary sm alert-dismiss-btn" data-alert-key="' + escAttr(a.alertKey || '') + '">&#x2715; Dismiss 24h</button>'
              : '') +
          '</div>'
        ).join('');
        document.querySelectorAll('.alert-dismiss-btn').forEach(btn => {
          btn.addEventListener('click', () => dismissAlert(btn.dataset.alertKey));
        });
      } else {
        errBanner.style.display = 'none';
      }
    }

    function renderDashboardTab() {
      const g = planSummary();
      // 1. Render 5-Hour & Weekly Rolling Bars
      const rw = rawData.rollingWindows || { fiveHour: {}, weekly: {} };
      const w5 = rw.fiveHour || {};
      const w7 = rw.weekly || {};
      const cap5 = w5.limitCredits ?? g.fiveHourCredits ?? '-';
      const cap7 = w7.limitCredits ?? g.weeklyCredits ?? '-';
      document.getElementById('w5hCapLabel').textContent = cap5;
      document.getElementById('w7dCapLabel').textContent = cap7;

      const b5 = document.getElementById('w5hBar');
      b5.style.width = (w5.usedPct || 0) + '%';
      b5.style.background = barColor(w5.usedPct || 0);
      document.getElementById('w5hReset').textContent = w5.resetsInMinutes
        ? ('Resets in ' + Math.floor(w5.resetsInMinutes/60) + 'h ' + (w5.resetsInMinutes%60) + 'm' + (w5.resetsAtIso ? ' - at ' + new Date(w5.resetsAtIso).toLocaleTimeString() : ''))
        : 'Window idle (5h)';
      const windowSourceSuffix = (w) => w.windowExpired
        ? ' <span style="opacity:0.75">(snapshot expired - ledger usage since reset, awaiting sync)</span>'
        : (w.windowSource === 'cc-billing-limits'
            ? ' <span style="opacity:0.75">(live CC window state)</span>'
            : ' <span style="opacity:0.75">(ledger estimate)</span>');
      const leftTxt = (w) => (w.leftCredits !== null && w.leftCredits !== undefined ? w.leftCredits.toFixed(2) : '-');
      document.getElementById('w5hText').innerHTML = 'Pool Used: <strong>' + (w5.usedCredits||0).toFixed(2) + ' credits</strong> (' + (w5.usedPct||0) + '%) | Left: <strong>' + leftTxt(w5) + '</strong> of ' + cap5 + ' credits' + windowSourceSuffix(w5);

      const b7 = document.getElementById('w7dBar');
      b7.style.width = (w7.usedPct || 0) + '%';
      b7.style.background = barColor(w7.usedPct || 0);
      document.getElementById('w7dReset').textContent = (w7.resetsInMs || w7.resetsInHours)
        ? ('Resets in ' + fmtResetDuration(w7.resetsInMs ?? (w7.resetsInHours * 3600000)) + (w7.resetsAtIso ? ' - at ' + new Date(w7.resetsAtIso).toLocaleString() : ''))
        : 'Window idle (7d)';
      document.getElementById('w7dText').innerHTML = 'Pool Used: <strong>' + (w7.usedCredits||0).toFixed(2) + ' credits</strong> (' + (w7.usedPct||0) + '%) | Left: <strong>' + leftTxt(w7) + '</strong> of ' + cap7 + ' credits' + windowSourceSuffix(w7);
      document.getElementById('w7dAnchor').textContent = w7.windowOpenedAt ? ('Window opened: ' + new Date(w7.windowOpenedAt).toLocaleString() + (w7.windowSource === 'cc-billing-limits' ? ' (CC window anchor)' : ' (first tracked request)')) : '';
      document.getElementById('w7dTop').textContent = Array.isArray(w7.topModels) && w7.topModels.length
        ? ('Top credit consumers (this billing period, per CC): ' + w7.topModels.slice(0, 5).map(t => t.slug + ' ' + Number(t.credits).toFixed(1) + 'cr').join(' | '))
        : '';

      // Window diagnostics: authoritative CC window state + usage-feed coverage.
      const cov = rawData.lastSyncCoverage || null;
      const monthlyPool = rw.monthlyPool || null;
      const diagEl = document.getElementById('windowDiagText');
      if (diagEl) {
        const live = w7.windowSource === 'cc-billing-limits';
        const wlFetchedAt = Number(rw.windowLimitsFetchedAt) || 0;
        const wlAgeTxt = wlFetchedAt ? (Math.max(0, Math.round((Date.now() - wlFetchedAt) / 60000)) + 'm ago') : '-';
        const liveTxt = live
          ? ('Command Code live window state - snapshot fetched ' + wlAgeTxt)
          : (w7.windowExpired ? 'expired CC snapshot + ledger since reset (fetched ' + wlAgeTxt + ')' : 'local ledger estimate');
        diagEl.innerHTML =
          'Bar source: <strong>' + escHtml(liveTxt) + '</strong> | ' +
          'Monthly pool: <strong>' + (monthlyPool ? (Number(monthlyPool.used).toFixed(2) + ' / ' + monthlyPool.granted + ' credits') : '-') + '</strong> | ' +
          'Usage feed: last sync fetched <strong>' + (cov ? (cov.totalFetched ?? 0) : 0) + '</strong> requests' +
          (cov && cov.gapSuspected ? ' | <strong style="color:var(--amber)">GAP: more than 100 requests since the previous sync - some are missing from the daily tables.</strong>' : '');
      }

      // 2. Render Plan Value & Break-Even Bar
      const paid = paidUsd();
      // ?? (not ||): a legitimate 0 daysLeft / 0 % must render, not fall back to 30/100.
      const daysLeftTxt = (g.daysLeft ?? 30) + 'd left';
      const cycleBadgeText = 'Cycle Start: ' + (g.cycleStartDateIst || '-') + ' IST (' + daysLeftTxt + ')' + (g.cycleFromSummary === false ? ' - est.' : '');
      document.getElementById('dashCycleMeta').textContent = cycleBadgeText;
      document.getElementById('trendCycleMeta').textContent = cycleBadgeText;

      document.getElementById('roiProgressBar').style.width = Math.min(100, g.breakEvenPct || 0) + '%';
      const netSavCycle = Number(g.trackedNetPlanSavings || 0);
      document.getElementById('roiHeaderBadges').innerHTML =
        '<span class="badge ' + (netSavCycle >= 0 ? 'badge-ok' : 'badge-amber') + '">' +
        'Cycle ROI: ' + (g.roiMultiplier || 0) + 'x | Net Plan Savings: ' + (netSavCycle >= 0 ? '+' : '') + '$' + netSavCycle.toFixed(2) +
        '</span>';
      document.getElementById('roiSubText').innerHTML =
        '<span>Paid (' + escHtml(g.planName || '-') + '): <strong>$' + paid.toFixed(2) + '</strong></span>' +
        '<span>Cycle API Value Extracted: <strong>$' + Number(g.trackedApiValueExtracted || 0).toFixed(2) + '</strong></span>' +
        '<span>Real Pocket Used: <strong>$' + Number(g.trackedRealPocketCost || 0).toFixed(2) + '</strong></span>' +
        '<span>Break-Even Progress: <strong>' + (g.breakEvenPct || 0) + '%</strong></span>';

      // 3. Dashboard Filtered KPIs & Per-Model Table
      const filtered = filterRowsByPeriod(dashPeriod, 'dashDateFrom', 'dashDateTo', 'dashModelFilter');
      let planCost = 0, realPocket = 0, netSav = 0, poolPct = 0, wasted = 0;
      let tokensTotal = 0, inTotal = 0, cached = 0;
      const byModel = {};

      for (const r of filtered) {
        planCost += Number(r.plan_cost || 0);
        realPocket += Number(r.effective_real_usd || 0);
        netSav += Number(r.net_plan_savings_usd || 0);
        poolPct += Number(r.pool_drain_pct || 0);
        wasted += Number(r.failed_wasted_count || 0);
        tokensTotal += Number(r.tokens_total || 0);
        inTotal += Number(r.tokens_in_total || 0);
        cached += Number(r.tokens_cached || 0);

        if (!byModel[r.model]) {
          byModel[r.model] = {
            model: r.model, role: r.role || '-', reqs: 0, wasted: 0,
            tokensTotal: 0, inTotal: 0, cached: 0,
            plan: 0, realPocket: 0, netSav: 0, creditsUsed: 0,
            allowance: r.model_allowance_usd, leverage: r.leverage_multiplier,
            burnPerUsd: r.credit_burn_per_usd,
            free: Boolean(r.is_free_model),
            unmapped: Boolean(r.unmapped_model_allowance)
          };
        }
        const m = byModel[r.model];
        m.reqs += Number(r.requests_count || 0);
        m.wasted += Number(r.failed_wasted_count || 0);
        m.tokensTotal += Number(r.tokens_total || 0);
        m.inTotal += Number(r.tokens_in_total || 0);
        m.cached += Number(r.tokens_cached || 0);
        m.plan += Number(r.plan_cost || 0);
        m.realPocket += Number(r.effective_real_usd || 0);
        m.netSav += Number(r.net_plan_savings_usd || 0);
        m.creditsUsed += Number(r.credits_consumed || 0);
      }

      document.getElementById('kpiPlanCost').textContent = fmtUsd(planCost);
      document.getElementById('kpiRealPocket').textContent = 'Real Pocket Cost (of $' + paid.toFixed(2) + '): ' + fmtUsd(realPocket);
      const savEl = document.getElementById('kpiNetSavings');
      savEl.textContent = (netSav >= 0 ? '+' : '') + fmtUsd(netSav);
      savEl.style.color = netSav >= 0 ? 'var(--green)' : 'var(--amber)';
      document.getElementById('kpiPoolShare').textContent = 'Pool Drained in Period: ' + poolPct.toFixed(2) + '%';
      document.getElementById('kpiCacheHit').textContent = pctOf(cached, inTotal);
      document.getElementById('kpiTotalTokens').textContent = fmtNum(tokensTotal);
      document.getElementById('kpiTokenSplit').textContent = 'Wasted turns: ' + wasted;

      const modelArr = Object.values(byModel).sort((a,b) => b.plan - a.plan);
      document.getElementById('modelTableBody').innerHTML = modelArr.length === 0
        ? '<tr><td colspan="11" style="text-align:center;color:var(--muted);">No usage recorded for selected period (' + dashPeriod.toUpperCase() + ').</td></tr>'
        : modelArr.map(m => {
            const capTxt = m.free ? 'Free (0 cr)' : (m.unmapped ? 'Unmapped (pool $)' : (m.allowance ? ('$' + m.allowance + ' (' + m.leverage + 'x)') : 'Unmapped'));
            const savTxt = (m.netSav >= 0 ? '+' : '') + fmtUsd(m.netSav);
            const burnTxt = m.free ? 'Free' : ((m.burnPerUsd !== null && m.burnPerUsd !== undefined) ? (Number(m.burnPerUsd).toFixed(2) + 'x') : '-');
            return '<tr>' +
              '<td><strong>' + escHtml(m.model) + '</strong></td>' +
              '<td style="color:var(--muted)">' + escHtml(m.role) + '</td>' +
              '<td>' + m.reqs + ' (' + m.wasted + ')</td>' +
              '<td>' + fmtNum(m.tokensTotal) + '</td>' +
              '<td>' + pctOf(m.cached, m.inTotal) + '</td>' +
              '<td><strong>' + fmtUsd(m.plan) + '</strong></td>' +
              '<td><span class="badge ' + capBadgeClass(m.allowance || 0, m.free) + '">' + capTxt + '</span></td>' +
              '<td><strong>' + burnTxt + '</strong></td>' +
              '<td><strong>' + Number(m.creditsUsed || 0).toFixed(2) + ' cr</strong></td>' +
              '<td>' + fmtUsd(m.realPocket) + '</td>' +
              '<td style="color:' + (m.netSav >= 0 ? 'var(--green)' : 'var(--amber)') + ';font-weight:600;">' + savTxt + '</td>' +
            '</tr>';
          }).join('');
    }

    // Shared Date Selector controls BOTH Daily Spend Trend (IST) and Date-Wise Breakdown
    function renderTrendsTab() {
      const filtered = filterRowsByPeriod(trendPeriod, 'trendDateFrom', 'trendDateTo', 'trendModelFilter');
      const byDate = {};
      for (const r of filtered) {
        byDate[r.usage_date] = (byDate[r.usage_date] || 0) + Number(r.plan_cost || 0);
      }

      const dates = Object.keys(byDate).sort().reverse();
      const maxSpend = Math.max(...Object.values(byDate), 0.0001);
      document.getElementById('dailyChart').innerHTML = dates.length === 0
        ? '<div style="color:var(--muted);font-size:0.84rem;">No usage recorded in selected date range (' + trendPeriod.toUpperCase() + ').</div>'
        : dates.map(d => '<div class="bar-wrap"><div class="bar-date">' + d + '</div><div class="bar-track"><div class="bar-fill" style="width:' + Math.max(2, Math.round((byDate[d]/maxSpend)*100)) + '%"></div></div><div class="bar-amt">' + fmtUsd(byDate[d]) + '</div></div>').join('');

      document.getElementById('dateTableBody').innerHTML = filtered.length === 0
        ? '<tr><td colspan="10" style="text-align:center;color:var(--muted);">No date-wise rows for selected range (' + trendPeriod.toUpperCase() + ').</td></tr>'
        : filtered.map(r => {
            const burnTxt = r.is_free_model ? 'Free' : ((r.credit_burn_per_usd !== null && r.credit_burn_per_usd !== undefined) ? (Number(r.credit_burn_per_usd).toFixed(2) + 'x') : '-');
            return '<tr><td>' + escHtml(r.usage_date) + '</td><td>' + escHtml(r.model) + '</td><td>' + r.requests_count + '</td><td>' + r.failed_wasted_count + '</td><td>' + fmtNum(r.tokens_total) + '</td><td>' + pctOf(r.tokens_cached, r.tokens_in_total) + '</td><td><strong>' + fmtUsd(r.plan_cost) + '</strong></td><td><strong>' + burnTxt + '</strong></td><td><strong>' + Number(r.credits_consumed || 0).toFixed(2) + ' cr</strong></td><td>' + fmtUsd(r.effective_real_usd) + '</td></tr>';
          }).join('');
    }

    function renderAdvisorTab() {
      const g = planSummary();
      const prof = g.avgTurnProfile || {};
      document.getElementById('advisorStrip').innerHTML =
        '<span>Cycle Remaining: <strong style="color:var(--text)">' + (g.daysLeft ?? 30) + ' days</strong></span>' +
        '<span>Pool Remaining: <strong style="color:var(--green)">' + (g.cyclePoolRemainingPct ?? 100) + '% ($' + (g.poolRemainingRealUsd ?? paidUsd()) + ' of $' + paidUsd().toFixed(2) + ')</strong></span>' +
        '<span>Safe Daily Pool Budget: <strong style="color:var(--accent)">' + (g.safeDailyPoolBudgetPct ?? 3.33) + '% / day</strong></span>' +
        '<span>Your Avg Turn: <strong style="color:var(--text)">' + fmtNum(prof.avgTotalTokens || 0) + ' tokens (' + (prof.avgCacheHitPct ?? 0) + '% cached)</strong></span>';

      document.getElementById('thSafeTurns').textContent = 'Safe Turns / Day (' + (g.daysLeft ?? 30) + 'D Left)';

      const m = g.advisorPick;
      let card;
      if (!m) {
        card = '<div class="pick-card"><div class="pick-tag">&#x1F3AF; Best Pick</div><div class="pick-desc">Run Manual Refresh with the model list checked.</div></div>';
      } else {
        const capLabel = m.isFree ? 'Free' : ('$' + (m.monthlyCapUsd || '-') + ' cap (' + (m.leverage || '-') + 'x)');
        const intelLabel = m.intelligence !== null ? ('Intelligence: <strong>' + m.intelligence + (m.intelligenceInheritedFrom ? '*' : '') + '</strong> | ') : '';
        card = '<div class="pick-card">' +
          '<div class="pick-tag">&#x1F3AF; Best Pick (Top Smart Score)</div>' +
          '<div class="pick-title"><span>' + escHtml(m.name) + '</span><span class="badge ' + capBadgeClass(m.monthlyCapUsd || 0, m.isFree) + '">' + escHtml(capLabel) + '</span></div>' +
          '<div class="pick-desc">' + intelLabel + 'Supports <strong>~' + fmtNum(m.safeTurnsPerDay || 0) + ' turns/day</strong> (' + fmtUsd(m.estTurnCost) + '/turn at your cache rate; uses ~' + m.poolDrainPer10TurnsPct + '% of its allowance per 10 turns). Role: ' + escHtml(m.role || '-') + '.</div>' +
        '</div>';
      }
      document.getElementById('advisorPicksGrid').innerHTML = card;

      renderCatalogTable();
    }

    function renderCatalogTable() {
      const q = (document.getElementById('catalogSearch').value || '').toLowerCase().trim();
      const list = (rawData.planCatalogModels || [])
        .filter(m => !q || m.name.toLowerCase().includes(q) || m.slug.includes(q) || (m.role||'').toLowerCase().includes(q))
        .sort((a, b) => {
          const vA = a[catalogSortKey] ?? -1;
          const vB = b[catalogSortKey] ?? -1;
          if (typeof vA === 'string') return catalogSortAsc ? vA.localeCompare(vB) : vB.localeCompare(vA);
          return catalogSortAsc ? (vA - vB) : (vB - vA);
        });

      document.getElementById('catalogTableBody').innerHTML = list.length === 0
        ? '<tr><td colspan="9" style="text-align:center;color:var(--muted);">No plan catalog models cached yet. Click Manual Refresh and check the model list box.</td></tr>'
        : list.map(m => {
            const intelTxt = m.intelligence !== null ? (m.intelligence + (m.intelligenceInheritedFrom ? ' *' : '')) : 'Unscored';
            const capTxt = m.isFree ? 'Free (Unlimited)' : (m.monthlyCapUsd ? ('$' + m.monthlyCapUsd + ' (' + m.leverage + 'x)') : 'Unmapped');
            const burnTxt = m.isFree ? 'Free' : ((m.creditBurnPerUsd !== null && m.creditBurnPerUsd !== undefined) ? (Number(m.creditBurnPerUsd).toFixed(2) + 'x') : '-');
            const safeTxt = m.isFree ? 'Unlimited' : (m.safeTurnsPerDay !== null ? (fmtNum(m.safeTurnsPerDay) + ' / day') : '-');
            const scoreTxt = m.smartScore !== null ? m.smartScore : '-';
            const flexBadge = m.peakNote
              ? ' <span class="badge ' + (m.isPeakActive ? 'badge-amber' : 'badge-ok') + '" title="' + escAttr(m.peakNote) + '">' + (m.isPeakActive ? 'Peak Now' : 'Off-Peak Now') + '</span>'
              : '';
            return '<tr>' +
              '<td><strong>' + escHtml(m.name) + '</strong> <span style="color:var(--muted);font-size:0.74rem;">(' + escHtml(m.contextWindow) + ')</span>' + flexBadge + '</td>' +
              '<td style="color:var(--muted)">' + escHtml(m.role || '-') + '</td>' +
              '<td><strong>' + intelTxt + '</strong></td>' +
              '<td><span class="badge ' + capBadgeClass(m.monthlyCapUsd || 0, m.isFree) + '">' + capTxt + '</span></td>' +
              '<td><strong>' + escHtml(burnTxt) + '</strong></td>' +
              '<td>' + fmtUsd(m.estTurnCost) + '</td>' +
              '<td>' + m.poolDrainPer10TurnsPct + '%</td>' +
              '<td><strong>' + safeTxt + '</strong></td>' +
              '<td><span class="badge badge-ok">' + scoreTxt + '</span></td>' +
            '</tr>';
          }).join('');
    }

    // Four cards: auth probe, sync coverage, row counts + storage, latencies.
    function renderSysInfo() {
      const sys = rawData.systemInfo || {}, t = sys.tables || {}, st = sys.storage || {}, lat = sys.latenciesMs || {}, cat = sys.catalog || {};
      const g = planSummary();
      const cov = rawData.lastSyncCoverage || null;
      const p = rawData.authProbe;
      const catSync = cat.lastCatalogSyncTs ? new Date(cat.lastCatalogSyncTs).toLocaleString() : 'Never';
      const cards = [
        {
          label: 'Session Cookie Probe',
          val: p ? ('usage ' + (p.usageStatus ?? '-') + ' | window ' + (p.windowStatus ?? '-')) : 'No sync yet',
          sub: p ? (authProbeText(p) + ' | ' + new Date(p.ts).toLocaleString()) : 'Run Manual Refresh once'
        },
        {
          label: 'Sync Coverage',
          val: cov ? ((cov.totalFetched ?? 0) + ' requests' + (cov.gapSuspected ? ' (GAP)' : '')) : 'No sync yet',
          sub: (cov && cov.oldestFetchedIso ? 'Feed span: ' + new Date(cov.oldestFetchedIso).toLocaleString() + ' -> ' + new Date(cov.newestFetchedIso).toLocaleString() + ' | ' : '') +
            'Plan: ' + escHtml(g.planName || '-') + ' (' + escHtml(g.planDetectedBy || '-') + ') | Catalog: ' + (cat.planModelsCount || 0) + ' models, ' + catSync
        },
        {
          label: 'D1 Rows & Storage',
          val: (t.totalRows || 0) + ' rows | ' + (st.sizeKb || 0) + ' KB',
          sub: 'Daily: ' + (t.cc_daily_model_usage || 0) + ' (' + (t.activeDays || 0) + '/90 days) | Ledger: ' + (t.cc_request_credits || 0) + ' | Meta: ' + (t.cc_meta || 0)
        },
        {
          label: 'Latencies',
          val: 'Usage API: ' + (lat.usageApiMs || 0) + ' ms',
          sub: 'Summary: ' + (lat.summaryApiMs || 0) + ' ms | Catalog: ' + (lat.catalogApiMs || 0) + ' ms | SQL read/write: ' + (lat.sqlReadMs || 0) + '/' + (lat.sqlWriteMs || 0) + ' ms | Colo: ' + escHtml(sys.edgeColo || 'N/A')
        }
      ];
      document.getElementById('sysInfoGrid').innerHTML = cards
        .map(c => '<div class="card"><div class="card-label">' + c.label + '</div><div class="card-val" style="font-size:1.1rem;">' + escHtml(c.val) + '</div><div class="card-sub">' + c.sub + '</div></div>').join('');
    }

    function renderAll() {
      renderHeaderAndAlerts();
      renderActiveTab();
      initSmartTooltips();
    }

    function openModal() { document.getElementById('modalMsg').textContent = ''; document.getElementById('refreshModal').style.display = 'flex'; }
    function closeModal() { document.getElementById('refreshModal').style.display = 'none'; }

    async function submitRefresh() {
      const username = document.getElementById('authUser').value.trim();
      const password = document.getElementById('authPass').value.trim();
      const cookie = document.getElementById('authCookie').value.trim();
      const forceCatalogSync = document.getElementById('forceCatalogCheck').checked;
      const msg = document.getElementById('modalMsg');
      msg.textContent = 'Syncing usage & selected dynamic catalogs...';
      try {
        const res = await fetch('/api/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, cookie, forceCatalogSync })
        });
        const out = await res.json();
        if (!res.ok || !out.ok) { msg.textContent = out.error || 'Sync failed'; return; }
        adminCreds = { username, password };
        rawData = out.data;
        lastDataFetchTs = Date.now();
        initModelDropdowns();
        renderAll();
        // /api/refresh returns ok:true even when the CC sync itself 401'd -
        // surface the real error instead of a false "Synced!".
        const probeLine = (out.syncResult && out.syncResult.authProbe) ? ' [' + authProbeText(out.syncResult.authProbe) + ']' : '';
        if (out.syncResult && out.syncResult.ok === false) {
          msg.textContent = 'Sync ran but CC rejected the cookie: ' + (out.syncResult.error || 'auth error') + probeLine;
          setTimeout(closeModal, 8000);
        } else {
          msg.textContent = 'Synced! (+' + (out.syncResult.newRecordsCount || 0) + ' new entries, plan: ' + (out.syncResult.plan || '-') + ')' + (out.syncResult.cookieRotated ? ' | session cookie auto-rotated' : '') + probeLine;
          setTimeout(closeModal, 1500);
        }
      } catch (e) { msg.textContent = 'Error: ' + e.message; }
    }

    function copyBookmarklet() {
      const origin = window.location.origin;
      const msg = document.getElementById('modalMsg');
      // NOTE: fill in your admin username below (password stays server-side in ADMIN_PASS).
      const bmUser = 'REPLACE_WITH_ADMIN_USER';
      // Pushes usage ledger + LIVE window state + per-model credits from the
      // logged-in commandcode.ai session (credentials:'include'), so the tracker
      // stays fed even when the stored session cookie is dead - HttpOnly cookies
      // can never be read by a bookmarklet, but they ARE sent on these fetches.
      // RUN IT WHILE commandcode.ai IS OPEN AND LOGGED IN on that device/browser.
      // void() wrapper so iOS Safari doesn't blank the page; per-endpoint statuses
      // are reported in the alert so any failure leg is visible instantly.
      const bm = "javascript:void((async()=>{try{const u=prompt('Tracker username:','" + bmUser + "');if(!u)return;const p=prompt('Tracker password:');if(!p)return;const st=[];let d={usages:[]};try{const r=await fetch('https://api.commandcode.ai/internal/usage?limit=100',{credentials:'include'});st.push('usage:'+r.status);if(r.ok){d=await r.json();}}catch(e){st.push('usage:ERR');}let wl=null;try{const w=await fetch('https://api.commandcode.ai/internal/billing/credits',{credentials:'include'});st.push('bars:'+w.status);if(w.ok){const wd=await w.json();if(wd&&wd.windowLimits&&wd.windowLimits.fiveHour&&wd.windowLimits.weekly){wl={fiveHour:wd.windowLimits.fiveHour,weekly:wd.windowLimits.weekly,monthlyUsed:(wd.credits&&wd.credits.monthlyCredits)||0,monthlyGranted:(wd.credits&&wd.credits.monthlyCreditsGranted)||null,ts:Date.now()};}}}catch(e){st.push('bars:ERR');}let byModel=null;let bmWin=null;try{const b=await fetch('https://api.commandcode.ai/internal/usage/by-model',{credentials:'include'});st.push('by-model:'+b.status);if(b.ok){const bd=await b.json();if(bd&&Array.isArray(bd.data)){byModel=bd.data;bmWin=bd.window||null;}}}catch(e){st.push('by-model:ERR');}const s=await fetch('" + origin + "/api/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p,usages:d.usages||[],windowLimits:wl,byModel:byModel,byModelWindow:bmWin})});st.push('push:'+s.status);const j=await s.json();alert(s.ok?('CC Tracker pushed ['+st.join(', ')+'] +'+(j.newRecordsCount||0)+' new requests'+(wl?' + live bars':'')+(byModel?' + by-model':'')):('Push failed: '+(j.error||s.status)+' ['+st.join(', ')+']'));}catch(e){alert('Sync failed: '+e.message);}})());";
      const done = () => { msg.textContent = 'Bookmarklet copied! Run it while commandcode.ai is OPEN + logged in. Alert shows per-endpoint statuses (usage / bars / by-model / push).'; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(bm).then(done).catch(() => fallbackCopyBookmarklet(bm, msg));
      } else {
        fallbackCopyBookmarklet(bm, msg);
      }
    }

    function fallbackCopyBookmarklet(bm, msg) {
      try {
        const ta = document.createElement('textarea');
        ta.value = bm;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        msg.textContent = 'Bookmarklet copied!';
      } catch (e) {
        msg.textContent = 'Copy failed - clipboard unavailable. Paste manually from the worker file.';
      }
    }

    // Pull fresh /api/data at most once per 15 minutes while the tab is visible.
    async function checkAutoRefreshOnFocus() {
      if (document.visibilityState !== 'visible' || Date.now() - lastDataFetchTs < DATA_REFRESH_MS) return;
      try {
        const data = await fetchData();
        if (data) {
          rawData = data;
          initModelDropdowns();
          renderAll();
        }
      } catch (_) {}
    }
    // Stale page loads sync in the background; poll briefly so the view catches up without a reload.
    async function refreshAfterBackgroundSync() {
      const stale = !rawData.lastSyncTs || (Date.now() - rawData.lastSyncTs >= DATA_REFRESH_MS);
      if (!stale) return;
      const before = rawData.lastSyncTs || 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise(r => setTimeout(r, 5000));
        try {
          const next = await fetchData();
          if (next) {
            // Failed syncs do not advance lastSyncTs, so also react to status/alert changes.
            const changed = next.lastSyncTs > before
              || next.lastSyncStatus !== rawData.lastSyncStatus
              || (next.alerts || []).length !== (rawData.alerts || []).length;
            if (changed) {
              rawData = next;
              initModelDropdowns();
              renderAll();
              return;
            }
          }
        } catch (_) {}
      }
    }

    document.addEventListener('visibilitychange', checkAutoRefreshOnFocus);
    setInterval(checkAutoRefreshOnFocus, 60000);

    initModelDropdowns();
    renderAll();
    refreshAfterBackgroundSync();
  </script>
</body>
</html>`;
}