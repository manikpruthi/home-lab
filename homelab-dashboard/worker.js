// ============================================================================
// HomeLab Health Dashboard - Cloudflare Worker
// ============================================================================
// Polls the Pi5 health API plus four Oracle VM health endpoints, stores the
// merged snapshot in D1, and renders a two-tab dashboard (Pi5 / Oracle VMs).
// Shares its D1 database with the uptime-monitor Worker, which owns the
// 'ipv6_data' row rendered as the IPv6 sparkline.
// ============================================================================

const VM_DEFS = [
  { id: 'vm1', port: 2086, name: 'VM1' },
  { id: 'vm2', port: 2082, name: 'VM2' },
  { id: 'vm3', port: 8080, name: 'VM3' },
  { id: 'vm4', port: 8880, name: 'VM4' }
];

const MUTE_KEYWORDS = {
  global: ['unreachable', 'timed out'],
  compute: ['temp', 'memory', 'ram', 'load', 'i/o', 'oom', 'zombies', 'throttle', 'steal', 'cpu', 'crash'],
  storage: ['disk', 'boot', 'inodes', 'storage', 'usb', 'toshiba', 'wd', 'ro'],
  network: ['tunnel', 'tailscale', 'dns', 'network', 'ipv6', 'vpn'],
  services: ['docker', 'container', 'service', 'failed', 'inactive', 'noise']
};

// Endpoint URLs come from Worker secrets so no hostname is committed.
function getVmConfig(env) {
  return VM_DEFS.map(vm => ({
    ...vm,
    url: env[`${vm.id.toUpperCase()}_URL`] || ''
  }));
}

