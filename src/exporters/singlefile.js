'use strict';

/**
 * Single-file HTML exporter.
 *
 * Post-processes each already-generated chat page (chats/<folder>/index.html)
 * into one portable .html file with the stylesheet + script inlined and all
 * local media embedded as base64 data URIs. The result can be emailed or
 * shared and opens with zero external files. Internal navigation links are
 * neutralized since sibling pages do not travel with a single file.
 *
 * Large media (> maxEmbedMB) is left unembedded to keep file sizes sane.
 */

const fs = require('fs');
const path = require('path');

const EXT_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', mp4: 'video/mp4', '3gp': 'video/3gpp',
  mov: 'video/quicktime', webm: 'video/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg',
  m4a: 'audio/mp4', aac: 'audio/aac', amr: 'audio/amr', wav: 'audio/wav',
  pdf: 'application/pdf', txt: 'text/plain', vcf: 'text/vcard',
};

function mimeOf(file) {
  const ext = (file.split('.').pop() || '').toLowerCase();
  return EXT_MIME[ext] || 'application/octet-stream';
}

function toDataUri(absPath, maxBytes) {
  try {
    const stat = fs.statSync(absPath);
    if (stat.size > maxBytes) return null;
    const buf = fs.readFileSync(absPath);
    return `data:${mimeOf(absPath)};base64,${buf.toString('base64')}`;
  } catch (_) {
    return null;
  }
}

function exportSingleFile(chats, outputDir, opts = {}) {
  const maxEmbedMB = opts.maxEmbedMB || 40;
  const maxBytes = maxEmbedMB * 1024 * 1024;
  const dir = path.join(outputDir, 'exports', 'singlefile');
  fs.mkdirSync(dir, { recursive: true });

  const css = fs.readFileSync(path.join(outputDir, 'assets', 'styles.css'), 'utf8');
  const appjs = fs.readFileSync(path.join(outputDir, 'assets', 'app.js'), 'utf8');

  for (const c of chats) {
    const chatDir = path.join(outputDir, 'chats', c.folderName);
    const srcHtml = path.join(chatDir, 'index.html');
    if (!fs.existsSync(srcHtml)) continue;
    let html = fs.readFileSync(srcHtml, 'utf8');

    // Inline stylesheet + script.
    html = html.replace(
      /<link rel="stylesheet" href="\.\.\/\.\.\/assets\/styles\.css">/,
      `<style>\n${css}\n</style>`
    );
    html = html.replace(
      /<script src="\.\.\/\.\.\/assets\/app\.js"><\/script>/,
      `<script>\n${appjs}\n</script>`
    );

    // Rewrite src/href attributes.
    html = html.replace(/(src|href)="([^"]+)"/g, (full, attr, val) => {
      if (/^(https?:|data:|mailto:|#)/i.test(val)) return full;
      if (val.endsWith('.html') || val.startsWith('../../')) return `${attr}="#"`;
      // Local media / avatar relative to the chat dir.
      const abs = path.join(chatDir, val);
      const uri = toDataUri(abs, maxBytes);
      return uri ? `${attr}="${uri}"` : full;
    });

    fs.writeFileSync(path.join(dir, `${c.folderName}.html`), html);
  }
  return dir;
}

module.exports = { exportSingleFile, mimeOf };
