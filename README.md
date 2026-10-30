# home-lab

Personal monorepo — a collection of my projects, each in its own folder.

## Projects

| Project | Description |
|---|---|
| [commandcode-usage-tracker](./commandcode-usage-tracker/) | Cloudflare Worker + D1 usage tracker dashboard: rolling quota windows, per-model costs, plan ROI, and catalog advisor. |
| [welcome-home-worker](./welcome-home-worker/) | Cloudflare Worker guest landing page: Wi-Fi QR join, tap-to-copy credentials, contact link. Built to sit behind an NFC tag. |
| [uptime-monitor](./uptime-monitor/) | Cloudflare Worker + D1 uptime probe: IPv6 liveness checks from the edge, queued InfluxDB metrics, and Slack alerts on state transitions. |
| [homelab-dashboard](./homelab-dashboard/) | Cloudflare Worker + D1 dashboard for a Raspberry Pi and four Oracle VMs: health snapshots, tunnel status, IPv6 sparkline, and Slack alerting. |

## Related repositories

The following projects used to live in this monorepo and have been split out into their own repositories:

- [mac-explorer](https://github.com/manikpruthi/mac-explorer) — Mac Explorer: native Swift/AppKit macOS file manager.
- [clipboard](https://github.com/manikpruthi/clipboard) — Clipboard Win: native macOS menu bar clipboard history app.

## Conventions

- Each project lives in its own top-level folder with its own `README.md`.
- No secrets are ever committed. Copy `*.example` files to their real names locally (e.g. `.dev.vars.example` → `.dev.vars`) and fill in your own values.
- Shared root files: [.gitignore](./.gitignore), [LICENSE](./LICENSE) (MIT, applies to all projects unless a subfolder states otherwise).

## License

MIT — see [LICENSE](./LICENSE).
