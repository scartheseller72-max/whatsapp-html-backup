'use strict';

/**
 * Chat + message extraction layer (v2).
 *
 * Read-only against the account. Selects chats, normalizes messages (now with
 * mentions, polls, starred/edited flags, link previews), downloads media, and
 * gathers per-chat extras: profile-picture avatar, group participants, and a
 * flat media list for the gallery page. Supports incremental fetch via a
 * `sinceTimestamp` lower bound.
 */

const path = require('path');
const { downloadMessageMedia, downloadUrl } = require('./media');
const { fetchPreview } = require('./linkpreview');
const {
  tsToDate, safeFilename, sleep, log,
} = require('./utils');

/** Strip everything but letters/digits (any script) for fuzzy name matching. */
function normalizeForMatch(str) {
  return String(str || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function chatMatchesSelection(chat, selection) {
  if (!selection || selection.length === 0) return true;
  const nameNorm = normalizeForMatch(chat.name);
  const number = (chat.id && chat.id.user ? chat.id.user : '').toLowerCase();
  return selection.some((sel) => {
    const s = normalizeForMatch(sel);
    const digits = String(sel).replace(/\D/g, '');
    return (nameNorm && s && nameNorm.includes(s)) || (digits && number.includes(digits));
  });
}

async function resolveContactName(contact) {
  if (!contact) return 'Unknown';
  return (
    contact.name || contact.pushname || contact.shortName
    || (contact.number ? `+${contact.number}` : null)
    || (contact.id && contact.id.user ? `+${contact.id.user}` : 'Unknown')
  );
}

/** Resolve @mentions on a message to display names. */
async function resolveMentions(msg, client) {
  const ids = msg.mentionedIds || [];
  if (!ids.length) return null;
  const out = [];
  for (const id of ids) {
    const serialized = typeof id === 'string' ? id : (id && id._serialized);
    if (!serialized) continue;
    const number = serialized.split('@')[0];
    let name = number;
    try {
      // eslint-disable-next-line no-await-in-loop
      const c = await client.getContactById(serialized);
      name = await resolveContactName(c);
    } catch (_) { /* fall back to number */ }
    out.push({ number, name });
  }
  return out.length ? out : null;
}

const SYSTEM_TYPES = new Set([
  'notification_template', 'gp2', 'e2e_notification', 'call_log',
  'group_notification', 'broadcast_notification', 'protocol',
]);

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
    mentions: null,
    poll: null,
    linkPreview: null,
    starred: !!msg.isStarred,
    edited: !!(msg._data && (msg._data.isEdited || msg._data.latestEditMsgKey)),
    isForwarded: !!msg.isForwarded,
    isDeleted: msg.type === 'revoked',
    system: SYSTEM_TYPES.has(msg.type),
  };

  // Sender
  if (msg.fromMe) {
    out.senderName = 'You';
  } else if (ctx.isGroup) {
    try { out.senderName = await resolveContactName(await msg.getContact()); }
    catch (_) { out.senderName = msg.author || 'Unknown'; }
  } else {
    out.senderName = ctx.chatName;
  }

  // Quoted
  if (msg.hasQuotedMsg) {
    try {
      const q = await msg.getQuotedMessage();
      let qSender = 'You';
      if (!q.fromMe) {
        try { qSender = await resolveContactName(await q.getContact()); }
        catch (_) { qSender = ctx.isGroup ? (q.author || 'Unknown') : ctx.chatName; }
      }
      out.quoted = { sender: qSender, body: q.body || '', type: q.type, hasMedia: !!q.hasMedia };
    } catch (_) { /* gone */ }
  }

  // Mentions
  if (ctx.client && msg.mentionedIds && msg.mentionedIds.length) {
    out.mentions = await resolveMentions(msg, ctx.client);
  }

  // Poll
  if (msg.type === 'poll_creation' || msg.pollName) {
    const opts = (msg.pollOptions || []).map((o) => ({ name: o.name || o.optionName || String(o) }));
    out.poll = { question: msg.pollName || 'Poll', options: opts };
  }

  // Location
  if (msg.location) {
    out.location = {
      lat: msg.location.latitude,
      lng: msg.location.longitude,
      description: msg.location.description || msg.location.name || '',
    };
  }

  // vCards
  if (msg.vCards && msg.vCards.length) {
    out.vcards = msg.vCards.map((vc) => {
      const fn = /FN:(.+)/i.exec(vc);
      const tel = /TEL[^:]*:(.+)/i.exec(vc);
      return { name: fn ? fn[1].trim() : 'Contact', tel: tel ? tel[1].trim() : '' };
    });
  }

  // Reactions
  try {
    if (typeof msg.getReactions === 'function') {
      const rs = await msg.getReactions();
      if (rs && rs.length) {
        out.reactions = rs
          .filter((r) => r.aggregateEmoji || r.reaction)
          .map((r) => ({ emoji: r.aggregateEmoji || r.reaction, count: r.senders ? r.senders.length : 1 }));
        if (!out.reactions.length) out.reactions = null;
      }
    }
  } catch (_) { /* unsupported */ }

  // Media
  if (ctx.downloadMedia && msg.hasMedia) {
    out.media = await downloadMessageMedia(msg, ctx.mediaDir, ctx.hashCache);
  } else if (msg.hasMedia) {
    out.media = { skipped: true, kind: 'file' };
  }

  // Link preview (only for plain text messages that contain links)
  if (ctx.linkPreviews && !msg.hasMedia && msg.links && msg.links.length) {
    const first = msg.links[0];
    const url = typeof first === 'string' ? first : (first && first.link);
    if (url) {
      try { out.linkPreview = await fetchPreview(url, ctx.linkCache); }
      catch (_) { /* ignore */ }
    }
  }

  return out;
}

