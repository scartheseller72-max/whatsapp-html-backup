'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const u = require('../src/utils');

test('escapeHtml escapes dangerous characters', () => {
  assert.strictEqual(u.escapeHtml('<b>&"\''), '&lt;b&gt;&amp;&quot;&#39;');
});

test('formatMessageText renders bold, italic and links', () => {
  const out = u.formatMessageText('hello *world* and _it_ http://x.com');
  assert.match(out, /<strong>world<\/strong>/);
  assert.match(out, /<em>it<\/em>/);
  assert.match(out, /<a href="http:\/\/x\.com"/);
});

test('formatMessageText converts newlines to <br>', () => {
  assert.match(u.formatMessageText('a\nb'), /a<br>b/);
});

test('safeFilename strips unsafe characters', () => {
  assert.strictEqual(u.safeFilename('A/B:C*?'), 'A_B_C_');
  assert.strictEqual(u.safeFilename(''), 'chat');
});

test('parseDateOnly parses and rejects', () => {
  assert.ok(u.parseDateOnly('2024-01-15') instanceof Date);
  assert.strictEqual(u.parseDateOnly('nope'), null);
  assert.strictEqual(u.parseDateOnly(null), null);
});

test('parseDateOnly endOfDay flag', () => {
  const d = u.parseDateOnly('2024-01-15', true);
  assert.strictEqual(d.getHours(), 23);
  assert.strictEqual(d.getMinutes(), 59);
});

test('pct and truncate', () => {
  assert.strictEqual(u.pct(1, 4), 25);
  assert.strictEqual(u.pct(1, 0), 0);
  assert.strictEqual(u.truncate('hello world', 5), 'hell…');
});

test('weekdayName and monthKey', () => {
  const d = new Date(2024, 0, 1); // Monday Jan 1 2024
  assert.strictEqual(u.weekdayName(d), 'Monday');
  assert.strictEqual(u.monthKey(d), '2024-01');
});

test('humanFileSize', () => {
  assert.strictEqual(u.humanFileSize(0), '0 B');
  assert.strictEqual(u.humanFileSize(1024), '1.0 KB');
});
