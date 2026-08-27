# AGENTS.md

## What this is
**NexBot** — a Baileys-based WhatsApp bot platform consolidating multiple bots into one repo + one shared core.

## Run
```
npm start              # single-process (unified bridge)
pm2 start ecosystem.config.js   # multi-process (recommended, crash-isolated)
```
No tests. No lint. CommonJS.

## Architecture
- `src/core/` — shared Baileys infrastructure (session/connect/QR/reconnect, multi-slot manager, unified HTTP bridge, paths). Reused by every module; do NOT duplicate per module.
- `src/modules/cs/`, `src/modules/admin/`, `src/modules/blast/` — each a standalone bot entry (auto-starts on require).
- `src/config.js` — THE single source of truth for ports, paths, groups, timing. Edit here, not in modules.
- `data/` — all runtime state (sessions, QR, DBs, caches, uploads). Never commit.
- `dashboard/` — React+Vite+Express control panel (PM2 control, logs, file editor, lock/session system).
- `ecosystem.config.js` — PM2 apps: NexBot-CORE(5610), AI-CS(5591), AI-ADMIN(5592), BLASTER(5588), DASHBOARD(5577).

## Key behaviors
- AI-CS: auto-reply menu webinar + bulk grup broadcast. Slots admin1(full) / admin2(bulk-only) / admin3(reply-only).
- AI-ADMIN: crawl 2 sites (PSI/Arteria), process uploaded PDFs via Ollama, send daily reports. Multi-slot: active number switchable via `data/admin/current-slot.json`.
- BLASTER: mass blast engine, 3 sender slots (s1/s2/s3), random delay, auto-pause on 10 consecutive fails.
- Dashboard proxies: `/api/csbridge`→5591, `/api/adminbridge`→5592, `/api/blast`→5588.

## Gotchas
- **Production safety**: these modules each auto-start their bridge on require. Do NOT run them on ports already used by the live production originals (5591/5592/5588) without stopping the old processes first.
- `credentials.json` (Google service-account) is runtime/secret — gitignored.
- Configure active AI-ADMIN slot via `POST /setslot` on 5592 or edit `data/admin/current-slot.json`.
- All UI text, code comments, and log messages are in **Bahasa Indonesia**.
- `*.original.js` files are the source-of-truth originals for reference; editing the live `index.js` modules is what affects behavior.
