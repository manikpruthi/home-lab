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
//   no longer split one model into provider-prefixed duplicates.
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
// - Confirmed renames alias in canonicalModelSlug (deepseek-v4-flash,
//   deepseek-v41-flash -> deepseek-v41-flash-fast); daily rows also merge by
//   canonical key at read time, and the legacy-row migration runs on forced refresh.
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
// User-confirmed renames: the same DeepSeek model shipped under several raw names
// across revisions. Mechanical canonicalization can't merge v4 with v41 (those read
// as genuinely different versions), so these exact legacy slugs alias to the newest
// canonical key. Keep this list to confirmed renames only - a wrong entry would pace
// usage against the wrong monthly cap.
const LEGACY_MODEL_ALIASES = {
  "deepseek-v4-flash": "deepseek-v41-flash-fast",
  "deepseek-v41-flash": "deepseek-v41-flash-fast"
};
// Command Code's session cookie. CC rotates this token server-side, so any
// static pasted copy goes stale fast - captureSessionCookieRotation() keeps the
// stored copy current from Set-Cookie response headers.
const SESSION_COOKIE_NAME = "__Secure-commandcode_prod_.session_token";
const CACHE_TTL_MS = 15 * 60 * 1000;            // 15 minutes usage auto-refresh TTL (matches 15m Cron)
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;     // 24 hours pricing/catalog & alert snooze TTL
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;       // 5-hour rolling window
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;  // 7-day weekly rolling window
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;     // UTC+05:30 (India Standard Time)
const GOAT_PAID_USD = 10.78;                    // GOAT plan $10.00 + $0.78 processing fee
const INGEST_BATCH_SIZE = 100;                  // D1 max statements per batch
const DOC_CACHE_OPTS = { cf: { cacheTtl: 86400 } }; // 24h edge cache for docs/OpenRouter (still gated by 10AM IST rule)
const SYNC_LEASE_MS = 90 * 1000;                // D1 lease held by a running sync / ingest
const SYNC_LEASE_WAIT_MS = 10 * 1000;           // Manual refresh + bookmarklet push wait this long for the lease
const SYNC_RETRY_FLOOR_MS = 5 * 60 * 1000;      // Do not re-attempt a failed sync more often than this
const ROLLUP_RETENTION_DAYS = 90;               // cc_daily_model_usage window
const SEEN_RETENTION_DAYS = 91;                 // >= rollup window so dedupe IDs outlive aggregates
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000; // Run retention DELETEs at most once per day

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
    ctx.waitUntil(syncUsageData(env, false, false, false));
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

        const forcePriceSync = Boolean(body.forcePriceSync);
        const forceCatalogSync = Boolean(body.forceCatalogSync);
        const syncResult = await syncUsageData(env, true, forcePriceSync, forceCatalogSync);
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
        const alertKey = String(body.alertKey || "").trim();
        if (alertKey) {
          const meta = await getMetaMany(env.DB, ["dismissed_alerts_json", "sync_errors_json"]);
          const map = safeJsonParse(meta.dismissed_alerts_json, {});
          const now = Date.now();
          for (const [k, exp] of Object.entries(map)) {
            if (exp <= now) delete map[k];
          }
          if (alertKey === "__ALL__") {
            const errs = safeJsonParse(meta.sync_errors_json, []);
            for (const e of errs) {
              map[makeAlertKey(e)] = now + CATALOG_TTL_MS;
            }
          } else {
            map[alertKey] = now + CATALOG_TTL_MS;
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
          const catalogMap = await getCachedCatalogMap(env.DB);
          const seenSet = await getBoundedSeenSet(env.DB);
          const { newRecordsCount, writeLatencyMs, dbMeta } = await ingestUsageItems(env.DB, usages, seenSet, catalogMap);
          await updateRollingWindowLedger(env.DB, usages);
          await enforceRetentionAndMeta(env, newRecordsCount, "OK (Bookmarklet Push)", { writeLatencyMs, dbMeta });
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
            syncResult = await syncUsageData(env, false, false, false);
          } else {
            ctx.waitUntil(syncUsageData(env, false, false, false));
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
            await syncUsageData(env, false, false, false);
          } else {
            ctx.waitUntil(syncUsageData(env, false, false, false));
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

async function syncUsageData(env, forced = false, forcePriceSync = false, forceCatalogSync = false) {
  const background = !forced && !forcePriceSync && !forceCatalogSync;
  if (background) {
    if (inFlightSync) return inFlightSync;
    inFlightSync = runSyncUsageData(env, forced, forcePriceSync, forceCatalogSync)
      .finally(() => { inFlightSync = null; });
    return inFlightSync;
  }
  if (inFlightSync) { try { await inFlightSync; } catch (_) {} }
  return runSyncUsageData(env, forced, forcePriceSync, forceCatalogSync);
}

async function runSyncUsageData(env, forced = false, forcePriceSync = false, forceCatalogSync = false) {
  const leaseToken = await acquireSyncLease(env.DB, forced ? SYNC_LEASE_WAIT_MS : 0);
  if (!leaseToken) {
    return { ok: false, busy: true, error: "A sync is already in progress. Please retry in a few seconds." };
  }
  try {
    return await syncUsageDataUnlocked(env, forced, forcePriceSync, forceCatalogSync);
  } finally {
    await releaseSyncLease(env.DB, leaseToken);
  }
}

async function syncUsageDataUnlocked(env, forced = false, forcePriceSync = false, forceCatalogSync = false) {
  const db = env.DB;
  const syncErrors = [];
  const latencies = {
    usageApiMs: 0,
    summaryApiMs: 0,
    pricingApiMs: 0,
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

  // Seen-IDs window matches the 91-day retention so dedupe rows outlive the 90-day rollup.
  const seenSet = await getBoundedSeenSet(db);
  // /internal/usage only serves the last 100 entries of the last 24h with no
  // cursor pagination, so the request ledger can never backfill a full 7-day
  // window on its own. The 5h/weekly bars read CC's authoritative windowLimits
  // from /internal/billing/credits instead; needsBackfill merely forces a fresh
  // read of the whole 24h feed on manual refresh.
  const prevCoverage = safeJsonParse(await getMeta(db, "last_sync_coverage_json"), null);
  const needsBackfill = !prevCoverage
    || prevCoverage.truncated === true
    || !prevCoverage.oldestFetchedIso
    || (Date.now() - new Date(prevCoverage.oldestFetchedIso).getTime()) < (SEVEN_DAYS_MS - 3600000);

  // Authoritative 5h/weekly window state + per-model credit attribution come
  // straight from CC's billing service (session cookie, API-key fallback).
  // Fetched BEFORE the usage feed so an expired cookie still refreshes the bars
  // via the alpha route even when /internal/usage 401s.
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

  let cursor = null;
  let pagesFetched = 0;
  let newRecordsCount = 0;
  const maxPages = 50; // Safety cap only - /internal/usage serves at most 100 entries of the last 24h and never a nextCursor, so this loop exits after page 1.
  const usagePageSize = "100"; // /internal/usage hard-rejects limit > 100 (HTTP 400). It is a 24h feed with no pagination; 7d history is not fetchable from it.
  const allFetchedUsages = [];
  let ccAuthSucceeded = false;
  let rotatedThisSync = false;

  while (pagesFetched < maxPages) {
    const apiUrl = new URL("https://api.commandcode.ai/internal/usage");
    apiUrl.searchParams.set("limit", usagePageSize);
    if (cursor) apiUrl.searchParams.set("cursor", cursor);

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
    latencies.usageApiMs += Math.round(performance.now() - t0);

    // A rotated session token minted on ANY response (even a 401's recovery
    // flow) is persisted for the next sync - this is what keeps a static
    // pasted copy from going stale between cron runs.
    if (await captureSessionCookieRotation(db, resp, cookieHeader, authProbe)) rotatedThisSync = true;
    authProbe.usageStatus = resp.status;

    if (!resp.ok) {
      const errText = await resp.text();
      const errMsg = `Usage API HTTP ${resp.status}: Session token expired or invalid. CC rotates its session token, so a pasted copy goes stale quickly - re-paste the current __Secure-commandcode_prod_.session_token via Manual Refresh. (${errText.slice(0, 240)})`;
      syncErrors.push({ source: "USAGE_API", code: String(resp.status), message: errMsg, ts: new Date().toISOString() });
      await setMeta(db, "last_sync_status", `ERR_AUTH HTTP ${resp.status}`);
      await setMeta(db, "sync_errors_json", JSON.stringify(syncErrors));
      // Persist the auth snapshot on the error exit too - this is the state the
      // System Info probe card needs to explain a dead/bad paste.
      await setMeta(db, "last_auth_probe_json", JSON.stringify(authProbe));
      // Guard: Never fetch external pricing or model catalogs when Command Code token is expired
      return { ok: false, status: resp.status, error: errMsg, authProbe };
    }

    ccAuthSucceeded = true;
    let payload;
    try {
      payload = await resp.json();
    } catch (parseErr) {
      syncErrors.push({ source: "USAGE_PARSE", code: "JSON", message: `Failed to parse /internal/usage JSON: ${parseErr.message}`, ts: new Date().toISOString() });
      break;
    }

    const usages = Array.isArray(payload.usages) ? payload.usages : [];
    if (usages.length === 0) break;

    allFetchedUsages.push(...usages);
    const hasSeenInPage = usages.some(u => u && u.id && seenSet.has(u.id));

    pagesFetched++;
    // Background crons stop at the first fully-seen page (cheap). The feed is
    // capped at the last 100 entries of the last 24h, so the ledger only ever
    // grows from what each sync / bookmarklet push observes; the weekly bar
    // does not depend on it (windowLimits does).
    const fullBackfill = forced || needsBackfill;
    if ((!fullBackfill && hasSeenInPage) || !payload.nextCursor) break;
    cursor = payload.nextCursor;
  }
  // Persist the auth snapshot on the normal exit path (the 401 exit has its own).
  await setMeta(db, "last_auth_probe_json", JSON.stringify(authProbe));

  // Sync coverage diagnostics: the usage feed only exposes the last 100
  // requests of the last 24h, so record exactly what this sync saw. The weekly
  // bar itself no longer depends on this coverage (windowLimits does).
  const fetchedTsList = allFetchedUsages
    .map(u => (u && u.createdAt ? new Date(u.createdAt).getTime() : NaN))
    .filter(t => Number.isFinite(t));
  const coverageInfo = {
    pagesFetched,
    totalFetched: allFetchedUsages.length,
    truncated: pagesFetched >= maxPages,
    oldestFetchedIso: fetchedTsList.length ? new Date(Math.min(...fetchedTsList)).toISOString() : null,
    newestFetchedIso: fetchedTsList.length ? new Date(Math.max(...fetchedTsList)).toISOString() : null,
    truncatedAtCursor: pagesFetched >= maxPages ? cursor : null
  };

  // Dynamic Catalog & Pricing Sync (Guarded by ccAuthSucceeded, 10 AM IST + 24h Rule + Checkboxes)
  let catalogMap = await getCachedCatalogMap(db);
  if (ccAuthSucceeded) {
    const catRes = await maybeSyncDynamicCatalogAndPricing(db, forced, forcePriceSync, forceCatalogSync, catalogMap);
    latencies.pricingApiMs = catRes.pricingLatencyMs || 0;
    latencies.catalogApiMs = catRes.catalogLatencyMs || 0;
    catalogMap = catRes.catalogMap;
    if (catRes.errors && catRes.errors.length > 0) {
      syncErrors.push(...catRes.errors);
    }
  }

  // Update 5-Hour & 7-Day Rolling Window Ledger from fetched requests
  if (allFetchedUsages.length > 0) {
    await updateRollingWindowLedger(db, allFetchedUsages);
  }

  // Ingest fetched usage items into D1 daily rollup
  let lastDbMeta = null;
  if (allFetchedUsages.length > 0) {
    const batchResult = await ingestUsageItems(db, allFetchedUsages, seenSet, catalogMap, syncErrors);
    newRecordsCount += batchResult.newRecordsCount;
    latencies.sqlWriteMs += batchResult.writeLatencyMs;
    lastDbMeta = batchResult.dbMeta;
  }

  const nowTs = await enforceRetentionAndMeta(env, newRecordsCount, "OK", {
    latencies,
    syncErrors,
    dbMeta: lastDbMeta,
    coverageInfo,
    runMigration: forced === true
  });

  return {
    ok: true,
    forced,
    forcePriceSync,
    forceCatalogSync,
    pagesFetched,
    totalFetched: allFetchedUsages.length,
    truncated: coverageInfo.truncated,
    newRecordsCount,
    latencies,
    errorsCount: syncErrors.length,
    cookieRotated: rotatedThisSync,
    authProbe,
    syncedAt: new Date(nowTs).toISOString()
  };
}

// ============================================================================
// Dynamic GOAT Catalog, Caps, Intelligence, Roles & Pricing Scraper (Zero Hardcoding)
// ============================================================================
async function maybeSyncDynamicCatalogAndPricing(db, forced, forcePriceSync, forceCatalogSync, existingCatalog) {
  const nowMs = Date.now();
  const istNow = new Date(nowMs + IST_OFFSET_MS);
  const todayIstStr = istNow.toISOString().slice(0, 10);
  const istHour = istNow.getUTCHours();

  const cached = await getMetaMany(db, [
    "last_price_sync_ts",
    "last_price_sync_date_ist",
    "last_catalog_sync_ts",
    "last_catalog_sync_date_ist",
    "goat_window_caps_json",
    "intelligence_inheritance_ts",
    "variant_cap_inheritance_ts"
  ]);
  const lastPriceSyncTs = Number(cached.last_price_sync_ts || 0);
  const lastPriceDateIst = cached.last_price_sync_date_ist || "";
  const lastCatSyncTs = Number(cached.last_catalog_sync_ts || 0);
  const lastCatDateIst = cached.last_catalog_sync_date_ist || "";
  // Old caches written before the inheritance pass existed need one migration run.
  // The v2 key covers cap inheritance + alias-aware slugs, which the first pass lacked.
  const needsInheritance = !cached.intelligence_inheritance_ts || !cached.variant_cap_inheritance_ts;

  // Stale caps were usage-DOLLARS scraped from the Limits table (20/50/100),
  // not credits (14/35/70). Anything at/above the credit scale is wrong: force
  // a prose-driven refetch on the next sync.
  const rawCaps = cached.goat_window_caps_json || null;
  const parsedCaps = safeJsonParse(rawCaps, null);
  const capsNeedFix = !parsedCaps || !parsedCaps.fiveHourPoolUsd || parsedCaps.fiveHourPoolUsd >= 15
    || !parsedCaps.weeklyPoolUsd || parsedCaps.weeklyPoolUsd >= 40
    || !parsedCaps.monthlyPoolUsd || parsedCaps.monthlyPoolUsd > 100;

  const hasCatalog = Object.keys(existingCatalog || {}).length > 0;
  const hasGoatModels = Object.values(existingCatalog || {}).some(m => m && m.onGoatPlan && m.monthlyCapUsd !== null);

  // 10:00 AM IST Daily Rule + 24-Hour Manual Refresh Check + Explicit Override Checkboxes
  const needPricing = Boolean(forcePriceSync) ||
    (istHour >= 10 && lastPriceDateIst !== todayIstStr) ||
    (forced && (nowMs - lastPriceSyncTs >= CATALOG_TTL_MS)) ||
    !hasCatalog;

  const needCatalog = Boolean(forceCatalogSync) ||
    (istHour >= 10 && lastCatDateIst !== todayIstStr) ||
    (forced && (nowMs - lastCatSyncTs >= CATALOG_TTL_MS)) ||
    !hasGoatModels ||
    capsNeedFix;

  const errors = [];
  let pricingLatencyMs = 0;
  let catalogLatencyMs = 0;
  let catalogUpdated = false;
  let pricingUpdated = false;
  const merged = { ...(existingCatalog || {}) };
  const pendingMetaWrites = {};
  // Explicit force bypasses the 24h edge cache; normal runs still use it.
  const catalogFetchOpts = forceCatalogSync ? {} : DOC_CACHE_OPTS;
  const pricingFetchOpts = forcePriceSync ? {} : DOC_CACHE_OPTS;

  // 1. Scrape GOAT Plan Tables (Table 1: Intelligence/Rates/Peak Schedule, Table 2: 5h/7d Reqs, Table 3: Monthly Caps), CLI Roles & Window Limits
  if (needCatalog || needPricing) {
    const tCat0 = performance.now();
    try {
      // Edge-cached docs (cf.cacheTtl): still gated by the 10 AM IST rule, just skips origin hits.
      const [goatResp, cliResp, limitsResp] = await Promise.all([
        fetch("https://commandcode.ai/docs/plans/goat", { headers: { "User-Agent": "Mozilla/5.0" }, ...catalogFetchOpts }),
        fetch("https://commandcode.ai/docs/reference/cli/models", { headers: { "User-Agent": "Mozilla/5.0" }, ...catalogFetchOpts }),
        fetch("https://commandcode.ai/docs/resources/usage-limits", { headers: { "User-Agent": "Mozilla/5.0" }, ...catalogFetchOpts })
      ]);

      if (!goatResp.ok) {
        errors.push({
          source: "GOAT_CATALOG_FETCH",
          code: String(goatResp.status),
          message: `GOAT docs fetch failed (HTTP ${goatResp.status}). Using last cached catalog.`,
          ts: new Date().toISOString()
        });
      } else {
        const goatHtml = await goatResp.text();
        const roleMap = cliResp.ok ? parseCliRolesHtml(await cliResp.text()) : {};

        if (limitsResp.ok) {
          const limitsHtml = await limitsResp.text();
          const parsedWindowCaps = parseGoatWindowCapsHtml(limitsHtml);
          if (parsedWindowCaps) {
            pendingMetaWrites.goat_window_caps_json = JSON.stringify(parsedWindowCaps);
          }
        }

        const scrapedGoat = parseAllGoatTablesHtml(goatHtml, roleMap);
        const scrapedCount = Object.keys(scrapedGoat).length;

        if (scrapedCount === 0) {
          errors.push({
            source: "GOAT_CATALOG_PARSE",
            code: "EMPTY",
            message: "GOAT docs table parser extracted 0 models. Using last cached catalog.",
            ts: new Date().toISOString()
          });
        } else {
          for (const [slug, info] of Object.entries(scrapedGoat)) {
            merged[slug] = { ...(merged[slug] || {}), ...info };
          }
          catalogUpdated = true;
          pendingMetaWrites.last_catalog_sync_ts = String(nowMs);
          pendingMetaWrites.last_catalog_sync_date_ist = todayIstStr;
        }
      }
    } catch (e) {
      errors.push({
        source: "GOAT_CATALOG_FETCH",
        code: "EX",
        message: `GOAT catalog fetch error: ${e.message}. Using last cached catalog.`,
        ts: new Date().toISOString()
      });
    }
    catalogLatencyMs = Math.round(performance.now() - tCat0);
  }

  // 2. Fetch OpenRouter API for supplementary market pricing
  if (needPricing) {
    const tPr0 = performance.now();
    try {
      const orResp = await fetch("https://openrouter.ai/api/v1/models", { headers: { "Accept": "application/json" }, ...pricingFetchOpts });
      if (!orResp.ok) {
        errors.push({
          source: "OPENROUTER_PRICING",
          code: String(orResp.status),
          message: `OpenRouter API HTTP ${orResp.status}. Using last cached prices.`,
          ts: new Date().toISOString()
        });
      } else {
        const orJson = await orResp.json();
        const list = Array.isArray(orJson.data) ? orJson.data : [];
        for (const m of list) {
          if (!m || !m.id || !m.pricing) continue;
          const slug = normalizeModelSlug(m.id);
          const inRate = Number((Number(m.pricing.prompt || 0) * 1_000_000).toFixed(4));
          const outRate = Number((Number(m.pricing.completion || 0) * 1_000_000).toFixed(4));
          const cacheRate = Number((Number(m.pricing.input_cache_read || 0) * 1_000_000).toFixed(4)) || Number((inRate * 0.1).toFixed(4));
          if (inRate >= 0 && outRate >= 0 && !merged[slug]) {
            merged[slug] = {
              slug,
              name: m.name || m.id,
              in: inRate,
              out: outRate,
              cache: cacheRate,
              cacheWrite: null,
              monthlyCapUsd: null,
              isFree: inRate === 0 && outRate === 0,
              intelligence: null,
              contextWindow: m.context_length ? `${Math.round(m.context_length / 1000)}K` : null,
              role: null,
              onGoatPlan: false,
              source: "openrouter"
            };
          }
        }
        pricingUpdated = true;
        pendingMetaWrites.last_price_sync_ts = String(nowMs);
        pendingMetaWrites.last_price_sync_date_ist = todayIstStr;
      }
    } catch (e) {
      errors.push({
        source: "OPENROUTER_PRICING",
        code: "EX",
        message: `OpenRouter pricing error: ${e.message}. Using last cached prices.`,
        ts: new Date().toISOString()
      });
    }
    pricingLatencyMs = Math.round(performance.now() - tPr0);
  }

  // 3. Apply Dynamic Intelligence Inheritance Rules:
  //    - Muse Contributor models inherit from non-contributor Muse base model
  //    - DeepSeek "-fast" variants inherit from non-fast DeepSeek base model
  // Prune stale keys superseded by LEGACY_MODEL_ALIASES so the Advisor table
  // never lists both the old slug and its canonical rename.
  // Only rewrite the (large) pricing blob when something actually changed, or when an
  // old cache still needs its one-time inheritance migration.
  if (catalogUpdated || pricingUpdated || needsInheritance) {
    for (const [legacy, canon] of Object.entries(LEGACY_MODEL_ALIASES)) {
      if (merged[legacy] && merged[canon]) delete merged[legacy];
    }
    applyModelIntelligenceInheritance(merged);
    pendingMetaWrites.model_pricing_json = JSON.stringify(merged);
    pendingMetaWrites.intelligence_inheritance_ts = String(nowMs);
    pendingMetaWrites.variant_cap_inheritance_ts = String(nowMs);
  }

  await setMetaMany(db, pendingMetaWrites);
  return { catalogMap: merged, pricingLatencyMs, catalogLatencyMs, errors };
}

// 3. Apply Dynamic Intelligence + Cap Inheritance Rules:
//    - Muse Contributor models inherit intelligence AND monthly cap from the
//      non-contributor Muse base model
//    - DeepSeek "-fast" variants inherit from the non-fast DeepSeek base model
// (Variant fast/contributor rows ship without a cap in the GOAT tables, which made
// the pool-fallback 1x burn under-read their weekly credits. An unknown variant
// with genuinely no base keeps the pool fallback + unmapped flag.)
function applyModelIntelligenceInheritance(catalogMap) {
  for (const [slug, item] of Object.entries(catalogMap || {})) {
    if (!item) continue;
    let baseItem = null;
    let baseSlug = null;

    // Rule A: Muse Contributor variant -> base Muse model
    if (slug.startsWith("muse-") && slug.endsWith("-contributor")) {
      baseSlug = slug.replace(/-contributor$/, "");
      baseItem = catalogMap[baseSlug] || null;
    }

    // Rule B: DeepSeek "-fast" variant (e.g. deepseek-v41-flash-fast) -> base DeepSeek model
    if (!baseItem && slug.startsWith("deepseek-") && slug.endsWith("-fast")) {
      baseSlug = slug.replace(/-fast$/, "");
      baseItem = catalogMap[baseSlug] || null;
    }
    if (!baseItem) continue;

    if ((item.intelligence === null || item.intelligence === undefined)
      && baseItem.intelligence !== null && baseItem.intelligence !== undefined) {
      item.intelligence = baseItem.intelligence;
      item.intelligenceInheritedFrom = baseItem.name || baseSlug;
    }
    if ((item.monthlyCapUsd === null || item.monthlyCapUsd === undefined)
      && baseItem.monthlyCapUsd !== null && baseItem.monthlyCapUsd !== undefined
      && !baseItem.isFree) {
      item.monthlyCapUsd = baseItem.monthlyCapUsd;
      item.capInheritedFrom = baseItem.name || baseSlug;
    }
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

// Parses all 3 HTML tables on https://commandcode.ai/docs/plans/goat dynamically
function parseAllGoatTablesHtml(html, roleMap = {}) {
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
      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdMatch;
      while ((tdMatch = tdRegex.exec(rowMatch[1])) !== null) {
        cells.push(stripHtml(tdMatch[1]));
      }
      if (cells.length < 4) continue;

      const rawCell0 = cells[0];
      const cleanName = cleanModelTitle(rawCell0);
      const slug = normalizeModelSlug(cleanName);
      if (!slug || slug === "model") continue;

      const parsedPeak = parsePeakScheduleFromCell(rawCell0);

      if (!catalog[slug]) {
        catalog[slug] = {
          slug,
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
          onGoatPlan: true,
          source: "commandcode-goat-docs"
        };
      } else if (parsedPeak && !catalog[slug].peakSchedule) {
        catalog[slug].peakSchedule = parsedPeak;
      }

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

      if (!catalog[slug].role) {
        catalog[slug].role = deriveDynamicRole(catalog[slug]);
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

// Parses GOAT 5-hour (14cr), Weekly (35cr), and Monthly (70cr) window limits.
// The "Limits by plan" table holds USAGE-DOLLARS ($20/$50/$100 on the $100
// model), NOT credits — per the prose, credits = dollars x (70 / monthlyPool).
// Prose ("you can use 14 credits in any 5 hours and 35 in any 7 days") is the
// source of truth and is parsed first; the table is only a fallback.
// Dynamically matches <th> headers ("5-hour", "weekly", "monthly") instead of
// assuming fixed column positions!
function parseGoatWindowCapsHtml(html) {
  const normalized = String(html || "").replace(/&nbsp;|&#160;/g, " ");
  // Primary: prose credit statements ("14 credits in any 5 hours ... 35 in any 7 days").
  const prose5h = normalized.match(/(\d+(?:\.\d+)?)\s*credits?\s+in\s+any\s+5[\s-]*hours?/i);
  const proseWeek = normalized.match(/(\d+(?:\.\d+)?)\s*(?:in\s+any\s+7\s+days?|credits?\s+in\s+any\s+week|per\s+week|weekly[^\d]{0,24}?cap[^\d]{0,24}?(\d+(?:\.\d+)?))/i);
  let proseWeekNum = null;
  if (proseWeek) {
    proseWeekNum = Number(proseWeek[2] !== undefined && proseWeek[2] !== "" ? proseWeek[2] : proseWeek[1]);
  }
  // "35 in any 7 days" variant where the number precedes without "credits".
  const proseWeekAlt = !Number.isFinite(proseWeekNum)
    ? normalized.match(/(\d+(?:\.\d+)?)\s+in\s+any\s+7\s+days?/i)
    : null;
  if (!Number.isFinite(proseWeekNum) && proseWeekAlt) proseWeekNum = Number(proseWeekAlt[1]);
  if (prose5h && Number.isFinite(proseWeekNum) && Number(prose5h[1]) > 0 && proseWeekNum > 0) {
    return { fiveHourPoolUsd: Number(prose5h[1]), weeklyPoolUsd: proseWeekNum, monthlyPoolUsd: 70 };
  }

  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tm;
  while ((tm = tableRegex.exec(html)) !== null) {
    const tableHtml = tm[1];
    const headers = [];
    const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
    let th;
    while ((th = thRegex.exec(tableHtml)) !== null) {
      headers.push(stripHtml(th[1]).toLowerCase());
    }

    const idx5h = headers.findIndex(h => /5-hour|5 hour|5h/i.test(h));
    const idxWeek = headers.findIndex(h => /week/i.test(h));
    const idxMonth = headers.findIndex(h => /month/i.test(h));
    if (idx5h === -1 || idxWeek === -1) continue;

    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm;
    while ((rm = rowRegex.exec(tableHtml)) !== null) {
      const cells = [];
      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let td;
      while ((td = tdRegex.exec(rm[1])) !== null) {
        cells.push(stripHtml(td[1]));
      }
      if (cells.length > Math.max(idx5h, idxWeek) && /^goat$/i.test(cells[0].trim())) {
        // Table cells are usage-DOLLARS; convert to credits with the monthly pool.
        const monthCell = idxMonth !== -1 && cells[idxMonth] ? extractLastDollarNumber(cells[idxMonth]) : null;
        const monthlyPool = (monthCell && monthCell > 0) ? monthCell : 70;
        const fiveHourDollars = extractLastDollarNumber(cells[idx5h]);
        const weeklyDollars = extractLastDollarNumber(cells[idxWeek]);
        if (fiveHourDollars && weeklyDollars) {
          const toCredits = (d) => Number(((d * 70) / monthlyPool).toFixed(2));
          return { fiveHourPoolUsd: toCredits(fiveHourDollars), weeklyPoolUsd: toCredits(weeklyDollars), monthlyPoolUsd: monthlyPool };
        }
      }
    }
  }
  return null;
}

function deriveDynamicRole(item) {
  if (item.isFree) return "Free Unlimited Model";
  const cap = item.monthlyCapUsd;
  if (cap >= 100) return `Max Deal Pool ($${cap} Cap)`;
  if (cap >= 80) return `High-Leverage Deal ($${cap} Cap)`;
  if (cap === 70 && item.intelligence >= 44) return "Open Pool Workhorse ($70 Cap)";
  if (cap === 70) return "High-Volume Open Pool ($70 Cap)";
  if (cap >= 40 && cap < 70) return `Mid-Cap Balanced ($${cap} Cap)`;
  if (cap === 20) return "2x Launch Pool ($20 Cap)";
  if (cap === 10) return "Frontier Capped ($10 Cap)";
  return "GOAT Catalog Model";
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
  // Squeeze doubled adjacent tokens: deepseek-v4-1-flash -> deepseek-v4-flash.
  const parts = s.split("-");
  const out = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last !== undefined && (last === p || (last.replace(/^v/, "") === p.replace(/^v/, "") && /^\d+$/.test(p)))) {
      // "v4","1" -> keep "v41"; identical repeats ("flash","flash") drop.
      if (/^\d+$/.test(p) && /^v\d+$/.test(last)) out[out.length - 1] = last + p;
      continue;
    }
    out.push(p);
  }
  const joined = out.join("-");
  return LEGACY_MODEL_ALIASES[joined] || joined;
}

function makeAlertKey(err) {
  return `${err.source || "ERR"}:${err.model || err.code || (err.message || "").slice(0, 32)}`;
}

// ============================================================================
// 5-Hour & 7-Day Weekly Rolling Window Ledger & Counter Computation
// ============================================================================
async function updateRollingWindowLedger(db, usages) {
  const raw = await getMeta(db, "rolling_window_ledger_json");
  const ledger = safeJsonParse(raw, {});
  const cutoffMs = Date.now() - SEVEN_DAYS_MS;

  for (const [id, entry] of Object.entries(ledger)) {
    if (!entry || entry.ts < cutoffMs) { delete ledger[id]; continue; }
    // One-time canonicalization: legacy rows stored pre-canonical slugs
    // ("deepseek/deepseek-v4-flash") remap to the canonical key in place.
    if (entry.slug && typeof entry.slug === "string") {
      const canon = canonicalModelSlug(entry.slug);
      if (canon && canon !== entry.slug) entry.slug = canon;
    }
  }

  for (const u of usages) {
    if (!u || !u.id || !u.createdAt) continue;
    const ts = new Date(u.createdAt).getTime();
    if (Number.isNaN(ts) || ts < cutoffMs) continue;
    const meta = u.meta || {};
    const slug = normalizeModelSlug(meta.model || "unknown");
    const apiCost = Number(meta.totalCost || 0);
    // CREDIT BASIS FIX: windows draw credits against STICKER usage-value, not billed $
    const stickerCost = Number(
      (Number(meta.inputCost || 0) + Number(meta.outputCost || 0) + Number(meta.cacheCost || 0)).toFixed(6)
    );
    ledger[u.id] = {
      ts,
      slug,
      apiCost,
      stickerCost: (Number.isFinite(stickerCost) && stickerCost > 0) ? stickerCost : apiCost
    };
  }

  await setMeta(db, "rolling_window_ledger_json", JSON.stringify(ledger));
}

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

function computeRollingWindows(ledgerMap, catalogMap, windowCaps, windowLimits, byModelPeriod) {
  const capsMissing = !windowCaps || !windowCaps.fiveHourPoolUsd || !windowCaps.weeklyPoolUsd;

  // Self-heal stale caches: usage-DOLLAR caps (20/50/100 from the Limits
  // table) are NOT credits (14/35/70). Anything at/above the credit scale is
  // wrong and converts via credits = dollars x (70 / monthlyPool).
  let fiveHourCap = (windowCaps && windowCaps.fiveHourPoolUsd) ? Number(windowCaps.fiveHourPoolUsd) : null;
  let weeklyCap = (windowCaps && windowCaps.weeklyPoolUsd) ? Number(windowCaps.weeklyPoolUsd) : null;
  let monthlyPool = (windowCaps && windowCaps.monthlyPoolUsd) ? Number(windowCaps.monthlyPoolUsd) : null;
  if (!(monthlyPool && monthlyPool > 0)) monthlyPool = 70;
  if (fiveHourCap !== null && fiveHourCap >= 15) fiveHourCap = Number(((fiveHourCap * 70) / monthlyPool).toFixed(2));
  if (weeklyCap !== null && weeklyCap >= 40) weeklyCap = Number(((weeklyCap * 70) / monthlyPool).toFixed(2));
  if (fiveHourCap !== null && fiveHourCap >= 15) { fiveHourCap = 14; weeklyCap = 35; }

  const now = Date.now();
  const cutoff5h = now - FIVE_HOURS_MS;
  const cutoff7d = now - SEVEN_DAYS_MS;

  // Single pass: no sort, no intermediate filtered arrays. Tracks oldest ts per window for reset timers.
  // CREDIT BASIS FIX: pool credits draw on STICKER usage-value (legacy ledger entries fall back to billed $)
  let used5h = 0, raw5h = 0, sticker5h = 0, count5h = 0, oldest5h = Infinity;
  let used7d = 0, raw7d = 0, sticker7d = 0, count7d = 0, oldest7d = Infinity;
  // Same fuzzy catalog resolution as the daily tables (exact match, then
  // longest-prefix): a variant slug must not silently fall back to weight 1.
  const windowCatMemo = new Map();
  const windowCatWarnings = [];
  // Per-model credit attribution for the diagnostics panel: which model burned what.
  const byModel7d = {};
  const byModel5h = {};
  const bumpModel = (map, slug, weighted, stickerV, apiV) => {
    const e = map[slug] || (map[slug] = { slug, credits: 0, sticker: 0, api: 0, requests: 0 });
    e.credits += weighted;
    e.sticker += stickerV;
    e.api += apiV;
    e.requests += 1;
  };

  for (const item of Object.values(ledgerMap || {})) {
    if (!item || typeof item.ts !== "number" || item.ts < cutoff7d) continue;
    const apiCost = Number(item.apiCost || 0);
    const sticker = (item.stickerCost !== null && item.stickerCost !== undefined)
      ? Number(item.stickerCost) : apiCost;
    const cat = lookupCatalogModel(item.slug, catalogMap, windowCatWarnings, windowCatMemo, null);
    // Billable-only accounting: free/unlimited models, builtin tool pings and
    // zero-cost turns never drain the GOAT pool on the CC page, so they must
    // not inflate usedCredits or pin the reset timer to an old $0 entry.
    const isToolEntry = BUILTIN_TOOLS.has(item.slug) || Boolean(cat && cat.isTool);
    const isFreeEntry = Boolean(cat && cat.isFree);
    const billable = !isToolEntry && !isFreeEntry && Number.isFinite(sticker) && sticker > 0;
    const modelCap = cat && cat.monthlyCapUsd ? Number(cat.monthlyCapUsd) : monthlyPool;
    // Lower-allowance models draw proportionally more pool credits per $1 of sticker usage.
    // Free/tool models always drain 0 (no fallback weight of 1).
    const creditWeight = (isToolEntry || isFreeEntry)
      ? 0
      : (monthlyPool && modelCap && modelCap > 0) ? (monthlyPool / modelCap) : 1;
    const weighted = sticker * creditWeight;

    // Raw/market + sticker totals still reflect every ledger row for diagnostics.
    raw7d += apiCost;
    sticker7d += Number.isFinite(sticker) ? sticker : 0;
    count7d++;
    // Reset anchor: the window OPENS on the first request of any kind (billable,
    // free, tool ping, $0). CC paces any mixture of models through one pool, so
    // anchoring on billable-only read ~1 day long. Only billable drain counts
    // toward usedCredits.
    if (item.ts < oldest7d) oldest7d = item.ts;
    if (billable) {
      used7d += weighted;
      bumpModel(byModel7d, item.slug, weighted,
        Number.isFinite(sticker) ? sticker : 0, apiCost);
    }

    if (item.ts >= cutoff5h) {
      raw5h += apiCost;
      sticker5h += Number.isFinite(sticker) ? sticker : 0;
      count5h++;
      if (item.ts < oldest5h) oldest5h = item.ts;
      if (billable) {
        used5h += weighted;
        bumpModel(byModel5h, item.slug, weighted,
          Number.isFinite(sticker) ? sticker : 0, apiCost);
      }
    }
  }

  const reset5hMs = oldest5h !== Infinity ? Math.max(0, (oldest5h + FIVE_HOURS_MS) - now) : 0;
  const reset7dMs = oldest7d !== Infinity ? Math.max(0, (oldest7d + SEVEN_DAYS_MS) - now) : 0;
  const oldest7dIso = oldest7d !== Infinity ? new Date(oldest7d).toISOString() : null;
  const oldest5hIso = oldest5h !== Infinity ? new Date(oldest5h).toISOString() : null;
  const topByCredits = (map) => Object.values(map)
    .map(e => ({ slug: e.slug, credits: Number(e.credits.toFixed(4)), sticker: Number(e.sticker.toFixed(4)), api: Number(e.api.toFixed(4)), requests: e.requests }))
    .sort((a, b) => b.credits - a.credits)
    .slice(0, 12);

  const fiveHourBase = {
    limitCredits: fiveHourCap,
    usedCredits: Number(used5h.toFixed(4)),
    leftCredits: fiveHourCap !== null ? Number(Math.max(0, fiveHourCap - used5h).toFixed(4)) : null,
    usedPct: fiveHourCap ? Number(Math.min(100, (used5h / fiveHourCap) * 100).toFixed(1)) : 0,
    rawApiUsd: Number(raw5h.toFixed(4)),
    stickerValueUsd: Number(sticker5h.toFixed(4)),
    requestsCount: count5h,
    resetsInMinutes: Math.ceil(reset5hMs / 60000),
    resetsInMs: reset5hMs,
    windowOpenedAt: oldest5hIso,
    topModels: topByCredits(byModel5h),
    capsMissing
  };
  const weeklyBase = {
    limitCredits: weeklyCap,
    usedCredits: Number(used7d.toFixed(4)),
    leftCredits: weeklyCap !== null ? Number(Math.max(0, weeklyCap - used7d).toFixed(4)) : null,
    usedPct: weeklyCap ? Number(Math.min(100, (used7d / weeklyCap) * 100).toFixed(1)) : 0,
    rawApiUsd: Number(raw7d.toFixed(4)),
    stickerValueUsd: Number(sticker7d.toFixed(4)),
    requestsCount: count7d,
    resetsInHours: Number((reset7dMs / 3600000).toFixed(1)),
    resetsInMs: reset7dMs,
    windowOpenedAt: oldest7dIso,
    topModels: topByCredits(byModel7d),
    capsMissing
  };

  // Authoritative override from CC's billing service. /internal/usage only
  // serves the last 100 requests of the last 24h (no cursor pagination), so a
  // locally rolled-up 7-day ledger can never match CC's own window state. When
  // windowLimits is cached, used/cap/percent/reset/anchor mirror the CC page
  // exactly; the ledger values stay on the object for diagnostics (raw $,
  // sticker $, and the 5h per-model breakdown, which the 24h feed does cover).
  const overrideWindow = (win, wl, windowMs) => {
    if (!wl || !Number.isFinite(wl.resetAt) || wl.resetAt <= 0 || !(wl.cap > 0)) return win;
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

  // Weekly per-model consumers: prefer CC's own by-model aggregation (the 24h
  // request feed cannot attribute a full 7-day window).
  let topModels7d = topByCredits(byModel7d);
  if (byModelPeriod && Array.isArray(byModelPeriod.data) && byModelPeriod.data.length > 0) {
    topModels7d = byModelPeriod.data
      .map(r => ({
        slug: r.model,
        credits: Number(Number(r.consumedMonthlyCredits || 0).toFixed(4)),
        sticker: Number(Number(r.creditsTotal || 0).toFixed(4)),
        api: Number(Number(r.creditsTotal || 0).toFixed(4)),
        requests: Number(r.requests || 0)
      }))
      .sort((a, b) => b.credits - a.credits)
      .slice(0, 12);
  }

  return {
    fiveHour: overrideWindow(fiveHourBase, windowLimits && windowLimits.fiveHour, FIVE_HOURS_MS),
    weekly: Object.assign(overrideWindow(weeklyBase, windowLimits && windowLimits.weekly, SEVEN_DAYS_MS), { topModels: topModels7d }),
    monthlyPool: windowLimits ? { used: windowLimits.monthlyUsed || 0, granted: windowLimits.monthlyGranted || 0 } : null
  };
}

// ============================================================================
// Batched Ingestion Helper (Evaluates Time-of-Day Peak/Off-Peak Rates per Turn)
// ============================================================================
async function ingestUsageItems(db, usages, seenSet, catalogMap, syncErrors = []) {
  let hitAlreadySeen = false;
  let newRecordsCount = 0;
  const statements = [];
  const lookupMemo = new Map();
  const reportedMissing = buildReportedMissingSet(syncErrors);

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

    statements.push(
      db.prepare(`INSERT OR IGNORE INTO cc_seen_requests (id, created_at) VALUES (?, ?)`).bind(item.id, item.createdAt || new Date().toISOString()),
      db.prepare(`
        INSERT INTO cc_daily_model_usage (
          usage_date, model, requests_count, failed_wasted_count,
          tokens_in_total, tokens_in_fresh, tokens_cached, tokens_out,
          plan_cost, input_cost, cache_cost, output_cost, actual_api_cost, duration_ms_total
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          duration_ms_total = duration_ms_total + excluded.duration_ms_total
      `).bind(
        usageDate, model, isFailedOrWasted,
        tokensInTotal, tokensInFresh, tokensCached, tokensOut,
        planCost, inputCost, cacheCost, outputCost, planCost, durationMs
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
  const runMigration = diag.runMigration === true;

  // Summary fetch + retention deletes are independent: run concurrently.
  const summaryPromise = (async () => {
    if (!env.CC_API_KEY) return;
    const tSum0 = performance.now();
    try {
      const sumResp = await fetch("https://api.commandcode.ai/alpha/usage/summary", {
        headers: { "Authorization": `Bearer ${env.CC_API_KEY}`, "x-api-key": env.CC_API_KEY }
      });
      latencies.summaryApiMs = Math.round(performance.now() - tSum0);
      if (sumResp.ok) {
        return await sumResp.text();
      }
      const summaryMsg = sumResp.status === 401
        ? `/alpha/usage/summary HTTP 401 - CC_API_KEY is stale/rotated (it changes whenever the CLI re-logs in). Re-paste the current "user_..." apiKey from ~/.commandcode/auth.json into Worker -> Settings -> Variables -> CC_API_KEY. Only the billing-cycle summary needs it; usage + bars keep working via the session cookie and bookmarklet pushes.`
        : `/alpha/usage/summary HTTP ${sumResp.status}`;
      syncErrors.push({ source: "SUMMARY_API", code: String(sumResp.status), message: summaryMsg, ts: new Date().toISOString() });
    } catch (e) {
      latencies.summaryApiMs = Math.round(performance.now() - tSum0);
      syncErrors.push({ source: "SUMMARY_API", code: "EX", message: `/alpha/usage/summary error: ${e.message}`, ts: new Date().toISOString() });
    }
    return null;
  })();

  // Retention deletes are expensive full scans; run them at most once per day.
  // Prior latency metadata is read in the same round trip so a skipped retention pass
  // does not reset the last known DB size / row counters to zero.
  // usage_date rows are IST calendar dates, so the daily-rollup cutoff is computed
  // in JS (IST) — UTC date('now') would drift a day around midnight IST.
  const metaState = await getMetaMany(db, ["last_retention_run_ts", "last_latencies_json"]);
  const lastRetentionTs = Number(metaState.last_retention_run_ts || 0);
  const priorLatencies = safeJsonParse(metaState.last_latencies_json, {});
  const runRetention = Date.now() - lastRetentionTs >= RETENTION_INTERVAL_MS;
  const rollupCutoffIst = istDateStr(Date.now() - ROLLUP_RETENTION_DAYS * 86400000);
  const retentionPromise = runRetention
    ? db.batch([
        db.prepare(`DELETE FROM cc_daily_model_usage WHERE usage_date < ?`).bind(rollupCutoffIst),
        db.prepare(`DELETE FROM cc_seen_requests WHERE substr(created_at, 1, 10) < date('now', ?)`).bind(`-${SEEN_RETENTION_DAYS} days`)
      ])
    : Promise.resolve(null);

  // One-time migration: merge legacy (usage_date, model) rows whose model key
  // predates canonical slugs. Idempotent — no-op when nothing non-canonical
  // remains. Runs on every forced refresh (not just the daily retention pass)
  // so the duplicate rows disappear on the next manual sync.
  // Safe form: INSERT the merged total into the canonical row first (upsert),
  // THEN delete the legacy row. The old UPDATE-then-DELETE dropped the day's
  // data whenever no canonical row existed yet.
  // LIMIT 200 rows per run so a big legacy backlog merges across syncs instead
  // of blowing the D1 batch / subrequest budget in one go.
  const migrationPromise = (runRetention || runMigration)
    ? (async () => {
        try {
          const legacyRows = await db.prepare(
            `SELECT usage_date, model, requests_count, failed_wasted_count, tokens_in_total, tokens_in_fresh, tokens_cached, tokens_out, plan_cost, input_cost, cache_cost, output_cost, actual_api_cost, duration_ms_total FROM cc_daily_model_usage LIMIT 5000`
          ).all();
          const remap = [];
          for (const r of (legacyRows.results || [])) {
            const canon = canonicalModelSlug(r.model);
            if (!canon || canon === r.model) continue;
            remap.push({
              canon, usage_date: r.usage_date, oldModel: r.model,
              requests_count: Number(r.requests_count || 0),
              failed_wasted_count: Number(r.failed_wasted_count || 0),
              tokens_in_total: Number(r.tokens_in_total || 0),
              tokens_in_fresh: Number(r.tokens_in_fresh || 0),
              tokens_cached: Number(r.tokens_cached || 0),
              tokens_out: Number(r.tokens_out || 0),
              plan_cost: Number(r.plan_cost || 0),
              input_cost: Number(r.input_cost || 0),
              cache_cost: Number(r.cache_cost || 0),
              output_cost: Number(r.output_cost || 0),
              actual_api_cost: Number(r.actual_api_cost || 0),
              duration_ms_total: Number(r.duration_ms_total || 0)
            });
          }
          if (remap.length === 0) return null;
          // Group by (usage_date, canonical model) first: several legacy rows
          // can map to the same canonical key, and applying them one by one
          // exceeds the D1 batch statement cap on large backlogs.
          const grouped = new Map();
          for (const m of remap.slice(0, 200)) {
            const key = m.usage_date + "|" + m.canon + "|" + m.oldModel;
            const g = grouped.get(key);
            if (!g) { grouped.set(key, { ...m }); continue; }
            for (const f of ["requests_count", "failed_wasted_count", "tokens_in_total", "tokens_in_fresh", "tokens_cached", "tokens_out", "plan_cost", "input_cost", "cache_cost", "output_cost", "actual_api_cost", "duration_ms_total"]) {
              g[f] = Number(g[f] || 0) + Number(m[f] || 0);
            }
          }
          const stmts = [];
          for (const m of grouped.values()) {
            // Upsert the legacy row's totals into the canonical row first...
            stmts.push(db.prepare(`
              INSERT INTO cc_daily_model_usage (
                usage_date, model, requests_count, failed_wasted_count,
                tokens_in_total, tokens_in_fresh, tokens_cached, tokens_out,
                plan_cost, input_cost, cache_cost, output_cost, actual_api_cost, duration_ms_total
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(usage_date, model) DO UPDATE SET
                requests_count = requests_count + excluded.requests_count,
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
                duration_ms_total = duration_ms_total + excluded.duration_ms_total
            `).bind(
              m.usage_date, m.canon,
              m.requests_count, m.failed_wasted_count,
              m.tokens_in_total, m.tokens_in_fresh, m.tokens_cached, m.tokens_out,
              m.plan_cost, m.input_cost, m.cache_cost, m.output_cost, m.actual_api_cost, m.duration_ms_total
            ));
            // ...then delete the legacy row (guarded so a same-value row survives).
            stmts.push(db.prepare(
              `DELETE FROM cc_daily_model_usage WHERE usage_date = ? AND model = ? AND model != ?`
            ).bind(m.usage_date, m.oldModel, m.canon));
          }
          for (let i = 0; i < stmts.length; i += INGEST_BATCH_SIZE) {
            await db.batch(stmts.slice(i, i + INGEST_BATCH_SIZE));
          }
          return { migratedRows: remap.length, migratedThisRun: grouped.size, backlogLeft: Math.max(0, remap.length - 200) };
        } catch (_) { return null; }
      })()
    : Promise.resolve(null);

  const [billingSummaryText, retentionBatch] = await Promise.all([summaryPromise, retentionPromise, migrationPromise]);

  const dbMeta = diag.dbMeta || (retentionBatch && retentionBatch[0] && retentionBatch[0].meta) || {};
  const coverageInfo = diag.coverageInfo || null;
  const nowTs = Date.now();

  const metaEntries = {
    last_sync_ts: String(nowTs),
    last_sync_status: `${prefix} (+${newRecordsCount} new requests)`,
    sync_errors_json: JSON.stringify(syncErrors),
    last_latencies_json: JSON.stringify({
      ...latencies,
      dbSizeBytes: dbMeta.size_after || priorLatencies.dbSizeBytes || 0,
      lastWriteRowsRead: dbMeta.rows_read || priorLatencies.lastWriteRowsRead || 0,
      lastWriteRowsWritten: dbMeta.rows_written || priorLatencies.lastWriteRowsWritten || 0
    })
  };
  if (runRetention) metaEntries.last_retention_run_ts = String(nowTs);
  if (billingSummaryText) metaEntries.billing_summary_json = billingSummaryText;
  if (coverageInfo) metaEntries.last_sync_coverage_json = JSON.stringify(coverageInfo);
  await setMetaMany(db, metaEntries);

  return nowTs;
}

// ============================================================================
// Dynamic Catalog Lookup (Zero Hardcoded Values)
// ============================================================================
async function getCachedCatalogMap(db) {
  const raw = await getMeta(db, "model_pricing_json");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (_) { return {}; }
}

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
  // Longest-prefix wins: a short shared prefix (e.g. "gpt") must not shadow a
  // longer, closer variant cap ($10 vs $80 = 8x credit error).
  let best = null;
  let bestLen = -1;
  for (const [k, v] of Object.entries(catalogMap || {})) {
    if (!k) continue;
    if (slug.startsWith(k) || k.startsWith(slug)) {
      if (k.length > bestLen) { bestLen = k.length; best = v; }
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
      message: `Model "${slug}" not found in cached GOAT/OpenRouter catalog. Using last cached values.`,
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
  // usage_date is an IST calendar date: compute the cutoff in JS (IST). The old
  // UTC date('now', ...) predicate drifted a day around midnight IST.
  const rollupCutoffIst = istDateStr(Date.now() - ROLLUP_RETENTION_DAYS * 86400000);
  const [dailyRowsRes, countsRes, metaRowsRes] = await db.batch([
    db.prepare(`SELECT usage_date, model, requests_count, failed_wasted_count, tokens_in_total, tokens_in_fresh, tokens_cached, tokens_out, plan_cost, input_cost, cache_cost, output_cost FROM cc_daily_model_usage WHERE usage_date >= ? ORDER BY usage_date DESC, plan_cost DESC`).bind(rollupCutoffIst),
    db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM cc_daily_model_usage) AS daily_rows_count,
        (SELECT COUNT(*) FROM cc_seen_requests) AS seen_requests_count,
        (SELECT COUNT(*) FROM cc_meta) AS meta_rows_count,
        (SELECT MIN(usage_date) FROM cc_daily_model_usage) AS oldest_date,
        (SELECT MAX(usage_date) FROM cc_daily_model_usage) AS newest_date,
        (SELECT COUNT(DISTINCT usage_date) FROM cc_daily_model_usage) AS active_days
    `),
    db.prepare(`SELECT key, value FROM cc_meta`)
  ]);
  const sqlReadLatencyMs = Math.round(performance.now() - tSql0);

  const metaMap = {};
  for (const r of (metaRowsRes.results || [])) metaMap[r.key] = r.value;

  const catalogMap = safeJsonParse(metaMap.model_pricing_json, {});
  const windowCaps = safeJsonParse(metaMap.goat_window_caps_json, null);
  const ledgerMap = safeJsonParse(metaMap.rolling_window_ledger_json, {});
  const dismissedMap = safeJsonParse(metaMap.dismissed_alerts_json, {});
  const rawErrors = safeJsonParse(metaMap.sync_errors_json, []);
  const syncErrors = rawErrors.filter(e => !(e.model && BUILTIN_TOOLS.has(e.model)));

  // Inheritance is applied and persisted at sync time. Only pre-flag caches need the pass.
  // Prune stale catalog keys superseded by LEGACY_MODEL_ALIASES so the Advisor
  // table never lists both the old slug and its canonical rename.
  for (const [legacy, canon] of Object.entries(LEGACY_MODEL_ALIASES)) {
    if (catalogMap[legacy] && catalogMap[canon]) delete catalogMap[legacy];
  }
  if (!metaMap.intelligence_inheritance_ts || !metaMap.variant_cap_inheritance_ts) {
    applyModelIntelligenceInheritance(catalogMap);
  }

  const monthlyPoolUsd = (windowCaps && windowCaps.monthlyPoolUsd) ? Number(windowCaps.monthlyPoolUsd) : null;
  const lastSyncCoverage = safeJsonParse(metaMap.last_sync_coverage_json, null);
  const authProbe = safeJsonParse(metaMap.last_auth_probe_json, null);
  const rawRows = dailyRowsRes.results || [];

  // Enrich rows strictly using dynamic catalog (Cache Hit savings excluded from ROI/Savings)
  // CREDIT BASIS FIX: pool drain uses STICKER usage-value (input+cache+output meta components
  // at GOAT list rates) - this is what Command Code paces allowances against. r.plan_cost
  // stays the market-billed amount (OpenRouter parity) for API Value Extracted.
  // Memoized catalog lookup: repeated models hit the Map instead of re-scanning Object.entries.
  // NOTE: enrichment lookups report into a throwaway per-request array, never the persisted
  // syncErrors — unmapped-model warnings must not flicker as red banner alerts on every GET.
  const lookupWarnings = [];
  const enrichMemo = new Map();
  const reportedMissing = buildReportedMissingSet(lookupWarnings);
  // Legacy rows written under pre-alias raw names (deepseek-v4-flash,
  // deepseek-v41-flash) merge into the canonical model at read time, so the
  // per-model tables show one DeepSeek row even before the D1 merge runs.
  const mergedRowsMap = new Map();
  for (const r of rawRows) {
    const canonModel = canonicalModelSlug(r.model);
    const key = (r.usage_date || "") + "|" + canonModel;
    const agg = mergedRowsMap.get(key);
    if (!agg) {
      mergedRowsMap.set(key, { ...r, model: canonModel });
    } else {
      agg.requests_count = Number(agg.requests_count || 0) + Number(r.requests_count || 0);
      agg.failed_wasted_count = Number(agg.failed_wasted_count || 0) + Number(r.failed_wasted_count || 0);
      agg.tokens_in_total = Number(agg.tokens_in_total || 0) + Number(r.tokens_in_total || 0);
      agg.tokens_in_fresh = Number(agg.tokens_in_fresh || 0) + Number(r.tokens_in_fresh || 0);
      agg.tokens_cached = Number(agg.tokens_cached || 0) + Number(r.tokens_cached || 0);
      agg.tokens_out = Number(agg.tokens_out || 0) + Number(r.tokens_out || 0);
      agg.plan_cost = Number(agg.plan_cost || 0) + Number(r.plan_cost || 0);
      agg.input_cost = Number(agg.input_cost || 0) + Number(r.input_cost || 0);
      agg.cache_cost = Number(agg.cache_cost || 0) + Number(r.cache_cost || 0);
      agg.output_cost = Number(agg.output_cost || 0) + Number(r.output_cost || 0);
    }
  }
  const enrichedRows = [...mergedRowsMap.values()].map(r => {
    const cat = lookupCatalogModel(r.model, catalogMap, lookupWarnings, enrichMemo, reportedMissing);
    let capUsd = (cat.monthlyCapUsd !== null && cat.monthlyCapUsd !== undefined) ? Number(cat.monthlyCapUsd) : null;
    // Unmapped models: fall back to the monthly pool ($70) so pool drain stays
    // dimensionally sane, but flag the row and keep net savings neutral (0)
    // instead of crediting the full market value as fake ROI.
    const unmappedAllowance = !(capUsd && capUsd > 0);
    if (unmappedAllowance && monthlyPoolUsd && monthlyPoolUsd > 0) capUsd = monthlyPoolUsd;
    const stickerPool = monthlyPoolUsd && monthlyPoolUsd > 0 ? monthlyPoolUsd : 70;
    const stickerValue = Number(r.input_cost || 0) + Number(r.cache_cost || 0) + Number(r.output_cost || 0);
    // Credit burn: pool credits consumed per $1 of sticker usage = monthlyPool / modelCap.
    // A $10-cap model burns 7x (70/10); a $70-cap model burns 1x. This is exactly
    // how CC paces the 5h / weekly / monthly limits.
    const creditBurnPerUsd = (capUsd && capUsd > 0) ? Number((stickerPool / capUsd).toFixed(3)) : null;
    const creditsConsumed = (creditBurnPerUsd !== null) ? Number((stickerValue * creditBurnPerUsd).toFixed(4)) : 0;
    const poolDrainFraction = (capUsd && capUsd > 0) ? (stickerValue / capUsd) : 0;
    const realPocketCost = poolDrainFraction * GOAT_PAID_USD;
    const netPlanSavings = unmappedAllowance ? 0 : (Number(r.plan_cost || 0) - realPocketCost);
    const leverage = (capUsd && capUsd > 0) ? Number((capUsd / GOAT_PAID_USD).toFixed(2)) : null;

    return {
      ...r,
      model_allowance_usd: capUsd,
      unmapped_model_allowance: unmappedAllowance,
      credit_burn_per_usd: creditBurnPerUsd,
      credits_consumed: creditsConsumed,
      pool_drain_pct: Number((poolDrainFraction * 100).toFixed(2)),
      effective_real_usd: realPocketCost,
      net_plan_savings_usd: netPlanSavings,
      leverage_multiplier: leverage,
      role: cat.role || null,
      intelligence: cat.intelligence ?? null,
      peak_note: cat.peakSchedule ? cat.peakSchedule.note : null
    };
  });

  const billingSummary = safeJsonParse(metaMap.billing_summary_json, null);
  const savedLatencies = safeJsonParse(metaMap.last_latencies_json, {});
  const counts = (countsRes.results && countsRes.results[0]) || {};
  const dbMeta = dailyRowsRes.meta || {};

  // Compute 5-Hour & Weekly Rolling Windows. Authoritative CC windowLimits
  // (cached at sync time) override the ledger estimate when present.
  const windowLimits = safeJsonParse(metaMap.window_limits_json, null);
  const byModelPeriod = safeJsonParse(metaMap.cc_by_model_json, null);
  const rollingWindows = computeRollingWindows(ledgerMap, catalogMap, windowCaps, windowLimits, byModelPeriod);

  // Determine exact Billing Cycle Start/End Dates in IST from billingSummary (fall back to 30-day window)
  const periodStartMs = (billingSummary && billingSummary.periodStart)
    ? new Date(billingSummary.periodStart).getTime()
    : (Date.now() - 30 * 86400000);
  const periodEndMs = (billingSummary && billingSummary.periodEnd)
    ? new Date(billingSummary.periodEnd).getTime()
    : (periodStartMs + 30 * 86400000);
  const cycleLengthDays = Math.max(1, Math.round((periodEndMs - periodStartMs) / 86400000));
  const cycleStartDateIst = new Date(periodStartMs + IST_OFFSET_MS).toISOString().slice(0, 10);
  const daysElapsed = Math.max(0, (Date.now() - periodStartMs) / 86400000);
  // Cycle end reached: 0 days left (never force to 1; the UI falls back via ?? not ||).
  const daysLeft = Math.max(0, Math.ceil((periodEndMs - Date.now()) / 86400000));

  // Filter rows belonging to the active billing cycle for cycle-level break-even & ROI
  const cycleRows = enrichedRows.filter(r => r.usage_date >= cycleStartDateIst);
  const cyclePoolCreditsUsed = billingSummary ? Number(billingSummary.totalCredits || billingSummary.totalCost || 0) : 0;
  // CREDIT BASIS FIX: prefer the sticker-based pool drain from daily rows (matches Command
  // Code's allowance pacing); billingSummary.totalCredits is market-billed, not credits.
  const cyclePoolUsedPct = Number(Math.min(100, cycleRows.reduce((s, r) => s + Number(r.pool_drain_pct || 0), 0)).toFixed(1));
  const cyclePoolRemainingPct = Number(Math.max(0, 100 - cyclePoolUsedPct).toFixed(1));
  const poolRemainingRealUsd = Number(((cyclePoolRemainingPct / 100) * GOAT_PAID_USD).toFixed(2));

  const trackedApiValueExtracted = cycleRows.reduce((s, r) => s + Number(r.plan_cost || 0), 0);
  const trackedRealPocketCost = cycleRows.reduce((s, r) => s + Number(r.effective_real_usd || 0), 0);
  const trackedNetPlanSavings = trackedApiValueExtracted - trackedRealPocketCost;
  const roiMultiplier = Number((trackedApiValueExtracted / GOAT_PAID_USD).toFixed(2));
  const netValueVsPaidUsd = Number((trackedApiValueExtracted - GOAT_PAID_USD).toFixed(4));

  // User's Average Turn Profile for Smart GOAT Plan Advisor & Full Model Table
  const totReqs = Math.max(1, enrichedRows.reduce((s, r) => s + Number(r.requests_count || 0), 0));
  const totInAll = enrichedRows.reduce((s, r) => s + Number(r.tokens_in_total || 0), 0);
  const totInCached = enrichedRows.reduce((s, r) => s + Number(r.tokens_cached || 0), 0);
  const avgInTotal = Math.round(totInAll / totReqs) || 51500;
  const avgInFresh = Math.round(enrichedRows.reduce((s, r) => s + Number(r.tokens_in_fresh || 0), 0) / totReqs) || 1500;
  const avgInCached = Math.round(totInCached / totReqs) || 50000;
  const avgOut = Math.round(enrichedRows.reduce((s, r) => s + Number(r.tokens_out || 0), 0) / totReqs) || 600;
  const avgCacheHitPct = totInAll > 0 ? Number(((totInCached / totInAll) * 100).toFixed(1)) : 95.0;

  const poolRemainingFraction = Math.max(0.01, cyclePoolRemainingPct / 100);
  const safeDaysLeft = Math.max(1, daysLeft);
  const safeDailyPoolBudgetPct = Number((cyclePoolRemainingPct / safeDaysLeft).toFixed(2));

  // Build Full Usable GOAT Plan Model List dynamically from scraped catalog (evaluating current UTC time for Peak/Off-Peak)
  const nowMs = Date.now();
  const goatCatalogModels = Object.values(catalogMap)
    .filter(m => m && m.onGoatPlan)
    .map(m => {
      const liveRates = getActiveModelRatesAtTime(m, nowMs);
      const inR = Number(liveRates.in || 0);
      const outR = Number(liveRates.out || 0);
      const cacheR = Number(liveRates.cache !== null && liveRates.cache !== undefined ? liveRates.cache : inR * 0.1);
      const capUsd = m.monthlyCapUsd !== null && m.monthlyCapUsd !== undefined ? Number(m.monthlyCapUsd) : null;
      const leverage = m.isFree ? 999 : (capUsd ? Number((capUsd / GOAT_PAID_USD).toFixed(2)) : null);
      // Credit burn per $1 sticker usage on this model (70 / cap). $10 cap -> 7x.
      const poolForBurn = (monthlyPoolUsd && monthlyPoolUsd > 0) ? monthlyPoolUsd : 70;
      const creditBurnPerUsd = (!m.isFree && capUsd && capUsd > 0) ? Number((poolForBurn / capUsd).toFixed(3)) : (m.isFree ? 0 : null);
      const estTurnCost = m.isFree ? 0 :
        ((avgInFresh * inR) + (avgInCached * cacheR) + (avgOut * outR)) / 1_000_000;
      const poolDrainPer10TurnsPct = (!m.isFree && capUsd && capUsd > 0) ? ((estTurnCost * 10) / capUsd) * 100 : 0;
      const remainingModelBudgetUsd = capUsd ? (capUsd * poolRemainingFraction) : 0;
      const safeTurnsPerDay = m.isFree ? 99999 :
        (estTurnCost > 0 && remainingModelBudgetUsd > 0 ? Math.floor((remainingModelBudgetUsd / estTurnCost) / safeDaysLeft) : null);
      const totalTurnsLeftCycle = m.isFree ? 999999 :
        (estTurnCost > 0 && remainingModelBudgetUsd > 0 ? Math.floor(remainingModelBudgetUsd / estTurnCost) : null);
      const intel = (m.intelligence !== null && m.intelligence !== undefined) ? Number(m.intelligence) : null;
      const smartScore = intel !== null && leverage !== null
        ? Number(((intel * Math.min(10, leverage)) / Math.max(0.05, estTurnCost * 100)).toFixed(1))
        : null;

      return {
        slug: m.slug,
        name: m.name || m.slug,
        role: m.role || deriveDynamicRole(m),
        contextWindow: m.contextWindow || "-",
        intelligence: intel,
        intelligenceInheritedFrom: m.intelligenceInheritedFrom || null,
        inRate: liveRates.in,
        outRate: liveRates.out,
        cacheRate: liveRates.cache,
        isPeakActive: Boolean(liveRates.isPeakActive),
        peakNote: m.peakSchedule ? m.peakSchedule.note : null,
        monthlyCapUsd: capUsd,
        isFree: Boolean(m.isFree),
        leverage,
        creditBurnPerUsd,
        estTurnCost: Number(estTurnCost.toFixed(4)),
        poolDrainPer10TurnsPct: Number(poolDrainPer10TurnsPct.toFixed(2)),
        safeTurnsPerDay,
        totalTurnsLeftCycle,
        reqs5h: m.reqs5h || null,
        reqsWeek: m.reqsWeek || null,
        smartScore
      };
    })
    .sort((a, b) => (b.smartScore || 0) - (a.smartScore || 0));

  // Dynamically select the 3 Advisor Pick Cards from the scraped GOAT catalog
  const dailyDriverPick = goatCatalogModels.find(m => !m.isFree && (m.monthlyCapUsd || 0) >= 40 && (m.intelligence || 0) >= 42) || goatCatalogModels[0] || null;
  const planningPick = [...goatCatalogModels].filter(m => (m.monthlyCapUsd || 0) <= 20 && (m.intelligence || 0) > 0).sort((a, b) => (b.intelligence || 0) - (a.intelligence || 0))[0] ||
    [...goatCatalogModels].sort((a, b) => (b.intelligence || 0) - (a.intelligence || 0))[0] || null;
  const executionPick = goatCatalogModels.find(m => m !== dailyDriverPick && !m.isFree && (m.monthlyCapUsd || 0) >= 70 && (m.safeTurnsPerDay || 0) >= 150) || goatCatalogModels[1] || null;

  // Filter out alerts dismissed within the last 24 hours.
  // Missing-window-caps is derived per-request (not a persisted sync error), so
  // it gets a single stable alertKey instead of a fresh ts-keyed alert each load.
  const derivedAlerts = rollingWindows.fiveHour.capsMissing || rollingWindows.weekly.capsMissing
    ? [{ source: "WINDOW_CAPS_MISSING", code: "LIMITS", message: "5h/Weekly window caps not yet cached from usage-limits docs. Run Manual Refresh with Model List checked.", ts: new Date().toISOString(), alertKey: "WINDOW_CAPS_MISSING:LIMITS" }]
    : [];
  const activeAlerts = [...syncErrors, ...derivedAlerts]
    .map(e => ({ ...e, alertKey: e.alertKey || makeAlertKey(e) }))
    .filter(e => !dismissedMap[e.alertKey] || dismissedMap[e.alertKey] <= nowMs);
  const unmappedModels = [...new Set((lookupWarnings || [])
    .filter(e => e.source === "MISSING_MODEL_CATALOG")
    .map(e => e.model))];

  const lastSyncTs = Number(metaMap.last_sync_ts || 0);

  return {
    lastSyncTs,
    lastSyncIso: lastSyncTs ? new Date(lastSyncTs).toISOString() : null,
    lastSyncStatus: metaMap.last_sync_status || "Never synced",
    alerts: activeAlerts,
    unmappedModels,
    rollingWindows,
    lastSyncCoverage,
    authProbe,
    goatPlanSummary: {
      planName: "GOAT",
      paidUsd: GOAT_PAID_USD,
      monthlyPoolUsd,
      cycleStartDateIst,
      cycleStartIso: (billingSummary && billingSummary.periodStart) ? billingSummary.periodStart : null,
      cycleEndIso: (billingSummary && billingSummary.periodEnd) ? billingSummary.periodEnd : null,
      cycleLengthDays,
      daysElapsed: Number(daysElapsed.toFixed(1)),
      daysLeft,
      cyclePoolCreditsUsed: Number(cyclePoolCreditsUsed.toFixed(2)),
      cyclePoolUsedPct,
      cyclePoolRemainingPct,
      poolRemainingRealUsd,
      safeDailyPoolBudgetPct,
      trackedApiValueExtracted: Number(trackedApiValueExtracted.toFixed(4)),
      trackedRealPocketCost: Number(trackedRealPocketCost.toFixed(4)),
      trackedNetPlanSavings: Number(trackedNetPlanSavings.toFixed(4)),
      roiMultiplier,
      netValueVsPaidUsd,
      breakEvenPct: Number(Math.min(100, (trackedApiValueExtracted / GOAT_PAID_USD) * 100).toFixed(1)),
      avgTurnProfile: { avgInTotal, avgInFresh, avgInCached, avgOut, avgCacheHitPct },
      advisorPicks: { dailyDriverPick, planningPick, executionPick }
    },
    goatCatalogModels,
    systemInfo: {
      edgeColo,
      tables: {
        cc_daily_model_usage: counts.daily_rows_count || 0,
        cc_seen_requests: counts.seen_requests_count || 0,
        cc_meta: counts.meta_rows_count || 0,
        totalRows: (counts.daily_rows_count || 0) + (counts.seen_requests_count || 0) + (counts.meta_rows_count || 0)
      },
      storage: {
        sizeBytes: dbMeta.size_after || savedLatencies.dbSizeBytes || 0,
        sizeKb: Number(((dbMeta.size_after || savedLatencies.dbSizeBytes || 0) / 1024).toFixed(2)),
        freeLimitMb: 500
      },
      latenciesMs: {
        usageApiMs: savedLatencies.usageApiMs || 0,
        summaryApiMs: savedLatencies.summaryApiMs || 0,
        pricingApiMs: savedLatencies.pricingApiMs || 0,
        catalogApiMs: savedLatencies.catalogApiMs || 0,
        sqlWriteMs: savedLatencies.sqlWriteMs || 0,
        sqlReadMs: sqlReadLatencyMs
      },
      d1QuotaLastRun: {
        rowsRead: (dbMeta.rows_read || 0) + (savedLatencies.lastWriteRowsRead || 0),
        rowsWritten: savedLatencies.lastWriteRowsWritten || 0
      },
      pricingCache: {
        modelsCachedCount: Object.keys(catalogMap).length,
        goatModelsCount: goatCatalogModels.length,
        lastPriceSyncTs: Number(metaMap.last_price_sync_ts || 0),
        lastCatalogSyncTs: Number(metaMap.last_catalog_sync_ts || 0),
        lastPriceSyncDateIst: metaMap.last_price_sync_date_ist || "Never"
      },
      retentionWindow: {
        oldestDate: counts.oldest_date || null,
        newestDate: counts.newest_date || null,
        activeDaysCount: counts.active_days || 0,
        maxDays: 90
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

// Bounded seen-IDs load. The window must be >= the daily rollup retention so a
// re-fetched request whose aggregate still exists can never be counted twice.
async function getBoundedSeenSet(db) {
  const seenRows = await db.prepare(
    `SELECT id FROM cc_seen_requests WHERE substr(created_at, 1, 10) >= date('now', ?)`
  ).bind(`-${SEEN_RETENTION_DAYS} days`).all();
  return new Set((seenRows.results || []).map(r => r.id));
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
  const cycleStart = data.goatPlanSummary && data.goatPlanSummary.cycleStartDateIst;
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

    .mini-bar { display: flex; height: 5px; width: 105px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; margin-top: 4px; }
    .mini-c { background: var(--green); }
    .mini-f { background: var(--accent); }
    .mini-o { background: var(--purple); }

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
      <h1>Command Code Usage Tracker</h1>
      <div class="sync-meta">
        <span id="syncStatusBadge" class="badge badge-ok">Synced</span>
        <span class="info-tip tip-down" tabindex="0" data-tip="Sync Status Color Guide: Green badge = Command Code API & D1 database synced OK | Red badge = Session Cookie expired (HTTP 401/403) or network error.">i</span>
        <span id="lastSyncText">Loading...</span>
      </div>
    </div>
    <div class="nav-bar">
      <button class="tab-btn active" id="tabBtnDash" onclick="switchTab('dash')">Dashboard</button>
      <button class="tab-btn" id="tabBtnTrends" onclick="switchTab('trends')">Date-Wise &amp; Trends</button>
      <button class="tab-btn" id="tabBtnAdvisor" onclick="switchTab('advisor')">GOAT Advisor</button>
      <button class="tab-btn" id="tabBtnInfo" onclick="switchTab('info')">System Info</button>
      <button onclick="openModal()">&#x21bb; Manual Refresh</button>
    </div>
  </header>

  <!-- Dismissible 24-Hour Alert Banner on Main Page -->
  <div id="errorBanner" class="error-banner">
    <div class="error-header">
      <strong style="color:var(--red)">&#x26A0; Active Fetch / Catalog Alerts (Dismissal snoozes identical alert for 24h)</strong>
      <button class="secondary sm" onclick="dismissAlert('__ALL__')">Dismiss All (24h)</button>
    </div>
    <div id="errorList"></div>
  </div>

  <!-- ==================================================================== -->
  <!-- TAB 1: CONCISE LANDING DASHBOARD (Default: Current Billing Cycle)    -->
  <!-- ==================================================================== -->
  <div id="tabDash" class="tab-pane active">
    <!-- Only 5-Hour ($14) and Weekly ($35) Rolling Bars -->
    <div class="window-grid">
      <div class="card">
        <div class="card-label">
          <span>5-Hour Rolling Limit (14 Credit Cap) <span class="info-tip tip-down" tabindex="0" data-tip="Tracks your 5-hour rolling GOAT pool cap: 14 CREDITS of usage-value, NOT API dollars. Credit burn per $1 of sticker usage = 70 / model allowance (GPT-5.6 Sol $20 cap = 3.5 credits per $1; DeepSeek V4.1 Flash $80 cap = 0.875 per $1), so ~$4 of GPT-5.6 Sol alone drains the whole window while ~$16 of DeepSeek Flash fits in it. Bar Color Guide: Solid Green (<60% used, safe) | Solid Amber (60-85% used, moderate) | Solid Red (>=85% used, near rate limit). Resets 5 hours after oldest turn in window.">i</span></span>
          <span id="w5hReset" style="text-transform:none;">Resets: -</span>
        </div>
        <div class="prog-track"><div class="prog-fill" id="w5hBar" style="width:0%"></div></div>
        <div class="card-sub" id="w5hText">Used: 0 credits | Left: 14 credits</div>
      </div>

      <div class="card">
        <div class="card-label">
          <span>Weekly (7-Day) Rolling Limit (<span id="w7dCapLabel">35</span> Credit Cap) <span class="info-tip tip-down" tabindex="0" data-tip="Tracks your 7-day rolling GOAT pool cap in CREDITS of usage-value (NOT API dollars) - worth the full cap on a full-allowance model like GLM-5.2, but only ~1/3.5 of it on GPT-5.6 Sol (3.5 credits per $1). Opens on your first request and resets 7 days later; every new window starts at zero. Extra pay-as-you-go credits never count toward the cap. Used, cap and reset mirror Command Code's own live window state exactly. Bar Color Guide: Solid Green (<60% used, safe) | Solid Amber (60-85% used, moderate) | Solid Red (>=85% used, near weekly cap).">i</span></span>
          <span id="w7dReset" style="text-transform:none;">Resets: -</span>
        </div>
        <div class="prog-track"><div class="prog-fill" id="w7dBar" style="width:0%"></div></div>
        <div class="card-sub" id="w7dText">Used: 0 credits | Left: 35 credits</div>
        <div class="card-sub" id="w7dAnchor" style="opacity:0.75"></div>
        <div class="card-sub" id="w7dTop" style="opacity:0.85"></div>
      </div>
    </div>

    <!-- Window Coverage & Diagnostics (which models burned the credits, sync span) -->
    <div class="card" style="margin-bottom:14px;">
        <div class="card-label"><span>Window Diagnostics <span class="info-tip" tabindex="0" data-tip="Where the numbers come from. Bar source: Command Code's own limits endpoint (/internal/billing/credits windowLimits) - used, cap and reset are exact, same as the CC page. Window opened = CC's window anchor (reset minus window length). Top credit consumers = CC's per-model credit aggregation for this period. The request feed (/internal/usage) only exposes the last 100 requests of the last 24h, so the local request ledger exists only as a fallback estimate and for 5-hour diagnostics.">i</span></span></div>
      <div class="card-sub" id="windowDiagText">Loading...</div>
    </div>

    <!-- Restored GOAT Plan Value & Break-Even Tracker Bar ($10.78 Paid) -->
    <div class="roi-card">
      <div class="roi-header">
        <div>
          <strong>GOAT Plan Value &amp; Break-Even Tracker ($10.78 Paid)</strong>
          <span class="info-tip" tabindex="0" data-tip="Compares total API Value Extracted in your current billing cycle against your $10.78 GOAT subscription cost (cache hit savings excluded). Gradient Guide: Sky-Blue (left) transitions to Emerald-Green (right) as your extracted API value approaches 100% of your $10.78 break-even line. Badge Color: Green = Net Plan Savings >= $0 | Amber = Below break-even.">i</span>
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
        <div class="card-label"><span>API Value Extracted <span class="info-tip" tabindex="0" data-tip="Actual API dollar value of turns executed in selected period (includes real-time off-peak/peak pricing billed by Command Code). Compare against Real Pocket Cost below.">i</span></span></div>
        <div class="card-val" id="kpiPlanCost">$0.00</div>
        <div class="card-sub" id="kpiRealPocket">Real Pocket Cost (of $10.78): $0.00</div>
      </div>
      <div class="card">
        <div class="card-label"><span>Net GOAT Plan Savings <span class="info-tip" tabindex="0" data-tip="API Value Extracted minus Real Pocket Cost (cache savings excluded). Text Color Guide: Green (+$) = You extracted more API value than the real pocket share of $10.78 ($20-$100 cap models) | Amber (-$) = $10 cap model where the $0.78 processing fee causes a slight loss.">i</span></span></div>
        <div class="card-val" id="kpiNetSavings">$0.00</div>
        <div class="card-sub" id="kpiPoolShare">Pool Drained in Period: 0.0%</div>
      </div>
      <div class="card">
        <div class="card-label"><span>Cache Hit Rate (Info Only) <span class="info-tip" tabindex="0" data-tip="Cached Input / Total Input tokens. Displayed for prompt efficiency diagnostics only (never counted as GOAT plan savings).">i</span></span></div>
        <div class="card-val" id="kpiCacheHit">0.0%</div>
        <div class="card-sub" id="kpiCacheSub">0 cached / 0 total in</div>
      </div>
      <div class="card">
        <div class="card-label"><span>Tokens &amp; Wasted Turns <span class="info-tip" tabindex="0" data-tip="Total tokens processed and count of failed or 0-output turns in the selected period.">i</span></span></div>
        <div class="card-val" id="kpiTotalTokens">0</div>
        <div class="card-sub" id="kpiTokenSplit">Fresh: 0 | Cache: 0 | Out: 0 | Wasted: 0</div>
      </div>
    </div>

    <div class="section-title">
      <span>Per-Model Usage &amp; GOAT Leverage Breakdown <span class="info-tip" tabindex="0" data-tip="Mini Bar 3-Color Guide (under model name): Green segment = Cached Input tokens | Sky-Blue segment = Fresh Input tokens | Purple segment = Output tokens. Cap Badge Color Guide: Green = $40-$100 Cap (3.71x-9.28x high value) | Purple = $20 Cap (1.86x) | Amber = $10 Cap (0.93x). Cap = monthly sticker allowance per $10.78. Credit Burn = pool credits consumed per $1 sticker usage = 70 / Cap (a $10-cap model burns 7 credits per $1; a $70-cap model burns 1 per $1). Credits Used = sticker spend x burn - this is what CC paces the 5h/weekly/monthly bars against.">i</span></span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Model &amp; Token Split</th>
            <th>Role / Tier</th>
            <th>Reqs (Wasted)</th>
            <th>Fresh In</th>
            <th>Cached In</th>
            <th>Output</th>
            <th>Cache Hit %</th>
            <th>API Value ($)</th>
            <th>GOAT Cap (Leverage)</th>
            <th>Credit Burn ($1 = ? cr)</th>
            <th>Credits Used</th>
            <th>Real Cost ($10.78)</th>
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
      <span>Daily Spend Trend (IST) <span class="info-tip" tabindex="0" data-tip="Day-wise Command Code API value spend controlled by the Date Range Selector above. Bar Gradient Guide: Sky-Blue (left) to Purple (right) scales relative to your highest spend day in the selected period.">i</span></span>
    </div>
    <div class="card" id="dailyChart" style="margin-bottom:20px;"></div>

    <div class="section-title">
      <span>Date-Wise Usage Breakdown (90-Day Rolling Window) <span class="info-tip" tabindex="0" data-tip="Day-by-day model rollup controlled by the Date Range Selector above. Rows older than 90 days are automatically purged from D1.">i</span></span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date (IST)</th>
            <th>Model</th>
            <th>Reqs</th>
            <th>Wasted</th>
            <th>Fresh In</th>
            <th>Cached In</th>
            <th>Output</th>
            <th>Cache Hit %</th>
            <th>API Value ($)</th>
            <th>Credit Burn</th>
            <th>Credits Used</th>
            <th>Real Cost ($10.78)</th>
          </tr>
        </thead>
        <tbody id="dateTableBody"></tbody>
      </table>
    </div>
  </div>

  <!-- ==================================================================== -->
  <!-- TAB 3: SMART GOAT PLAN ADVISOR & NEXT-ACTION STRATEGY                -->
  <!-- ==================================================================== -->
  <div id="tabAdvisor" class="tab-pane">
    <div class="section-title">
      <span>Smart GOAT Plan Advisor &amp; Next-Action Strategy <span class="info-tip" tabindex="0" data-tip="100% dynamically computed from commandcode.ai/docs/plans/goat & cli/models (10 AM IST daily rule). Muse Contributor & DeepSeek Fast variants inherit base model intelligence (*) when unscored. Flexible models (DeepSeek) auto-adjust Est. Cost/Turn for current UTC Peak vs Off-Peak hours. True Value: Cap / $10.78 = sticker usage per $1 paid (allowance x). Credit burn per $1 sticker usage = 70 / Cap. Badge Colors: Green = $40-$100 Cap (3.71x-9.28x value, 1.75-7x credit burn) | Purple = $20 Cap (1.86x value, 3.5x credit burn) | Amber = $10 Cap (0.93x value, 7x credit burn).">i</span></span>
      <input type="text" id="catalogSearch" placeholder="Search all ~70 GOAT models or roles..." oninput="renderCatalogTable()" style="width:270px;" />
    </div>
    <div class="advisor-box">
      <div class="advisor-strip" id="advisorStrip"></div>
      <div class="advisor-picks-grid" id="advisorPicksGrid"></div>
      <div class="table-wrap" style="margin-bottom:0;">
        <table>
          <thead>
            <tr>
              <th onclick="sortCatalog('name')">Recommended GOAT Model</th>
              <th onclick="sortCatalog('role')">Role / Tier</th>
              <th onclick="sortCatalog('intelligence')">Intelligence</th>
              <th onclick="sortCatalog('monthlyCapUsd')">GOAT Cap (Leverage)</th>
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

  <!-- Manual Refresh Modal with 2 Checkboxes -->
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
        <input type="checkbox" id="forcePriceCheck" />
        <span>Force fetch latest API pricing now (bypass 24h / 10 AM check)</span>
      </label>
      <label class="checkbox-row">
        <input type="checkbox" id="forceCatalogCheck" />
        <span>Force fetch GOAT model list, caps, roles &amp; intelligence</span>
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

    function fmtUsd(n) { return '$' + Number(n || 0).toFixed(4); }
    function fmtNum(n) {
      n = Number(n || 0);
      if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
      return String(n);
    }
    // XSS guard: model slugs/names, roles, peak notes and alert messages all
    // originate from scraped docs or API text and are injected via innerHTML.
    function escHtml(s) {
      return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function escAttr(s) { return escHtml(s).replace(/\x60/g, '&#96;'); }
    // Weekly reset as "Xd Yh" (matches the CC page's "3d 21h" style), not raw total hours.
    // Remaining time is ceiled to whole hours, then split into days + hours -
    // the same rounding the Command Code page uses.
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
    function capBadgeClass(cap, isFree) {
      if (isFree || cap >= 40) return 'badge-ok';
      if (cap >= 20) return 'badge-purple';
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

    async function dismissAlert(alertKey) {
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
          body: JSON.stringify({ alertKey, username: creds.username, password: creds.password })
        });
        if (!res.ok) {
          adminCreds = null;
          alert('Dismiss failed: invalid admin credentials.');
          return;
        }
        adminCreds = creds;
        if (alertKey === '__ALL__') {
          rawData.alerts = [];
        } else {
          rawData.alerts = (rawData.alerts || []).filter(a => a.alertKey !== alertKey);
        }
        renderHeaderAndAlerts();
      } catch (_) {}
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

    // The HTML only embeds billing-cycle rows; pull the full 90-day history on demand.
    async function ensureFullRows() {
      if (!rawData.rowsPartial) return true;
      try {
        const res = await fetch('/api/data');
        const out = await res.json();
        if (out && out.ok && out.data) {
          rawData = out.data;
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
      const g = rawData.goatPlanSummary || {};
      const cycleStartStr = g.cycleStartDateIst || todayStr;

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
      const badge = document.getElementById('syncStatusBadge');
      const statusStr = rawData.lastSyncStatus || 'Unknown';
      const isErr = statusStr.includes('ERR') || statusStr.includes('401') || statusStr.includes('403');
      badge.className = 'badge ' + (isErr ? 'badge-err' : 'badge-ok');
      badge.textContent = isErr ? 'Cookie Expired / Auth Error' : statusStr;
      document.getElementById('lastSyncText').textContent = 'Last Sync: ' + (rawData.lastSyncTs ? new Date(rawData.lastSyncTs).toLocaleString() : 'Never') + ' (Auto-sync: 15m)';

      const alerts = Array.isArray(rawData.alerts) ? rawData.alerts : [];
      const errBanner = document.getElementById('errorBanner');
      // Unmapped models burn at the 1x pool fallback, which UNDER-reads vs CC if
      // their real cap is lower — surface as an informational (non-error) line.
      const unmapped = Array.isArray(rawData.unmappedModels) ? rawData.unmappedModels : [];
      const infoLines = unmapped.length > 0
        ? [{ source: 'UNMAPPED', message: 'Unmapped models burn at 1.00x pool fallback (may under-read vs CC): ' + unmapped.join(', ') + '. Force-fetch the GOAT model list to map them.' }]
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
      // 1. Render 5-Hour ($14) & Weekly ($35) Rolling Bars
      const rw = rawData.rollingWindows || { fiveHour: {}, weekly: {} };
      const w5 = rw.fiveHour || {};
      const w7 = rw.weekly || {};

      const b5 = document.getElementById('w5hBar');
      b5.style.width = (w5.usedPct || 0) + '%';
      b5.style.background = barColor(w5.usedPct || 0);
      document.getElementById('w5hReset').textContent = w5.resetsInMinutes ? ('Resets in ' + Math.floor(w5.resetsInMinutes/60) + 'h ' + (w5.resetsInMinutes%60) + 'm' + (w5.resetsAtIso ? ' - at ' + new Date(w5.resetsAtIso).toLocaleTimeString() : '')) : 'Window idle (5h)';
      document.getElementById('w5hText').innerHTML = 'Pool Used: <strong>' + (w5.usedCredits||0).toFixed(2) + ' credits</strong> (' + (w5.usedPct||0) + '%) | Left: <strong>' + (w5.leftCredits !== null && w5.leftCredits !== undefined ? w5.leftCredits.toFixed(2) : '-') + '</strong> of ' + (w5.limitCredits || 14) + ' credits' + (w5.windowSource === 'cc-billing-limits' ? ' <span style="opacity:0.75">(live CC window state)</span>' : ' <span style="opacity:0.75">(Sticker value: $' + (w5.stickerValueUsd||0).toFixed(2) + ' | Market-billed: $' + (w5.rawApiUsd||0).toFixed(2) + ')</span>');

      const b7 = document.getElementById('w7dBar');
      b7.style.width = (w7.usedPct || 0) + '%';
      b7.style.background = barColor(w7.usedPct || 0);
      document.getElementById('w7dReset').textContent = (w7.resetsInMs || w7.resetsInHours) ? ('Resets in ' + fmtResetDuration(w7.resetsInMs ?? (w7.resetsInHours * 3600000)) + (w7.resetsAtIso ? ' - at ' + new Date(w7.resetsAtIso).toLocaleString() : '')) : 'Window idle (7d)';
      document.getElementById('w7dCapLabel').textContent = w7.limitCredits ?? 35;
      document.getElementById('w7dText').innerHTML = 'Pool Used: <strong>' + (w7.usedCredits||0).toFixed(2) + ' credits</strong> (' + (w7.usedPct||0) + '%) | Left: <strong>' + (w7.leftCredits !== null && w7.leftCredits !== undefined ? w7.leftCredits.toFixed(2) : '-') + '</strong> of ' + (w7.limitCredits ?? 35) + ' credits' + (w7.windowSource === 'cc-billing-limits' ? ' <span style="opacity:0.75">(live CC window state)</span>' : ' <span style="opacity:0.75">(Sticker value: $' + (w7.stickerValueUsd||0).toFixed(2) + ' | Market-billed: $' + (w7.rawApiUsd||0).toFixed(2) + ')</span>');
      document.getElementById('w7dAnchor').textContent = w7.windowOpenedAt ? ('Window opened: ' + new Date(w7.windowOpenedAt).toLocaleString() + (w7.windowSource === 'cc-billing-limits' ? ' (CC window anchor)' : ' (first tracked request)')) : '';
      document.getElementById('w7dTop').textContent = Array.isArray(w7.topModels) && w7.topModels.length
        ? ('Top credit consumers' + (w7.windowSource === 'cc-billing-limits' ? ' (this period, per CC)' : '') + ': ' + w7.topModels.slice(0, 5).map(t => t.slug + ' ' + Number(t.credits).toFixed(1) + 'cr').join(' | '))
        : '';

      // Window diagnostics: authoritative CC window state + usage-feed coverage.
      const cov = rawData.lastSyncCoverage || null;
      const monthlyPool = rw.monthlyPool || null;
      const diagEl = document.getElementById('windowDiagText');
      if (diagEl) {
        const anchorTxt = w7.windowOpenedAt ? new Date(w7.windowOpenedAt).toLocaleString() : '-';
        const live = w7.windowSource === 'cc-billing-limits';
        const resetTxt = w7.resetsAtIso ? new Date(w7.resetsAtIso).toLocaleString() : '-';
        const oldestTxt = cov && cov.oldestFetchedIso ? new Date(cov.oldestFetchedIso).toLocaleString() : '-';
        const newestTxt = cov && cov.newestFetchedIso ? new Date(cov.newestFetchedIso).toLocaleString() : '-';
        const spanHrs = (cov && cov.oldestFetchedIso && cov.newestFetchedIso)
          ? (((new Date(cov.newestFetchedIso) - new Date(cov.oldestFetchedIso)) / 3600000).toFixed(1)) + 'h' : '-';
        diagEl.innerHTML =
          'Bar source: <strong>' + (live ? 'Command Code live window state (exact)' : 'local ledger estimate') + '</strong> | ' +
          'Window opened: <strong>' + escHtml(anchorTxt) + '</strong>' + (live ? ' (CC anchor, resets at ' + escHtml(resetTxt) + ')' : '') + ' | ' +
          'Monthly pool: <strong>' + (monthlyPool && monthlyPool.granted ? (Number(monthlyPool.used).toFixed(2) + ' / ' + monthlyPool.granted + ' credits') : '-') + '</strong> | ' +
          'Usage feed: last sync fetched <strong>' + (cov ? (cov.totalFetched ?? 0) : 0) + '</strong> entries in <strong>' + (cov ? (cov.pagesFetched ?? 0) : 0) + '</strong> pages ' +
          '(oldest ' + escHtml(oldestTxt) + ' -> newest ' + escHtml(newestTxt) + ', span ' + escHtml(spanHrs) + ') - the /internal/usage feed only exposes the last 100 requests of the last 24h, so the request ledger alone cannot span 7 days' +
          (cov && cov.truncated ? ' | <strong style="color:var(--amber)">FEED TRUNCATED at page cap.</strong>' : '') +
          ((cov && cov.truncated) || (w7.requestsCount || 0) === 0 ? '' : ' | tracked ' + (w7.requestsCount || 0) + ' requests in 24h feed');
      }

      // 2. Render GOAT Plan Value & Break-Even Bar ($10.78 Paid)
      const g = rawData.goatPlanSummary || { paidUsd: 10.78, cycleStartDateIst: '-', daysElapsed: 0, daysLeft: 30, trackedApiValueExtracted: 0, trackedRealPocketCost: 0, trackedNetPlanSavings: 0, roiMultiplier: 0, breakEvenPct: 0 };
      // ?? (not ||): a legitimate 0 daysLeft / 0 % must render, not fall back to 30/100.
      const daysLeftTxt = (g.daysLeft ?? 30) + 'd left';
      const cycleBadgeText = 'Cycle Start: ' + (g.cycleStartDateIst || '-') + ' IST (' + daysLeftTxt + ')';
      document.getElementById('dashCycleMeta').textContent = cycleBadgeText;
      document.getElementById('trendCycleMeta').textContent = cycleBadgeText;

      document.getElementById('roiProgressBar').style.width = Math.min(100, g.breakEvenPct || 0) + '%';
      const netSavCycle = Number(g.trackedNetPlanSavings || 0);
      document.getElementById('roiHeaderBadges').innerHTML =
        '<span class="badge ' + (netSavCycle >= 0 ? 'badge-ok' : 'badge-amber') + '">' +
        'Cycle ROI: ' + (g.roiMultiplier || 0) + 'x | Net Plan Savings: ' + (netSavCycle >= 0 ? '+' : '') + '$' + netSavCycle.toFixed(2) +
        '</span>';
      document.getElementById('roiSubText').innerHTML =
        '<span>Paid (GOAT): <strong>$' + g.paidUsd.toFixed(2) + '</strong></span>' +
        '<span>Cycle API Value Extracted: <strong>$' + Number(g.trackedApiValueExtracted || 0).toFixed(2) + '</strong></span>' +
        '<span>Real Pocket Used: <strong>$' + Number(g.trackedRealPocketCost || 0).toFixed(2) + '</strong></span>' +
        '<span>Break-Even Progress: <strong>' + (g.breakEvenPct || 0) + '%</strong></span>';

      // 3. Dashboard Filtered KPIs & Per-Model Table
      const filtered = filterRowsByPeriod(dashPeriod, 'dashDateFrom', 'dashDateTo', 'dashModelFilter');
      let planCost = 0, realPocket = 0, netSav = 0, poolPct = 0, reqs = 0, wasted = 0;
      let inTotal = 0, inFresh = 0, cached = 0, outTotal = 0;
      const byModel = {};

      for (const r of filtered) {
        planCost += Number(r.plan_cost || 0);
        realPocket += Number(r.effective_real_usd || 0);
        netSav += Number(r.net_plan_savings_usd || 0);
        poolPct += Number(r.pool_drain_pct || 0);
        reqs += Number(r.requests_count || 0);
        wasted += Number(r.failed_wasted_count || 0);
        inTotal += Number(r.tokens_in_total || 0);
        inFresh += Number(r.tokens_in_fresh || 0);
        cached += Number(r.tokens_cached || 0);
        outTotal += Number(r.tokens_out || 0);

        if (!byModel[r.model]) {
          byModel[r.model] = {
            model: r.model, role: r.role || '-', reqs: 0, wasted: 0,
            inTotal: 0, inFresh: 0, cached: 0, out: 0,
            plan: 0, realPocket: 0, netSav: 0, creditsUsed: 0,
            allowance: r.model_allowance_usd, leverage: r.leverage_multiplier,
            burnPerUsd: r.credit_burn_per_usd,
            unmapped: Boolean(r.unmapped_model_allowance),
            peakNote: r.peak_note || null
          };
        }
        byModel[r.model].reqs += r.requests_count;
        byModel[r.model].wasted += r.failed_wasted_count;
        byModel[r.model].inTotal += r.tokens_in_total;
        byModel[r.model].inFresh += r.tokens_in_fresh;
        byModel[r.model].cached += r.tokens_cached;
        byModel[r.model].out += r.tokens_out;
        byModel[r.model].plan += r.plan_cost;
        byModel[r.model].realPocket += Number(r.effective_real_usd || 0);
        byModel[r.model].netSav += Number(r.net_plan_savings_usd || 0);
        byModel[r.model].creditsUsed += Number(r.credits_consumed || 0);
      }

      document.getElementById('kpiPlanCost').textContent = fmtUsd(planCost);
      document.getElementById('kpiRealPocket').textContent = 'Real Pocket Cost (of $10.78): ' + fmtUsd(realPocket);
      const savEl = document.getElementById('kpiNetSavings');
      savEl.textContent = (netSav >= 0 ? '+' : '') + fmtUsd(netSav);
      savEl.style.color = netSav >= 0 ? 'var(--green)' : 'var(--amber)';
      document.getElementById('kpiPoolShare').textContent = 'Pool Drained in Period: ' + poolPct.toFixed(2) + '%';
      document.getElementById('kpiCacheHit').textContent = (inTotal > 0 ? ((cached / inTotal) * 100).toFixed(1) : '0.0') + '%';
      document.getElementById('kpiCacheSub').textContent = fmtNum(cached) + ' cached / ' + fmtNum(inTotal) + ' in';
      document.getElementById('kpiTotalTokens').textContent = fmtNum(inTotal + outTotal);
      document.getElementById('kpiTokenSplit').textContent = 'Fresh: ' + fmtNum(inFresh) + ' | Cache: ' + fmtNum(cached) + ' | Out: ' + fmtNum(outTotal) + ' | Wasted: ' + wasted;

      const modelArr = Object.values(byModel).sort((a,b) => b.plan - a.plan);
      document.getElementById('modelTableBody').innerHTML = modelArr.length === 0
        ? '<tr><td colspan="13" style="text-align:center;color:var(--muted);">No usage recorded for selected period (' + dashPeriod.toUpperCase() + ').</td></tr>'
        : modelArr.map(m => {
            const hit = m.inTotal > 0 ? ((m.cached / m.inTotal) * 100).toFixed(1) + '%' : '0%';
            const tot = Math.max(1, m.inTotal + m.out);
            const cP = Math.round((m.cached / tot) * 100), fP = Math.round((m.inFresh / tot) * 100), oP = Math.max(1, 100 - cP - fP);
            const capTxt = m.unmapped ? 'Unmapped (pool $)' : (m.allowance ? ('$' + m.allowance + ' (' + m.leverage + 'x)') : 'Unmapped');
            const savTxt = (m.netSav >= 0 ? '+' : '') + fmtUsd(m.netSav);
            const burnTxt = (m.burnPerUsd !== null && m.burnPerUsd !== undefined) ? (Number(m.burnPerUsd).toFixed(2) + 'x') : '-';
            const creditsTxt = Number(m.creditsUsed || 0).toFixed(2) + ' cr';
            return '<tr>' +
              '<td><strong>' + escHtml(m.model) + '</strong><div class="mini-bar"><div class="mini-c" style="width:' + cP + '%"></div><div class="mini-f" style="width:' + fP + '%"></div><div class="mini-o" style="width:' + oP + '%"></div></div></td>' +
              '<td style="color:var(--muted)">' + escHtml(m.role) + '</td>' +
              '<td>' + m.reqs + ' (' + m.wasted + ')</td>' +
              '<td>' + fmtNum(m.inFresh) + '</td>' +
              '<td>' + fmtNum(m.cached) + '</td>' +
              '<td>' + fmtNum(m.out) + '</td>' +
              '<td>' + hit + '</td>' +
              '<td><strong>' + fmtUsd(m.plan) + '</strong></td>' +
              '<td><span class="badge ' + capBadgeClass(m.allowance || 0, false) + '">' + capTxt + '</span></td>' +
              '<td><strong>' + burnTxt + '</strong></td>' +
              '<td><strong>' + creditsTxt + '</strong></td>' +
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
        ? '<tr><td colspan="12" style="text-align:center;color:var(--muted);">No date-wise rows for selected range (' + trendPeriod.toUpperCase() + ').</td></tr>'
        : filtered.map(r => {
            const hit = r.tokens_in_total > 0 ? ((r.tokens_cached / r.tokens_in_total) * 100).toFixed(1) + '%' : '0%';
            const burnTxt = (r.credit_burn_per_usd !== null && r.credit_burn_per_usd !== undefined) ? (Number(r.credit_burn_per_usd).toFixed(2) + 'x') : '-';
            return '<tr><td>' + escHtml(r.usage_date) + '</td><td>' + escHtml(r.model) + '</td><td>' + r.requests_count + '</td><td>' + r.failed_wasted_count + '</td><td>' + fmtNum(r.tokens_in_fresh) + '</td><td>' + fmtNum(r.tokens_cached) + '</td><td>' + fmtNum(r.tokens_out) + '</td><td>' + hit + '</td><td><strong>' + fmtUsd(r.plan_cost) + '</strong></td><td><strong>' + burnTxt + '</strong></td><td><strong>' + Number(r.credits_consumed || 0).toFixed(2) + ' cr</strong></td><td>' + fmtUsd(r.effective_real_usd) + '</td></tr>';
          }).join('');
    }

    function renderAdvisorTab() {
      const g = rawData.goatPlanSummary || { paidUsd: 10.78, cyclePoolRemainingPct: 100, poolRemainingRealUsd: 10.78, daysLeft: 30, safeDailyPoolBudgetPct: 3.33, avgTurnProfile: {} };
      const prof = g.avgTurnProfile || {};
      document.getElementById('advisorStrip').innerHTML =
        '<span>Cycle Remaining: <strong style="color:var(--text)">' + (g.daysLeft ?? 30) + ' days</strong></span>' +
        '<span>Pool Remaining: <strong style="color:var(--green)">' + (g.cyclePoolRemainingPct ?? 100) + '% ($' + (g.poolRemainingRealUsd ?? 10.78) + ' of $' + g.paidUsd + ')</strong></span>' +
        '<span>Safe Daily Pool Budget: <strong style="color:var(--accent)">' + (g.safeDailyPoolBudgetPct ?? 3.33) + '% / day</strong></span>' +
        '<span>Your Avg Turn Profile: <strong style="color:var(--text)">' + fmtNum(prof.avgInTotal || 51500) + ' in (' + (prof.avgCacheHitPct ?? 95) + '% cached) / ' + fmtNum(prof.avgOut || 600) + ' out</strong></span>';

      document.getElementById('thSafeTurns').textContent = 'Safe Turns / Day (' + (g.daysLeft ?? 30) + 'D Left)';

      const picks = g.advisorPicks || {};
      const renderPickCard = (tag, m, fallbackText) => {
        if (!m) return '<div class="pick-card"><div class="pick-tag">' + tag + '</div><div class="pick-desc">' + fallbackText + '</div></div>';
        const capLabel = m.isFree ? 'Free' : ('$' + (m.monthlyCapUsd || '-') + ' cap (' + (m.leverage || '-') + 'x)');
        const intelLabel = m.intelligence !== null ? ('Intelligence: <strong>' + m.intelligence + (m.intelligenceInheritedFrom ? '*' : '') + '</strong> | ') : '';
        return '<div class="pick-card">' +
          '<div class="pick-tag">' + tag + '</div>' +
          '<div class="pick-title"><span>' + escHtml(m.name) + '</span><span class="badge ' + capBadgeClass(m.monthlyCapUsd || 0, m.isFree) + '">' + escHtml(capLabel) + '</span></div>' +
          '<div class="pick-desc">' + intelLabel + 'Supports <strong>~' + fmtNum(m.safeTurnsPerDay || 0) + ' turns/day</strong> (' + fmtUsd(m.estTurnCost) + '/turn at your cache rate; uses ~' + m.poolDrainPer10TurnsPct + '% pool per 10 turns). Role: ' + escHtml(m.role || '-') + '.</div>' +
        '</div>';
      };
      document.getElementById('advisorPicksGrid').innerHTML =
        renderPickCard('&#x1F3AF; Primary Daily Driver (Best Smart Balance)', picks.dailyDriverPick, 'Run Manual Refresh with GOAT model list checked.') +
        renderPickCard('&#x1F9E9; Architecture &amp; Planning Pick (Capped Usage)', picks.planningPick, 'Run Manual Refresh with GOAT model list checked.') +
        renderPickCard('&#x26A1; High-Volume Execution / Sub-Agent Pick', picks.executionPick, 'Run Manual Refresh with GOAT model list checked.');

      renderCatalogTable();
    }

    function renderCatalogTable() {
      const q = (document.getElementById('catalogSearch').value || '').toLowerCase().trim();
      const list = (rawData.goatCatalogModels || [])
        .filter(m => !q || m.name.toLowerCase().includes(q) || m.slug.includes(q) || (m.role||'').toLowerCase().includes(q))
        .sort((a, b) => {
          const vA = a[catalogSortKey] ?? -1;
          const vB = b[catalogSortKey] ?? -1;
          if (typeof vA === 'string') return catalogSortAsc ? vA.localeCompare(vB) : vB.localeCompare(vA);
          return catalogSortAsc ? (vA - vB) : (vB - vA);
        });

      document.getElementById('catalogTableBody').innerHTML = list.length === 0
        ? '<tr><td colspan="9" style="text-align:center;color:var(--muted);">No GOAT catalog models cached yet. Click Manual Refresh and check "Force fetch GOAT model list".</td></tr>'
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

    function renderSysInfo() {
      const sys = rawData.systemInfo || {}, t = sys.tables || {}, st = sys.storage || {}, lat = sys.latenciesMs || {}, pc = sys.pricingCache || {}, rw = sys.retentionWindow || {};
      const pSync = pc.lastPriceSyncTs ? new Date(pc.lastPriceSyncTs).toLocaleString() : 'Never';
      const cSync = pc.lastCatalogSyncTs ? new Date(pc.lastCatalogSyncTs).toLocaleString() : 'Never';
      const cov = rawData.lastSyncCoverage || null;
      const wins = rawData.rollingWindows || {};
      const w7c = wins.weekly || {};
      const covTxt = cov
        ? ((cov.totalFetched ?? 0) + ' entries / ' + (cov.pagesFetched ?? 0) + ' pages' + (cov.truncated ? ' TRUNCATED' : ''))
        : 'No sync yet';
      const anchorTxt = w7c.windowOpenedAt ? new Date(w7c.windowOpenedAt).toLocaleString() : '-';
      document.getElementById('sysInfoGrid').innerHTML = [
        { label: 'D1 Database Row Counts', val: (t.totalRows || 0) + ' rows', sub: 'Daily: ' + (t.cc_daily_model_usage||0) + ' | Seen IDs: ' + (t.cc_seen_requests||0) + ' | Meta: ' + (t.cc_meta||0) },
        { label: 'D1 Storage Used', val: (st.sizeKb || 0) + ' KB', sub: ((st.sizeKb || 0) / (500 * 1024) * 100).toFixed(4) + '% of 500 MB Free Limit' },
        { label: 'Session Cookie Probe', val: rawData.authProbe ? ('usage ' + (rawData.authProbe.usageStatus ?? '-') + ' | window ' + (rawData.authProbe.windowStatus ?? '-') + ' (' + (rawData.authProbe.windowSource || 'n/a') + ')') : 'No sync yet', sub: rawData.authProbe ? (authProbeText(rawData.authProbe) + ' | ' + new Date(rawData.authProbe.ts).toLocaleString()) : 'Run Manual Refresh once' },
        { label: 'Usage & Summary API Latency', val: (lat.usageApiMs || 0) + ' ms', sub: 'Summary API: ' + (lat.summaryApiMs || 0) + ' ms' },
        { label: 'Catalog & Pricing Latency', val: 'Cat: ' + (lat.catalogApiMs || 0) + ' ms', sub: 'Pricing: ' + (lat.pricingApiMs || 0) + ' ms | GOAT Models: ' + (pc.goatModelsCount || 0) },
        { label: 'Last 10 AM IST Syncs', val: pc.lastPriceSyncDateIst || 'Never', sub: 'Catalog: ' + cSync + ' | Prices: ' + pSync },
        { label: 'D1 SQL Latency & Retention', val: 'Read: ' + (lat.sqlReadMs || 0) + ' ms', sub: 'Write: ' + (lat.sqlWriteMs || 0) + ' ms | Days: ' + (rw.activeDaysCount||0) + '/90 | Colo: ' + (sys.edgeColo||'N/A') },
        { label: 'Window & Sync Coverage', val: covTxt, sub: 'Window opened: ' + anchorTxt + ' | Weekly: ' + ((w7c.usedCredits ?? 0).toFixed(2)) + ' / ' + (w7c.limitCredits ?? 35) + ' cr' }
      ].map(c => '<div class="card"><div class="card-label">' + c.label + '</div><div class="card-val">' + c.val + '</div><div class="card-sub">' + c.sub + '</div></div>').join('');
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
      const forcePriceSync = document.getElementById('forcePriceCheck').checked;
      const forceCatalogSync = document.getElementById('forceCatalogCheck').checked;
      const msg = document.getElementById('modalMsg');
      msg.textContent = 'Syncing usage & selected dynamic catalogs...';
      try {
        const res = await fetch('/api/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, cookie, forcePriceSync, forceCatalogSync })
        });
        const out = await res.json();
        if (!res.ok || !out.ok) { msg.textContent = out.error || 'Sync failed'; return; }
        adminCreds = { username, password };
        rawData = out.data;
        initModelDropdowns();
        renderAll();
        // /api/refresh returns ok:true even when the CC sync itself 401'd -
        // surface the real error instead of a false "Synced!".
        const probeLine = (out.syncResult && out.syncResult.authProbe) ? ' [' + authProbeText(out.syncResult.authProbe) + ']' : '';
        if (out.syncResult && out.syncResult.ok === false) {
          msg.textContent = 'Sync ran but CC rejected the cookie: ' + (out.syncResult.error || 'auth error') + probeLine;
          setTimeout(closeModal, 8000);
        } else {
          msg.textContent = 'Synced! (+' + (out.syncResult.newRecordsCount || 0) + ' new entries)' + (out.syncResult.cookieRotated ? ' | session cookie auto-rotated' : '') + probeLine;
          setTimeout(closeModal, 1000);
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

    // Auto-pull fresh /api/data if browser tab is focused or open >= 15 mins
    async function checkAutoRefreshOnFocus() {
      if (document.visibilityState === 'visible' && rawData.lastSyncTs && (Date.now() - rawData.lastSyncTs >= 15 * 60 * 1000)) {
        try {
          const res = await fetch('/api/data');
          const out = await res.json();
          if (out && out.ok && out.data) {
            rawData = out.data;
            initModelDropdowns();
            renderAll();
          }
        } catch (_) {}
      }
    }
    // Stale page loads sync in the background; poll briefly so the view catches up without a reload.
    async function refreshAfterBackgroundSync() {
      const stale = !rawData.lastSyncTs || (Date.now() - rawData.lastSyncTs >= 15 * 60 * 1000);
      if (!stale) return;
      const before = rawData.lastSyncTs || 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise(r => setTimeout(r, 5000));
        try {
          const res = await fetch('/api/data');
          const out = await res.json();
          if (out && out.ok && out.data) {
            const next = out.data;
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