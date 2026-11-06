// ============================================================================
// Uptime Monitor - Cloudflare Worker
// ============================================================================
// Probes PI_IPV6_URL from Cloudflare's edge on a cron, keeps the confirmed
// state and a 24-hour history in D1, queues points for InfluxDB, and posts to
// Slack only when the confirmed state changes.
//
// Shares its D1 database with homelab-dashboard. This Worker owns the
// 'ipv6_data' and 'ipv6_influx_queue' rows; it only reads the dashboard's
// 'mute_prefs' (the 'network' mute silences these Slack alerts).
// ============================================================================

const DATA_KEY = 'ipv6_data';
const QUEUE_KEY = 'ipv6_influx_queue';
const BACKUP_KEY = 'ipv6_data_corrupt';   // last unparseable ipv6_data, kept for inspection
const MUTE_KEY = 'mute_prefs';

const PROBE_ATTEMPTS = 3;
const PROBE_TIMEOUT_MS = 3000;
const PROBE_GAP_MS = 3000;
const INFLUX_TIMEOUT_MS = 10000;
const SLACK_TIMEOUT_MS = 5000;

const HISTORY_WINDOW_S = 24 * 60 * 60;   // the dashboard labels the sparkline "24h"
const HISTORY_MAX = 2000;                // hard cap in case the cron is set to every minute
const QUEUE_MAX = 1000;                  // ~3.5 days at */5 while InfluxDB is unreachable
const DEFAULT_DOWN_AFTER = 2;            // consecutive failed runs before the state flips to down

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADERS });
const iso = s => (Number.isFinite(s) ? new Date(s * 1000).toISOString() : null);

function parseJSON(raw) {
  try { return { ok: true, value: JSON.parse(raw) }; } catch { return { ok: false, value: null }; }
}

// Constant-time string compare for the manual-run secret.
function safeEqual(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i);
  return diff === 0;
}

function fmtDuration(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

// Throws on failure: callers must not carry on with defaults, or the write
// that follows would replace the stored history with an empty one.
async function readRows(db, keys) {
  const { results } = await db
    .prepare(`SELECT key, value FROM store WHERE key IN (${keys.map(() => '?').join(',')})`)
    .bind(...keys)
    .all();
  return Object.fromEntries((results || []).map(r => [r.key, r.value]));
}

// One D1 batch, so the state row and the queue row change together or not at all.
async function writeRows(db, entries) {
  const stmt = db.prepare('INSERT INTO store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  await db.batch(Object.entries(entries).map(([k, v]) => stmt.bind(k, v)));
}

// ---------------------------------------------------------------------------
// State document
// ---------------------------------------------------------------------------

const isPoint = p => p && Number.isFinite(p.time) && (p.status === 0 || p.status === 1);
const asState = s => (s === 'up' || s === 'down' ? s : 'unknown');

// Start of the trailing run of `state` in history (used to back-fill `since`
// for documents written by the previous version of this Worker).
function runStart(history, state) {
  const status = state === 'up' ? 1 : state === 'down' ? 0 : null;
  let start = null;
  for (let i = history.length - 1; i >= 0 && history[i].status === status; i--) start = history[i].time;
  return start;
}

// Accepts anything (missing row, older shape, hand-edited JSON) and returns a complete document.
function normalizeDoc(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const history = Array.isArray(d.history) ? d.history.filter(isPoint) : [];
  const state = asState(d.state);
  const outage = d.last_outage;
  return {
    state,
    since: Number.isFinite(d.since) ? d.since : runStart(history, state),
    // Older documents have no `notified`; that version alerted on every transition, so state == notified.
    notified: 'notified' in d ? (asState(d.notified) === 'unknown' ? null : d.notified) : (state === 'unknown' ? null : state),
    fail_streak: Number.isInteger(d.fail_streak) && d.fail_streak > 0 ? d.fail_streak : 0,
    first_fail: Number.isFinite(d.first_fail) ? d.first_fail : null,
    last_check: Number.isFinite(d.last_check) ? d.last_check : (history.at(-1)?.time ?? null),
    last_outage: outage && Number.isFinite(outage.from) && Number.isFinite(outage.to) ? outage : null,
    history
  };
}

// Up is confirmed by one good run; down needs `downAfter` failed runs in a row.
// The outage is dated from the first failure, not from the run that confirmed it.
function advanceState(doc, status, now, downAfter) {
  if (status === 1) {
    doc.fail_streak = 0;
    doc.first_fail = null;
  } else {
    if (doc.fail_streak === 0) doc.first_fail = now;
    doc.fail_streak += 1;
  }

  const next = status === 1 ? 'up' : doc.fail_streak >= downAfter ? 'down' : doc.state;
  if (next !== doc.state) {
    if (next === 'down') {
      doc.since = doc.first_fail ?? now;
    } else {
      if (doc.state === 'down' && Number.isFinite(doc.since)) doc.last_outage = { from: doc.since, to: now };
      doc.since = now;
    }
    doc.state = next;
  }

  doc.last_check = now;
  doc.history = [...doc.history, { time: now, status }]
    .filter(p => p.time > now - HISTORY_WINDOW_S)
    .slice(-HISTORY_MAX);
}

// `state` is the truth; `notified` is what Slack was last told. They differ
// while an alert is pending (Slack failed, or the network category is muted).
function pendingAlert(doc) {
  if (doc.state === 'down' && doc.notified !== 'down') return 'down';
  if (doc.state === 'up' && doc.notified === 'down') return 'up';
  return null;
}

function alertText(kind, doc, now) {
  if (kind === 'down') {
    const n = doc.fail_streak;
    const span = Number.isFinite(doc.since) ? now - doc.since : 0;
    return `🚨 *IPv6 DOWN:* Pi5 is unreachable via IPv6 (${n} failed check${n === 1 ? '' : 's'} in a row` +
      (span >= 60 ? ` over ${fmtDuration(span)}` : '') + ').';
  }
  const o = doc.last_outage;
  return '✅ *IPv6 UP:* Pi5 is reachable again via IPv6' + (o ? ` after ${fmtDuration(o.to - o.from)} down.` : '.');
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

// Up = the endpoint itself answered 2xx/3xx. Redirects are not followed, so a
// redirect to a host that is reachable over IPv4 can't mask a dead IPv6 path.
async function probe(url) {
  for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      res.body?.cancel().catch(() => {});
      if (res.status < 400) return true;
      console.warn(`Probe attempt ${attempt}/${PROBE_ATTEMPTS}: HTTP ${res.status}`);
    } catch (err) {
      console.warn(`Probe attempt ${attempt}/${PROBE_ATTEMPTS}: ${err.message}`);
    }
    if (attempt < PROBE_ATTEMPTS) await sleep(PROBE_GAP_MS);
  }
  return false;
}

async function sendSlack(webhook, text) {
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS)
    });
    res.body?.cancel().catch(() => {});
    if (res.ok) return true;
    console.error(`Slack: HTTP ${res.status}; will retry next run`);
  } catch (err) {
    console.error(`Slack: ${err.message}; will retry next run`);
  }
  return false;
}

