'use strict';

/**
 * CLI argument parsing + option resolution. Shared by the terminal entry point
 * (src/index.js) and the Web UI (src/server.js), so flags, config-file values
 * and Web-UI form fields all resolve through the same logic.
 */

const fs = require('fs');
const path = require('path');
const { parseDateOnly } = require('./utils');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[(i += 1)];
    switch (a) {
      case '--from': args.from = next(); break;
      case '--to': args.to = next(); break;
      case '--chats': args.chats = next(); break;
      case '--out': args.out = next(); break;
      case '--format': case '--formats': args.format = next(); break;
      case '--no-media': args.noMedia = true; break;
      case '--no-avatars': args.noAvatars = true; break;
      case '--no-link-previews': args.noLinkPreviews = true; break;
      case '--max': args.max = parseInt(next(), 10); break;
      case '--no-groups': args.noGroups = true; break;
      case '--include-status': args.includeStatus = true; break;
      case '--throttle': args.throttle = parseInt(next(), 10); break;
      case '--incremental': args.incremental = true; break;
      case '--config': args.config = next(); break;
      case '--serve': args.serve = true; break;
      case '--port': args.port = parseInt(next(), 10); break;
      case '--wizard': args.wizard = true; break;
      case '--logout': args.logout = true; break;
      case '--help': case '-h': args.help = true; break;
      default: args._.push(a);
    }
  }
  return args;
}

function buildOptions(args, root) {
  let cfg = {};
  const cfgPath = args.config
    ? path.resolve(process.cwd(), args.config)
    : path.join(root, 'config.json');
  if (fs.existsSync(cfgPath)) {
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (_) { /* ignore */ }
  }

  const chatsCsv = args.chats !== undefined ? args.chats : null;
  const chatsFromCsv = chatsCsv
    ? chatsCsv.split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  const outputDir = path.resolve(process.cwd(), args.out || cfg.outputDir || 'output');

  return {
    outputDir,
    sessionDir: path.resolve(root, cfg.sessionDir || '.wwebjs_auth'),
    dateFrom: parseDateOnly(args.from !== undefined ? args.from : cfg.dateFrom, false),
    dateTo: parseDateOnly(args.to !== undefined ? args.to : cfg.dateTo, true),
    chats: chatsFromCsv || cfg.chats || [],
    downloadMedia: args.noMedia ? false : (cfg.downloadMedia !== false),
    downloadAvatars: args.noAvatars ? false : (cfg.downloadAvatars !== false),
    linkPreviews: args.noLinkPreviews ? false : (cfg.linkPreviews !== false),
    maxMessagesPerChat: Number.isFinite(args.max) ? args.max : (cfg.maxMessagesPerChat || 0),
    includeGroups: args.noGroups ? false : (cfg.includeGroups !== false),
    includeStatus: args.includeStatus || cfg.includeStatus || false,
    throttleMs: Number.isFinite(args.throttle) ? args.throttle : (cfg.throttleMs != null ? cfg.throttleMs : 120),
    incremental: !!args.incremental || !!cfg.incremental,
    format: args.format || cfg.format || 'html',
    port: Number.isFinite(args.port) ? args.port : (cfg.port || 3000),
    rawFrom: args.from !== undefined ? args.from : cfg.dateFrom,
    rawTo: args.to !== undefined ? args.to : cfg.dateTo,
  };
}

/** Map a Web-UI JSON body to an args-shaped object for buildOptions(). */
function argsFromBody(body) {
  const args = {};
  if (body.from) args.from = body.from;
  if (body.to) args.to = body.to;
  if (body.chats) args.chats = body.chats;
  if (body.format) args.format = body.format;
  if (body.out) args.out = body.out;
  if (body.noMedia) args.noMedia = true;
  if (body.noGroups) args.noGroups = true;
  if (body.incremental) args.incremental = true;
  if (body.includeStatus) args.includeStatus = true;
  return args;
}

module.exports = { parseArgs, buildOptions, argsFromBody };
