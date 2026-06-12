'use strict';

/**
 * Backup orchestration core — shared by the CLI (src/index.js) and the Web UI
 * (src/server.js). Connects, walks the selected chats, renders the HTML archive
 * (messages / gallery / stats / members + top-level index & global stats),
 * runs any extra export formats, and maintains incremental state.
 *
 * Hooks let the caller observe progress without coupling to a UI:
 *   hooks.logger     logger-like object (info/warn/error/step)
 *   hooks.onQr(str)  raw QR string for browser rendering
 *   hooks.onPhase(name, data)   lifecycle: connecting|ready|chat|render|export|done
 *   hooks.onChatStart(name, totalMessages) / hooks.onChatEnd()
 *   hooks.onMessage()           one normalized message processed
 *   hooks.shouldStop()          return true to stop gracefully after the
 *                               current message; partial results are rendered
 */

const fs = require('fs');
const path = require('path');

const { createClient, closeClient } = require('./client');
const { selectChats, processChat } = require('./fetcher');
const renderer = require('./renderer');
const stats = require('./stats');
const state = require('./state');
const { runExports, parseFormats } = require('./exporters');
const { safeFilename, formatFull, tsToDate, log: defaultLog } = require('./utils');

function buildPreview(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.system) continue;
    if (m.body) return m.body.replace(/\s+/g, ' ').slice(0, 80);
    if (m.poll) return `📊 ${m.poll.question || 'Poll'}`;
    if (m.media && !m.media.error) {
      const k = m.media.kind;
      return k === 'image' ? '📷 Photo' : k === 'video' ? '🎬 Video'
        : k === 'audio' ? (m.media.isVoiceNote ? '🎙 Voice note' : '🎵 Audio') : '📎 Document';
    }
    if (m.location) return '📍 Location';
    if (m.vcards) return '👤 Contact';
  }
  return '';
}

