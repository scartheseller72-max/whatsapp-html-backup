<div align="center">

<img src="assets/logo.png" alt="WhatsApp HTML Backup" width="120" height="120">

# WhatsApp HTML Backup

**Export your own WhatsApp chats into a beautiful, human-readable, Telegram-style HTML archive — per-chat pages, a searchable index, and all your media downloaded locally.**

</div>

---

## Overview

`whatsapp-html-backup` links to your WhatsApp account the same way the official
WhatsApp Web does — you scan a QR code once — then walks your chats and renders a
clean, offline, browsable archive you can open in any web browser.

```
output/
├── index.html                     Searchable landing page (all chats)
├── assets/
│   ├── styles.css                 Shared Telegram-style theme
│   └── logo.png                   Brand mark
└── chats/
    ├── Amma/
    │   ├── index.html             One self-contained page per chat
    │   └── media/                 Photos, voice notes, video, docs
    └── Office_Group/
        ├── index.html
        └── media/
```

Everything is static HTML/CSS — no server, no tracking, no internet required to
read it back. Move the `output/` folder anywhere and it just works.

---

## Feature Matrix

| Capability                | Detail                                                                 |
|---------------------------|------------------------------------------------------------------------|
| Auth                      | QR-code link via WhatsApp Web; session persisted (scan once)           |
| Output layout             | Per-chat HTML pages + searchable `index.html` (Telegram-style)         |
| Media                     | Downloads photos, video, voice notes, audio, documents, stickers       |
| Media in HTML             | Images/video/audio embedded inline; documents as download cards        |
| Message types             | Text, media, replies/quotes, reactions, locations, contacts, system    |
| Markdown                  | Renders `*bold*`, `_italic_`, `~strike~`, ` ```mono``` `, links        |
| Date filtering            | `--from` / `--to` (YYYY-MM-DD), inclusive                              |
| Chat selection            | All chats by default, or filter by name/number                         |
| Groups                    | Per-sender names + colors; optional `--no-groups`                      |
| Dedupe                    | Identical media within a chat stored once (SHA-1)                      |
| Stability                 | Configurable throttling for large accounts                             |

---

## System Requirements

| Component   | Requirement                                                              |
|-------------|--------------------------------------------------------------------------|
| Node.js     | v18 or newer (`node --version`)                                          |
| OS          | Windows, macOS, or Linux                                                 |
| Disk        | Enough free space for your media (chats with video can be large)         |
| Network     | Internet access during backup (to talk to WhatsApp Web)                  |
| Phone       | The phone with your WhatsApp account, to scan the QR once                |

> A Chromium browser is downloaded automatically by the `whatsapp-web.js`
> dependency on first `npm install`. No manual browser setup is required.

---

## Installation

```bash
# 1. Unzip the project, then from the project root:
cd whatsapp-html-backup

# 2. Install dependencies (also fetches a bundled Chromium — first run only)
npm install
```

---

## Usage

### Quick start — back up everything

```bash
npm run backup
```

A QR code prints in your terminal. On your phone:
**WhatsApp → Settings → Linked Devices → Link a Device → scan it.**
The tool then downloads your chats and writes the archive to `output/`.
Open `output/index.html` in your browser when it finishes.

### Common examples

```bash
# Only messages from 2024 onward
node src/index.js --from 2024-01-01

# A date window
node src/index.js --from 2024-01-01 --to 2024-12-31

# Specific chats only (by name or number, comma-separated)
node src/index.js --chats "Amma, Office Group, +94771234567"

# Text only, skip media downloads
node src/index.js --no-media

# Exclude group chats, cap at 5000 messages per chat
node src/index.js --no-groups --max 5000

# Forget the linked session (next run shows a fresh QR)
npm run logout
```

### All options

