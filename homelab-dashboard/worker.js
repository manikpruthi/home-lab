// ============================================================================
// HomeLab Health Dashboard - Cloudflare Worker
// ============================================================================
// Polls the Pi5 health API plus four Oracle VM health endpoints, stores the
// merged snapshot in D1, and renders a two-tab dashboard (Pi5 / Oracle VMs).
// Shares its D1 database with the uptime-monitor Worker, which owns the
// 'ipv6_data' row rendered as the IPv6 sparkline.
//
// Everything deployment-specific (URLs, credentials, webhook) comes from
// Worker variables/secrets, so this exact file is both the git copy and the
// copy pasted into the Cloudflare dashboard.
// ============================================================================

const VM_DEFS = [
  { id: 'vm1', name: 'VM1' },
  { id: 'vm2', name: 'VM2' },
  { id: 'vm3', name: 'VM3' },
  { id: 'vm4', name: 'VM4' }
];

const MUTE_CATEGORIES = ['global', 'compute', 'storage', 'network', 'services'];

// First matching rule wins; anything unmatched is a service alert.
const ALERT_RULES = [
  ['global', /\bhost unreachable\b/],
  ['network', /\b(tunnel|tailscale|dns|network|ipv[46]|vpn|wireguard)\b/],
  ['storage', /\b(disk|boot|inodes?|storage|usb|toshiba|wd|smart|read-only|filesystem)\b/],
  ['services', /\b(docker|containers?|services?)\b/],
  ['compute', /\b(temp|memory|ram|load|i\/o|oom|zombies?|throttl\w*|steal|cpu|crash|shutdown)\b/]
];

const UNREACHABLE_ALERT = 'Host unreachable (fetch failed or timed out)';
const ONE_SHOT_ALERT = /ARM instance grabbed/i;  // notified once, never re-reminded

const FETCH_TIMEOUT_MS = 12000;
const STALE_MS = 20 * 60 * 1000;          // page load refreshes in background past this age
const REMIND_MS = 6 * 60 * 60 * 1000;     // Slack re-reminds about unchanged active alerts
const IPV6_WINDOW_S = 24 * 60 * 60;      // sparkline window; matches uptime-monitor's retention and the "24h" label
const IPV6_STALE_S = 15 * 60;            // uptime-monitor runs every 5 min, so 3 missed runs = stale

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
};

// One poll at a time per isolate, so concurrent page loads don't stampede the hosts.
let inflightRefresh = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Hosts without a configured URL are skipped entirely.
function getHosts(env) {
  return [
    { id: 'pi5', name: 'Pi5', url: env.PI5_HEALTH_URL || '', group: 'pi5' },
    ...VM_DEFS.map(vm => ({ ...vm, url: env[`${vm.id.toUpperCase()}_URL`] || '', group: 'vms' }))
  ].filter(h => h.url);
}

// Timing-safe Basic auth against ADMIN_USER / ADMIN_PASS Worker secrets.
function isAuthorized(request, env) {
  if (!env.ADMIN_USER || !env.ADMIN_PASS) return false;
  const header = request.headers.get('Authorization') || '';
  const expected = 'Basic ' + btoa(`${env.ADMIN_USER}:${env.ADMIN_PASS}`);
  let diff = header.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= (header.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  return diff === 0;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function categorizeAlert(text) {
  const a = String(text).toLowerCase();
  for (const [cat, re] of ALERT_RULES) if (re.test(a)) return cat;
  return 'services';
}

async function readStore(env, keys) {
  const out = {};
  try {
    const { results } = await env.HEALTH_DB
      .prepare(`SELECT key, value FROM store WHERE key IN (${keys.map(() => '?').join(',')})`)
      .bind(...keys)
      .all();
    for (const row of results || []) {
      try { out[row.key] = JSON.parse(row.value); } catch (err) { console.error(`D1 parse error (${row.key}):`, err); }
    }
  } catch (err) {
    console.error('D1 read error:', err);
  }
  return out;
}

async function writeStore(env, entries) {
  const stmt = env.HEALTH_DB.prepare(
    'INSERT INTO store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  try {
    await env.HEALTH_DB.batch(Object.entries(entries).map(([k, v]) => stmt.bind(k, JSON.stringify(v))));
  } catch (err) {
    console.error('D1 write error:', err);
  }
}

// Returns the parsed payload, or null on timeout / HTTP error / bad JSON / wrong shape.
async function fetchHealth(host, headers) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(host.url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) {
        console.warn(`${host.name}: HTTP ${res.status}`);
        continue;
      }
      const body = await res.json();
      if (body && typeof body === 'object' && body.system) return body;
      console.warn(`${host.name}: payload missing 'system'`);
    } catch (err) {
      console.warn(`${host.name}: ${err.message}`);
    }
  }
  return null;
}

const appendTrend = (arr = [], val) => [...arr, parseFloat(val) || 0].slice(-5);

function trendsFor(host, old, fresh) {
  if (host.id === 'pi5') {
    return { temp: appendTrend(old.temp, fresh.system.temp), ram: appendTrend(old.ram, fresh.system.ram_pct) };
  }
  return { steal: appendTrend(old.steal, fresh.system.cpu_steal) };
}

