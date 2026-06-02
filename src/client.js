'use strict';

/**
 * WhatsApp Web client bootstrap.
 *
 * Handles QR-code login (printed to the terminal), persistent session storage
 * via LocalAuth (so you only scan once), and clean ready/disconnect events.
 *
 * NOTE: whatsapp-web.js drives a real Chromium instance via Puppeteer. The
 * session in `sessionDir` is the equivalent of being logged in on a linked
 * device — keep it private and never commit it.
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { log } = require('./utils');

/**
 * Create and initialize a WhatsApp Web client.
 *
 * @param {object} opts
 * @param {string} opts.sessionDir  Folder to persist the linked-device session.
 * @returns {Promise<import('whatsapp-web.js').Client>} ready client
 */
function createClient({ sessionDir }) {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionDir }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
    },
    // Pin a known-good WhatsApp Web build cache for stability.
    webVersionCache: {
      type: 'remote',
      remotePath:
        'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1023677078-alpha.html',
    },
  });

  return new Promise((resolve, reject) => {
    let resolved = false;

    client.on('qr', (qr) => {
      console.log('\n  Scan this QR code with WhatsApp on your phone:');
      console.log('  (WhatsApp > Settings > Linked Devices > Link a Device)\n');
      qrcode.generate(qr, { small: true });
    });

    client.on('loading_screen', (percent, message) => {
      log.info(`Loading WhatsApp… ${percent}% ${message || ''}`.trim());
    });

    client.on('authenticated', () => {
      log.info('Authenticated. Session saved for next time.');
    });

    client.on('auth_failure', (msg) => {
      log.error('Authentication failed:', msg);
      if (!resolved) {
        resolved = true;
        reject(new Error(`auth_failure: ${msg}`));
      }
    });

    client.on('ready', () => {
      log.info('WhatsApp client is ready.');
      if (!resolved) {
        resolved = true;
        resolve(client);
      }
    });

    client.on('disconnected', (reason) => {
      log.warn('Client disconnected:', reason);
    });

    client.initialize().catch((err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
  });
}

/** Destroy the client gracefully. */
async function closeClient(client) {
  try {
    await client.destroy();
  } catch (_) {
    /* ignore */
  }
}

module.exports = { createClient, closeClient };
