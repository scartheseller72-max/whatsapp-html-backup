'use strict';

/**
 * CSV exporter — one .csv per chat with the columns:
 * datetime, sender, fromMe, type, body, media_path
 * Spreadsheet-safe quoting (RFC 4180) and leading-character guard against
 * CSV formula injection.
 */

const fs = require('fs');
const path = require('path');

function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  // Neutralize spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function row(cells) {
  return cells.map(csvCell).join(',');
}

function exportCsv(chats, outputDir) {
  const dir = path.join(outputDir, 'exports', 'csv');
  fs.mkdirSync(dir, { recursive: true });
  const header = ['datetime', 'sender', 'fromMe', 'type', 'body', 'media_path'];

  for (const c of chats) {
    const lines = [row(header)];
    for (const m of c.messages) {
      lines.push(row([
        m.date instanceof Date ? m.date.toISOString() : m.date,
        m.senderName,
        m.fromMe ? 'yes' : 'no',
        m.system ? 'system' : m.type,
        m.isDeleted ? '(deleted)' : (m.body || ''),
        m.media && m.media.relPath ? `chats/${c.folderName}/${m.media.relPath}` : '',
      ]));
    }
    // UTF-8 BOM so Excel detects the encoding (Sinhala/emoji-safe).
    fs.writeFileSync(path.join(dir, `${c.folderName}.csv`), `\ufeff${lines.join('\n')}\n`);
  }
  return dir;
}

module.exports = { exportCsv, csvCell };
