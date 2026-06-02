'use strict';

/**
 * WhatsApp Web client bootstrap.
 *
 * Handles QR-code login and persistent session storage via LocalAuth. Accepts
 * optional hooks so the caller can route the QR + lifecycle events to the
 * terminal (CLI) or to a browser (Web UI). If no `onQr` hook is supplied, the
 * QR is printed to the terminal via qrcode-terminal.
 *
 * NOTE: this drives a real Chromium instance via Puppeteer. The session in
 * `sessionDir` is the equivalent of a linked device — keep it private.
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');

function createClient({ sessionDir, hooks = {} }) {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionDir }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu',
      ],
    },
    webVersionCache: {
      type: 'remote',
      remotePath:
        'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1023677078-alpha.html',
    },
  });

  return new Promise((resolve, reject) => {
    let resolved = false;

    client.on('qr', (qr) => {
      if (hooks.onQr) {
        hooks.onQr(qr);
      } else {
        console.log('\n  Scan this QR with WhatsApp (Settings > Linked Devices > Link a Device):\n');
        qrcodeTerminal.generate(qr, { small: true });
      }
    });

    client.on('loading_screen', (percent, message) => {
      if (hooks.onLoading) hooks.onLoading(percent, message);
    });

    client.on('authenticated', () => { if (hooks.onAuth) hooks.onAuth(); });

    client.on('auth_failure', (msg) => {
      if (hooks.onLog) hooks.onLog(`auth failure: ${msg}`);
      if (!resolved) { resolved = true; reject(new Error(`auth_failure: ${msg}`)); }
    });

    client.on('ready', () => {
      if (hooks.onReady) hooks.onReady();
      if (!resolved) { resolved = true; resolve(client); }
    });

    client.on('disconnected', (reason) => { if (hooks.onDisconnected) hooks.onDisconnected(reason); });

    client.initialize().catch((err) => {
      if (!resolved) { resolved = true; reject(err); }
    });
  });
}

async function closeClient(client) {
  try { await client.destroy(); } catch (_) { /* ignore */ }
}

module.exports = { createClient, closeClient };
