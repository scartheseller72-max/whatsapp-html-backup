'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { computeChatStats, computeGlobalStats } = require('../src/stats');
const { tsToDate } = require('../src/utils');

function mk(o) {
  return Object.assign({
    timestamp: o.ts, date: tsToDate(o.ts), fromMe: false, type: 'chat', body: '',
    senderName: 'X', media: null, system: false,
  }, o);
}

const base = Math.floor(new Date(2024, 0, 1, 10, 0, 0).getTime() / 1000);

test('computeChatStats counts totals, senders and media', () => {
  const msgs = [
    mk({ ts: base, fromMe: true, senderName: 'You', body: 'hello world test' }),
    mk({ ts: base + 60, fromMe: false, senderName: 'Amma', body: 'reply 😀😀' }),
    mk({ ts: base + 120, fromMe: false, senderName: 'Amma', type: 'image', media: { kind: 'image', isVoiceNote: false } }),
    mk({ ts: base + 180, fromMe: true, senderName: 'You', type: 'ptt', media: { kind: 'audio', isVoiceNote: true } }),
    mk({ ts: base + 240, system: true, body: 'encrypted' }),
  ];
  const s = computeChatStats(msgs, true);
  assert.strictEqual(s.total, 4, 'system message excluded from total');
  assert.strictEqual(s.fromMe, 2);
  assert.strictEqual(s.fromOthers, 2);
  assert.strictEqual(s.media.image, 1);
  assert.strictEqual(s.media.audio, 1);
  assert.strictEqual(s.voiceNotes, 1);
  assert.strictEqual(s.mediaTotal, 2);
  const amma = s.topSenders.find((x) => x.key === 'Amma');
  assert.strictEqual(amma.count, 2);
});

test('computeChatStats extracts emojis and hour buckets', () => {
  const msgs = [mk({ ts: base, body: 'nice 😀😀 day' })];
  const s = computeChatStats(msgs, false);
  const happy = s.topEmojis.find((e) => e.key === '😀');
  assert.ok(happy && happy.count === 2);
  assert.strictEqual(s.byHour[10], 1);
});

test('computeGlobalStats aggregates per-chat stats', () => {
  const a = computeChatStats([mk({ ts: base, body: 'x y z' })], false);
  const b = computeChatStats([mk({ ts: base, body: 'p q r' }), mk({ ts: base + 1, body: 's' })], true);
  const g = computeGlobalStats([{ chatName: 'A', stats: a }, { chatName: 'B', stats: b }]);
  assert.strictEqual(g.chats, 2);
  assert.strictEqual(g.groups, 1);
  assert.strictEqual(g.total, 3);
  assert.strictEqual(g.topChats[0].name, 'B');
});
