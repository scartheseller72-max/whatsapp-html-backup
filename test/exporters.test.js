'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exportJson } = require('../src/exporters/json');
const { exportCsv, csvCell } = require('../src/exporters/csv');
const { parseFormats } = require('../src/exporters');
const { tsToDate } = require('../src/utils');

function mk(o) {
  return Object.assign({
    timestamp: o.ts, date: tsToDate(o.ts), fromMe: false, type: 'chat', body: '',
    senderName: 'X', media: null, system: false, isDeleted: false,
  }, o);
}

const base = Math.floor(new Date(2024, 0, 1, 9, 0, 0).getTime() / 1000);

function sampleChats() {
  return [{
    chatName: 'Amma', folderName: 'Amma', isGroup: false,
    counts: { total: 2, media: 1 }, members: null,
    messages: [
      mk({ ts: base, fromMe: true, senderName: 'You', body: 'hello' }),
      mk({ ts: base + 60, fromMe: false, senderName: 'Amma', type: 'image', media: { kind: 'image', relPath: 'media/x.jpg', mimetype: 'image/jpeg', originalName: null } }),
    ],
  }];
}

test('exportJson writes per-chat and index files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waj-'));
  exportJson(sampleChats(), dir);
  const chatJson = JSON.parse(fs.readFileSync(path.join(dir, 'exports', 'json', 'Amma.json'), 'utf8'));
  assert.strictEqual(chatJson.messageCount, 2);
  assert.strictEqual(chatJson.messages[0].body, 'hello');
  assert.strictEqual(chatJson.messages[1].media.kind, 'image');
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'exports', 'json', 'index.json'), 'utf8'));
  assert.strictEqual(index.chats[0].messages, 2);
});

test('exportCsv writes header and rows with safe quoting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wac-'));
  exportCsv(sampleChats(), dir);
  const csv = fs.readFileSync(path.join(dir, 'exports', 'csv', 'Amma.csv'), 'utf8');
  const lines = csv.trim().split('\n');
  assert.match(lines[0], /^datetime,sender,fromMe,type,body,media_path$/);
  assert.strictEqual(lines.length, 3);
  assert.match(lines[2], /chats\/Amma\/media\/x\.jpg/);
});

test('csvCell neutralizes formula injection and quotes', () => {
  assert.strictEqual(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.strictEqual(csvCell('a,b'), '"a,b"');
  assert.strictEqual(csvCell('he said "hi"'), '"he said ""hi"""');
});

test('parseFormats always includes html and filters invalid', () => {
  assert.deepStrictEqual(parseFormats('pdf,json,bogus'), ['html', 'pdf', 'json']);
  assert.deepStrictEqual(parseFormats(''), ['html']);
  assert.deepStrictEqual(parseFormats('csv'), ['html', 'csv']);
});