/** Download a chat's profile picture into its folder. Returns rel path or null. */
async function fetchAvatar(chat, client, chatDir) {
  try {
    let url = null;
    if (typeof chat.getContact === 'function') {
      const contact = await chat.getContact();
      if (contact && typeof contact.getProfilePicUrl === 'function') {
        url = await contact.getProfilePicUrl();
      }
    }
    if (!url) return null;
    const dest = path.join(chatDir, 'avatar.jpg');
    const saved = await downloadUrl(url, dest);
    return saved ? 'avatar.jpg' : null;
  } catch (_) {
    return null;
  }
}

/** Resolve group participants into a renderable members list. */
async function fetchMembers(chat, client) {
  if (!chat.isGroup || !chat.participants) return null;
  const members = [];
  for (const p of chat.participants) {
    const serialized = p.id && p.id._serialized;
    let name = (p.id && p.id.user) ? `+${p.id.user}` : 'Unknown';
    try {
      // eslint-disable-next-line no-await-in-loop
      if (serialized) name = await resolveContactName(await client.getContactById(serialized));
    } catch (_) { /* fallback */ }
    members.push({
      name,
      number: (p.id && p.id.user) ? `+${p.id.user}` : '',
      isAdmin: !!p.isAdmin || !!p.isSuperAdmin,
      isSuperAdmin: !!p.isSuperAdmin,
      avatarRel: null,
    });
  }
  members.sort((a, b) => (b.isAdmin - a.isAdmin) || a.name.localeCompare(b.name));
  return members;
}

async function processChat(chat, opts, client) {
  const isGroup = !!chat.isGroup;
  const chatName = chat.name || (chat.id && chat.id.user ? `+${chat.id.user}` : 'Unknown');
  const folderName = safeFilename(chatName, isGroup ? 'group' : 'chat');
  const chatDir = path.join(opts.outputDir, 'chats', folderName);
  const mediaDir = path.join(chatDir, 'media');

  const fetchLimit = opts.maxMessagesPerChat && opts.maxMessagesPerChat > 0
    ? opts.maxMessagesPerChat : Infinity;

  let raw = [];
  try {
    raw = await chat.fetchMessages({ limit: fetchLimit });
  } catch (err) {
    log.warn(`fetchMessages failed for "${chatName}": ${err.message}`);
    return {
      messages: [], counts: { total: 0, media: 0 }, chatName, folderName, isGroup,
      mediaItems: [], members: null, avatarRel: null,
    };
  }

  const fromSec = opts.dateFrom ? Math.floor(opts.dateFrom.getTime() / 1000) : null;
  const toSec = opts.dateTo ? Math.floor(opts.dateTo.getTime() / 1000) : null;
  const sinceSec = opts.sinceTimestamp || null;
  const filtered = raw.filter((m) => {
    if (fromSec !== null && m.timestamp < fromSec) return false;
    if (toSec !== null && m.timestamp > toSec) return false;
    if (sinceSec !== null && m.timestamp <= sinceSec) return false;
    return true;
  });

  const ctx = {
    isGroup,
    chatName,
    client,
    downloadMedia: opts.downloadMedia,
    linkPreviews: opts.linkPreviews,
    linkCache: opts.linkCache,
    mediaDir,
    hashCache: new Map(),
  };

  if (opts.onChatStart) opts.onChatStart(chatName, filtered.length);

  const messages = [];
  let mediaCount = 0;
  const mediaItems = [];
  for (const m of filtered) {
    if (opts.shouldStop && opts.shouldStop()) break;
    // eslint-disable-next-line no-await-in-loop
    const norm = await normalizeMessage(m, ctx);
    if (norm.media && !norm.media.error && !norm.media.skipped) {
      mediaCount += 1;
      mediaItems.push({ kind: norm.media.kind, relPath: norm.media.relPath, originalName: norm.media.originalName });
    }
    messages.push(norm);
    if (opts.throttleMs) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(opts.throttleMs);
    }
    if (opts.onMessage) opts.onMessage();
  }

  if (opts.onChatEnd) opts.onChatEnd(chatName, messages.length);

  messages.sort((a, b) => a.timestamp - b.timestamp);

  // Per-chat extras
  let avatarRel = null;
  let members = null;
  if (opts.downloadAvatars !== false) avatarRel = await fetchAvatar(chat, client, chatDir);
  if (isGroup) members = await fetchMembers(chat, client);

  return {
    messages,
    counts: { total: messages.length, media: mediaCount },
    chatName,
    folderName,
    isGroup,
    mediaItems,
    members,
    avatarRel,
    lastTimestamp: messages.length ? messages[messages.length - 1].timestamp : (opts.sinceTimestamp || 0),
  };
}

async function selectChats(client, opts) {
  const all = await client.getChats();
  return all.filter((chat) => {
    if (!opts.includeGroups && chat.isGroup) return false;
    if (!opts.includeStatus && chat.id && chat.id._serialized === 'status@broadcast') return false;
    return chatMatchesSelection(chat, opts.chats);
  });
}

module.exports = {
  selectChats, processChat, resolveContactName, chatMatchesSelection,
};
