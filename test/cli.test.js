'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { parseArgs, argsFromBody } = require('../src/cli');

test('parseArgs maps flags and values', () => {
  const a = parseArgs(['--from', '2024-01-01', '--no-media', '--max', '50', '--chats', 'A,B']);
  assert.strictEqual(a.from, '2024-01-01');
  assert.strictEqual(a.noMedia, true);
  assert.strictEqual(a.max, 50);
  assert.strictEqual(a.chats, 'A,B');
});

test('argsFromBody maps Web UI fields including advanced options', () => {
  const a = argsFromBody({
    from: '2024-01-01', noMedia: true, noAvatars: true, noLinkPreviews: true,
    max: '25', throttle: '0', format: 'html,csv',
  });
  assert.strictEqual(a.from, '2024-01-01');
  assert.strictEqual(a.noMedia, true);
  assert.strictEqual(a.noAvatars, true);
  assert.strictEqual(a.noLinkPreviews, true);
  assert.strictEqual(a.max, 25);
  assert.strictEqual(a.throttle, 0);
  assert.strictEqual(a.format, 'html,csv');
});

test('argsFromBody ignores invalid numeric values', () => {
  const a = argsFromBody({ max: 'abc', throttle: '-5' });
  assert.strictEqual(a.max, undefined);
  assert.strictEqual(a.throttle, undefined);
});
