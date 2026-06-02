<div align="center">

<img src="assets/logo.png" alt="WhatsApp HTML Backup" width="120" height="120">

# WhatsApp HTML Backup

**Export your own WhatsApp chats into a beautiful, human-readable, Telegram-style HTML archive — per-chat pages, a stats dashboard, media gallery, in-chat search, light/dark themes, plus PDF / JSON / CSV / single-file export and an optional browser Web UI.**

[![CI](https://github.com/scartheseller72-max/whatsapp-html-backup/actions/workflows/ci.yml/badge.svg)](https://github.com/scartheseller72-max/whatsapp-html-backup/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D18-43853d)
![License](https://img.shields.io/badge/license-MIT-blue)
![Version](https://img.shields.io/badge/version-2.0.0-1ebe6b)

</div>

---

## Overview

`whatsapp-html-backup` links to your WhatsApp account the same way the official
WhatsApp Web does — you scan a QR code once — then walks your chats and renders a
clean, offline, browsable archive you can open in any web browser. Run it from the
terminal, or use the built-in **browser Web UI** (scan the QR right in your browser).

```
output/
├── index.html                     Searchable landing page (all chats)
├── stats.html                     Overall analytics across every chat
├── assets/  (styles.css, app.js, logo.png)
└── chats/
    └── Amma/
        ├── index.html             Messages (with in-chat search + jump-to-month)
        ├── gallery.html           Media grid
        ├── stats.html             Per-chat "WhatsApp Wrapped" analytics
        ├── members.html           Group participants (groups only)
        ├── avatar.jpg             Profile picture
        └── media/                 Photos, voice notes, video, docs
```

Everything is static HTML/CSS/JS — no server needed to read it back. Optional
exports land in `output/exports/{pdf,json,csv,singlefile}/`.

---

## What's new in v2.0

| Pack | Highlights |
|------|------------|
| **Reader UX** | Per-chat + global **stats dashboards**, **in-chat full-text search** (highlight + prev/next), **media gallery**, **light/dark theme** toggle, **jump-to-month** |
| **Export** | **PDF** (per chat), **JSON / NDJSON**, **CSV**, **single-file HTML** (media embedded as base64) |
| **Fidelity** | **Profile-picture avatars**, **group participants** page, **link previews**, **polls**, **starred** ★, **edited** markers, **@mentions** |
| **Engineering** | **Incremental backup** (only new since last run), **progress bar + ETA**, **interactive wizard**, **file logging** |
| **Web UI** | Local **Express dashboard** — scan the QR in your browser, watch live progress, browse the finished archive |
| **Distribution** | MIT license, **GitHub Actions CI**, **Dockerfile**, `npx` bin, unit tests |

---

## System Requirements

| Component | Requirement |
|-----------|-------------|
| Node.js   | v18 or newer (`node --version`) |
| OS        | Windows, macOS, or Linux |
| Disk      | Free space for your media (video-heavy chats get large) |
| Network   | Internet during backup (to reach WhatsApp Web) |
| Phone     | The phone with your WhatsApp account, to scan the QR once |

> A Chromium browser is downloaded automatically by `whatsapp-web.js` on first
> `npm install`. PDF export reuses that same Chromium.

---

## Installation

```bash
cd whatsapp-html-backup
npm install      # also fetches a bundled Chromium (first run only)
```

---

## Usage

### Option A — Browser Web UI (easiest)

```bash
npm run serve            # → http://localhost:3000
```

Open the URL, click **Start**, scan the QR in your browser, and watch live
progress. When it finishes, click **Open archive →**. No terminal interaction
needed beyond launching it.

### Option B — Interactive wizard

```bash
npm run wizard
```

Answers a few prompts (dates, chats, media, formats) and runs.

### Option C — One-shot terminal command

```bash
npm run backup           # back up everything
```

A QR prints in your terminal. Scan it from
**WhatsApp → Settings → Linked Devices → Link a Device**.

### Examples

```bash
# Date window + PDF and JSON exports
node src/index.js --from 2024-01-01 --to 2024-12-31 --format pdf,json

# Specific chats only, single-file HTML for easy sharing
node src/index.js --chats "Amma, Office Group" --format singlefile

# Incremental top-up (only chats with new messages since last run)
node src/index.js --incremental

# Text only, no groups
node src/index.js --no-media --no-groups

# Forget the linked session (next run shows a fresh QR)
npm run logout
```

### All options

| Flag | Description |
|------|-------------|
| `--from YYYY-MM-DD` | Only messages on/after this date |
| `--to YYYY-MM-DD` | Only messages on/before this date (inclusive) |
| `--chats "A,B,..."` | Only these chats (name/number substrings). Default: all |
| `--out <dir>` | Output directory (default: `output`) |
| `--format <list>` | Extra exports: `pdf,json,ndjson,csv,singlefile` (HTML always on) |
| `--no-media` | Skip downloading media |
| `--no-avatars` | Skip profile-picture downloads |
| `--no-link-previews` | Skip fetching link previews |
| `--max <n>` | Cap messages fetched per chat |
| `--no-groups` | Exclude group chats |
| `--include-status` | Include the Status/Broadcast pseudo-chat |
| `--throttle <ms>` | Delay between message operations (default: 120) |
| `--incremental` | Only fetch chats with new activity since last run |
| `--config <file>` | Load defaults from JSON (default: `config.json`) |
| `--wizard` | Interactive setup prompts |
| `--serve [--port n]` | Launch the browser Web UI |
| `--logout` | Delete the saved session and exit |
| `--help` | Show usage |

### Config file (optional)

```bash
cp config.example.json config.json   # edit; CLI flags override these
```

---

## Docker

```bash
docker build -t wa-backup .
docker run -it -p 3000:3000 \
  -v "$PWD/output:/app/output" \
  -v "$PWD/.wwebjs_auth:/app/.wwebjs_auth" \
  wa-backup
# open http://localhost:3000
```

Session + output are volume-mounted so they persist across runs.

---

## Architecture

```
  Phone ──QR──► whatsapp-web.js ──► headless Chromium ──► WhatsApp Web
                      │
        ┌─────────────┼───────────────────────────────┐
        ▼             ▼                                ▼
   fetcher.js     media.js / linkpreview.js        stats.js
   (chats, msgs)  (downloads, og: scrape)          (analytics)
        └──────────────┬───────────────────────────────┘
                       ▼
                  renderer.js  ──►  HTML archive (index / chat / gallery / stats / members)
                       ▼
                  exporters/*  ──►  pdf / json / csv / singlefile
```

| Module | Responsibility |
|--------|----------------|
| `src/backup.js` | Orchestration core (shared by CLI + Web UI) |
| `src/client.js` | WhatsApp Web client, QR login, persistent session, hooks |
| `src/fetcher.js` | Chat selection, message normalization, avatars, members, mentions, polls |
| `src/media.js` | Media + URL download, mimetype→extension, content-hash dedupe |
| `src/linkpreview.js` | Open Graph link-preview scraper (cached) |
| `src/stats.js` | Per-chat + global analytics |
| `src/renderer.js` | Telegram-style HTML, theme, search, gallery, stats, members |
| `src/exporters/*` | PDF / JSON / CSV / single-file exporters |
| `src/state.js` | Incremental-backup state |
| `src/server.js` | Express Web UI + live status API |
| `src/cli.js` · `src/wizard.js` · `src/index.js` | Args/options, prompts, CLI entry |

Run the tests with `npm test` (Node's built-in test runner — no extra deps).

---

## Security & Privacy

- **Your session is sensitive.** `.wwebjs_auth/` is the equivalent of a linked
  device. It is git-ignored — never commit, upload, or share it. Wipe with
  `npm run logout`.
- **Your backup is private.** `output/` holds real chat content + media and is
  git-ignored. Treat it like any personal archive.
- **Web UI is localhost-only** by default. It drives your live session — do not
  expose it to a network. (Docker sets `HOST=0.0.0.0` only so the mapped port
  works; run it on a trusted machine.)
- **Everything stays local.** Data flows only between your machine and
  WhatsApp's servers, exactly like WhatsApp Web.

---

## Important Notes & Limitations

- **Unofficial client / Terms of Service.** This relies on `whatsapp-web.js`, an
  unofficial automation library. Automating WhatsApp can violate WhatsApp's
  Terms of Service and risks your number being banned. Use only on **your own
  account**, at your own risk. Personal backup use only.
- **History availability.** WhatsApp Web only exposes history synced to the
  linked session; very old messages may be incomplete. Keep your phone online so
  more history syncs.
- **PDF export** needs the bundled Chromium. If it's unavailable, the export is
  skipped with a tip — the HTML pages include a print stylesheet, so
  **Print → Save as PDF** in your browser works too.
- **Large accounts take time.** Use `--throttle` for stability and
  `--incremental` for fast top-ups.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| QR keeps refreshing | Scan faster, or `npm run logout` and retry |
| `Failed to launch the browser process` | Install the OS libraries Chromium needs (see Dockerfile for the list) |
| Stuck on "Loading…" | Keep your phone online while it syncs |
| Some old messages missing | Expected — only synced history is available |
| PDF export skipped | Use the browser's Print → Save as PDF on the HTML pages |

---

## License

MIT — see [LICENSE](LICENSE). Provided as-is for personal backup use. You are
responsible for complying with WhatsApp's Terms of Service and applicable laws.
