'use strict';

/**
 * Chat + message extraction layer.
 *
 * Walks the WhatsApp Web store, applies chat selection + date-range filters,
 * normalizes each message into a plain object the renderer understands, and
 * triggers media downloads. Everything here is read-only against the account.
 */

const path = require('path');
const { downloadMessageMedia } = require('./media');
const { tsToDate, safeFilename, sleep, log } = require('./utils');

/**
 * Decide whether a chat should be included based on the selection list.
 * Matching is case-insensitive against the chat name and the bare number.
 */
function chatMatchesSelection(chat, selection) {
  if (!selection || selection.length === 0) return true;
  const name = (chat.name || '').toLowerCase();
  const number = (chat.id && chat.id.user ? chat.id.user : '').toLowerCase();
  return selection.some((sel) => {
    const s = String(sel).toLowerCase().replace(/[^a-z0-9]/gi, '');
    const nameNorm = name.replace(/[^a-z0-9]/gi, '');
    return (
      (nameNorm && nameNorm.includes(s)) ||
      (number && number.includes(s.replace(/\D/g, '')) && s.replace(/\D/g, '') !== '')
    );
  });
}

/** Resolve a friendly display name for a contact, with graceful fallbacks. */
async function resolveContactName(contact) {
  if (!contact) return 'Unknown';
  return (
    contact.name ||
    contact.pushname ||
    contact.shortName ||
    (contact.number ? `+${contact.number}` : null) ||
    (contact.id && contact.id.user ? `+${contact.id.user}` : 'Unknown')
  );
}

/**
 * Normalize a single whatsapp-web.js Message into a plain object.
 * Resolves sender name (for groups), quoted message, reactions, location and
 * vCards, and downloads any attached media.
 */
async function normalizeMessage(msg, ctx) {
  const date = tsToDate(msg.timestamp);

  const out = {
    id: msg.id ? msg.id._serialized : null,
    timestamp: msg.timestamp,
    date,
    fromMe: !!msg.fromMe,
    type: msg.type,
    body: msg.body || '',
    senderName: null,
    media: null,
    quoted: null,
    location: null,
    vcards: null,
    reactions: null,
    isForwarded: !!msg.isForwarded,
    isDeleted: msg.type === 'revoked',
    system: false,
  };

  // System / notification messages (group changes, e2e notices, calls, etc.).
  const SYSTEM_TYPES = new Set([
    'notification_template', 'gp2', 'e2e_notification', 'call_log',
    'group_notification', 'broadcast_notification', 'protocol',
  ]);
  if (SYSTEM_TYPES.has(msg.type)) {
    out.system = true;
  }

  // Sender name resolution.
  if (msg.fromMe) {
    out.senderName = 'You';
  } else if (ctx.isGroup) {
    try {
      const contact = await msg.getContact();
      out.senderName = await resolveContactName(contact);
    } catch (_) {
      out.senderName = msg.author || 'Unknown';
    }
  } else {
    out.senderName = ctx.chatName;
  }

  // Quoted / replied-to message.
  if (msg.hasQuotedMsg) {
    try {
      const q = await msg.getQuotedMessage();
      let qSender = 'You';
      if (!q.fromMe) {
        try {
          const qc = await q.getContact();
          qSender = await resolveContactName(qc);
        } catch (_) {
          qSender = ctx.isGroup ? (q.author || 'Unknown') : ctx.chatName;
        }
      }
      out.quoted = {
        sender: qSender,
        body: q.body || '',
        type: q.type,
        hasMedia: !!q.hasMedia,
      };
    } catch (_) {
      /* quoted message no longer available */
    }
  }

  // Location.
  if (msg.location) {
    out.location = {
      lat: msg.location.latitude,
      lng: msg.location.longitude,
      description: msg.location.description || msg.location.name || '',
    };
  }

  // Shared contact cards.
  if (msg.vCards && msg.vCards.length) {
    out.vcards = msg.vCards.map((vc) => {
      const fnMatch = /FN:(.+)/i.exec(vc);
      const telMatch = /TEL[^:]*:(.+)/i.exec(vc);
      return {
        name: fnMatch ? fnMatch[1].trim() : 'Contact',
        tel: telMatch ? telMatch[1].trim() : '',
      };
    });
  }

  // Reactions (available on newer whatsapp-web.js versions).
  try {
    if (typeof msg.getReactions === 'function') {
      const reactions = await msg.getReactions();
      if (reactions && reactions.length) {
        out.reactions = reactions
          .filter((r) => r.aggregateEmoji || r.reaction)
          .map((r) => ({
            emoji: r.aggregateEmoji || r.reaction,
            count: r.senders ? r.senders.length : 1,
          }));
        if (out.reactions.length === 0) out.reactions = null;
      }
    }
  } catch (_) {
    /* reactions unsupported on this version */
  }

  // Media download.
  if (ctx.downloadMedia && msg.hasMedia) {
    out.media = await downloadMessageMedia(msg, ctx.mediaDir, ctx.hashCache);
  } else if (msg.hasMedia) {
    out.media = { skipped: true, kind: 'file' };
  }

  return out;
}

