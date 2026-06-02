#!/usr/bin/env node
'use strict';

/**
 * whatsapp-html-backup — entry point / CLI.
 *
 * Connects to WhatsApp Web (QR login), exports the selected chats + media,
 * and writes a Telegram-style static HTML archive to the output folder.
 *
 * Usage:
 *   node src/index.js [options]
 *
 * Options:
 *   --from YYYY-MM-DD        Only messages on/after this date
 *   --to YYYY-MM-DD          Only messages on/before this date (inclusive)
 *   --chats "A,B,+9477..."   Only these chats (name/number substrings). Default: all
 *   --out <dir>              Output directory (default: output)
 *   --no-media               Skip downloading media (text only)
 *   --max <n>                Cap messages fetched per chat (default: all available)
 *   --no-groups              Exclude group chats
 *   --include-status         Include the Status/Broadcast pseudo-chat
 *   --throttle <ms>          Delay between message ops (default: 120)
 *   --config <file>          Load defaults from a JSON config (default: config.json if present)
 *   --logout                 Delete the saved session and exit
 *   --help                   Show this help
 */

const fs = require('fs');
const path = require('path');

const { createClient, closeClient } = require('./client');
const { selectChats, processChat } = require('./fetcher');
const { renderChatPage, renderIndexPage, writeAssets } = require('./renderer');
const {
  ensureDir, parseDateOnly, formatFull, log,
} = require('./utils');

const ROOT = path.resolve(__dirname, '..');

function printHelp() {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(4, 33).join('\n').replace(/^ \*?/gm, ''));
}

/** Parse argv into a flat options object. */
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[(i += 1)];
    switch (a) {
      case '--from': args.from = next(); break;
      case '--to': args.to = next(); break;
      case '--chats': args.chats = next(); break;
      case '--out': args.out = next(); break;
      case '--no-media': args.noMedia = true; break;
      case '--max': args.max = parseInt(next(), 10); break;
      case '--no-groups': args.noGroups = true; break;
      case '--include-status': args.includeStatus = true; break;
      case '--throttle': args.throttle = parseInt(next(), 10); break;
      case '--config': args.config = next(); break;
      case '--logout': args.logout = true; break;
      case '--help': case '-h': args.help = true; break;
      default: args._.push(a);
    }
  }
  return args;
}

/** Merge config file + CLI flags into the final options object. */
function buildOptions(args) {
  let cfg = {};
  const cfgPath = args.config
    ? path.resolve(process.cwd(), args.config)
    : path.join(ROOT, 'config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      log.info(`Loaded config from ${cfgPath}`);
    } catch (err) {
      log.warn(`Could not parse config ${cfgPath}: ${err.message}`);
    }
  }

  const chatsCsv = args.chats !== undefined ? args.chats : null;
  const chatsFromCsv = chatsCsv
    ? chatsCsv.split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  const outputDir = path.resolve(
    process.cwd(),
    args.out || cfg.outputDir || 'output'
  );

  return {
    outputDir,
    sessionDir: path.resolve(ROOT, cfg.sessionDir || '.wwebjs_auth'),
    dateFrom: parseDateOnly(args.from !== undefined ? args.from : cfg.dateFrom, false),
    dateTo: parseDateOnly(args.to !== undefined ? args.to : cfg.dateTo, true),
    chats: chatsFromCsv || cfg.chats || [],
    downloadMedia: args.noMedia ? false : (cfg.downloadMedia !== false),
    maxMessagesPerChat: Number.isFinite(args.max) ? args.max : (cfg.maxMessagesPerChat || 0),
    includeGroups: args.noGroups ? false : (cfg.includeGroups !== false),
    includeStatus: args.includeStatus || cfg.includeStatus || false,
    throttleMs: Number.isFinite(args.throttle) ? args.throttle : (cfg.throttleMs ?? 120),
    rawFrom: args.from !== undefined ? args.from : cfg.dateFrom,
    rawTo: args.to !== undefined ? args.to : cfg.dateTo,
  };
}

