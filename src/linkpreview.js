'use strict';

/**
 * Lightweight Open Graph / link-preview scraper.
 *
 * Fetches the first ~256 KB of a URL and extracts og:title / og:description /
 * og:image (falling back to <title> / <meta name=description>). Results are
 * cached in-memory per run and can be persisted to disk by the caller.
 *
 * Runs on the user's machine (direct egress). All failures resolve to null —
 * a missing preview never breaks a backup. Dependency-free (stdlib only).
 */

const https = require('https');
const http = require('http');

const MAX_BYTES = 256 * 1024;

function hostOf(url) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch (_) { return ''; }
}

function metaContent(html, patterns) {
  for (const re of patterns) {
    const m = re.exec(html);
    if (m && m[1]) return m[1].trim();
  }
  return '';
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x2F;/g, '/');
}

function extractOg(html, url) {
  const title = metaContent(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    /<title[^>]*>([^<]+)<\/title>/i,
  ]);
  const description = metaContent(html, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
  ]);
  let image = metaContent(html, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
  ]);
  if (image && image.startsWith('//')) image = `https:${image}`;
  if (image && image.startsWith('/')) {
    try { image = new URL(image, url).href; } catch (_) { image = ''; }
  }
  if (!title && !description && !image) return null;
  return {
    url,
    host: hostOf(url),
    title: decodeEntities(title),
    description: decodeEntities(description),
    image,
  };
}

function fetchPreview(url, cache, timeoutMs = 10000) {
  if (cache && cache.has(url)) return Promise.resolve(cache.get(url));
  return new Promise((resolve) => {
    const done = (val) => { if (cache) cache.set(url, val); resolve(val); };
    let mod;
    try { mod = url.startsWith('https:') ? https : http; } catch (_) { return done(null); }
    try {
      const req = mod.get(url, {
        timeout: timeoutMs,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; whatsapp-html-backup/2.0)' },
      }, (res) => {
        const ct = (res.headers['content-type'] || '');
        if (res.statusCode !== 200 || !/text\/html/i.test(ct)) { res.resume(); return done(null); }
        let buf = '';
        let bytes = 0;
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          bytes += chunk.length;
          buf += chunk;
          if (bytes >= MAX_BYTES) { res.destroy(); }
        });
        res.on('end', () => done(extractOg(buf, url)));
        res.on('close', () => done(extractOg(buf, url)));
      });
      req.on('timeout', () => { req.destroy(); done(null); });
      req.on('error', () => done(null));
    } catch (_) {
      done(null);
    }
    return undefined;
  });
}

module.exports = { fetchPreview, hostOf };
