'use strict';

/**
 * Local Web UI server.
 *
 * Serves a single-page dashboard where you click "Start", scan the QR shown in
 * the browser, watch live progress, and then browse the finished archive — no
 * terminal interaction required. The backup runs in-process via runBackup();
 * status is exposed over a small polling API and the generated archive is
 * served statically at /archive.
 *
 * Bind is localhost-only by design — this drives your live WhatsApp session and
 * must not be exposed to a network.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const QRCode = require('qrcode');

const { buildOptions, argsFromBody } = require('./cli');
const { runBackup } = require('./backup');

const ROOT = path.resolve(__dirname, '..');

function startServer(baseArgs) {
  const app = express();
  app.use(express.json());

  // Resolved output dir for static serving (form can override before start).
  let outputDir = buildOptions(baseArgs, ROOT).outputDir;

  const status = {
    phase: 'idle',          // idle | connecting | qr | ready | running | stopping | done | error
    qrDataUrl: null,
    log: [],
    chat: null,
    chatIndex: 0,
    chatTotal: 0,
    messages: 0,
    summary: null,
    error: null,
    running: false,
    startedAt: null,
    stopRequested: false,
  };

  function pushLog(level, parts) {
    const line = `${level === 'INFO' ? '' : `${level} `}${parts.join(' ')}`;
    status.log.push(line);
    if (status.log.length > 400) status.log.shift();
  }
  const logger = {
    info: (...a) => { console.log(...a); pushLog('INFO', a); },
    warn: (...a) => { console.warn(...a); pushLog('WARN', a); },
    error: (...a) => { console.error(...a); pushLog('ERROR', a); },
    step: (...a) => { console.log(...a); pushLog('STEP', a); },
  };

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'webui.html'));
  });

  app.get('/api/status', (req, res) => res.json(status));

  app.post('/api/start', async (req, res) => {
    if (status.running) return res.status(409).json({ error: 'A backup is already running.' });

    const args = { ...baseArgs, ...argsFromBody(req.body || {}) };
    const opts = buildOptions(args, ROOT);
    outputDir = opts.outputDir;

    status.phase = 'connecting';
    status.qrDataUrl = null;
    status.log = [];
    status.error = null;
    status.summary = null;
    status.chat = null;
    status.chatIndex = 0;
    status.chatTotal = 0;
    status.messages = 0;
    status.running = true;
    status.startedAt = Date.now();
    status.stopRequested = false;
    res.json({ started: true });

    const hooks = {
      logger,
      onQr: async (qr) => {
        try { status.qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 1 }); } catch (_) { /* ignore */ }
        status.phase = 'qr';
      },
      onPhase: (name, data) => {
        if (name === 'ready') { status.phase = 'running'; status.qrDataUrl = null; }
        else if (name === 'chat') { status.chat = data.name; status.chatIndex = data.index; status.chatTotal = data.total; }
        else if (name === 'done') { status.phase = 'done'; status.summary = data; }
        else if (status.phase !== 'running' && status.phase !== 'done') status.phase = name;
      },
      onMessage: () => { status.messages += 1; },
      shouldStop: () => status.stopRequested,
    };

    try {
      await runBackup(opts, hooks);
    } catch (err) {
      status.phase = 'error';
      status.error = err.message || String(err);
      logger.error(status.error);
    } finally {
      status.running = false;
    }
  });

  app.post('/api/stop', (req, res) => {
    if (!status.running) return res.status(409).json({ error: 'No backup is running.' });
    status.stopRequested = true;
    status.phase = 'stopping';
    logger.warn('Stop requested from the Web UI.');
    return res.json({ stopping: true });
  });

  // Serve the finished archive. Resolved lazily so it follows the chosen out dir.
  app.use('/archive', (req, res, next) => {
    express.static(outputDir)(req, res, next);
  });

  const port = baseArgs.port || 3000;
  // Localhost-only by default. In Docker, HOST=0.0.0.0 is set so the mapped
  // port is reachable from the host — only expose this on a trusted machine.
  const host = process.env.HOST || '127.0.0.1';
  const server = app.listen(port, host, () => {
    console.log(`\n  WhatsApp Backup Web UI → http://localhost:${port}\n  (Open it in your browser, then click Start and scan the QR.)\n`);
  });
  return server;
}

module.exports = { startServer };
