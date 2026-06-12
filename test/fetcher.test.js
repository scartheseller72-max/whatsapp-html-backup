'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { chatMatchesSelection } = require('../src/fetcher');

function chat(name, user) {
  return { name, id: { user } };
}

test('empty selection matches every chat', () => {
  assert.ok(chatMatchesSelection(chat('Amma', '94771234567'), []));
  assert.ok(chatMatchesSelection(chat('Amma', '94771234567'), null));
});

test('matches by name substring, ignoring punctuation and case', () => {
  assert.ok(chatMatchesSelection(chat('Office Group', '123'), ['office group']));
  assert.ok(chatMatchesSelection(chat('Office Group', '123'), ['OFFICE']));
  assert.ok(!chatMatchesSelection(chat('Office Group', '123'), ['family']));
});

test('matches Sinhala / non-Latin chat names', () => {
  assert.ok(chatMatchesSelection(chat('අම්මා', '123'), ['අම්මා']));
  assert.ok(chatMatchesSelection(chat('පවුලේ කතාබහ', '123'), ['පවුලේ']));
  assert.ok(!chatMatchesSelection(chat('අම්මා', '123'), ['තාත්තා']));
});

test('matches by phone number digits', () => {
  assert.ok(chatMatchesSelection(chat('Whoever', '94771234567'), ['+94 77 123 4567']));
  assert.ok(!chatMatchesSelection(chat('Whoever', '94771234567'), ['+94999']));
});