/**
 * Fetch + normalize all (filtered) messages for one chat.
 *
 * @returns {Promise<{messages: object[], counts: object}>}
 */
async function processChat(chat, opts) {
  const isGroup = !!chat.isGroup;
  const chatName = chat.name || (chat.id && chat.id.user ? `+${chat.id.user}` : 'Unknown');
  const folderName = safeFilename(chatName, isGroup ? 'group' : 'chat');
  const chatDir = path.join(opts.outputDir, 'chats', folderName);
  const mediaDir = path.join(chatDir, 'media');

  const fetchLimit = opts.maxMessagesPerChat && opts.maxMessagesPerChat > 0
    ? opts.maxMessagesPerChat
    : Infinity;

  let raw = [];
  try {
    raw = await chat.fetchMessages({ limit: fetchLimit });
  } catch (err) {
    log.warn(`fetchMessages failed for "${chatName}": ${err.message}`);
    return { messages: [], counts: { total: 0, media: 0 }, chatName, folderName, isGroup };
  }

  // Date-range filter (timestamps are seconds).
  const fromSec = opts.dateFrom ? Math.floor(opts.dateFrom.getTime() / 1000) : null;
  const toSec = opts.dateTo ? Math.floor(opts.dateTo.getTime() / 1000) : null;
  const filtered = raw.filter((m) => {
    if (fromSec !== null && m.timestamp < fromSec) return false;
    if (toSec !== null && m.timestamp > toSec) return false;
    return true;
  });

  const ctx = {
    isGroup,
    chatName,
    downloadMedia: opts.downloadMedia,
    mediaDir,
    hashCache: new Map(),
  };

  const messages = [];
  let mediaCount = 0;
  for (const m of filtered) {
    // eslint-disable-next-line no-await-in-loop
    const norm = await normalizeMessage(m, ctx);
    if (norm.media && !norm.media.error && !norm.media.skipped) mediaCount += 1;
    messages.push(norm);
    if (opts.throttleMs) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(opts.throttleMs);
    }
  }

  // Oldest first for natural reading order.
  messages.sort((a, b) => a.timestamp - b.timestamp);

  return {
    messages,
    counts: { total: messages.length, media: mediaCount },
    chatName,
    folderName,
    isGroup,
  };
}

/**
 * Enumerate chats, apply selection + type filters, and yield those to back up.
 */
async function selectChats(client, opts) {
  const all = await client.getChats();
  const selected = all.filter((chat) => {
    if (!opts.includeGroups && chat.isGroup) return false;
    if (!opts.includeStatus && chat.id && chat.id._serialized === 'status@broadcast') return false;
    return chatMatchesSelection(chat, opts.chats);
  });
  return selected;
}

module.exports = { selectChats, processChat, resolveContactName };