| Flag                 | Description                                                        |
|----------------------|--------------------------------------------------------------------|
| `--from YYYY-MM-DD`  | Only messages on/after this date                                   |
| `--to YYYY-MM-DD`    | Only messages on/before this date (inclusive)                      |
| `--chats "A,B,..."`  | Only these chats (name/number substrings). Default: all            |
| `--out <dir>`        | Output directory (default: `output`)                               |
| `--no-media`         | Skip downloading media (text only)                                 |
| `--max <n>`          | Cap messages fetched per chat (default: all available)             |
| `--no-groups`        | Exclude group chats                                                |
| `--include-status`   | Include the Status/Broadcast pseudo-chat                           |
| `--throttle <ms>`    | Delay between message operations (default: 120)                    |
| `--config <file>`    | Load defaults from a JSON config (default: `config.json`)          |
| `--logout`           | Delete the saved session and exit                                  |
| `--help`             | Show usage                                                         |

### Config file (optional)

Prefer a file over flags? Copy `config.example.json` to `config.json` and edit it.
CLI flags always override config values.

```bash
cp config.example.json config.json
```

---

## How It Works

```
  Phone (your account)
        │  QR link (one time)
        ▼
  whatsapp-web.js  ──drives──►  headless Chromium  ──►  WhatsApp Web
        │
        ▼
  fetcher.js   enumerate chats, pull + filter messages
        │
        ▼
  media.js     downloadMedia() → save + dedupe into chats/<chat>/media/
        │
        ▼
  renderer.js  Telegram-style HTML  →  index.html + chats/<chat>/index.html
```

| Module            | Responsibility                                                      |
|-------------------|---------------------------------------------------------------------|
| `src/client.js`   | WhatsApp Web client, QR login, persistent `LocalAuth` session       |
| `src/fetcher.js`  | Chat selection, message normalization, date filtering               |
| `src/media.js`    | Media download, mimetype→extension, content-hash dedupe             |
| `src/renderer.js` | Telegram-style HTML for chat pages + index, lightbox, search        |
| `src/utils.js`    | Dates, filenames, HTML-escaping, WhatsApp markdown                  |
| `src/index.js`    | CLI parsing, config merge, orchestration                            |

---

## Security & Privacy

- **Your session is sensitive.** The `.wwebjs_auth/` folder is the equivalent of
  being logged in on a linked device. It is git-ignored by default — never commit,
  upload, or share it. Run `npm run logout` to wipe it.
- **Your backup is private.** `output/` contains your real chat content and media.
  It is git-ignored by default. Treat it like any personal archive.
- **Everything stays local.** No data is sent anywhere except directly between your
  machine and WhatsApp's own servers (exactly as WhatsApp Web does).

---

## Important Notes & Limitations

- **Unofficial client / Terms of Service.** This tool relies on `whatsapp-web.js`,
  an unofficial automation library. Automating WhatsApp can violate WhatsApp's
  Terms of Service and carries a real risk of your number being banned. Use it only
  on **your own account**, at your own discretion and risk. This project is intended
  purely for personal data backup and portability.
- **History availability.** WhatsApp Web only exposes the message history that is
  synced to the linked session. Very old messages that the linked device has not
  loaded may be incomplete. Keep your phone connected during the backup so more
  history syncs.
- **Large accounts take time.** Media-heavy chats can be large and slow; the
  `--throttle` setting keeps things stable. Be patient on the first full run.
- **Disappearing / deleted messages** that are already gone cannot be recovered.

---

## Troubleshooting

| Symptom                                   | Fix                                                            |
|-------------------------------------------|---------------------------------------------------------------|
| QR code keeps refreshing                  | Scan faster, or run `npm run logout` and retry                |
| `Failed to launch the browser process`    | Install OS libs Chromium needs (see `whatsapp-web.js` docs)   |
| Stuck on "Loading WhatsApp…"              | Keep your phone online; let it finish syncing                 |
| Some old messages missing                 | Expected — only synced history is available (see Limitations) |
| Media shows "not downloaded"              | You ran with `--no-media`; re-run without it                  |

---

## License

MIT. Provided as-is, for personal backup use. You are responsible for complying
with WhatsApp's Terms of Service and applicable laws in your jurisdiction.
