'use strict';

/**
 * Media download + persistence.
 *
 * Downloads the binary attached to a WhatsApp message (image, video, voice
 * note, document, sticker), writes it into the chat's media folder with a
 * sensible filename + extension, and returns metadata the renderer uses to
 * embed/link it. Files are de-duplicated by content hash so a forwarded image
 * shared across chats is not stored many times within the same chat.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { humanFileSize, log } = require('./utils');

// Minimal mimetype -> extension map, covering the common WhatsApp payloads.
const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/ogg; codecs=opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'audio/wav': 'wav',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/vcard': 'vcf',
  'text/x-vcard': 'vcf',
};

/** Best-effort extension from mimetype, falling back to a filename or "bin". */
function extFromMime(mimetype, fallbackName) {
  if (mimetype) {
    const key = mimetype.toLowerCase().trim();
    if (MIME_EXT[key]) return MIME_EXT[key];
    const base = key.split(';')[0].trim();
    if (MIME_EXT[base]) return MIME_EXT[base];
    const slash = base.split('/')[1];
    if (slash && /^[a-z0-9]+$/.test(slash)) return slash;
  }
  if (fallbackName && fallbackName.includes('.')) {
    return fallbackName.split('.').pop().toLowerCase();
  }
  return 'bin';
}

/** High-level kind used by the renderer to choose an HTML element. */
function kindFromMime(mimetype) {
  if (!mimetype) return 'file';
  const m = mimetype.toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'file';
}

/**
 * Download and persist the media for a single message.
 *
 * @param {import('whatsapp-web.js').Message} msg
 * @param {string} mediaDir  Absolute path to the chat's media folder.
 * @param {Map<string,object>} hashCache  Per-chat dedupe cache (hash -> meta).
 * @returns {Promise<object|null>} media metadata or null when nothing saved.
 */
async function downloadMessageMedia(msg, mediaDir, hashCache) {
  if (!msg.hasMedia) return null;

  let media;
  try {
    media = await msg.downloadMedia();
  } catch (err) {
    log.warn(`Could not download media for message ${msg.id ? msg.id._serialized : '?'}: ${err.message}`);
    return { error: true, reason: err.message };
  }

  if (!media || !media.data) {
    return { error: true, reason: 'empty media payload' };
  }

  const buffer = Buffer.from(media.data, 'base64');
  const hash = crypto.createHash('sha1').update(buffer).digest('hex');

  // De-dupe within the chat.
  if (hashCache.has(hash)) {
    return hashCache.get(hash);
  }

  fs.mkdirSync(mediaDir, { recursive: true });

  const ext = extFromMime(media.mimetype, media.filename);
  const kind = kindFromMime(media.mimetype);
  const fileName = `${kind}_${hash.slice(0, 12)}.${ext}`;
  const absPath = path.join(mediaDir, fileName);

  if (!fs.existsSync(absPath)) {
    fs.writeFileSync(absPath, buffer);
  }

  const meta = {
    error: false,
    kind,
    mimetype: media.mimetype || 'application/octet-stream',
    // Path relative to the chat HTML file (which lives one level above media/).
    relPath: `media/${fileName}`,
    originalName: media.filename || null,
    size: buffer.length,
    sizeHuman: humanFileSize(buffer.length),
    isVoiceNote: msg.type === 'ptt',
  };

  hashCache.set(hash, meta);
  return meta;
}

module.exports = { downloadMessageMedia, extFromMime, kindFromMime };
