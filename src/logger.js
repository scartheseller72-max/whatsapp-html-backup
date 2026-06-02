'use strict';

/**
 * File logger that mirrors messages to the console and appends them to
 * <outputDir>/backup.log. Returns an object with the same shape as utils.log
 * plus close(). If the log file cannot be opened, it degrades to console-only.
 */

const fs = require('fs');
const path = require('path');

function ts() {
  return new Date().toISOString();
}

function createLogger(outputDir) {
  let stream = null;
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    stream = fs.createWriteStream(path.join(outputDir, 'backup.log'), { flags: 'a' });
    stream.write(`\n===== Run started ${ts()} =====\n`);
  } catch (_) {
    stream = null;
  }

  const writeFile = (level, args) => {
    if (!stream) return;
    try { stream.write(`[${ts()}] ${level} ${args.join(' ')}\n`); } catch (_) { /* ignore */ }
  };

  const hhmm = () => {
    const d = new Date();
    const p = (n) => (n < 10 ? `0${n}` : `${n}`);
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  return {
    info: (...a) => { console.log(`[${hhmm()}]`, ...a); writeFile('INFO', a); },
    warn: (...a) => { console.warn(`[${hhmm()}] WARN`, ...a); writeFile('WARN', a); },
    error: (...a) => { console.error(`[${hhmm()}] ERROR`, ...a); writeFile('ERROR', a); },
    step: (...a) => { console.log(`\n[${hhmm()}] ==>`, ...a); writeFile('STEP', a); },
    close: () => { if (stream) { try { stream.end(); } catch (_) { /* ignore */ } } },
  };
}

module.exports = { createLogger };