function buildPreview(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.system) continue;
    if (m.body) return m.body.replace(/\s+/g, ' ').slice(0, 80);
    if (m.media && !m.media.error) {
      const k = m.media.kind;
      return k === 'image' ? '📷 Photo'
        : k === 'video' ? '🎬 Video'
        : k === 'audio' ? (m.media.isVoiceNote ? '🎙 Voice note' : '🎵 Audio')
        : '📎 Document';
    }
    if (m.location) return '📍 Location';
    if (m.vcards) return '👤 Contact';
  }
  return '';
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) { printHelp(); return; }

  if (args.logout) {
    const sessionDir = path.resolve(ROOT, '.wwebjs_auth');
    const cacheDir = path.resolve(ROOT, '.wwebjs_cache');
    for (const d of [sessionDir, cacheDir]) {
      if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); log.info(`Removed ${d}`); }
    }
    log.info('Logged out. Next run will show a fresh QR code.');
    return;
  }

  const opts = buildOptions(args);

  log.step('Starting WhatsApp HTML Backup');
  log.info(`Output:      ${opts.outputDir}`);
  log.info(`Date range:  ${opts.rawFrom || 'beginning'} → ${opts.rawTo || 'now'}`);
  log.info(`Media:       ${opts.downloadMedia ? 'download' : 'skip'}`);
  log.info(`Chats:       ${opts.chats.length ? opts.chats.join(', ') : 'ALL'}`);

  ensureDir(opts.outputDir);
  ensureDir(path.join(opts.outputDir, 'chats'));

  log.step('Connecting to WhatsApp Web — scan the QR code if prompted…');
  const client = await createClient({ sessionDir: opts.sessionDir });

  try {
    const chats = await selectChats(client, opts);
    log.info(`${chats.length} chat(s) selected for backup.`);

    const summaries = [];
    let totalMessages = 0;

    for (let i = 0; i < chats.length; i += 1) {
      const chat = chats[i];
      const label = chat.name || (chat.id && chat.id.user) || 'Unknown';
      log.step(`[${i + 1}/${chats.length}] ${label}`);

      // eslint-disable-next-line no-await-in-loop
      const result = await processChat(chat, opts);
      if (result.messages.length === 0 && opts.chats.length === 0 && (opts.dateFrom || opts.dateTo)) {
        log.info('  (no messages in range — skipped)');
        continue;
      }

      const chatDir = path.join(opts.outputDir, 'chats', result.folderName);
      ensureDir(chatDir);

      const html = renderChatPage({
        chatName: result.chatName,
        isGroup: result.isGroup,
        messages: result.messages,
        counts: result.counts,
      });
      fs.writeFileSync(path.join(chatDir, 'index.html'), html);

      const last = result.messages[result.messages.length - 1];
      summaries.push({
        chatName: result.chatName,
        folderName: result.folderName,
        isGroup: result.isGroup,
        total: result.counts.total,
        media: result.counts.media,
        lastDate: last ? last.date : null,
        lastPreview: buildPreview(result.messages),
      });
      totalMessages += result.counts.total;
      log.info(`  ${result.counts.total} messages, ${result.counts.media} media files`);
    }

    // Sort chats by most-recent activity for the index.
    summaries.sort((a, b) => {
      const ta = a.lastDate ? a.lastDate.getTime() : 0;
      const tb = b.lastDate ? b.lastDate.getTime() : 0;
      return tb - ta;
    });

    log.step('Writing index + assets…');
    const logoPath = path.join(ROOT, 'assets', 'logo.png');
    const { hasLogo } = writeAssets(opts.outputDir, logoPath);

    const indexHtml = renderIndexPage(summaries, {
      totalChats: summaries.length,
      totalMessages,
      dateFrom: opts.rawFrom || null,
      dateTo: opts.rawTo || null,
      generatedAt: formatFull(new Date()),
      hasLogo,
    });
    fs.writeFileSync(path.join(opts.outputDir, 'index.html'), indexHtml);

    log.step('Done.');
    log.info(`Backed up ${summaries.length} chats / ${totalMessages} messages.`);
    log.info(`Open: ${path.join(opts.outputDir, 'index.html')}`);
  } finally {
    await closeClient(client);
    // whatsapp-web.js / puppeteer can leave the event loop alive.
    setTimeout(() => process.exit(0), 500);
  }
}

run().catch((err) => {
  log.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
