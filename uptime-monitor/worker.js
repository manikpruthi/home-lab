export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(this.monitorIPv6(env));
  },

  async fetch(request, env, ctx) {
    await this.monitorIPv6(env);
    return new Response("IPv6 Monitor executed successfully.", { status: 200 });
  },

  async monitorIPv6(env) {
    const { PI_IPV6_URL, INFLUX_URL, INFLUX_TOKEN, INFLUX_SECRET, SLACK_WEBHOOK, HEALTH_DB } = env;
    const now = Math.floor(Date.now() / 1000);
    let isUp = false;

    // 1. Ping
    let retries = 3;
    while (retries > 0 && !isUp) {
      try {
        const res = await fetch(PI_IPV6_URL, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          isUp = true;
        } else {
          retries--;
          if (retries > 0) await new Promise(resolve => setTimeout(resolve, 3000));
        }
      } catch (err) {
        retries--;
        if (retries > 0) await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    const currentStatus = isUp ? 1 : 0;

    // 2. Fetch the master object from D1 SQL
    let masterData = { state: "unknown", history: [], influxQueue: [] };
    try {
      const rawData = await HEALTH_DB.prepare("SELECT value FROM store WHERE key = ?").bind("ipv6_data").first("value");
      if (rawData) {
        masterData = JSON.parse(rawData);
      }
    } catch (err) {
      console.error("Failed to read from D1:", err);
    }

    // 3. Stateful Slack Alerts
    if (currentStatus === 0 && masterData.state !== "down") {
      await this.sendSlack(SLACK_WEBHOOK, "🚨 *IPv6 DOWN:* Pi5 is unreachable via IPv6!");
      masterData.state = "down";
    } else if (currentStatus === 1 && masterData.state === "down") {
      await this.sendSlack(SLACK_WEBHOOK, "✅ *IPv6 UP:* Pi5 is reachable again via IPv6!");
      masterData.state = "up";
    } else if (masterData.state === "unknown") {
      masterData.state = isUp ? "up" : "down";
    }

    // 4. Append History (480 max) & Influx Queue (1000 max)
    masterData.history.push({ time: now, status: currentStatus });
    masterData.history = masterData.history.slice(-480);

    masterData.influxQueue.push({ time: now, status: currentStatus });
    if (masterData.influxQueue.length > 1000) {
      masterData.influxQueue = masterData.influxQueue.slice(-1000);
    }

    // 5. InfluxDB Sync
    let payload = "";
    for (const item of masterData.influxQueue) {
      payload += `uptime,monitor_name=Pi5_IPv6 status_code=${item.status} ${item.time}\n`;
    }

    const separator = INFLUX_URL.includes('?') ? '&' : '?';
    const writeUrl = `${INFLUX_URL}${separator}precision=s`;

    const writeHeaders = {
      "Authorization": `Token ${INFLUX_TOKEN}`,
      "Content-Type": "text/plain; charset=utf-8"
    };
    // Optional upstream guard (e.g. a reverse proxy or tunnel that checks a shared secret).
    if (INFLUX_SECRET) {
      writeHeaders["x-worker-secret"] = INFLUX_SECRET;
    }

    try {
      const writeRes = await fetch(writeUrl, {
        method: "POST",
        headers: writeHeaders,
        body: payload
      });

      if (writeRes.ok) {
        masterData.influxQueue = [];
      } else {
        console.error("Influx error:", await writeRes.text());
      }
    } catch (err) {
      console.error("Influx sync failed, keeping data in D1 queue.");
    }

    // 6. Save back to D1 SQL (UPSERT)
    try {
      await HEALTH_DB.prepare(`
        INSERT INTO store (key, value) VALUES ('ipv6_data', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).bind(JSON.stringify(masterData)).run();
    } catch (err) {
      console.error("Failed to write to D1:", err);
    }
  },

  async sendSlack(webhook, text) {
    if (!webhook) return;
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
    } catch (e) {}
  }
};
