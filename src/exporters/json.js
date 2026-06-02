'use strict';

/**
 * JSON / NDJSON exporter.
 *
 * Writes one structured .json file per chat plus a combined index.json. Dates
 * are emitted as ISO strings; binary media is referenced by relative path (the
 * files live in the HTML archive's chats/<chat>/media/ folder).
 */

const fs = require('fs');
const path = require('path');

function plainMessage(m) {
  return {
    id: m.id,
    timestamp: m.timestamp,
    datetime: m.date instanceof Date ? m.date.toISOString() : m.date,
    fromMe: m.fromMe,
    sender: m.senderName,
    type: m.type,
    body: m.body || '',
    media: m.media && !m.media.error && !m.media.skipped
      ? { kind: m.media.kind, path: m.media.relPath, mimetype: m.media.mimetype, name: m.media.originalName }
      : null,
    quoted: m.quoted || null,
    poll: m.poll || null,
    location: m.location || null,
    contacts: m.vcards || null,
    mentions: m.mentions || null,
    reactions: m.reactions || null,
    linkPreview: m.linkPreview ? { url: m.linkPreview.url, title: m.linkPreview.title } : null,
    starred: !!m.starred,
    edited: !!m.edited,
    forwarded: !!m.isForwarded,
    deleted: !!m.isDeleted,
    system: !!m.system,
  };
}

function exportJson(chats, outputDir, opts = {}) {
  const dir = path.join(outputDir, 'exports', 'json');
  fs.mkdirSync(dir, { recursive: true });
  const ndjson = !!opts.ndjson;
  const index = [];

  for (const c of chats) {
    const payload = {
      chat: c.chatName,
      isGroup: c.isGroup,
      messageCount: c.counts.total,
      members: c.members || null,
      messages: c.messages.map(plainMessage),
    };
    const base = path.join(dir, `${c.folderName}.${ndjson ? 'ndjson' : 'json'}`);
    if (ndjson) {
      const lines = payload.messages.map((m) => JSON.stringify(m)).join('\n');
      fs.writeFileSync(base, `${lines}\n`);
    } else {
      fs.writeFileSync(base, JSON.stringify(payload, null, 2));
    }
    index.push({ chat: c.chatName, folder: c.folderName, isGroup: c.isGroup, messages: c.counts.total });
  }

  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    chats: index,
  }, null, 2));

  return dir;
}

module.exports = { exportJson, plainMessage };