async function flushInflux(env, queue) {
  const body = queue.map(p => `uptime,monitor_name=Pi5_IPv6 status_code=${p.status} ${p.time}`).join('\n') + '\n';
  const url = `${env.INFLUX_URL}${env.INFLUX_URL.includes('?') ? '&' : '?'}precision=s`;
  const headers = { Authorization: `Token ${env.INFLUX_TOKEN}`, 'Content-Type': 'text/plain; charset=utf-8' };
  // Optional upstream guard (e.g. a reverse proxy or tunnel that checks a shared secret).
  if (env.INFLUX_SECRET) headers['x-worker-secret'] = env.INFLUX_SECRET;

  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(INFLUX_TIMEOUT_MS) });
    if (res.ok) {
      res.body?.cancel().catch(() => {});
      return true;
    }
    console.error(`InfluxDB: HTTP ${res.status} ${(await res.text()).slice(0, 300)}; keeping ${queue.length} points queued`);
  } catch (err) {
    console.error(`InfluxDB: ${err.message}; keeping ${queue.length} points queued`);
  }
  return false;
}

// ---------------------------------------------------------------------------
// One monitoring run
// ---------------------------------------------------------------------------

async function monitorIPv6(env) {
  const { PI_IPV6_URL, HEALTH_DB, SLACK_WEBHOOK } = env;
  if (!HEALTH_DB) return { ok: false, error: 'D1 binding HEALTH_DB is missing' };
  if (!PI_IPV6_URL) return { ok: false, error: 'PI_IPV6_URL is not set' };

  const now = Math.floor(Date.now() / 1000);
  const status = (await probe(PI_IPV6_URL)) ? 1 : 0;

  // Read after probing, to keep the read-modify-write window short.
  let rows;
  try {
    rows = await readRows(HEALTH_DB, [DATA_KEY, QUEUE_KEY, MUTE_KEY]);
  } catch (err) {
    console.error('D1 read failed; skipping this run so stored history is not overwritten:', err);
    return { ok: false, error: 'D1 read failed' };
  }

  const writes = {};
  const parsed = rows[DATA_KEY] == null ? { ok: true, value: null } : parseJSON(rows[DATA_KEY]);
  if (!parsed.ok) {
    console.error(`${DATA_KEY} is not valid JSON; copied to ${BACKUP_KEY}, starting fresh`);
    writes[BACKUP_KEY] = rows[DATA_KEY];
  }
  const doc = normalizeDoc(parsed.value);

  // Queue: own row; falls back to the queue embedded in documents from the previous version.
  let queue = rows[QUEUE_KEY] != null ? parseJSON(rows[QUEUE_KEY]).value : parsed.value?.influxQueue;
  queue = Array.isArray(queue) ? queue.filter(isPoint) : [];

  const downAfter = Math.max(1, parseInt(env.DOWN_AFTER_RUNS, 10) || DEFAULT_DOWN_AFTER);
  advanceState(doc, status, now, downAfter);

  // Slack
  const mutes = rows[MUTE_KEY] != null ? parseJSON(rows[MUTE_KEY]).value || {} : {};
  const pending = pendingAlert(doc);
  let alert = 'none';
  if (!pending) {
    if (doc.state === 'up') doc.notified = 'up';
  } else if (!SLACK_WEBHOOK) {
    doc.notified = doc.state;          // alerting disabled: track silently
    alert = 'disabled';
  } else if (mutes.network) {
    // A recovery during a mute is dropped; an outage still alerts once unmuted.
    if (pending === 'up') doc.notified = 'up';
    alert = 'muted';
  } else if (await sendSlack(SLACK_WEBHOOK, alertText(pending, doc, now))) {
    doc.notified = pending;
    alert = `sent ${pending}`;
  } else {
    alert = `failed ${pending}`;       // notified unchanged, so the next run retries
  }

  // InfluxDB (optional: without INFLUX_URL and INFLUX_TOKEN nothing is queued)
  let influx = 'disabled';
  if (env.INFLUX_URL && env.INFLUX_TOKEN) {
    queue = [...queue, { time: now, status }].slice(-QUEUE_MAX);
    if (await flushInflux(env, queue)) {
      queue = [];
      influx = 'flushed';
    } else {
      influx = 'queued';
    }
  }

  writes[DATA_KEY] = JSON.stringify(doc);
  writes[QUEUE_KEY] = JSON.stringify(queue);
  try {
    await writeRows(HEALTH_DB, writes);
  } catch (err) {
    console.error('D1 write failed:', err);
    return { ok: false, error: 'D1 write failed' };
  }

  const result = { ok: true, probe: status ? 'up' : 'down', state: doc.state, fail_streak: doc.fail_streak, alert, influx, queued: queue.length };
  console.log(JSON.stringify(result));
  return result;
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(monitorIPv6(env).then(r => { if (!r.ok) console.error(`Run failed: ${r.error}`); }));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    // Manual run: POST /run with "Authorization: Bearer <RUN_SECRET>".
    if (url.pathname === '/run') {
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
      if (!env.RUN_SECRET) return new Response('Manual runs are disabled (RUN_SECRET is not set)', { status: 403 });
      if (!safeEqual(request.headers.get('Authorization') || '', `Bearer ${env.RUN_SECRET}`)) {
        return new Response('Unauthorized', { status: 401 });
      }
      const result = await monitorIPv6(env);
      return json(result, result.ok ? 200 : 500);
    }

    // Read-only status; never probes, so crawlers and favicon requests can't add history points.
    if (url.pathname === '/' && request.method === 'GET') {
      if (!env.HEALTH_DB) return json({ error: 'D1 binding HEALTH_DB is missing' }, 500);
      let rows;
      try {
        rows = await readRows(env.HEALTH_DB, [DATA_KEY, QUEUE_KEY]);
      } catch (err) {
        return json({ error: 'D1 read failed' }, 503);
      }
      const doc = normalizeDoc(rows[DATA_KEY] == null ? null : parseJSON(rows[DATA_KEY]).value);
      const queue = rows[QUEUE_KEY] == null ? [] : parseJSON(rows[QUEUE_KEY]).value;
      return json({
        state: doc.state,
        since: iso(doc.since),
        last_check: iso(doc.last_check),
        fail_streak: doc.fail_streak,
        notified: doc.notified,
        last_outage: doc.last_outage && { from: iso(doc.last_outage.from), to: iso(doc.last_outage.to) },
        history_points: doc.history.length,
        influx_queued: Array.isArray(queue) ? queue.length : 0
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};