// fetched_at = last successful fetch; attempted_at = last try (success or not).
function mergeHost(host, old = {}, fresh, now) {
  if (fresh) {
    fresh._trends = trendsFor(host, old._trends || {}, fresh);
    fresh._meta = { fetched_at: now, attempted_at: now };
    fresh._online = true;
    return fresh;
  }
  return { ...old, _meta: { ...(old._meta || {}), attempted_at: now }, _online: false };
}

// Flat alert list across hosts. An offline host contributes only its
// unreachable alert, never the stale alerts from its cached payload.
function collectAlerts(data, hosts, mutes) {
  const out = [];
  for (const host of hosts) {
    const h = data[host.id];
    if (!h || !h._meta) continue;
    const label = host.id === 'pi5' ? 'Pi5' : (h.hostname || host.name);
    const texts = h._online === false
      ? [UNREACHABLE_ALERT]
      : (host.id === 'pi5' ? h.summary?.active_alerts : h.active_alerts) || [];
    for (const raw of texts) {
      const text = String(raw);
      const cat = categorizeAlert(text);
      out.push({ host: label, text, cat, muted: !!mutes[cat] });
    }
  }
  return out;
}

// The uptime-monitor Worker's 'ipv6_data' row, trimmed to the sparkline window.
// Stale only when the row exists, so a setup without uptime-monitor shows no alert.
function ipv6Monitor(raw, nowS) {
  const doc = raw && typeof raw === 'object' ? raw : null;
  const history = (Array.isArray(doc?.history) ? doc.history : []).filter(h => h && h.time > nowS - IPV6_WINDOW_S);
  const lastCheck = Number.isFinite(doc?.last_check) ? doc.last_check : (doc?.history?.at(-1)?.time ?? null);
  return {
    state: doc?.state || 'unknown',
    since: Number.isFinite(doc?.since) ? doc.since : null,
    last_check: lastCheck,
    stale: !!doc && (!Number.isFinite(lastCheck) || nowS - lastCheck > IPV6_STALE_S),
    history
  };
}

