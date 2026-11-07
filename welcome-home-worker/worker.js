export default {
  async fetch(request, env) {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Guest Wi-Fi</title>
    <style>
        :root {
            --bg: #0f172a;
            --card: rgba(255, 255, 255, 0.1);
            --text: #f8fafc;
            --accent: #38bdf8;
        }
        @media (prefers-color-scheme: light) {
            :root {
                --bg: #f1f5f9;
                --card: rgba(255, 255, 255, 0.7);
                --text: #1e293b;
                --accent: #0284c7;
            }
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: var(--bg);
            color: var(--text);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
        }
        .card {
            background: var(--card);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 24px;
            padding: 30px;
            width: 100%;
            max-width: 350px;
            text-align: center;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        h1 { font-size: 1.4rem; margin-bottom: 5px; }
        p.subtitle { opacity: 0.7; font-size: 0.9rem; margin-bottom: 25px; }
        .qr-container {
            background: white;
            padding: 15px;
            border-radius: 16px;
            display: inline-block;
            margin-bottom: 25px;
        }
        .qr-container img { display: block; width: 180px; height: 180px; }
        .info-row {
            background: rgba(0, 0, 0, 0.05);
            padding: 12px 16px;
            border-radius: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            cursor: pointer;
            transition: transform 0.1s;
        }
        .info-row.readonly { cursor: default; }
        .info-row.readonly:active { transform: none; }
        .info-row:active { transform: scale(0.98); }
        .label { font-size: 0.75rem; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.05em; text-align: left; }
        .value { font-weight: 600; font-family: monospace; font-size: 1.1rem; text-align: left; }
        .address-value { font-size: 0.9rem; word-break: break-word; line-height: 1.2; }
        .footer { margin-top: 15px; font-size: 0.7rem; opacity: 0.5; }
        .safari-banner {
            display: none;
            background: var(--accent);
            color: white;
            border-radius: 16px;
            padding: 14px 16px;
            margin-bottom: 20px;
            text-align: left;
            font-size: 0.85rem;
            line-height: 1.35;
        }
        .safari-banner a {
            display: block;
            margin-top: 10px;
            background: white;
            color: #0f172a;
            text-align: center;
            padding: 10px;
            border-radius: 10px;
            font-weight: 600;
            text-decoration: none;
        }
        .toast {
            position: fixed;
            bottom: 30px;
            background: var(--accent);
            color: white;
            padding: 10px 20px;
            border-radius: 20px;
            font-size: 0.8rem;
            opacity: 0;
            transition: opacity 0.3s;
            pointer-events: none;
            z-index: 100;
        }
    </style>
</head>
<body>
    <div class="card">
        <h1>Welcome Home</h1>
        <p class="subtitle">Scan to join or tap to copy</p>

        <div id="safari-banner" class="safari-banner">
            To join with one tap, open this page in Safari, then long-press the QR code and choose <b>Join</b>.
            <a id="safari-link" href="#">Open in Safari</a>
        </div>

        <div class="qr-container">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=WIFI:S:${env.WIFI_SSID};T:WPA;P:${env.WIFI_PASS};;" alt="WiFi QR Code">
        </div>

        <div class="info-row" onclick="copyToClipboard('${env.WIFI_SSID}', 'Network Name')">
            <div style="text-align: left;">
                <div class="label">Network</div>
                <div class="value">${env.WIFI_SSID}</div>
            </div>
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 7V6a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V18a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2M8 7h4a2 2 0 012 2v4m0 0H8"></path></svg>
        </div>

        <div class="info-row" onclick="copyToClipboard('${env.WIFI_PASS}', 'Password')">
            <div style="text-align: left;">
                <div class="label">Password</div>
                <div class="value">••••••••</div>
            </div>
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 7V6a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V18a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2M8 7h4a2 2 0 012 2v4m0 0H8"></path></svg>
        </div>

        <div class="info-row readonly">
            <div style="text-align: left;">
                <div class="label">Bluetooth</div>
                <div class="value">${env.BT_NAME}</div>
            </div>
        </div>

        <div class="info-row" onclick="copyToClipboard('${env.HOME_ADDR}', 'Address')">
            <div style="text-align: left; max-width: 85%;">
                <div class="label">Address</div>
                <div class="value address-value">${env.HOME_ADDR}</div>
            </div>
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 7V6a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V18a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2M8 7h4a2 2 0 012 2v4m0 0H8"></path></svg>
        </div>

        <div class="info-row" onclick="window.open('https://wa.me/${env.WHATSAPP_NUM}', '_blank')">
            <div style="text-align: left;">
                <div class="label">Contact</div>
                <div class="value">Tap to WhatsApp</div>
            </div>
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
        </div>

        <div class="footer">
            Powered by Private Cloud
        </div>
    </div>

    <div id="toast" class="toast">Copied to clipboard!</div>

    <script>
        // iOS opens NFC/link URLs in the default browser. Only Safari offers
        // "Join network" on a long-pressed Wi-Fi QR, so hand other iOS browsers
        // over to Safari via the x-safari-https:// scheme (iOS 17+).
        (function () {
            const ua = navigator.userAgent;
            const isIOS = /iPhone|iPad|iPod/.test(ua) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            const notSafari = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Brave|GSA|Instagram|FBAN|FBAV/.test(ua);
            if (!isIOS || !notSafari) return;

            const safariUrl = 'x-safari-' + location.href;
            document.getElementById('safari-link').href = safariUrl;
            document.getElementById('safari-banner').style.display = 'block';

            // Try once automatically; browsers that need a tap keep the button.
            try {
                if (!sessionStorage.getItem('safariHandoff')) {
                    sessionStorage.setItem('safariHandoff', '1');
                    location.href = safariUrl;
                }
            } catch (e) { /* storage blocked: the button still works */ }
        })();

        async function copyToClipboard(text, label) {
            try {
                await navigator.clipboard.writeText(text);
                const toast = document.getElementById('toast');
                toast.innerText = label + ' copied!';
                toast.style.opacity = '1';
                setTimeout(() => toast.style.opacity = '0', 2000);
            } catch (err) {
                console.error('Failed to copy: ', err);
            }
        }
    </script>
</body>
</html>
    `;

    return new Response(html, {
      headers: { "Content-Type": "text/html;charset=UTF-8" },
    });
  },
};
