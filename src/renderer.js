'use strict';

/**
 * HTML rendering layer.
 *
 * Turns the normalized chat/message objects into a Telegram-style static site:
 *   output/
 *     index.html                  (landing page: searchable chat list)
 *     assets/styles.css           (shared theme)
 *     chats/<chat>/index.html      (one page per chat)
 *     chats/<chat>/media/...        (downloaded attachments)
 */

const fs = require('fs');
const path = require('path');
const {
  escapeHtml, formatMessageText, formatTime, formatDayHeader, dayKey, formatFull,
} = require('./utils');

const SENDER_VARS = [
  'var(--sender-1)', 'var(--sender-2)', 'var(--sender-3)', 'var(--sender-4)',
  'var(--sender-5)', 'var(--sender-6)', 'var(--sender-7)', 'var(--sender-8)',
];

function senderColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SENDER_VARS[h % SENDER_VARS.length];
}

function initials(name) {
  const clean = String(name || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim();
  if (!clean) return '#';
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Render the attachment portion of a message bubble. */
function renderMedia(media, type) {
  if (!media) return '';
  if (media.skipped) {
    return `<div class="media-missing">[media not downloaded — run with media enabled]</div>`;
  }
  if (media.error) {
    return `<div class="media-missing">[media unavailable: ${escapeHtml(media.reason || 'download failed')}]</div>`;
  }
  const src = escapeHtml(media.relPath);

  if (media.kind === 'image') {
    return `<div class="media-img"><img src="${src}" loading="lazy" alt="image" onclick="openLightbox(this.src)"></div>`;
  }
  if (media.kind === 'video') {
    return `<div class="media-video"><video controls preload="none" src="${src}"></video></div>`;
  }
  if (media.kind === 'audio') {
    const tag = media.isVoiceNote || type === 'ptt'
      ? '<span class="vn-tag">voice note</span>' : '';
    return `<div class="media-audio voice-note"><audio controls preload="none" src="${src}"></audio>${tag}</div>`;
  }
  const ext = (media.relPath.split('.').pop() || 'file').slice(0, 4);
  const name = escapeHtml(media.originalName || `file.${ext}`);
  return `<a class="media-file" href="${src}" target="_blank" rel="noopener noreferrer" download>
      <span class="fi">${escapeHtml(ext)}</span>
      <span class="fmeta"><span class="fname">${name}</span><br><span class="fsize">${escapeHtml(media.sizeHuman || '')}</span></span>
    </a>`;
}

/** Render one normalized message into a chat row. */
function renderMessage(msg, isGroup) {
  const time = formatTime(msg.date);

  if (msg.system) {
    const body = msg.body ? formatMessageText(msg.body) : '(system message)';
    return `<div class="row system"><div class="system-msg">${body}</div></div>`;
  }

  const side = msg.fromMe ? 'out' : 'in';
  let inner = '';

  if (msg.isForwarded) inner += `<div class="fwd">Forwarded</div>`;

  if (isGroup && !msg.fromMe) {
    inner += `<div class="sender" style="color:${senderColor(msg.senderName)}">${escapeHtml(msg.senderName)}</div>`;
  }

  if (msg.quoted) {
    const qBody = msg.quoted.body
      ? formatMessageText(msg.quoted.body)
      : (msg.quoted.hasMedia ? '[media]' : '');
    inner += `<div class="quoted"><span class="q-sender">${escapeHtml(msg.quoted.sender)}</span><span class="q-body">${qBody}</span></div>`;
  }

  if (msg.isDeleted) {
    inner += `<div class="text deleted">This message was deleted</div>`;
  } else {
    if (msg.media) inner += renderMedia(msg.media, msg.type);

    if (msg.location) {
      const { lat, lng, description } = msg.location;
      const label = description ? escapeHtml(description) : `${lat}, ${lng}`;
      inner += `<div class="location"><a href="https://maps.google.com/?q=${lat},${lng}" target="_blank" rel="noopener noreferrer">📍 ${label}</a></div>`;
    }

    if (msg.vcards) {
      for (const vc of msg.vcards) {
        inner += `<div class="vcard">${escapeHtml(vc.name)}${vc.tel ? ` · ${escapeHtml(vc.tel)}` : ''}</div>`;
      }
    }

    if (msg.body) {
      const cls = msg.media || msg.location || msg.vcards ? 'text caption' : 'text';
      inner += `<div class="${cls}">${formatMessageText(msg.body)}</div>`;
    }
  }

  if (msg.reactions && msg.reactions.length) {
    const r = msg.reactions
      .map((x) => `<span class="react">${escapeHtml(x.emoji)}${x.count > 1 ? ` ${x.count}` : ''}</span>`)
      .join('');
    inner += `<div class="reactions">${r}</div>`;
  }

  inner += `<span class="meta">${escapeHtml(time)}</span>`;

  return `<div class="row ${side}"><div class="bubble">${inner}</div></div>`;
}

const LIGHTBOX_JS = `
<div class="lightbox" id="lightbox" onclick="this.classList.remove('open')"><img id="lightbox-img" src="" alt=""></div>
<script>
function openLightbox(src){var lb=document.getElementById('lightbox');document.getElementById('lightbox-img').src=src;lb.classList.add('open');}
document.addEventListener('keydown',function(e){if(e.key==='Escape'){var lb=document.getElementById('lightbox');if(lb)lb.classList.remove('open');}});
</script>`;

/** Build the full HTML for a single chat. */
function renderChatPage(chat) {
  const { chatName, isGroup, messages, counts } = chat;
  const rows = [];
  let lastDay = null;
  for (const m of messages) {
    const dk = dayKey(m.date);
    if (dk !== lastDay) {
      rows.push(`<div class="day-sep"><span>${escapeHtml(formatDayHeader(m.date))}</span></div>`);
      lastDay = dk;
    }
    rows.push(renderMessage(m, isGroup));
  }

  const subtitle = isGroup
    ? `Group · ${counts.total} messages`
    : `${counts.total} messages`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(chatName)} — WhatsApp Backup</title>
<link rel="stylesheet" href="../../assets/styles.css">
</head>
<body>
<div class="topbar"><div class="topbar-inner">
  <div class="avatar">${escapeHtml(initials(chatName))}</div>
  <div><div class="title">${escapeHtml(chatName)}</div><div class="subtitle">${escapeHtml(subtitle)}</div></div>
  <div class="back"><a href="../../index.html">All chats</a></div>
</div></div>
<div class="chat">
${rows.join('\n') || '<div class="day-sep"><span>No messages in range</span></div>'}
</div>
${LIGHTBOX_JS}
</body>
</html>`;
}

/** Build the landing page that lists every backed-up chat. */
function renderIndexPage(summaries, meta) {
  const cards = summaries
    .map((s) => {
      const prev = s.lastPreview ? escapeHtml(s.lastPreview) : '<em>no messages</em>';
      const when = s.lastDate ? escapeHtml(formatFull(s.lastDate)) : '';
      return `<a class="chat-card" href="chats/${encodeURIComponent(s.folderName)}/index.html" data-name="${escapeHtml(s.chatName.toLowerCase())}">
  <div class="avatar">${escapeHtml(initials(s.chatName))}</div>
  <div class="cc-body">
    <div class="cc-name">${escapeHtml(s.chatName)} ${s.isGroup ? '<span class="tag-group">· group</span>' : ''}</div>
    <div class="cc-prev">${prev}</div>
  </div>
  <div class="cc-side"><div>${when}</div><div class="badge">${s.total}</div></div>
</a>`;
    })
    .join('\n');

  const range = meta.dateFrom || meta.dateTo
    ? `Range: ${meta.dateFrom || '…'} → ${meta.dateTo || '…'} · `
    : '';

  const logo = meta.hasLogo
    ? `<img src="assets/logo.png" alt="logo">`
    : `<div class="avatar">WA</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WhatsApp Backup — ${meta.totalChats} chats</title>
<link rel="stylesheet" href="assets/styles.css">
</head>
<body>
<div class="index-head">
  <div class="brand">${logo}<div><h1>WhatsApp Chat Backup</h1>
  <div class="meta-line">${range}${meta.totalChats} chats · ${meta.totalMessages} messages · generated ${escapeHtml(meta.generatedAt)}</div></div></div>
</div>
<div class="search-wrap"><input id="chat-search" type="text" placeholder="Search chats…" oninput="filterChats(this.value)"></div>
<div class="chat-list" id="chat-list">
${cards || '<div class="footer">No chats matched your filters.</div>'}
</div>
<div class="footer">Generated by whatsapp-html-backup · This archive is for your personal records.</div>
<script>
function filterChats(q){q=(q||'').toLowerCase().trim();var cards=document.querySelectorAll('.chat-card');cards.forEach(function(c){var n=c.getAttribute('data-name')||'';c.style.display=(!q||n.indexOf(q)!==-1)?'':'none';});}
</script>
</body>
</html>`;
}

/** Copy the shared stylesheet (and logo if present) into output/assets. */
function writeAssets(outputDir, logoSourcePath) {
  const assetsDir = path.join(outputDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'templates', 'styles.css'), path.join(assetsDir, 'styles.css'));
  let hasLogo = false;
  if (logoSourcePath && fs.existsSync(logoSourcePath)) {
    fs.copyFileSync(logoSourcePath, path.join(assetsDir, 'logo.png'));
    hasLogo = true;
  }
  return { hasLogo };
}

module.exports = {
  renderChatPage,
  renderIndexPage,
  writeAssets,
  initials,
};