const fmtAge = s => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`);

// Page-only alert for the Global Alerts card. Not part of collectAlerts, so the
// dashboard's Slack never duplicates the uptime-monitor's own IPv6 alerts.
function ipv6Alerts(mon, mutes, nowS) {
  let text = null;
  if (mon.stale) {
    text = Number.isFinite(mon.last_check)
      ? `IPv6 monitor stale (no check for ${fmtAge(nowS - mon.last_check)})`
      : 'IPv6 monitor stale (no checks recorded)';
  } else if (mon.state === 'down') {
    text = 'IPv6 unreachable from Cloudflare edge' + (Number.isFinite(mon.since) ? ` for ${fmtAge(nowS - mon.since)}` : '');
  }
  return text ? [{ host: 'Pi5', text, cat: 'network', muted: !!mutes.network }] : [];
}

// Numbers are stripped from the dedupe key so "RAM (86%)" -> "RAM (87%)" isn't a new alert.
const alertKey = a => `${a.host}: ${a.text}`.toLowerCase().replace(/\d+(\.\d+)?/g, '#');

// Slack only on change (new / resolved) plus a periodic reminder for still-active alerts.
function buildSlackUpdate(alerts, prev = {}, nowMs) {
  const current = new Map(alerts.filter(a => !a.muted).map(a => [alertKey(a), `${a.host}: ${a.text}`]));
  const previous = prev.active || {};

  const added = [...current].filter(([k]) => !(k in previous)).map(([, label]) => label);
  const resolved = Object.entries(previous).filter(([k]) => !current.has(k)).map(([, label]) => label);
  const reminders = [...current.values()].filter(label => !ONE_SHOT_ALERT.test(label));
  const remindDue = reminders.length > 0 && nowMs - (prev.last_sent || 0) >= REMIND_MS;

  const parts = [];
  if (added.length) parts.push('🚨 *New alerts*\n• ' + added.join('\n• '));
  if (resolved.length) parts.push('✅ *Resolved*\n• ' + resolved.join('\n• '));
  if (!added.length && !resolved.length && remindDue) parts.push(`⏰ *Still active (${reminders.length})*\n• ` + reminders.join('\n• '));
  else if (parts.length && current.size > added.length) parts.push(`_${current.size - added.length} other alert(s) still active_`);

  const message = parts.join('\n\n');
  const changed = added.length > 0 || resolved.length > 0;
  return {
    message,
    state: { active: Object.fromEntries(current), last_sent: message ? nowMs : (prev.last_sent || 0) },
    dirty: changed || !!message
  };
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export default {
  async scheduled(event, env, ctx) {
    await this.fetchAndStore(env, ctx, 'all', true);
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/mute' && request.method === 'POST') {
      if (!isAuthorized(request, env)) return new Response('Unauthorized', { status: 401 });

      let category;
      try { ({ category } = await request.json()); } catch (err) { /* handled below */ }
      if (!MUTE_CATEGORIES.includes(category)) return json({ error: 'unknown category' }, 400);

      const { mute_prefs: mutes = {} } = await readStore(env, ['mute_prefs']);
      mutes[category] = !mutes[category];
      await writeStore(env, { mute_prefs: mutes });
      return json({ success: true, mutes });
    }

    if (url.pathname === '/') {
      return new Response(renderPage(env), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }

    if (url.pathname === '/api/data') {
      const force = url.searchParams.get('force');
      const hosts = getHosts(env);
      let data;

      if (force) {
        if (!isAuthorized(request, env)) return new Response('Unauthorized', { status: 401 });
        if (!['all', 'pi5', 'vms'].includes(force)) return json({ error: 'force must be all, pi5 or vms' }, 400);
        data = await this.fetchAndStore(env, ctx, force, false);
      }

      const store = await readStore(env, force ? ['ipv6_data', 'mute_prefs'] : ['dashboard_data', 'ipv6_data', 'mute_prefs']);
      const mutes = store.mute_prefs || {};

      if (!force) {
        data = store.dashboard_data;
        const now = Date.now();
        const stale = !data || hosts.some(h => {
          const m = data[h.id]?._meta;
          return !m || now - new Date(m.attempted_at || m.fetched_at).getTime() >= STALE_MS;
        });
        if (!data) {
          data = await this.refreshOnce(env, ctx);
        } else if (stale) {
          // Serve the cached copy now; refresh in the background.
          ctx.waitUntil(this.refreshOnce(env, ctx).catch(err => console.error('Background refresh failed:', err)));
        }
      }

      const nowS = Math.floor(Date.now() / 1000);
      const ipv6 = ipv6Monitor(store.ipv6_data, nowS);
      const body = {
        ...data,
        pi5: { ...(data.pi5 || {}), ipv6_monitor: ipv6 },
        _mutes: mutes,
        _alerts: [...collectAlerts(data, hosts, mutes), ...ipv6Alerts(ipv6, mutes, nowS)],
        _vms: VM_DEFS.map(v => v.id)
      };
      return json(body);
    }

    return new Response('Not Found', { status: 404 });
  },

  refreshOnce(env, ctx) {
    if (!inflightRefresh) {
      inflightRefresh = this.fetchAndStore(env, ctx, 'all', false).finally(() => { inflightRefresh = null; });
    }
    return inflightRefresh;
  },

  async fetchAndStore(env, ctx, target, notify) {
    const started = Date.now();
    const hosts = getHosts(env);
    const targets = hosts.filter(h => target === 'all' || h.group === target);
    const headers = env.WORKER_SECRET ? { 'x-worker-secret': env.WORKER_SECRET } : {};

    // Fetch first, then read-merge-write, to keep the race window with a concurrent poll small.
    const results = await Promise.all(targets.map(h => fetchHealth(h, headers)));

    const store = await readStore(env, ['dashboard_data', 'mute_prefs', 'alert_state']);
    const data = store.dashboard_data || {};
    const now = new Date().toISOString();
    targets.forEach((h, i) => { data[h.id] = mergeHost(h, data[h.id], results[i], now); });

    const writes = { dashboard_data: data };

    if (notify && env.SLACK_WEBHOOK) {
      const alerts = collectAlerts(data, hosts, store.mute_prefs || {});
      const update = buildSlackUpdate(alerts, store.alert_state, Date.now());
      if (update.message) {
        ctx.waitUntil(
          fetch(env.SLACK_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: update.message })
          }).then(r => { if (!r.ok) console.error(`Slack: HTTP ${r.status}`); })
            .catch(err => console.error('Slack error:', err))
        );
      }
      if (update.dirty) writes.alert_state = update.state;
    }

    await writeStore(env, writes);
    console.log(`fetchAndStore(${target}) ${Date.now() - started}ms, online: ` +
      targets.map((h, i) => `${h.name}=${results[i] ? 'up' : 'down'}`).join(' '));
    return data;
  }
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function renderPage(env) {
  const title = escapeHtml(env.DASHBOARD_TITLE || 'HomeLab Dashboard');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --bg: #0f172a; --card: #1e293b; --border: #334155; --text: #f8fafc;
      --text-muted: #94a3b8; --accent: #38bdf8; --success: #10b981;
      --warning: #f59e0b; --danger: #ef4444; --info: #06b6d4; --tab-bg: #0f172a; --tab-active: #1e293b;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 20px; line-height: 1.5; overflow-x: hidden; }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1px solid var(--border); padding-bottom: 15px; margin-bottom: 20px; }
    .header h2 { margin: 0; font-size: 1.5rem; letter-spacing: 1px; color: var(--text); display: flex; align-items: center; gap: 10px; }
    .status-dot { width: 10px; height: 10px; background: var(--success); border-radius: 50%; box-shadow: 0 0 8px var(--success); }
    .status-dot.err { background: var(--danger); box-shadow: 0 0 8px var(--danger); }
    .btn-group { display: flex; gap: 10px; }
    button { padding: 6px 12px; background: transparent; color: var(--accent); border: 1px solid var(--accent); border-radius: 4px; cursor: pointer; font-family: var(--mono); font-size: 0.8em; transition: all 0.2s; white-space: nowrap; }
    button:hover { background: var(--accent); color: var(--bg); }

    .mute-btn { padding: 0; margin-left: 8px; font-size: 1.3em; border: none; background: transparent; color: var(--text-muted); transition: transform 0.2s; }
    .mute-btn:hover { background: transparent; transform: scale(1.1); }

    .tabs { display: flex; gap: 5px; margin-bottom: 20px; border-bottom: 2px solid var(--border); }
    .tab { padding: 10px 20px; background: var(--tab-bg); color: var(--text-muted); cursor: pointer; font-weight: bold; font-family: var(--mono); font-size: 1em; border-radius: 6px 6px 0 0; border: 1px solid transparent; border-bottom: none; }
    .tab.active { background: var(--tab-active); color: var(--accent); border-color: var(--border); }
    .pane { display: none; }
    .pane.active { display: block; }
    .pane-head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; }
    .timestamp { font-family: var(--mono); color: var(--text-muted); font-size: 0.85em; }

    .grid { display: grid; grid-template-columns: 1fr; gap: 20px; }

    .card { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.2); transition: border-color 0.3s; min-width: 0; }
    .card.err { border-color: var(--danger); }
    .card h3 { margin: 0 0 15px 0; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1.5px; color: var(--text-muted); display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; border-bottom: 1px solid var(--border); padding-bottom: 8px; align-items: flex-end; min-height: 28px; }
    .card h3.sub { margin-top: 20px; border-top: 1px solid var(--border); padding-top: 15px; align-items: center; min-height: auto; }

    .header-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }

    .data-row { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 8px; font-size: 0.95em; align-items: center; }
    .val { font-family: var(--mono); color: var(--accent); font-weight: bold; text-align: right; overflow-wrap: anywhere; }
    .val.ok { color: var(--success); }
    .val.warn { color: var(--warning); }
    .val.err { color: var(--danger); }
    .val.info { color: var(--info); }
    .speed-tag { font-size: 0.85em; color: var(--text-muted); font-weight: normal; font-family: var(--mono); }
    .bar-bg { background: var(--bg); height: 6px; border-radius: 3px; overflow: hidden; margin: 4px 0 12px 0; }
    .bar-fill { height: 100%; background: var(--accent); transition: width 0.5s ease-out; }
    .bar-fill.high { background: var(--danger); }
    .subtext { font-family: var(--mono); color: var(--text-muted); font-size: 0.8em; white-space: pre-wrap; word-break: break-all; background: var(--bg); padding: 8px; border-radius: 4px; margin-top: 10px; border: 1px solid var(--border); }
    .badge { padding: 4px 8px; border-radius: 4px; font-size: 0.85em; font-family: var(--mono); font-weight: bold; margin-bottom: 2px; display: inline-block; }
    .badge.success { background: rgba(16, 185, 129, 0.2); color: var(--success); border: 1px solid var(--success); }
    .badge.danger { background: rgba(239, 68, 68, 0.2); color: var(--danger); border: 1px solid var(--danger); }
    .badge.tunnel { cursor: pointer; margin-left: 4px; }
    .alert-summary { margin-bottom: 15px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 4px; border-left: 3px solid var(--danger); }
    .alert-summary.ok { border-left-color: var(--success); }
    .alert-item { color: var(--danger); font-size: 0.85em; font-family: var(--mono); font-weight: bold; margin-bottom: 4px; }
    .alert-item.ok { color: var(--success); }
    .alert-item.muted { color: var(--text-muted); font-weight: normal; }
    .alert-item:last-child { margin-bottom: 0; }

    .sparkline { display: flex; height: 16px; gap: 1px; align-items: flex-end; background: rgba(0,0,0,0.2); padding: 2px; width: max-content; }
    .spark-bar { flex: 0 0 2px; cursor: pointer; transition: opacity 0.2s; }
    .spark-bar.up { background: var(--success); height: 100%; }
    .spark-bar.down { background: var(--danger); height: 40%; }
    .spark-bar:hover { opacity: 0.7; }
    .spark-time-display { font-size: 0.75em; color: var(--info); text-align: right; min-height: 14px; margin-top: 4px; font-family: var(--mono); }

    .services-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); column-gap: 30px; }

    @media (min-width: 900px) {
      .grid { grid-template-columns: repeat(2, 1fr); }
      .card-wide { grid-column: 1 / -1; }
    }

    @media (max-width: 600px) {
      body { padding: 16px; }
      .header { flex-direction: column; align-items: flex-start; gap: 15px; }
      .btn-group { width: 100%; justify-content: space-between; }
      .tabs { flex-wrap: wrap; }
      .tab { flex-grow: 1; text-align: center; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2><div class="status-dot" id="status-dot"></div> ${title}</h2>
      <div class="btn-group">
        <button data-act="sync" data-arg="all">[ GLOBAL_SYNC ]</button>
      </div>
    </div>

    <div id="global-alerts" style="margin-bottom: 20px;"></div>

    <div class="tabs">
      <button class="tab active" data-act="tab" data-arg="pi5">PI5 SERVER</button>
      <button class="tab" data-act="tab" data-arg="vms">ORACLE VMs</button>
    </div>

    <div id="pane-pi5" class="pane active">
      <div class="pane-head">
        <div class="timestamp" id="ts-pi5">SYS_STATUS: INITIALIZING...</div>
        <button data-act="sync" data-arg="pi5">[ SYNC_PI5 ]</button>
      </div>
      <div id="dash-pi5" class="grid" style="display:none;"></div>
    </div>

    <div id="pane-vms" class="pane">
      <div class="pane-head">
        <div class="timestamp" id="ts-vms">SYS_STATUS: INITIALIZING...</div>
        <button data-act="sync" data-arg="vms">[ SYNC_VMS ]</button>
      </div>
      <div id="dash-vms" class="grid" style="display:none;"></div>
    </div>
  </div>

  <script>(${clientMain})();</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Browser code. Serialized into the page with Function.prototype.toString, so
// it must stay self-contained (no references to Worker-scope identifiers).
// ---------------------------------------------------------------------------

function clientMain() {
  const state = { mutes: {}, creds: null, data: null };
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

  const ist = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour12: true
  });
  const fmtTime = iso => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? ist.format(d) : 'never';
  };

  const row = (label, val, cls) => '<div class="data-row"><span>' + label + '</span> <span class="val ' + (cls || '') + '">' + val + '</span></div>';
  const bar = (pct, high) => '<div class="bar-bg"><div class="bar-fill ' + (high ? 'high' : '') + '" style="width: ' + Math.min(Math.max(pct, 0), 100) + '%"></div></div>';
  const card = (cls, err, inner) => '<div class="card ' + cls + (err ? ' err' : '') + '">' + inner + '</div>';

  const muteBtn = cat => {
    const muted = !!state.mutes[cat];
    return '<button class="mute-btn" data-act="mute" data-arg="' + cat + '" title="' + (muted ? 'Unmute' : 'Mute') + ' ' + cat + ' alerts">' + (muted ? '🔕' : '🔔') + '</button>';
  };

  const fmtIO = str => {
    if (!str || str === 'none') return '0.00R | 0.00W';
    return str.replace(' (MB/s)', '').replace(' R | ', 'R | ').replace(' W', 'W');
  };

  const renderTrend = (arr, val, suffix) => {
    const shown = esc(val) + (suffix || '');
    if (!arr || !arr.length) return shown;
    const recent = arr.slice(-3);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const color = num(val) > avg ? 'var(--warning)' : 'var(--info)';
    return '<span style="color:' + color + '; font-size:0.85em; margin-right:5px;">' + esc(arr.join('|')) + '</span>' + shown;
  };

  const tunnelUp = s => typeof s === 'string' && s.includes('[REACHABLE]');

  const renderTunnel = (dataStr, name) => {
    const up = tunnelUp(dataStr);
    const hs = dataStr && dataStr.includes('HS: ') ? dataStr.split('HS: ')[1] : 'Offline';
    return '<span class="badge tunnel ' + (up ? 'success' : 'danger') + '" data-act="hs" data-name="' + esc(name) + '" data-hs="' + esc(hs) + '" title="Tap for handshake">' + esc(name) + ' ' + (up ? '✓' : '✗') + '</span>';
  };

  // Shared by Pi5 and VM cards.
  const renderServices = services => {
    let html = '', log = '', hasErr = false;
    for (const [name, info] of Object.entries(services || {})) {
      const health = info.health || '';
      const status = info.status || 'unknown';
      let cls = 'ok';
      if (health === 'DOWN' || health === 'ERRORS_FOUND') cls = 'err';
      else if (status === 'inactive' || status === 'not running') cls = 'warn';
      else if (health === 'INFO' || health === 'DISABLED') cls = 'info';
      if (cls === 'err') hasErr = true;

      const shown = health === 'DISABLED' ? 'DISABLED' : status.toUpperCase();
      const grab = info.grabbed === 'yes' ? ' <span class="badge success">GRABBED</span>' : '';
      html += row(esc(name) + grab, esc(shown), cls);
      if (info.last_error) log += '\n' + esc(name) + ': ' + esc(info.last_error);
    }
    return { html, log, hasErr };
  };

  const logBox = log => log ? '<div class="subtext" style="color:var(--info);">&gt;&gt; SERVICE LOG (LAST HOUR)' + log + '</div>' : '';

  function renderGlobalHUD(data) {
    const alerts = data._alerts || [];
    const active = alerts.filter(a => !a.muted);
    const items = alerts.length
      ? alerts.map(a => '<div class="alert-item' + (a.muted ? ' muted' : '') + '">' + (a.muted ? '🔕 ' : '&gt;&gt; ') + esc(a.host) + ': ' + esc(a.text) + '</div>').join('')
      : '<div class="alert-item ok">&gt;&gt; Cluster Connectivity Nominal</div>';

    $('status-dot').classList.toggle('err', active.length > 0);
    $('global-alerts').innerHTML = card('', active.length > 0,
      '<h3><span>Global Alerts</span> <div class="header-actions"><span class="badge ' + (active.length ? 'danger' : 'success') + '">' + active.length + ' ACTIVE' +
      (alerts.length > active.length ? ' / ' + (alerts.length - active.length) + ' MUTED' : '') + '</span>' + muteBtn('global') + '</div></h3>' +
      '<div class="alert-summary' + (alerts.length ? '' : ' ok') + '">' + items + '</div>');
  }

  const uplinkLine = (host, label) => {
    if (!host || !host._meta) return '<span style="color:var(--danger)">' + label + ': NO DATA</span>';
    return host._online
      ? '<span style="color:var(--success)">' + label + ': LIVE</span>'
      : '<span style="color:var(--danger)">' + label + ': OFFLINE (last ok ' + esc(fmtTime(host._meta.fetched_at)) + ')</span>';
  };

  function renderPi5(pi5) {
    const dash = $('dash-pi5');
    dash.style.display = 'grid';
    if (!pi5 || !pi5.system) {
      $('ts-pi5').innerHTML = uplinkLine(pi5, 'PI5');
      dash.innerHTML = card('', true, '<h3>DATA UNAVAILABLE</h3>');
      return;
    }

    const sys = pi5.system, st = pi5.storage || {}, net = pi5.network || {}, proc = pi5.processes || {}, io = pi5.io_speeds || {};
    $('ts-pi5').innerHTML = 'UPLINK: ' + uplinkLine(pi5, 'PI5') + ' | DATA: <span style="color: var(--text);">' + esc(fmtTime(pi5._meta.fetched_at)) + '</span>';

    const alerts = pi5.summary?.active_alerts || [];
    const hasAlert = k => alerts.some(a => String(a).includes(k));

    // Compute
    const ramPct = num(sys.ram_pct);
    const isTempErr = hasAlert('Temp') || num(sys.temp) >= 75;
    const isIoErr = hasAlert('I/O Wait');
    const isOomErr = (sys.oom && sys.oom !== 'none') || num(sys.zombies) > 5;
    const thr = parseInt(sys.throttle, 16);
    const isThrottleNow = Number.isNaN(thr) ? true : (thr & 0xF) !== 0;
    const isThrottlePast = !Number.isNaN(thr) && (thr & 0xF0000) !== 0;
    const isRamErr = hasAlert('Memory') || ramPct >= 85;
    const isCrashErr = !!sys.crash_msg && sys.crash_msg !== 'none';
    const computeErr = isTempErr || isIoErr || isOomErr || isThrottleNow || isRamErr || isCrashErr;

    // Storage
    const pctCell = v => v === 'ERR' ? 'ERR' : esc(v) + '%';
    const pctCls = v => v === 'ERR' || num(v) >= 90 ? 'err' : '';
    const usbErr = v => !v || v === 'OFFLINE' || v === 'Missing';
    const bootPct = num(st.boot_pct);
    const isFsErr = /read-only/i.test(st.filesys || '');
    const isInodeErr = num(st.inodes) >= 90;
    const storageErr = [st.boot_pct, st.wd_pct, st.toshiba_pct].some(v => pctCls(v) === 'err') ||
      [st.usb_boot, st.usb_wd, st.usb_tosh].some(usbErr) || isFsErr || isInodeErr;

    // Network
    const ipv6Mon = pi5.ipv6_monitor;
    const isIpv6MonErr = !!(ipv6Mon && (ipv6Mon.stale || (ipv6Mon.history && ipv6Mon.history.length && ipv6Mon.state !== 'up')));
    const vmTunnels = ['oci_vm1', 'oci_vm2', 'oci_vm3', 'oci_vm4'];
    const isTunnelErr = vmTunnels.some(k => net[k] && !tunnelUp(net[k]));
    const isDnsErr = net.dns4 !== '✓' || net.dns6 !== '✓';
    const isIpErr = net.ipv4 !== '✓' || net.ipv6 !== '✓';
    const tsState = net.tailscale_state || (net.tailscale ? '' : 'OFFLINE');
    const isTsErr = tsState ? tsState !== 'Running' : /offline|stopped|error|needs/i.test(net.tailscale || '');
    const isNetAlertErr = hasAlert('IPv6') || hasAlert('VPN') || hasAlert('DNS');
    const networkErr = isIpv6MonErr || isTunnelErr || isDnsErr || isIpErr || isTsErr || isNetAlertErr;

    const svc = renderServices(pi5.services);

    let ipv6Html = '';
    if (ipv6Mon && ipv6Mon.history) {
      const bars = ipv6Mon.history.map(h => {
        const t = esc(ist.format(new Date(h.time * 1000)));
        return '<div class="spark-bar ' + (h.status === 1 ? 'up' : 'down') + '" title="' + t + '" data-act="spark" data-arg="' + t + '"></div>';
      }).join('');
      const ipv6Label = ipv6Mon.stale ? 'STALE' : (ipv6Mon.state || 'unknown').toUpperCase();
      const ipv6Hint = ipv6Mon.stale
        ? 'Last check ' + fmtTime(ipv6Mon.last_check ? ipv6Mon.last_check * 1000 : null) + ' · tap graph for times'
        : ipv6Mon.since ? ipv6Label + ' since ' + fmtTime(ipv6Mon.since * 1000) + ' · tap graph for times' : 'Tap graph to view time';
      ipv6Html = row('IPv6 Status (24h)', esc(ipv6Label), !ipv6Mon.stale && ipv6Mon.state === 'up' ? 'ok' : 'err') +
        '<div id="ipv6-scroll" style="width: 100%; overflow-x: auto; margin-bottom: 4px; border-radius: 3px;"><div class="sparkline">' + bars + '</div></div>' +
        '<div id="ipv6-spark-time" class="spark-time-display">' + esc(ipv6Hint) + '</div>';
    }

    const memVal = '<span style="display:flex; flex-direction:column; align-items:flex-end;"><span>' + renderTrend(pi5._trends?.ram, ramPct, '%') +
      '</span><span class="speed-tag">(' + esc(sys.ram_u) + '/' + esc(sys.ram_t) + ' MiB)</span></span>';

    dash.innerHTML =
      card('', computeErr,
        '<h3><span>System Compute</span> <div class="header-actions"><span>' + esc(sys.uptime) + '</span>' + muteBtn('compute') + '</div></h3>' +
        row('Crash Log', isCrashErr ? esc(sys.crash_msg) : 'CLEAN', isCrashErr ? 'err' : 'ok') +
        row('Temp (Fan: ' + esc(sys.fan) + ')', renderTrend(pi5._trends?.temp, sys.temp, '°C'), isTempErr ? 'err' : 'ok') +
        row('Load Average', esc(sys.load)) +
        row('I/O Wait', esc(sys.iowait) + '%', isIoErr ? 'err' : 'ok') +
        row('OOM Kills / Zombies', esc(sys.oom) + ' | ' + esc(sys.zombies), isOomErr ? 'err' : 'ok') +
        row('Throttle Status', esc(sys.throttle) + (isThrottlePast && !isThrottleNow ? ' (since boot)' : ''), isThrottleNow ? 'err' : (isThrottlePast ? 'warn' : 'ok')) +
        '<div style="margin-top:15px;"></div>' + row('Memory Usage', memVal, isRamErr ? 'err' : '') +
        bar(ramPct, isRamErr) +
        '<div class="subtext">CPU: ' + esc(proc.cpu_top) + '\nRAM: ' + esc(proc.ram_top) + '\nIO:  ' + esc(proc.io_top || 'none') + '\nSWAP: ' + esc(sys.swap) + ' MiB</div>'
      ) +
      card('', storageErr,
        '<h3><span>Volume Metrics</span> <div class="header-actions"><span>Inodes: <span class="' + (isInodeErr ? 'val err' : '') + '">' + esc(st.inodes) + '%</span></span>' + muteBtn('storage') + '</div></h3>' +
        row('Boot SSD <span class="speed-tag">[' + esc(fmtIO(io.boot)) + ']</span>', pctCell(st.boot_pct), pctCls(st.boot_pct)) +
        bar(bootPct, bootPct >= 90) +
        row('WD HDD <span class="speed-tag">[' + esc(fmtIO(io.wd)) + ']</span>', pctCell(st.wd_pct), pctCls(st.wd_pct)) +
        row('Toshiba HDD <span class="speed-tag">[' + esc(fmtIO(io.toshiba)) + ']</span>', pctCell(st.toshiba_pct), pctCls(st.toshiba_pct)) +
        '<div style="margin-top:10px;"></div>' +
        row('USB-BUS (Boot)', esc(st.usb_boot), usbErr(st.usb_boot) ? 'err' : 'info') +
        row('USB-BUS (WD)', esc(st.usb_wd), usbErr(st.usb_wd) ? 'err' : 'info') +
        row('USB-BUS (Toshiba)', esc(st.usb_tosh), usbErr(st.usb_tosh) ? 'err' : 'info') +
        '<div style="margin-top:10px;"></div>' +
        row('File System / FD', esc(st.filesys) + ' | ' + esc(st.fd), isFsErr ? 'err' : 'ok') +
        '<div class="subtext">SSD TBW: ' + esc(st.boot_tbw) + '</div>'
      ) +
      card('card-wide', networkErr,
        '<h3><span>Network Interface</span> <div class="header-actions">' + muteBtn('network') + '</div></h3>' +
        ipv6Html +
        row('IPv6 / VPN / DNS Alerts', isNetAlertErr ? 'ERRORS' : 'CLEAN', isNetAlertErr ? 'err' : 'ok') +
        row('Traffic', esc(net.traffic)) +
        '<div class="data-row" style="align-items: flex-start;"><span>OCI Tunnels</span> <span class="val" style="display:flex; flex-wrap:wrap; justify-content:flex-end; gap:4px; max-width: 65%;">' +
          vmTunnels.map((k, i) => renderTunnel(net[k], 'VM' + (i + 1))).join('') +
        '</span></div>' +
        '<div id="handshake-display" class="spark-time-display" style="margin-bottom: 12px; margin-top: 0;">Tap a VM badge for handshake time</div>' +
        row('DNS Reach (v4 / v6)', esc(net.dns4) + ' / ' + esc(net.dns6), isDnsErr ? 'err' : 'ok') +
        row('IP Config (v4 / v6)', esc(net.ipv4) + ' / ' + esc(net.ipv6), isIpErr ? 'err' : 'ok') +
        '<div style="margin-top:10px;"></div>' +
        row('Tailscale', esc(tsState || (net.tailscale || '').split(' ')[0]) + (net.tailscale && net.tailscale !== 'OFFLINE' ? ' <span class="speed-tag">' + esc(net.tailscale) + '</span>' : ''), isTsErr ? 'err' : 'ok') +
        '<div class="subtext" style="margin-bottom:15px; margin-top:0;">PiVPN: ' + esc(net.pivpn || 'No active clients') + '</div>' +
        '<h3 class="sub"><span>SERVICES</span> <div class="header-actions">' + muteBtn('services') + '</div></h3>' +
        '<div class="services-grid">' + svc.html + '</div>' +
        '<div class="subtext" style="color:var(--warning);">UNHEALTHY CONTAINERS: ' + esc(pi5.docker?.unhealthy || 'none') + '\nSTOPPED CONTAINERS: ' + esc(pi5.docker?.down || 'none') + '</div>' +
        logBox(svc.log)
      );

    requestAnimationFrame(() => {
      const scroller = $('ipv6-scroll');
      if (scroller) scroller.scrollLeft = scroller.scrollWidth;
    });
  }

  function renderVMs(data) {
    const dash = $('dash-vms');
    const ids = data._vms || Object.keys(data).filter(k => /^vm[0-9]+$/.test(k)).sort();
    const vms = ids.map(id => data[id]);
    const newest = vms.map(vm => vm?._meta?.fetched_at).filter(Boolean).sort().pop();

    $('ts-vms').innerHTML = 'UPLINK: ' + vms.map((vm, i) => uplinkLine(vm, 'VM' + (i + 1))).join(' | ') +
      (newest ? ' | DATA: <span style="color: var(--text);">' + esc(fmtTime(newest)) + '</span>' : '');

    dash.innerHTML = vms.map((vm, idx) => {
      const fallback = 'VM' + (idx + 1);
      if (!vm || !vm.system) return card('', true, '<h3>' + fallback + ' DATA UNAVAILABLE</h3>');

      const sys = vm.system, net = vm.network || {}, cache = vm.cache_stats || {};
      const ramPct = num(sys.ram_pct), diskPct = num(sys.disk_pct);
      const isRamErr = ramPct >= 85;
      const isDiskErr = diskPct >= 90;
      const isTunnelErr = net.pi_tunnel !== 'REACHABLE';
      const isOomErr = !!sys.oom_kills && sys.oom_kills !== 'none';
      const svc = renderServices(vm.services);
      const offline = vm._online === false;

      return card('', svc.hasErr || isRamErr || isDiskErr || isTunnelErr || isOomErr || offline,
        '<h3><span>' + esc(vm.hostname || fallback) + (offline ? ' <span class="badge danger">OFFLINE</span>' : '') + '</span> <div class="header-actions"><span>' + esc(sys.uptime) + '</span></div></h3>' +
        row('Load Average / CPU Steal', esc(sys.load) + ' | ' + renderTrend(vm._trends?.steal, sys.cpu_steal, '%')) +
        row('Memory (' + esc(sys.ram_pct) + '%)', esc(sys.ram_u) + ' / ' + esc(sys.ram_t) + ' MiB', isRamErr ? 'err' : '') +
        row('Disk (' + esc(sys.disk_pct) + '%)', esc(sys.disk_info), isDiskErr ? 'err' : '') +
        row('Streaming Cache <span style="color:var(--info)">(' + esc(cache.hit_rate_pct || '0') + '%)</span>',
          '<span style="color:var(--success)">' + esc(cache.hits_formatted || '0') + '</span> <span style="color:var(--text-muted)">|</span> <span style="color:var(--warning)">' + esc(cache.misses_formatted || cache.misses || '0') + '</span>') +
        row('Pi5 Tunnel' + (net.pi_tunnel_ip ? ' (' + esc(net.pi_tunnel_ip) + ')' : ''), esc(net.pi_tunnel || 'unknown'), isTunnelErr ? 'err' : 'ok') +
        row('OOM Kills', esc(sys.oom_kills), isOomErr ? 'err' : 'ok') +
        '<h3 class="sub"><span>SERVICES</span></h3>' +
        '<div class="services-grid">' + svc.html + '</div>' +
        logBox(svc.log)
      );
    }).join('');
    dash.style.display = 'grid';
  }

  function render(data) {
    state.data = data;
    state.mutes = data._mutes || {};
    renderGlobalHUD(data);
    renderPi5(data.pi5);
    renderVMs(data);
  }

  // Credentials are kept in memory for this tab only and dropped on a 401.
  function getCreds() {
    if (state.creds) return state.creds;
    const u = prompt('Admin User:');
    if (!u) return null;
    const p = prompt('Passcode:');
    if (!p) return null;
    state.creds = 'Basic ' + btoa(u + ':' + p);
    return state.creds;
  }

  async function authFetch(url, opts) {
    const creds = getCreds();
    if (!creds) return null;
    const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: creds } });
    if (res.status === 401) {
      state.creds = null;
      alert('ACCESS DENIED');
      return null;
    }
    return res;
  }

  async function loadData(force) {
    const url = '/api/data' + (force ? '?force=' + encodeURIComponent(force) : '');
    let res;
    try {
      if (force) {
        if (!getCreds()) return;
        if (force === 'all' || force === 'pi5') { $('ts-pi5').textContent = 'FETCHING UPLINK...'; $('dash-pi5').style.display = 'none'; }
        if (force === 'all' || force === 'vms') { $('ts-vms').textContent = 'FETCHING UPLINK...'; $('dash-vms').style.display = 'none'; }
        res = await authFetch(url, { cache: 'no-store' });
      } else {
        res = await fetch(url, { cache: 'no-store' });
      }
    } catch (err) {
      res = null;
      alert('NETWORK ERROR: ' + err.message);
    }
    if (res && !res.ok) { alert('API ERROR (' + res.status + ')'); res = null; }
    if (!res) { if (state.data) render(state.data); return; }
    render(await res.json());
  }

  async function toggleMute(category) {
    const res = await authFetch('/api/mute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category })
    });
    if (!res) return;
    if (!res.ok) { alert('API ERROR (' + res.status + ')'); return; }
    await res.json();
    loadData();  // re-render so alert muted/active state reflects the change
  }

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const arg = el.dataset.arg;
    switch (el.dataset.act) {
      case 'tab':
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === el));
        document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + arg));
        break;
      case 'sync': loadData(arg); break;
      case 'mute': toggleMute(arg); break;
      case 'spark':
        $('ipv6-spark-time').textContent = arg;
        document.querySelectorAll('.spark-bar').forEach(b => { b.style.opacity = b === el ? '1' : '0.5'; });
        break;
      case 'hs':
        $('handshake-display').textContent = el.dataset.name + ' Handshake: ' + el.dataset.hs;
        break;
    }
  });

  loadData();
}