// Timing-safe Basic auth against ADMIN_USER / ADMIN_PASS Worker secrets.
function isAuthorized(request, env) {
  const header = request.headers.get('Authorization') || '';
  if (!env.ADMIN_USER || !env.ADMIN_PASS) return false;
  const expected = 'Basic ' + btoa(`${env.ADMIN_USER}:${env.ADMIN_PASS}`);
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < header.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export default {
  // ==========================================
  // 1. CRON JOB TRIGGER (Hourly)
  // ==========================================
  async scheduled(event, env, ctx) {
    await this.fetchAndStore(env, ctx, 'all', true);
  },

  // ==========================================
  // 2. BROWSER/API TRIGGER
  // ==========================================
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/mute' && request.method === 'POST') {
      if (!isAuthorized(request, env)) return new Response('Unauthorized', { status: 401 });

      const { category } = await request.json();
      let mutes = {};
      try {
        const raw = await env.HEALTH_DB.prepare("SELECT value FROM store WHERE key = 'mute_prefs'").first("value");
        if (raw) mutes = JSON.parse(raw);
      } catch (err) {}

      mutes[category] = !mutes[category];

      await env.HEALTH_DB.prepare(`
        INSERT INTO store (key, value) VALUES ('mute_prefs', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).bind(JSON.stringify(mutes)).run();

      return new Response(JSON.stringify({ success: true, mutes }));
    }

    if (url.pathname === '/') {
      const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>HomeLab Dashboard</title>
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
            .btn-group { display: flex; gap: 10px; }
            button { padding: 6px 12px; background: transparent; color: var(--accent); border: 1px solid var(--accent); border-radius: 4px; cursor: pointer; font-family: var(--mono); font-size: 0.8em; transition: all 0.2s; white-space: nowrap; }
            button:hover { background: var(--accent); color: var(--bg); }

            .mute-btn { padding: 0; margin-left: 8px; font-size: 1.3em; border: none; background: transparent; color: var(--text-muted); transition: transform 0.2s; }
            .mute-btn:hover { background: transparent; transform: scale(1.1); }

            .tabs { display: flex; gap: 5px; margin-bottom: 20px; border-bottom: 2px solid var(--border); }
            .tab { padding: 10px 20px; background: var(--tab-bg); color: var(--text-muted); border: none; cursor: pointer; font-weight: bold; font-family: var(--mono); font-size: 1em; border-radius: 6px 6px 0 0; border: 1px solid transparent; border-bottom: none; }
            .tab.active { background: var(--tab-active); color: var(--accent); border-color: var(--border); }
            .pane { display: none; }
            .pane.active { display: block; }
            .timestamp { font-family: var(--mono); color: var(--text-muted); font-size: 0.85em; margin-bottom: 20px; }

            .grid { display: grid; grid-template-columns: 1fr; gap: 20px; }

            .card { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.2); transition: border-color 0.3s; min-width: 0; }
            .card h3 { margin: 0 0 15px 0; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1.5px; color: var(--text-muted); display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; border-bottom: 1px solid var(--border); padding-bottom: 8px; align-items: flex-end; min-height: 28px; }

            .header-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }

            .data-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.95em; align-items: center; }
            .val { font-family: var(--mono); color: var(--accent); font-weight: bold; text-align: right; }
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
            .alert-summary { margin-bottom: 15px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 4px; border-left: 3px solid var(--danger); }
            .alert-item { color: var(--danger); font-size: 0.85em; font-family: var(--mono); font-weight: bold; margin-bottom: 4px; }
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
              <h2><div class="status-dot"></div> HomeLab Dashboard</h2>
              <div class="btn-group">
                <button onclick="forceRefresh('all')">[ GLOBAL_SYNC ]</button>
              </div>
            </div>

            <div id="global-alerts" style="margin-bottom: 20px;"></div>

            <div class="tabs">
              <button class="tab active" onclick="switchTab('pi5')">PI5 SERVER</button>
              <button class="tab" onclick="switchTab('vms')">ORACLE VMs</button>
            </div>

            <div id="pane-pi5" class="pane active">
              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <div class="timestamp" id="ts-pi5" style="margin-bottom:0;">SYS_STATUS: INITIALIZING...</div>
                <button onclick="forceRefresh('pi5')" style="margin-bottom: 20px;">[ SYNC_PI5 ]</button>
              </div>
              <div id="dash-pi5" class="grid" style="display:none;"></div>
            </div>

            <div id="pane-vms" class="pane">
              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <div class="timestamp" id="ts-vms" style="margin-bottom:0;">SYS_STATUS: INITIALIZING...</div>
                <button onclick="forceRefresh('vms')" style="margin-bottom: 20px;">[ SYNC_VMS ]</button>
              </div>
              <div id="dash-vms" class="grid" style="display:none;"></div>
            </div>
          </div>

          <script>
            let currentMutes = {};

            const istFormatter = new Intl.DateTimeFormat('en-IN', {
                timeZone: 'Asia/Kolkata',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour12: true
            });

            function switchTab(target) {
              document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
              document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
              event.target.classList.add('active');
              document.getElementById('pane-' + target).classList.add('active');
            }

            function showSparkTime(el, time) {
              document.getElementById('ipv6-spark-time').innerText = time;
              document.querySelectorAll('.spark-bar').forEach(b => b.style.opacity = '0.5');
              el.style.opacity = '1';
            }

            function showHandshake(name, hs) {
              document.getElementById('handshake-display').innerText = name + ' Handshake: ' + hs;
            }

            async function toggleMute(category) {
              const u = prompt("Admin User:"); const p = prompt("Passcode:");
              if (!u || !p) return;

              const res = await fetch('/api/mute', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Basic ' + btoa(u + ':' + p)
                },
                body: JSON.stringify({ category })
              });

              if (res.status === 401) { alert('ACCESS DENIED'); return; }
              const data = await res.json();
              currentMutes = data.mutes;

              document.querySelectorAll('.' + category + '-mute').forEach(btn => {
                const isMuted = currentMutes[category];
                btn.innerText = isMuted ? '🔕' : '🔔';
                btn.title = isMuted ? 'Unmute Alerts' : 'Mute Alerts';
              });
            }

            const getBtn = (cat) => {
              const isMuted = currentMutes[cat];
              return '<button class="mute-btn ' + cat + '-mute" onclick="toggleMute(\\'' + cat + '\\')" title="' + (isMuted ? 'Unmute Alerts' : 'Mute Alerts') + '">' + (isMuted ? '🔕' : '🔔') + '</button>';
            };

            const fmtIO = (str) => {
              if (!str || str === 'none') return '0.00R | 0.00W';
              return str.replace(' (MB/s)', '').replace(' R | ', 'R | ').replace(' W', 'W');
            };

            const renderTrend = (arr, val, suffix) => {
              if (!arr || !arr.length) return val + (suffix || '');
              const avg = arr.slice(-3).reduce((a, b) => a + b, 0) / Math.min(arr.length, 3);
              const cur = parseFloat(val) || 0;
              const color = cur > avg ? 'var(--warning)' : 'var(--info)';
              return '<span style="color:' + color + '; font-size:0.85em; margin-right:5px;">' + arr.join('|') + '</span>' + val + (suffix || '');
            };

            const renderTunnel = (dataStr, name) => {
              if (!dataStr || dataStr === '??') return '<span class="badge danger" style="cursor:pointer; margin-left:4px;" onclick="showHandshake(\\'' + name + '\\', \\'Offline\\')">' + name + ' ✗</span>';
              const isUp = dataStr.includes('REACHABLE');
              const hs = dataStr.includes('HS: ') ? dataStr.split('HS: ')[1] : 'Unknown';
              const color = isUp ? 'success' : 'danger';
              const icon = isUp ? '✓' : '✗';
              return '<span class="badge ' + color + '" style="cursor:pointer; margin-left:4px;" onclick="showHandshake(\\'' + name + '\\', \\'' + hs + '\\')" title="Tap for handshake">' + name + ' ' + icon + '</span>';
            };

            async function loadData(forceTarget = null, username = '', password = '') {
              const cacheBuster = Date.now();
              const url = forceTarget
                  ? '/api/data?force=' + forceTarget + '&_=' + cacheBuster
                  : '/api/data?_=' + cacheBuster;

              const headers = forceTarget ? { 'Authorization': 'Basic ' + btoa(username + ':' + password) } : {};

              if (forceTarget === 'all' || forceTarget === 'pi5') document.getElementById('ts-pi5').innerText = "FETCHING UPLINK...";
              if (forceTarget === 'all' || forceTarget === 'vms') document.getElementById('ts-vms').innerText = "FETCHING UPLINK...";

              const res = await fetch(url, { headers });
              if (res.status === 401) { alert('ACCESS DENIED'); return; }
              if (!res.ok) { alert('API ERROR'); return; }

              const data = await res.json();
              currentMutes = data._mutes || {};

              renderGlobalHUD(data);
              renderPi5(data.pi5);

              const vms = Object.keys(data).filter(k => k.startsWith('vm')).sort().map(k => data[k]);
              renderVMs(vms);
            }

            function renderGlobalHUD(data) {
              const dash = document.getElementById('global-alerts');
              let allAlerts = [];

              if (data.pi5?.summary?.active_alerts) {
                allAlerts.push(...data.pi5.summary.active_alerts.map(a => 'Pi5: ' + a));
              }

              const vms = Object.keys(data).filter(k => k.startsWith('vm')).map(k => data[k]);
              vms.forEach((vm, idx) => {
                const vmName = vm.hostname || ('VM' + (idx+1));
                if (vm && vm.active_alerts) {
                  allAlerts.push(...vm.active_alerts.map(a => vmName + ': ' + a));
                }
              });

              let alertHtml = allAlerts.length > 0
                ? '<div class="alert-summary">' + allAlerts.map(a => '<div class="alert-item">>> ' + a + '</div>').join('') + '</div>'
                : '<div class="alert-summary" style="border-left-color: var(--success);"><div class="alert-item" style="color: var(--success);">>> Cluster Connectivity Nominal</div></div>';

              const isGlobalErr = allAlerts.length > 0;

              dash.innerHTML = '<div class="card" style="border-color: ' + (isGlobalErr ? 'var(--danger)' : 'var(--border)') + '">' +
                  '<h3><span>Global Alerts</span> <div class="header-actions"><span class="badge ' + (allAlerts.length > 0 ? 'danger' : 'success') + '">' + allAlerts.length + ' ACTIVE</span>' + getBtn('global') + '</div></h3>' +
                  alertHtml +
                '</div>';
            }

            function renderPi5(pi5) {
              const dash = document.getElementById('dash-pi5');
              if (!pi5 || !pi5.system) {
                document.getElementById('ts-pi5').innerText = "PI5: NO DATA";
                dash.innerHTML = '<div class="card"><h3>DATA UNAVAILABLE</h3></div>';
                dash.style.display = 'grid';
                return;
              }

              const statusBadge = pi5._online ? '<span style="color:var(--success)">LIVE</span>' : '<span style="color:var(--danger)">CACHED (FETCH FAILED)</span>';
              document.getElementById('ts-pi5').innerHTML = 'UPLINK: ' + statusBadge + ' | DATA: <span style="color: var(--text);">' + istFormatter.format(new Date(pi5._meta.fetched_at)) + '</span>';

              const ramPct = parseInt(pi5.system.ram_pct) || 0;
              const bootPct = parseInt(pi5.storage.boot_pct) || 0;
              const alerts = pi5.summary.active_alerts || [];
              const hasAlert = (k) => alerts.some(a => a.includes(k));

              const isTempErr = hasAlert('Temp');
              const isIoErr = hasAlert('I/O Wait');
              const isOomErr = pi5.system.oom !== 'none' || parseInt(pi5.system.zombies) > 0;
              const isThrottleErr = pi5.system.throttle !== 'none' && pi5.system.throttle !== '0x0';
              const isRamErr = hasAlert('Memory') || ramPct >= 85;
              const isCrashErr = pi5.system.crash_msg !== 'none';
              const computeCardErr = isTempErr || isIoErr || isOomErr || isThrottleErr || isRamErr || isCrashErr;

              const isBootVolErr = bootPct >= 90;
              const isUsbBootErr = pi5.storage.usb_boot === 'OFFLINE' || pi5.storage.usb_boot === 'Missing';
              const isUsbWdErr = pi5.storage.usb_wd === 'OFFLINE' || pi5.storage.usb_wd === 'Missing';
              const isUsbToshErr = pi5.storage.usb_tosh === 'OFFLINE' || pi5.storage.usb_tosh === 'Missing';
              const isFsErr = pi5.storage.filesys && pi5.storage.filesys.includes('RO');
              const isInodeErr = parseInt(pi5.storage.inodes) >= 90;
              const storageCardErr = isBootVolErr || isUsbBootErr || isUsbWdErr || isUsbToshErr || isFsErr || isInodeErr || pi5.storage.boot_pct === 'ERR' || pi5.storage.wd_pct === 'ERR' || pi5.storage.toshiba_pct === 'ERR';

              const isIpv6Err = pi5.ipv6_monitor && pi5.ipv6_monitor.state !== 'up';
              const isTunnelErr = (pi5.network.oci_vm1 && !pi5.network.oci_vm1.includes('REACHABLE')) ||
                                  (pi5.network.oci_vm2 && !pi5.network.oci_vm2.includes('REACHABLE')) ||
                                  (pi5.network.oci_vm3 && !pi5.network.oci_vm3.includes('REACHABLE')) ||
                                  (pi5.network.oci_vm4 && !pi5.network.oci_vm4.includes('REACHABLE'));
              const isDnsErr = pi5.network.dns4?.includes('ERR') || pi5.network.dns6?.includes('ERR') || pi5.network.dns4?.includes('FAIL');
              const isIpErr = pi5.network.ipv4?.includes('ERR') || pi5.network.ipv6?.includes('ERR');
              const isTsErr = pi5.network.tailscale?.includes('Offline') || pi5.network.tailscale?.includes('Error') || pi5.network.tailscale?.includes('Stopped');
              const isNetworkAlertErr = hasAlert('IPv6') || hasAlert('VPN');
              const networkCardErr = isIpv6Err || isTunnelErr || isDnsErr || isIpErr || isTsErr || isNetworkAlertErr;

              let svcHtml = '';
              let infoHtml = '';
              if (pi5.services) {
                for (const [name, info] of Object.entries(pi5.services)) {
                  let colorClass = info.health === 'OK' ? 'ok' : 'err';
                  if (info.health === 'INFO') colorClass = 'info';
                  if (info.status === 'inactive' || info.status === 'not running') colorClass = 'warn';
                  if (info.health === 'DISABLED') colorClass = 'info';

                  let displayStatus = info.health === 'DISABLED' ? 'DISABLED' : info.status.toUpperCase();
                  svcHtml += '<div class="data-row"><span>' + name + '</span> <span class="val ' + colorClass + '">' + displayStatus + '</span></div>';

                  if (info.last_error) {
                    infoHtml += '<br>' + name + ': ' + info.last_error;
                  }
                }
              }

              let ipv6Html = '';
              if (pi5.ipv6_monitor && pi5.ipv6_monitor.history) {
                const { state, history } = pi5.ipv6_monitor;
                const bars = history.slice(-480).map(h => {
                  const t = istFormatter.format(new Date(h.time * 1000));
                  return '<div class="spark-bar ' + (h.status === 1 ? 'up' : 'down') + '" title="' + t + '" onclick="showSparkTime(this, \\'' + t + '\\')"></div>';
                }).join('');
                const stateColor = state === 'up' ? 'ok' : 'err';

                ipv6Html = '<div class="data-row"><span>IPv6 Status (24h)</span> <span class="val ' + stateColor + '">' + (state || 'unknown').toUpperCase() + '</span></div>' +
                           '<div id="ipv6-scroll" style="width: 100%; overflow-x: auto; margin-bottom: 4px; border-radius: 3px;">' +
                             '<div class="sparkline">' + bars + '</div>' +
                           '</div>' +
                           '<div id="ipv6-spark-time" class="spark-time-display">Tap graph to view time</div>';
              }

              dash.innerHTML = '<div class="card" style="border-color: ' + (computeCardErr ? 'var(--danger)' : 'var(--border)') + '">' +
                  '<h3><span>System Compute</span> <div class="header-actions"><span>' + pi5.system.uptime + '</span>' + getBtn('compute') + '</div></h3>' +
                  '<div class="data-row"><span>Crash Log</span> <span class="val ' + (isCrashErr ? 'err' : 'ok') + '">' + (isCrashErr ? 'DETECTED' : 'CLEAN') + '</span></div>' +
                  '<div class="data-row"><span>Temp (Fan: ' + pi5.system.fan + ')</span> <span class="val ' + (isTempErr ? 'err' : 'ok') + '">' + renderTrend(pi5._trends?.temp, pi5.system.temp, '°C') + '</span></div>' +
                  '<div class="data-row"><span>Load Average</span> <span class="val">' + pi5.system.load + '</span></div>' +
                  '<div class="data-row"><span>I/O Wait</span> <span class="val ' + (isIoErr ? 'err' : 'ok') + '">' + pi5.system.iowait + '%</span></div>' +
                  '<div class="data-row"><span>OOM Kills / Zombies</span> <span class="val ' + (isOomErr ? 'err' : 'ok') + '">' + pi5.system.oom + ' | ' + pi5.system.zombies + '</span></div>' +
                  '<div class="data-row"><span>Throttle Status</span> <span class="val ' + (isThrottleErr ? 'err' : 'ok') + '">' + pi5.system.throttle + '</span></div>' +
                  '<div class="data-row" style="margin-top:15px; align-items: flex-start;"><span>Memory Usage</span> <span class="val ' + (isRamErr ? 'err' : '') + '" style="display: flex; flex-direction: column; align-items: flex-end;"><span>' + renderTrend(pi5._trends?.ram, ramPct, '%') + '</span><span class="speed-tag">(' + pi5.system.ram_u + '/' + pi5.system.ram_t + ' MiB)</span></span></div>' +
                  '<div class="bar-bg"><div class="bar-fill ' + (isRamErr ? 'high' : '') + '" style="width: ' + ramPct + '%"></div></div>' +
                  '<div class="subtext">CPU: ' + pi5.processes.cpu_top + '<br>RAM: ' + pi5.processes.ram_top + '<br>IO:  ' + (pi5.processes.io_top || 'none') + '<br>SWAP: ' + pi5.system.swap + ' MiB</div>' +
                '</div>' +
                '<div class="card" style="border-color: ' + (storageCardErr ? 'var(--danger)' : 'var(--border)') + '">' +
                  '<h3><span>Volume Metrics</span> <div class="header-actions"><span>Inodes: <span class="' + (isInodeErr ? 'val err' : '') + '">' + pi5.storage.inodes + '%</span></span>' + getBtn('storage') + '</div></h3>' +
                  '<div class="data-row"><span>Boot SSD <span class="speed-tag">[' + fmtIO(pi5.io_speeds.boot) + ']</span></span> <span class="val ' + (isBootVolErr || pi5.storage.boot_pct === 'ERR' ? 'err' : '') + '">' + (pi5.storage.boot_pct === 'ERR' ? 'ERR' : bootPct + '%') + '</span></div>' +
                  '<div class="bar-bg"><div class="bar-fill ' + (isBootVolErr ? 'high' : '') + '" style="width: ' + bootPct + '%"></div></div>' +
                  '<div class="data-row"><span>WD HDD <span class="speed-tag">[' + fmtIO(pi5.io_speeds.wd) + ']</span></span> <span class="val ' + (pi5.storage.wd_pct === 'ERR' ? 'err' : '') + '">' + (pi5.storage.wd_pct === 'ERR' ? 'ERR' : pi5.storage.wd_pct + '%') + '</span></div>' +
                  '<div class="data-row"><span>Toshiba HDD <span class="speed-tag">[' + fmtIO(pi5.io_speeds.toshiba) + ']</span></span> <span class="val ' + (pi5.storage.toshiba_pct === 'ERR' ? 'err' : '') + '">' + (pi5.storage.toshiba_pct === 'ERR' ? 'ERR' : pi5.storage.toshiba_pct + '%') + '</span></div>' +
                  '<div class="data-row" style="margin-top:10px;"><span>USB-BUS (Boot)</span> <span class="val ' + (isUsbBootErr ? 'err' : 'info') + '">' + pi5.storage.usb_boot + '</span></div>' +
                  '<div class="data-row"><span>USB-BUS (WD)</span> <span class="val ' + (isUsbWdErr ? 'err' : 'info') + '">' + pi5.storage.usb_wd + '</span></div>' +
                  '<div class="data-row"><span>USB-BUS (Toshiba)</span> <span class="val ' + (isUsbToshErr ? 'err' : 'info') + '">' + pi5.storage.usb_tosh + '</span></div>' +
                  '<div class="data-row" style="margin-top:10px;"><span>File System / FD</span> <span class="val ' + (isFsErr ? 'err' : 'ok') + '">' + pi5.storage.filesys + ' | ' + pi5.storage.fd + '</span></div>' +
                  '<div class="subtext">SSD TBW: ' + pi5.storage.boot_tbw + '</div>' +
                '</div>' +
                '<div class="card card-wide" style="border-color: ' + (networkCardErr ? 'var(--danger)' : 'var(--border)') + '">' +
                  '<h3><span>Network Interface</span> <div class="header-actions">' + getBtn('network') + '</div></h3>' +
                  ipv6Html +
                  '<div class="data-row"><span>IPv6 / VPN Err</span> <span class="val ' + (isNetworkAlertErr ? 'err' : 'ok') + '">' + (isNetworkAlertErr ? 'ERRORS' : 'CLEAN') + '</span></div>' +
                  '<div class="data-row"><span>Traffic</span> <span class="val">' + pi5.network.traffic + '</span></div>' +
                  '<div class="data-row" style="align-items: flex-start;"><span>OCI Tunnels</span> <span class="val" style="display:flex; flex-wrap:wrap; justify-content:flex-end; gap:4px; max-width: 65%;">' +
                    renderTunnel(pi5.network.oci_vm1, 'VM1') +
                    renderTunnel(pi5.network.oci_vm2, 'VM2') +
                    renderTunnel(pi5.network.oci_vm3, 'VM3') +
                    renderTunnel(pi5.network.oci_vm4, 'VM4') +
                  '</span></div>' +
                  '<div id="handshake-display" class="spark-time-display" style="margin-bottom: 12px; margin-top: 0;">Tap a VM badge for handshake time</div>' +
                  '<div class="data-row"><span>DNS Reach (v4 / v6)</span> <span class="val ' + (isDnsErr ? 'err' : 'ok') + '">' + pi5.network.dns4 + ' / ' + pi5.network.dns6 + '</span></div>' +
                  '<div class="data-row"><span>IP Config (v4 / v6)</span> <span class="val ' + (isIpErr ? 'err' : 'ok') + '">' + pi5.network.ipv4 + ' / ' + pi5.network.ipv6 + '</span></div>' +
                  '<div class="data-row" style="margin-top:10px;"><span>Tailscale</span> <span class="val ' + (isTsErr ? 'err' : '') + '">' + (pi5.network.tailscale || 'OFFLINE').split(' ')[0] + '</span></div>' +
                  '<div class="subtext" style="margin-bottom:15px; margin-top:0;">' + pi5.network.pivpn + '</div>' +

                  '<h3 style="margin-top:20px; border-top:1px solid var(--border); padding-top:15px; align-items:center; min-height:auto;"><span>SERVICES</span> <div class="header-actions">' + getBtn('services') + '</div></h3>' +
                  '<div class="services-grid">' +
                    svcHtml +
                  '</div>' +
                  '<div class="subtext" style="margin-top:10px; color:var(--warning);">STOPPED CONTAINERS:<br>' + (pi5.docker?.down || 'none') + '</div>' +
                  (infoHtml ? '<div class="subtext" style="margin-top:10px; color:var(--info);">>> NETWORK NOISE' + infoHtml + '</div>' : '') +
                '</div>';

              dash.style.display = 'grid';

              setTimeout(() => {
                const scroller = document.getElementById('ipv6-scroll');
                if (scroller) scroller.scrollLeft = scroller.scrollWidth;
              }, 100);
            }

            function renderVMs(vms) {
              const dash = document.getElementById('dash-vms');

              const validMeta = vms.find(vm => vm && vm._meta);
              const metaTime = validMeta ? validMeta._meta.fetched_at : null;

              const getStatus = (vm, name) => vm?._online ? '<span style="color:var(--success)">' + name + ': LIVE</span>' : '<span style="color:var(--danger)">' + name + ': CACHED</span>';

              const headerBadges = vms.map((vm, idx) => getStatus(vm, 'VM' + (idx+1))).join(' | ');

              document.getElementById('ts-vms').innerHTML = metaTime ?
                'UPLINK: ' + headerBadges + ' | DATA: <span style="color: var(--text);">' + istFormatter.format(new Date(metaTime)) + '</span>' : 'NO DATA';

              let html = '';
              vms.forEach((vm, idx) => {
                const vmFallbackName = 'VM' + (idx + 1);
                if (!vm || !vm.system) {
                  html += '<div class="card" style="border-color: var(--danger)"><h3>' + vmFallbackName + ' DATA UNAVAILABLE</h3></div>';
                  return;
                }

                let hasSvcErr = false;
                const isVmRamErr = vm.system.ram_pct >= 85;
                const isVmDiskErr = vm.system.disk_pct >= 90;
                const isVmTunnelErr = vm.network.pi_tunnel !== 'REACHABLE';
                const isVmOomErr = vm.system.oom_kills !== 'none';

                let svcHtml = '';
                let infoHtml = '';

                for (const [name, info] of Object.entries(vm.services)) {
                  let colorClass = info.health === 'OK' ? 'ok' : 'err';
                  if (info.health === 'INFO') colorClass = 'info';
                  if (info.status === 'inactive' || info.status === 'not running') colorClass = 'warn';
                  if (info.health === 'DISABLED') colorClass = 'info';

                  if (colorClass === 'err') hasSvcErr = true;

                  let displayStatus = info.health === 'DISABLED' ? 'DISABLED' : info.status.toUpperCase();
                  let grabBadge = info.grabbed === 'yes' ? ' <span class="badge success">GRABBED</span>' : '';

                  svcHtml += '<div class="data-row"><span>' + name + grabBadge + '</span> <span class="val ' + colorClass + '">' + displayStatus + '</span></div>';

                  if (info.last_error) {
                    infoHtml += '<br>' + name + ': ' + info.last_error;
                  }
                }

                const vmCardErr = hasSvcErr || isVmRamErr || isVmDiskErr || isVmTunnelErr || isVmOomErr;

                html += '<div class="card" style="border-color: ' + (vmCardErr ? 'var(--danger)' : 'var(--border)') + '">' +
                  '<h3><span>' + (vm.hostname || vmFallbackName) + '</span> <div class="header-actions"><span>' + vm.system.uptime + '</span>' + getBtn('compute') + '</div></h3>' +
                  '<div class="data-row"><span>Load Average / CPU Steal</span> <span class="val">' + vm.system.load + ' | ' + renderTrend(vm._trends?.steal, vm.system.cpu_steal, '%') + '</span></div>' +
                  '<div class="data-row"><span>Memory (' + vm.system.ram_pct + '%)</span> <span class="val ' + (isVmRamErr ? 'err' : '') + '">' + vm.system.ram_u + ' / ' + vm.system.ram_t + ' MiB</span></div>' +
                  '<div class="data-row"><span>Disk (' + vm.system.disk_pct + '%)</span> <span class="val ' + (isVmDiskErr ? 'err' : '') + '">' + vm.system.disk_info + '</span></div>' +
                  '<div class="data-row"><span>Streaming Cache <span style="color:var(--info)">(' + (vm.cache_stats?.hit_rate_pct || '0') + '%)</span></span> <span class="val"><span style="color:var(--success)">' + (vm.cache_stats?.hits_formatted || '0') + '</span> <span style="color:var(--text-muted)">|</span> <span style="color:var(--warning)">' + (vm.cache_stats?.misses_formatted || vm.cache_stats?.misses || '0') + '</span></span></div>' +
                  '<div class="data-row"><span>Pi5 Tunnel</span> <span class="val ' + (isVmTunnelErr ? 'err' : 'ok') + '">' + vm.network.pi_tunnel + '</span></div>' +
                  '<div class="data-row"><span>OOM Kills</span> <span class="val ' + (isVmOomErr ? 'err' : 'ok') + '">' + vm.system.oom_kills + '</span></div>' +

                  '<h3 style="margin-top:20px; border-top:1px solid var(--border); padding-top:15px; align-items:center; min-height:auto;"><span>SERVICES</span> <div class="header-actions">' + getBtn('services') + '</div></h3>' +
                  '<div class="services-grid">' +
                    svcHtml +
                  '</div>' +

                  (infoHtml ? '<div class="subtext" style="margin-top:10px; color:var(--info);">>> NETWORK NOISE' + infoHtml + '</div>' : '') +
                '</div>';
              });

              dash.innerHTML = html;
              dash.style.display = 'grid';
            }

            function forceRefresh(target) {
              const u = prompt("Admin User:"); const p = prompt("Passcode:");
              if (!u || !p) return;
              if (target === 'all' || target === 'pi5') document.getElementById('dash-pi5').style.display = 'none';
              if (target === 'all' || target === 'vms') document.getElementById('dash-vms').style.display = 'none';
              loadData(target, u, p);
            }

            loadData();
          </script>
        </body>
        </html>
      `;
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
        }
      });
    }

    if (url.pathname === '/api/data') {
      let responseData;
      const forceTarget = url.searchParams.get('force');
      const vmConfig = getVmConfig(env);

      if (forceTarget) {
        if (!isAuthorized(request, env)) return new Response('Unauthorized', { status: 401 });
        responseData = await this.fetchAndStore(env, ctx, forceTarget, false);
      } else {
        responseData = { pi5: {} };
        vmConfig.forEach(v => responseData[v.id] = {});

        try {
          const rawDash = await env.HEALTH_DB.prepare("SELECT value FROM store WHERE key = 'dashboard_data'").first("value");
          if (rawDash) responseData = JSON.parse(rawDash);
        } catch (err) {
          console.error("D1 Read Error (dashboard_data):", err);
        }

        const piAge = responseData.pi5?._meta?.fetched_at ? (new Date() - new Date(responseData.pi5._meta.fetched_at)) / 60000 : 999;
        if (piAge >= 30) {
          responseData = await this.fetchAndStore(env, ctx, 'all', false);
        }
      }

      let ipv6Data = { state: "unknown", history: [] };
      let mutes = {};
      try {
        const rawIpv6 = await env.HEALTH_DB.prepare("SELECT value FROM store WHERE key = 'ipv6_data'").first("value");
        if (rawIpv6) ipv6Data = JSON.parse(rawIpv6);

        const rawMutes = await env.HEALTH_DB.prepare("SELECT value FROM store WHERE key = 'mute_prefs'").first("value");
        if (rawMutes) mutes = JSON.parse(rawMutes);
      } catch (err) {
        console.error("D1 Read Error:", err);
      }

      if (!responseData.pi5) responseData.pi5 = {};
      responseData.pi5.ipv6_monitor = { state: ipv6Data.state, history: ipv6Data.history };
      responseData._mutes = mutes;

      return new Response(JSON.stringify(responseData), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
        }
      });
    }

    return new Response('Not Found', { status: 404 });
  },

  async fetchAndStore(env, ctx, target, isCron) {
    console.time(`ExecutionTime-${target}`);
    try {
      const vmConfig = getVmConfig(env);
      let data = { pi5: {} };
      vmConfig.forEach(v => data[v.id] = {});
      let activeMutes = {};

      try {
        const rawDash = await env.HEALTH_DB.prepare("SELECT value FROM store WHERE key = 'dashboard_data'").first("value");
        if (rawDash) data = JSON.parse(rawDash);

        const rawMutes = await env.HEALTH_DB.prepare("SELECT value FROM store WHERE key = 'mute_prefs'").first("value");
        if (rawMutes) activeMutes = JSON.parse(rawMutes);
      } catch (err) {
        console.error("D1 Read Error:", err);
      }

      const filterAlerts = (alertsArray) => {
        if (!alertsArray) return [];
        return alertsArray.filter(alert => {
          const lowerAlert = alert.toLowerCase();
          for (const [cat, isMuted] of Object.entries(activeMutes)) {
            if (isMuted && MUTE_KEYWORDS[cat] && MUTE_KEYWORDS[cat].some(k => lowerAlert.includes(k))) {
              return false;
            }
          }
          return true;
        });
      };

      const now = new Date().toISOString();
      const fetchOpts = env.WORKER_SECRET ? { headers: { 'x-worker-secret': env.WORKER_SECRET } } : {};
      let slackMsg = "";

      async function fetchWithRetry(url, options, retries = 1, timeoutMs = 12000) {
        for (let i = 0; i <= retries; i++) {
          try {
            const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
            if (res.ok) return await res.json();
          } catch (err) {
            if (i === retries) return null;
          }
        }
        return null;
      }

      const appendTrend = (arr = [], val) => {
        const num = parseFloat(val) || 0;
        return [...arr, num].slice(-5);
      };

      const promises = [];
      if (target === 'all' || target === 'pi5') promises.push(env.PI5_HEALTH_URL ? fetchWithRetry(env.PI5_HEALTH_URL, fetchOpts) : Promise.resolve(null));
      else promises.push(Promise.resolve(null));

      if (target === 'all' || target === 'vms') vmConfig.forEach(vm => promises.push(vm.url ? fetchWithRetry(vm.url, fetchOpts) : Promise.resolve(null)));
      else vmConfig.forEach(() => promises.push(Promise.resolve(null)));

      const results = await Promise.all(promises);
      const dataPi5 = results[0];
      const vmResults = results.slice(1);

      if (target === 'all' || target === 'pi5') {
        if (dataPi5) {
          const oldTrends = data.pi5?._trends || {};
          dataPi5._trends = {
            temp: appendTrend(oldTrends.temp, dataPi5.system.temp),
            ram: appendTrend(oldTrends.ram, dataPi5.system.ram_pct)
          };
          dataPi5._meta = { fetched_at: now };
          data.pi5 = dataPi5;
          data.pi5._online = true;
        } else {
          if (!data.pi5) data.pi5 = {};
          data.pi5._meta = { fetched_at: now };
          data.pi5._online = false;
          if (!activeMutes.global) slackMsg += "🚨 *CRITICAL:* Pi5 is Unreachable or Timed Out!\n";
        }

        if (data.pi5?.summary?.active_alerts) {
          const filteredPi5Alerts = filterAlerts(data.pi5.summary.active_alerts);
          if (filteredPi5Alerts.length > 0) {
            slackMsg += "🚨 *Pi5 Alerts*\n• " + filteredPi5Alerts.join("\n• ") + "\n\n";
          }
        }
      }

      if (target === 'all' || target === 'vms') {
        vmResults.forEach((vmData, index) => {
          const vmDef = vmConfig[index];
          const vmId = vmDef.id;
          const oldData = data[vmId] || {};

          if (vmData) {
            const oldTrends = oldData._trends || {};
            vmData._trends = { steal: appendTrend(oldTrends.steal, vmData.system.cpu_steal) };
            vmData._meta = { fetched_at: now };

            const hasGrabAlert = vmData.active_alerts?.some(a => a.includes("ARM instance grabbed"));
            vmData.notified_grabbed = hasGrabAlert ? true : false;
            vmData.just_grabbed = hasGrabAlert && !oldData.notified_grabbed;

            data[vmId] = vmData;
            data[vmId]._online = true;

            let vmAlerts = data[vmId]?.active_alerts || [];
            if (data[vmId]?.notified_grabbed && !data[vmId]?.just_grabbed) {
              vmAlerts = vmAlerts.filter(a => !a.includes("ARM instance grabbed"));
            }

            const filteredVMAlerts = filterAlerts(vmAlerts);
            if (filteredVMAlerts.length > 0) {
              slackMsg += `🚨 *${vmDef.name} Alerts*\n• ` + filteredVMAlerts.join("\n• ") + "\n\n";
            }
          } else {
            if (!data[vmId]) data[vmId] = {};
            data[vmId]._meta = { fetched_at: now };
            data[vmId]._online = false;
            if (!activeMutes.global) slackMsg += `🚨 *CRITICAL:* ${vmDef.name} (${vmDef.port}) is Unreachable or Timed Out!\n`;
          }
        });
      }

      try {
        await env.HEALTH_DB.prepare(`
          INSERT INTO store (key, value) VALUES ('dashboard_data', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).bind(JSON.stringify(data)).run();
      } catch (err) {
        console.error("D1 Write Error:", err);
      }

      if (env.SLACK_WEBHOOK && slackMsg.trim() !== "") {
        ctx.waitUntil(fetch(env.SLACK_WEBHOOK, { method: 'POST', body: JSON.stringify({ text: slackMsg.trim() }) }));
      }

      return data;

    } catch (error) {
      console.error(`[CRITICAL] fetchAndStore failed for target: ${target}`, error);
      throw error;
    } finally {
      console.timeEnd(`ExecutionTime-${target}`);
    }
  }
};
