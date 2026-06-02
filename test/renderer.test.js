'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const r = require('../src/renderer');
const { computeChatStats } = require('../src/stats');
const { tsToDate } = require('../src/utils');

function mk(o) {
  return Object.assign({
    timestamp: o.ts, date: tsToDate(o.ts), fromMe: false, type: 'chat', body: '',
    senderName: 'X', media: null, quoted: null, location: null, vcards: null,
    reactions: null, mentions: null, poll: null, linkPreview: null,
    starred: false, edited: false, isForwarded: false, isDeleted: false, system: false,
  }, o);
}

const base = Math.floor(new Date(2024, 5, 3, 14, 0, 0).getTime() / 1000);

test('renderChatPage produces bubbles, toolbar and month nav', () => {
  const messages = [
    mk({ ts: base, fromMe: false, senderName: 'Amma', body: 'Hi *there*' }),
    mk({ ts: base + 60, fromMe: true, senderName: 'You', body: 'reply', starred: true, edited: true }),
    mk({ ts: base + 120, fromMe: false, senderName: 'Amma', poll: { question: 'Lunch?', options: [{ name: 'Rice' }, { name: 'Noodles' }] } }),
    mk({ ts: base + 180, fromMe: false, senderName: 'Bot', mentions: [{ number: '123', name: 'Amma' }], body: 'hey @123' }),
  ];
  const html = r.renderChatPage({
    chatName: 'Amma', isGroup: true, messages,
    counts: { total: messages.length, media: 0 }, hasStats: true, avatarRel: null,
  });
  assert.match(html, /class="row in"/);
  assert.match(html, /class="row out"/);
  assert.match(html, /chat-search-box/);
  assert.match(html, /data-month="2024-06"/);
  assert.match(html, /<strong>there<\/strong>/);
  assert.match(html, /poll-q/);
  assert.match(html, /class="mention">@Amma/);
  assert.match(html, /star-tag/);
  assert.match(html, /edited-tag/);
  assert.match(html, /data-theme="dark"/);
});

test('renderStatsPage renders cards and charts', () => {
  const messages = [mk({ ts: base, fromMe: true, senderName: 'You', body: 'hello there friend' })];
  const stats = computeChatStats(messages, false);
  const html = r.renderStatsPage({
    chatName: 'Amma', isGroup: false, counts: { total: 1, media: 0 }, stats, avatarRel: null,
  });
  assert.match(html, /Total messages/);
  assert.match(html, /heatmap/);
  assert.match(html, /Activity by hour/);
});

test('renderIndexPage lists chats and links to global stats', () => {
  const html = r.renderIndexPage([
    { chatName: 'Amma', folderName: 'Amma', isGroup: false, total: 5, lastDate: tsToDate(base), lastPreview: 'hi', avatarRel: null },
  ], { totalChats: 1, totalMessages: 5, dateFrom: null, dateTo: null, generatedAt: 'now', hasLogo: false });
  assert.match(html, /chat-card/);
  assert.match(html, /stats\.html/);
  assert.match(html, /Amma/);
});

test('renderGalleryPage renders media cells', () => {
  const html = r.renderGalleryPage({
    chatName: 'Amma', isGroup: false, counts: { total: 0, media: 2 }, avatarRel: null, hasStats: true,
    mediaItems: [{ kind: 'image', relPath: 'media/a.jpg' }, { kind: 'file', relPath: 'media/b.pdf', originalName: 'b.pdf' }],
  });
  assert.match(html, /class="gallery"/);
  assert.match(html, /media\/a\.jpg/);
});
