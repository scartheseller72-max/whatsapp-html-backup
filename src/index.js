#!/usr/bin/env node
'use strict';

/**
 * whatsapp-html-backup — CLI entry point (v2).
 *
 * Thin wrapper around the shared backup core. Supports a one-shot terminal
 * backup, an interactive wizard, a local Web UI, and session logout.
 *
 * Usage:
 *   node src/index.js [options]
 *
 * Options:
 *   --from YYYY-MM-DD        Only messages on/after this date
 *   --to YYYY-MM-DD          Only messages on/before this date (inclusive)
 *   --chats "A,B,+9477..."   Only these chats (name/number substrings). Default: all
 *   --out <dir>              Output directory (default: output)
 *   --format <list>          Extra exports: pdf,json,ndjson,csv,singlefile (html always on)
 *   --no-media               Skip downloading media (text only)
 *   --no-avatars             Skip profile-picture downloads
 *   --no-link-previews       Skip fetching link previews
 *   --max <n>                Cap messages fetched per chat
 *   --no-groups              Exclude group chats
 *   --include-status         Include the Status/Broadcast pseudo-chat
 *   --throttle <ms>          Delay between message operations (default: 120)
 *   --incremental            Only fetch chats with new activity since last run
 *   --config <file>          Load defaults from JSON (default: config.json)
 *   --wizard                 Interactive setup prompts
 *   --serve [--port <n>]     Launch the browser Web UI instead of a CLI run
 *   --logout                 Delete the saved session and exit
 *   --help                   Show this help
 */

const fs = require('fs');
const path = require('path');

const { parseArgs, buildOptions } = require('./cli');
const { runBackup } = require('./backup');
const { runWizard } = require('./wizard');
const { createLogger } = require('./logger');

const ROOT = path.resolve(__dirname, '..');

function printHelp() {
  const src = fs.readFileSync(__filename, 'utf8').split('\n');
  const block = src.slice(6, 38).map((l) => l.replace(/^ \*?/, '')).join('\n');
  console.log(block);
}

async function main() {
  let args = parseArgs(process.argv.slice(2));

  if (args.help) { printHelp(); return; }

  if (args.logout) {
    for (const d of ['.wwebjs_auth', '.wwebjs_cache']) {
      const abs = path.resolve(ROOT, d);
      if (fs.existsSync(abs)) { fs.rmSync(abs, { recursive: true, force: true }); console.log(`Removed ${abs}`); }
    }
    console.log('Logged out. Next run shows a fresh QR code.');
    return;
  }

  if (args.serve) {
    // Lazy-require so a CLI-only install without express still works.
    // eslint-disable-next-line global-require
    const { startServer } = require('./server');
    startServer(args);
    return; // server keeps the process alive
  }

  if (args.wizard) {
    const wiz = await runWizard();
    args = { ...args, ...wiz };
  }

  const opts = buildOptions(args, ROOT);
  const logger = createLogger(opts.outputDir);

  logger.step('WhatsApp HTML Backup');
  logger.info(`Output:     ${opts.outputDir}`);
  logger.info(`Range:      ${opts.rawFrom || 'beginning'} → ${opts.rawTo || 'now'}`);
  logger.info(`Media:      ${opts.downloadMedia ? 'download' : 'skip'} · Avatars: ${opts.downloadAvatars ? 'yes' : 'no'} · Link previews: ${opts.linkPreviews ? 'yes' : 'no'}`);
  logger.info(`Chats:      ${opts.chats.length ? opts.chats.join(', ') : 'ALL'}`);
  logger.info(`Formats:    ${opts.format}${opts.incremental ? ' · incremental' : ''}`);

  try {
    await runBackup(opts, { logger });
  } catch (err) {
    logger.error(err && err.stack ? err.stack : err);
    logger.close();
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 300);
    return;
  }

  logger.close();
  setTimeout(() => process.exit(0), 500);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
