'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const state = require('../src/state');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wast-'));
}

test('update/getSummary/lastTimestamp round-trip through disk', () => {
  const dir = tmpDir();
  const st = state.load(dir);
  state.update(st, 'Amma', 1700000000, 12, { chatName: 'Amma', total: 12 });
  state.save(dir, st);

  const reloaded = state.load(dir);
  assert.strictEqual(state.lastTimestamp(reloaded, 'Amma'), 1700000000);
  assert.strictEqual(state.getSummary(reloaded, 'Amma').total, 12);
});

test('per-chat stats persist so incremental runs can rebuild global stats', () => {
  const dir = tmpDir();
  const st = state.load(dir);
  const stats = { isGroup: false, total: 5, fromMe: 2, byHour: new Array(24).fill(0), topEmojis: [{ key: '😀', count: 3 }] };
  state.update(st, 'Amma', 1700000000, 5, { chatName: 'Amma' }, stats);
  state.save(dir, st);

  const reloaded = state.load(dir);
  const got = state.getStats(reloaded, 'Amma');
  assert.ok(got, 'stats should survive a save/load cycle');
  assert.strictEqual(got.total, 5);
  assert.strictEqual(got.topEmojis[0].key, '😀');
});

test('getStats returns null for older state entries without stats', () => {
  const st = { version: 2, chats: { Amma: { lastTimestamp: 1, total: 1, summary: {} } }, lastRun: null };
  assert.strictEqual(state.getStats(st, 'Amma'), null);
});