async function runBackup(opts, hooks = {}) {
  const log = hooks.logger || defaultLog;
  const phase = (name, data) => { if (hooks.onPhase) hooks.onPhase(name, data); };

  opts.formats = parseFormats(opts.format);
  opts.linkCache = new Map();
  if (opts.onMessage === undefined && hooks.onMessage) opts.onMessage = hooks.onMessage;
  if (opts.onChatStart === undefined && hooks.onChatStart) opts.onChatStart = hooks.onChatStart;
  if (opts.onChatEnd === undefined && hooks.onChatEnd) opts.onChatEnd = hooks.onChatEnd;
  if (opts.shouldStop === undefined && hooks.shouldStop) opts.shouldStop = hooks.shouldStop;
  const stopRequested = () => !!(opts.shouldStop && opts.shouldStop());

  fs.mkdirSync(path.join(opts.outputDir, 'chats'), { recursive: true });
  const st = state.load(opts.outputDir);

  phase('connecting');
  log.step('Connecting to WhatsApp Web…');
  const client = await createClient({
    sessionDir: opts.sessionDir,
    hooks: {
      onQr: hooks.onQr,
      onLoading: (p, m) => log.info(`Loading… ${p}% ${m || ''}`.trim()),
      onAuth: () => log.info('Authenticated.'),
      onReady: () => { phase('ready'); log.info('Client ready.'); },
      onLog: (m) => log.warn(m),
    },
  });

  const processedSummaries = [];
  const perChatForGlobal = [];
  const exportChats = [];
  let totalMessages = 0;

  try {
    const chats = await selectChats(client, opts);
    log.info(`${chats.length} chat(s) selected.`);
    phase('chats', { count: chats.length });

    for (let i = 0; i < chats.length; i += 1) {
      if (stopRequested()) {
        log.warn('Stop requested — finishing with the chats processed so far.');
        break;
      }
      const chat = chats[i];
      const chatName = chat.name || (chat.id && chat.id.user ? `+${chat.id.user}` : 'Unknown');
      const folderName = safeFilename(chatName, chat.isGroup ? 'group' : 'chat');

      // Incremental: skip chats with no new activity since last run.
      if (opts.incremental && chat.timestamp && state.lastTimestamp(st, folderName) >= chat.timestamp) {
        const saved = state.getSummary(st, folderName);
        if (saved) {
          processedSummaries.push({ ...saved, lastDate: saved.lastTimestamp ? tsToDate(saved.lastTimestamp) : null });
          log.info(`[${i + 1}/${chats.length}] ${chatName} — no new messages, kept`);
          continue;
        }
      }

      log.step(`[${i + 1}/${chats.length}] ${chatName}`);
      phase('chat', { index: i + 1, total: chats.length, name: chatName });

      // eslint-disable-next-line no-await-in-loop
      const result = await processChat(chat, opts, client);
      if (result.messages.length === 0 && (opts.dateFrom || opts.dateTo) && opts.chats.length === 0) {
        log.info('  (no messages in range)');
        continue;
      }

      const chatStats = stats.computeChatStats(result.messages, result.isGroup);
      const chatDir = path.join(opts.outputDir, 'chats', result.folderName);
      fs.mkdirSync(chatDir, { recursive: true });

      const pageData = {
        chatName: result.chatName,
        isGroup: result.isGroup,
        messages: result.messages,
        counts: result.counts,
        stats: chatStats,
        members: result.members,
        mediaItems: result.mediaItems,
        avatarRel: result.avatarRel,
        hasStats: result.counts.total > 0,
      };

      fs.writeFileSync(path.join(chatDir, 'index.html'), renderer.renderChatPage(pageData));
      fs.writeFileSync(path.join(chatDir, 'gallery.html'), renderer.renderGalleryPage(pageData));
      if (pageData.hasStats) fs.writeFileSync(path.join(chatDir, 'stats.html'), renderer.renderStatsPage(pageData));
      if (result.isGroup && result.members) fs.writeFileSync(path.join(chatDir, 'members.html'), renderer.renderMembersPage(pageData));

      const last = result.messages[result.messages.length - 1];
      const summary = {
        chatName: result.chatName,
        folderName: result.folderName,
        isGroup: result.isGroup,
        total: result.counts.total,
        media: result.counts.media,
        lastTimestamp: last ? last.timestamp : 0,
        lastPreview: buildPreview(result.messages),
        avatarRel: result.avatarRel,
      };
      processedSummaries.push({ ...summary, lastDate: last ? last.date : null });
      perChatForGlobal.push({ chatName: result.chatName, stats: chatStats });
      exportChats.push({
        chatName: result.chatName,
        folderName: result.folderName,
        isGroup: result.isGroup,
        counts: result.counts,
        messages: result.messages,
        members: result.members,
      });
      state.update(st, result.folderName, summary.lastTimestamp, summary.total, summary);
      totalMessages += result.counts.total;
      log.info(`  ${result.counts.total} messages, ${result.counts.media} media`);
    }

    // Sort by most recent.
    processedSummaries.sort((a, b) => {
      const ta = a.lastDate ? a.lastDate.getTime() : 0;
      const tb = b.lastDate ? b.lastDate.getTime() : 0;
      return tb - ta;
    });

    phase('render');
    log.step('Writing index, global stats + assets…');
    const logoPath = path.join(__dirname, '..', 'assets', 'logo.png');
    const { hasLogo } = renderer.writeAssets(opts.outputDir, logoPath);

    const meta = {
      totalChats: processedSummaries.length,
      totalMessages: processedSummaries.reduce((s, x) => s + (x.total || 0), 0),
      dateFrom: opts.rawFrom || null,
      dateTo: opts.rawTo || null,
      generatedAt: formatFull(new Date()),
      hasLogo,
    };
    fs.writeFileSync(path.join(opts.outputDir, 'index.html'), renderer.renderIndexPage(processedSummaries, meta));

    const globalStats = stats.computeGlobalStats(perChatForGlobal.map((c) => ({ chatName: c.chatName, stats: c.stats })));
    fs.writeFileSync(path.join(opts.outputDir, 'stats.html'), renderer.renderGlobalStatsPage(globalStats, meta));

    // Extra export formats (operate on chats processed this run).
    const extras = opts.formats.filter((f) => f !== 'html');
    if (extras.length && exportChats.length) {
      phase('export', { formats: extras });
      log.step(`Running exports: ${extras.join(', ')}…`);
      await runExports(opts.formats, exportChats, opts.outputDir, log);
    }

    state.save(opts.outputDir, st);

    phase('done', { chats: meta.totalChats, messages: meta.totalMessages });
    log.step('Done.');
    log.info(`${meta.totalChats} chats / ${meta.totalMessages} messages → ${path.join(opts.outputDir, 'index.html')}`);
    return { chats: meta.totalChats, messages: meta.totalMessages, outputDir: opts.outputDir };
  } finally {
    await closeClient(client);
  }
}

module.exports = { runBackup, buildPreview };
