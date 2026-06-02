'use strict';

/**
 * PDF exporter.
 *
 * Renders each generated chat page to a print-formatted PDF using Puppeteer
 * (reused from the whatsapp-web.js dependency). Puppeteer is required lazily so
 * the rest of the tool works even if a Chromium-less environment can't produce
 * PDFs. The chat pages already ship a print stylesheet (@media print), so the
 * output is clean.
 *
 * Falls back gracefully: if Puppeteer/Chromium is unavailable, it returns
 * { ok: false, reason } instead of throwing, and the caller can advise the user
 * to use the browser's "Print → Save as PDF" on the HTML pages instead.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function exportPdf(chats, outputDir, log) {
  let puppeteer;
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    puppeteer = require('puppeteer');
  } catch (_) {
    return { ok: false, reason: 'puppeteer not installed' };
  }

  const dir = path.join(outputDir, 'exports', 'pdf');
  fs.mkdirSync(dir, { recursive: true });

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  } catch (err) {
    return { ok: false, reason: `could not launch Chromium: ${err.message}` };
  }

  let count = 0;
  try {
    for (const c of chats) {
      const srcHtml = path.join(outputDir, 'chats', c.folderName, 'index.html');
      if (!fs.existsSync(srcHtml)) continue;
      // eslint-disable-next-line no-await-in-loop
      const page = await browser.newPage();
      // eslint-disable-next-line no-await-in-loop
      await page.goto(pathToFileURL(srcHtml).href, { waitUntil: 'networkidle0', timeout: 60000 });
      // eslint-disable-next-line no-await-in-loop
      await page.pdf({
        path: path.join(dir, `${c.folderName}.pdf`),
        format: 'A4',
        printBackground: true,
        margin: { top: '14mm', bottom: '14mm', left: '10mm', right: '10mm' },
      });
      // eslint-disable-next-line no-await-in-loop
      await page.close();
      count += 1;
      if (log) log.info(`  PDF: ${c.chatName}`);
    }
  } catch (err) {
    return { ok: false, reason: err.message, count };
  } finally {
    try { await browser.close(); } catch (_) { /* ignore */ }
  }

  return { ok: true, count, dir };
}

module.exports = { exportPdf };
