'use strict';

/**
 * Export dispatcher — runs the requested extra export formats after the HTML
 * archive has been generated. `html` is the always-on base output and is a
 * no-op here. Supported extras: pdf, json, ndjson, csv, singlefile.
 */

const { exportJson } = require('./json');
const { exportCsv } = require('./csv');
const { exportSingleFile } = require('./singlefile');
const { exportPdf } = require('./pdf');

const VALID = new Set(['html', 'pdf', 'json', 'ndjson', 'csv', 'singlefile']);

function parseFormats(spec) {
  if (!spec) return ['html'];
  const list = (Array.isArray(spec) ? spec : String(spec).split(','))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .filter((s) => VALID.has(s));
  if (!list.includes('html')) list.unshift('html');
  return Array.from(new Set(list));
}

async function runExports(formats, chats, outputDir, log) {
  const results = {};
  for (const fmt of formats) {
    try {
      if (fmt === 'html') { results.html = { ok: true }; continue; }
      if (fmt === 'json') { results.json = { ok: true, dir: exportJson(chats, outputDir) }; }
      else if (fmt === 'ndjson') { results.ndjson = { ok: true, dir: exportJson(chats, outputDir, { ndjson: true }) }; }
      else if (fmt === 'csv') { results.csv = { ok: true, dir: exportCsv(chats, outputDir) }; }
      else if (fmt === 'singlefile') { results.singlefile = { ok: true, dir: exportSingleFile(chats, outputDir) }; }
      else if (fmt === 'pdf') {
        // eslint-disable-next-line no-await-in-loop
        const r = await exportPdf(chats, outputDir, log);
        results.pdf = r;
        if (log) {
          if (r.ok) log.info(`  Exported pdf (${r.count} file${r.count === 1 ? '' : 's'}) → ${r.dir}`);
          else log.warn(`PDF export skipped (${r.reason}). Tip: open a chat's index.html and use the browser's Print → Save as PDF (a print stylesheet is included).`);
        }
      }
      if (log && results[fmt] && results[fmt].ok && fmt !== 'pdf') log.info(`  Exported ${fmt} → ${results[fmt].dir}`);
    } catch (err) {
      results[fmt] = { ok: false, reason: err.message };
      if (log) log.warn(`Export ${fmt} failed: ${err.message}`);
    }
  }
  return results;
}

module.exports = { runExports, parseFormats, VALID };
