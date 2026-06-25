'use strict';

/**
 * Incremental-backup state.
 *
 * Persists, per chat, the timestamp of the last message captured so a later run
 * with --incremental only fetches newer messages. Stored as JSON next to the
 * output so it travels with the archive.
 */

const fs = require('fs');
const path = require('path');

const FILE = '.backup-state.json';

function statePath(outputDir) {
  return path.join(outputDir, FILE);
}

function load(outputDir) {
  try {
    const p = statePath(outputDir);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) { /* corrupt/empty -> fresh */ }
  return { version: 2, chats: {}, lastRun: null };
}

function save(outputDir, state) {
  state.lastRun = new Date().toISOString();
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(statePath(outputDir), JSON.stringify(state, null, 2));
}

/** Last captured timestamp (seconds) for a chat folder, or 0. */
function lastTimestamp(state, folderName) {
  const e = state.chats[folderName];
  return e && e.lastTimestamp ? e.lastTimestamp : 0;
}

function update(state, folderName, lastTs, total, summary, stats) {
  const prev = state.chats[folderName] || {};
  state.chats[folderName] = {
    lastTimestamp: lastTs || prev.lastTimestamp || 0,
    total,
    summary: summary || prev.summary || null,
    // Persisted so an --incremental run can rebuild global stats for chats it
    // skips (otherwise stats.html would only reflect chats changed this run).
    stats: stats || prev.stats || null,
    updatedAt: new Date().toISOString(),
  };
}

function getSummary(state, folderName) {
  const e = state.chats[folderName];
  return e && e.summary ? e.summary : null;
}

function getStats(state, folderName) {
  const e = state.chats[folderName];
  return e && e.stats ? e.stats : null;
}

module.exports = {
  load, save, lastTimestamp, update, getSummary, getStats, statePath,
};
