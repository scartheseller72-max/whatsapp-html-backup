'use strict';

/**
 * HTML rendering layer (v2).
 *
 * Emits a Telegram-style static site with, per chat:
 *   index.html     (messages, with search toolbar + jump-to-month)
 *   gallery.html   (media grid)
 *   stats.html     (per-chat analytics)
 *   members.html   (group participants — groups only)
 * plus a top-level index.html (chat list) and stats.html (global analytics),
 * a shared assets/ folder (styles.css, app.js, logo.png), and a light/dark
 * theme toggle persisted in localStorage.
 */

const fs = require('fs');
const path = require('path');
const {
  escapeHtml, formatMessageText, formatTime, formatDayHeader, dayKey, formatFull,
  monthKey, monthLabel, weekdayName, pct, truncate, WEEKDAYS,
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

function avatarHtml(name, avatarRel) {
  if (avatarRel) return `<div class="avatar"><img src="${escapeHtml(avatarRel)}" alt=""></div>`;
  return `<div class="avatar">${escapeHtml(initials(name))}</div>`;
}

const FAVICON = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Ctext y=%22.9em%22 font-size=%2290%22%3E%F0%9F%92%AC%3C/text%3E%3C/svg%3E';

const LIGHTBOX = `<div class="lightbox" id="lightbox" role="dialog" aria-label="Image viewer" aria-hidden="true">
  <button class="lb-btn lb-close" onclick="closeLightbox()" aria-label="Close">✕</button>
  <button class="lb-btn lb-prev" onclick="lightboxStep(-1)" aria-label="Previous image">‹</button>
  <img id="lightbox-img" src="" alt="">
  <button class="lb-btn lb-next" onclick="lightboxStep(1)" aria-label="Next image">›</button>
  <div class="lb-counter" id="lb-counter"></div>
</div>`;

/** Wrap a full page with the shared head/theme/lightbox/app.js. */
function pageShell({ title, cssPrefix, body, withChrome }) {
  const p = cssPrefix || '';
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="${FAVICON}">
<link rel="stylesheet" href="${p}assets/styles.css">
<script>(function(){var t=null;try{t=localStorage.getItem('wa-theme')}catch(e){}
if(!t&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)t='light';
if(t)document.documentElement.setAttribute('data-theme',t);})();</script>
</head>
<body>
${body}
${withChrome ? LIGHTBOX : ''}
<button class="to-top" id="to-top" onclick="window.scrollTo({top:0,behavior:'smooth'})" aria-label="Back to top" hidden>↑</button>
<script src="${p}assets/app.js"></script>
</body>
</html>`;
}

/* ---------------- Message rendering ---------------- */

function renderMedia(media, type) {
  if (!media) return '';
  if (media.skipped) return `<div class="media-missing">[media not downloaded]</div>`;
  if (media.error) return `<div class="media-missing">[media unavailable: ${escapeHtml(media.reason || 'failed')}]</div>`;
  const src = escapeHtml(media.relPath);
  if (media.kind === 'image') {
    return `<div class="media-img"><img src="${src}" loading="lazy" alt="image" onclick="openLightbox(this.src)"></div>`;
  }
  if (media.kind === 'video') {
    return `<div class="media-video"><video controls preload="none" src="${src}"></video></div>`;
  }
  if (media.kind === 'audio') {
    const tag = (media.isVoiceNote || type === 'ptt') ? '<span class="vn-tag">voice note</span>' : '';
    return `<div class="media-audio voice-note"><audio controls preload="none" src="${src}"></audio>${tag}</div>`;
  }
  const ext = (media.relPath.split('.').pop() || 'file').slice(0, 4);
  const name = escapeHtml(media.originalName || `file.${ext}`);
  return `<a class="media-file" href="${src}" target="_blank" rel="noopener noreferrer" download>
      <span class="fi">${escapeHtml(ext)}</span>
      <span class="fmeta"><span class="fname">${name}</span><br><span class="fsize">${escapeHtml(media.sizeHuman || '')}</span></span>
    </a>`;
}

function applyMentions(html, mentions) {
  if (!mentions || !mentions.length) return html;
  let out = html;
  for (const m of mentions) {
    if (!m.number) continue;
    const re = new RegExp(`@${m.number}`, 'g');
    out = out.replace(re, `<span class="mention">@${escapeHtml(m.name || m.number)}</span>`);
  }
  return out;
}

function renderLinkPreview(lp) {
  if (!lp || !lp.url) return '';
  const img = lp.image ? `<img src="${escapeHtml(lp.image)}" loading="lazy" alt="">` : '';
  const title = lp.title ? `<div class="lp-title">${escapeHtml(truncate(lp.title, 90))}</div>` : '';
  const desc = lp.description ? `<div class="lp-desc">${escapeHtml(truncate(lp.description, 120))}</div>` : '';
  return `<a class="linkprev" href="${escapeHtml(lp.url)}" target="_blank" rel="noopener noreferrer">${img}<div class="lp-body">${title}${desc}<div class="lp-host">${escapeHtml(lp.host || '')}</div></div></a>`;
}

function renderPoll(poll) {
  if (!poll) return '';
  const opts = (poll.options || [])
    .map((o) => `<div class="poll-opt"><span class="dot"></span>${escapeHtml(o.name || o)}</div>`)
    .join('');
  return `<div class="poll"><div class="poll-q">📊 ${escapeHtml(poll.question || 'Poll')}</div>${opts}</div>`;
}

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
    const qBody = msg.quoted.body ? formatMessageText(msg.quoted.body) : (msg.quoted.hasMedia ? '[media]' : '');
    inner += `<div class="quoted"><span class="q-sender">${escapeHtml(msg.quoted.sender)}</span><span class="q-body">${qBody}</span></div>`;
  }

  if (msg.isDeleted) {
    inner += `<div class="text deleted">This message was deleted</div>`;
  } else {
    if (msg.media) inner += renderMedia(msg.media, msg.type);
    if (msg.poll) inner += renderPoll(msg.poll);
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
    if (msg.linkPreview) inner += renderLinkPreview(msg.linkPreview);
    if (msg.body) {
      const cls = (msg.media || msg.location || msg.vcards || msg.poll || msg.linkPreview) ? 'text caption' : 'text';
      inner += `<div class="${cls}">${applyMentions(formatMessageText(msg.body), msg.mentions)}</div>`;
    }
  }

  if (msg.reactions && msg.reactions.length) {
    inner += `<div class="reactions">${msg.reactions
      .map((x) => `<span class="react">${escapeHtml(x.emoji)}${x.count > 1 ? ` ${x.count}` : ''}</span>`)
      .join('')}</div>`;
  }

  const starTag = msg.starred ? '<span class="star-tag">★</span>' : '';
  const editTag = msg.edited ? '<span class="edited-tag">edited</span>' : '';
  inner += `<span class="meta">${escapeHtml(time)}${editTag}${starTag}</span>`;

  return `<div class="row ${side}"><div class="bubble">${inner}</div></div>`;
}

/* ---------------- Chat sub-pages ---------------- */

function themeButton() {
  return '<button id="theme-btn" onclick="toggleTheme()" aria-label="Toggle light/dark theme" title="Toggle theme">◐</button>';
}

function chatChrome(chatName, isGroup, counts, avatarRel, active, hasStats) {
  const link = (href, label, key) => `<a href="${href}" class="${active === key ? 'active' : ''}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`;
  const subnav = [
    link('index.html', 'Messages', 'messages'),
    link('gallery.html', 'Gallery', 'gallery'),
    hasStats ? link('stats.html', 'Stats', 'stats') : '',
    isGroup ? link('members.html', 'Members', 'members') : '',
  ].filter(Boolean).join('');

  const subtitle = isGroup
    ? `Group · ${counts.total.toLocaleString()} messages`
    : `${counts.total.toLocaleString()} messages`;
  return `<header class="topbar"><div class="topbar-inner">
  ${avatarHtml(chatName, avatarRel)}
  <div class="topbar-id"><div class="title">${escapeHtml(chatName)}</div><div class="subtitle">${escapeHtml(subtitle)}</div></div>
  <div class="back">${themeButton()} <a href="../../index.html">← All chats</a></div>
</div></header>
<nav class="subnav" aria-label="Chat sections">${subnav}</nav>`;
}

function renderChatPage(chat) {
  const { chatName, isGroup, messages, counts, avatarRel, hasStats } = chat;

  // Month navigation options.
  const monthsSeen = [];
  const seen = new Set();
  for (const m of messages) {
    if (m.system) continue;
    const k = monthKey(m.date);
    if (!seen.has(k)) { seen.add(k); monthsSeen.push({ key: k, label: monthLabel(m.date) }); }
  }
  const monthOpts = monthsSeen
    .map((mo) => `<option value="${escapeHtml(mo.key)}">${escapeHtml(mo.label)}</option>`)
    .join('');

  const rows = [];
  let lastDay = null;
  let lastMonth = null;
  for (const m of messages) {
    const dk = dayKey(m.date);
    if (dk !== lastDay) {
      const mk = monthKey(m.date);
      const attr = mk !== lastMonth ? ` data-month="${escapeHtml(mk)}"` : '';
      rows.push(`<div class="day-sep"${attr}><span>${escapeHtml(formatDayHeader(m.date))}</span></div>`);
      lastDay = dk; lastMonth = mk;
    }
    rows.push(renderMessage(m, isGroup));
  }

  const toolbar = `<div class="toolbar">
  <input id="chat-search-box" type="search" placeholder="Search in this chat…  ( / )" aria-label="Search in this chat" oninput="runSearch(this.value)">
  <span class="count" id="search-count" aria-live="polite"></span>
  <button onclick="prevMatch()" aria-label="Previous match" title="Previous match (Shift+Enter)">‹</button>
  <button onclick="nextMatch()" aria-label="Next match" title="Next match (Enter)">›</button>
  <span class="spacer"></span>
  ${monthOpts ? `<select onchange="jumpToMonth(this.value)" aria-label="Jump to month"><option value="">Jump to month…</option>${monthOpts}</select>` : ''}
</div>`;

  const body = `${chatChrome(chatName, isGroup, counts, avatarRel, 'messages', hasStats)}
${toolbar}
<div class="chat">
${rows.join('\n') || '<div class="day-sep"><span>No messages in range</span></div>'}
</div>`;

  return pageShell({ title: `${chatName} — WhatsApp Backup`, cssPrefix: '../../', body, withChrome: true });
}

function renderGalleryPage(chat) {
  const { chatName, isGroup, counts, avatarRel, mediaItems, hasStats } = chat;
  const cells = (mediaItems || []).map((mi) => {
    const src = escapeHtml(mi.relPath);
    if (mi.kind === 'image') return `<a href="${src}" onclick="openLightbox(this.href);return false;"><img src="${src}" loading="lazy" alt=""></a>`;
    if (mi.kind === 'video') return `<a href="${src}" target="_blank" rel="noopener noreferrer"><video src="${src}" muted preload="metadata"></video></a>`;
    if (mi.kind === 'audio') return `<a href="${src}" target="_blank" rel="noopener noreferrer" class="g-file">🎵 audio</a>`;
    return `<a href="${src}" target="_blank" rel="noopener noreferrer" class="g-file">📎 ${escapeHtml(truncate(mi.originalName || 'file', 18))}</a>`;
  }).join('');

  const body = `${chatChrome(chatName, isGroup, counts, avatarRel, 'gallery', hasStats)}
<div class="gallery">${cells || '<div class="footer">No media in this chat.</div>'}</div>`;
  return pageShell({ title: `${chatName} — Gallery`, cssPrefix: '../../', body, withChrome: true });
}

function barRows(entries, max, fmtLabel) {
  const top = Math.max(max, 1);
  return entries.map((e) => {
    const w = pct(e.count, top);
    const label = fmtLabel ? fmtLabel(e.key) : e.key;
    return `<div class="bar-row"><span class="bl">${escapeHtml(String(label))}</span><span class="bt"><span class="bf" style="width:${w}%"></span></span><span class="bv">${e.count}</span></div>`;
  }).join('');
}

function renderStatsPage(chat) {
  const { chatName, isGroup, counts, avatarRel, stats } = chat;
  const s = stats;
  const maxWeekday = Math.max(...s.byWeekday, 1);
  const maxHour = Math.max(...s.byHour, 1);

  const weekdayBars = WEEKDAYS.map((wd, i) => ({ key: wd.slice(0, 3), count: s.byWeekday[i] }));
  const hourCells = s.byHour.map((v) => {
    const intensity = v / maxHour;
    const bg = intensity === 0 ? 'var(--bubble-in)'
      : `rgba(100,181,239,${0.15 + intensity * 0.85})`;
    return `<div class="cell" style="background:${bg}" title="${v} msgs"></div>`;
  }).join('');
  const hourAxis = Array.from({ length: 24 }, (_, h) => `<div>${h % 6 === 0 ? h : ''}</div>`).join('');

  const senderBars = barRows(s.topSenders, s.topSenders[0] ? s.topSenders[0].count : 1);
  const monthEntries = Object.entries(s.byMonth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => ({ key: k, count: v }));
  const maxMonth = monthEntries.reduce((mx, e) => Math.max(mx, e.count), 1);
  const monthBars = barRows(monthEntries, maxMonth, (k) => {
    const [y, mo] = k.split('-');
    return `${mo}/${y.slice(2)}`;
  });

  const emojiCloud = s.topEmojis.map((e) => `<div class="ec">${escapeHtml(e.key)}<small>${e.count}</small></div>`).join('');
  const wordChips = s.topWords.map((w) => `<span class="chip">${escapeHtml(w.key)} <b>${w.count}</b></span>`).join('');

  const card = (num, lbl) => `<div class="stat-card"><div class="num">${escapeHtml(String(num))}</div><div class="lbl">${escapeHtml(lbl)}</div></div>`;

  const body = `${chatChrome(chatName, isGroup, counts, avatarRel, 'stats', true)}
<div class="stats-wrap">
  <div class="stats-grid">
    ${card(s.total.toLocaleString(), 'Total messages')}
    ${card(s.fromMe.toLocaleString(), 'Sent by you')}
    ${card(s.fromOthers.toLocaleString(), 'Received')}
    ${card(s.mediaTotal.toLocaleString(), 'Media files')}
    ${card(s.voiceNotes.toLocaleString(), 'Voice notes')}
    ${card(s.activeDays.toLocaleString(), 'Active days')}
    ${card(s.avgPerActiveDay, 'Avg / active day')}
    ${card(`${s.busiestHour}:00`, 'Busiest hour')}
  </div>

  ${isGroup && s.topSenders.length ? `<div class="stats-section"><h3>Most active members</h3>${senderBars}</div>` : ''}

  <div class="stats-section"><h3>Messages by weekday</h3>${barRows(weekdayBars, maxWeekday)}</div>

  <div class="stats-section"><h3>Activity by hour of day</h3>
    <div class="heatmap">${hourCells}</div>
    <div class="heat-axis">${hourAxis}</div>
  </div>

  ${monthEntries.length ? `<div class="stats-section"><h3>Messages by month</h3>${monthBars}</div>` : ''}

  ${emojiCloud ? `<div class="stats-section"><h3>Top emojis</h3><div class="emoji-cloud">${emojiCloud}</div></div>` : ''}

  ${wordChips ? `<div class="stats-section"><h3>Top words</h3><div class="chips">${wordChips}</div></div>` : ''}
</div>`;
  return pageShell({ title: `${chatName} — Stats`, cssPrefix: '../../', body, withChrome: false });
}

function renderMembersPage(chat) {
  const { chatName, counts, avatarRel, members, hasStats } = chat;
  const rows = (members || []).map((m) => {
    const adminBadge = m.isAdmin ? `<span class="badge-admin">${m.isSuperAdmin ? 'creator' : 'admin'}</span>` : '';
    return `<div class="member-row">${avatarHtml(m.name, m.avatarRel)}<div><span class="mname">${escapeHtml(m.name)}</span>${adminBadge}<div class="subtitle">${escapeHtml(m.number || '')}</div></div></div>`;
  }).join('');
  const body = `${chatChrome(chatName, true, counts, avatarRel, 'members', hasStats)}
<div class="members"><div class="footer" style="text-align:left">${(members || []).length} participants</div>${rows}</div>`;
  return pageShell({ title: `${chatName} — Members`, cssPrefix: '../../', body, withChrome: false });
}

/* ---------------- Top-level pages ---------------- */

function renderIndexPage(summaries, meta) {
  const groups = summaries.filter((s) => s.isGroup).length;
  const cards = summaries.map((s) => {
    const prev = s.lastPreview ? escapeHtml(s.lastPreview) : '<em>no messages</em>';
    const when = s.lastDate ? escapeHtml(formatFull(s.lastDate)) : '';
    return `<a class="chat-card" href="chats/${encodeURIComponent(s.folderName)}/index.html" data-name="${escapeHtml(s.chatName.toLowerCase())}" data-kind="${s.isGroup ? 'group' : 'direct'}">
  ${avatarHtml(s.chatName, s.avatarRel)}
  <div class="cc-body">
    <div class="cc-name">${escapeHtml(s.chatName)} ${s.isGroup ? '<span class="tag-group">group</span>' : ''}</div>
    <div class="cc-prev">${prev}</div>
  </div>
  <div class="cc-side"><div class="cc-when">${when}</div><div class="badge">${s.total.toLocaleString()}</div></div>
</a>`;
  }).join('\n');

  const range = (meta.dateFrom || meta.dateTo)
    ? `Range: ${meta.dateFrom || '…'} → ${meta.dateTo || '…'} · ` : '';
  const logo = meta.hasLogo ? `<img src="assets/logo.png" alt="logo">` : `<div class="avatar">WA</div>`;

  const body = `<header class="index-head">
  <div class="brand">${logo}<div><h1>WhatsApp Chat Backup</h1>
  <div class="meta-line">${range}${meta.totalChats} chats · ${meta.totalMessages.toLocaleString()} messages · generated ${escapeHtml(meta.generatedAt)}</div></div>
  <div class="back" style="margin-left:auto">${themeButton()} <a href="stats.html">📊 Overall stats</a></div></div>
</header>
<div class="search-wrap">
  <input id="chat-search" type="search" placeholder="Search chats…  ( / )" aria-label="Search chats" oninput="filterChats()">
  <div class="filter-tabs" role="tablist" aria-label="Chat type filter">
    <button class="ftab active" data-kind="all" onclick="setKindFilter(this)" role="tab" aria-selected="true">All <span>${meta.totalChats}</span></button>
    <button class="ftab" data-kind="direct" onclick="setKindFilter(this)" role="tab" aria-selected="false">Chats <span>${meta.totalChats - groups}</span></button>
    <button class="ftab" data-kind="group" onclick="setKindFilter(this)" role="tab" aria-selected="false">Groups <span>${groups}</span></button>
  </div>
</div>
<main class="chat-list" id="chat-list">
${cards || '<div class="footer">No chats matched your filters.</div>'}
<div class="footer" id="no-results" hidden>No chats match your search.</div>
</main>
<div class="footer">Generated by whatsapp-html-backup · personal archive</div>`;
  return pageShell({ title: `WhatsApp Backup — ${meta.totalChats} chats`, cssPrefix: '', body, withChrome: false });
}

function renderGlobalStatsPage(g, meta) {
  const card = (num, lbl) => `<div class="stat-card"><div class="num">${escapeHtml(String(num))}</div><div class="lbl">${escapeHtml(lbl)}</div></div>`;
  const maxWeekday = Math.max(...g.byWeekday, 1);
  const maxHour = Math.max(...g.byHour, 1);
  const weekdayBars = WEEKDAYS.map((wd, i) => ({ key: wd.slice(0, 3), count: g.byWeekday[i] }));
  const hourCells = g.byHour.map((v) => {
    const bg = v === 0 ? 'var(--bubble-in)' : `rgba(100,181,239,${0.15 + (v / maxHour) * 0.85})`;
    return `<div class="cell" style="background:${bg}" title="${v}"></div>`;
  }).join('');
  const hourAxis = Array.from({ length: 24 }, (_, h) => `<div>${h % 6 === 0 ? h : ''}</div>`).join('');
  const topChatBars = barRows(g.topChats.map((c) => ({ key: truncate(c.name, 16), count: c.total })), g.topChats[0] ? g.topChats[0].total : 1);
  const emojiCloud = (g.topEmojis || []).map((e) => `<div class="ec">${escapeHtml(e.key)}<small>${e.count}</small></div>`).join('');

  const body = `<header class="topbar"><div class="topbar-inner">
  ${meta.hasLogo ? '<div class="avatar"><img src="assets/logo.png" alt=""></div>' : '<div class="avatar">WA</div>'}
  <div class="topbar-id"><div class="title">Overall statistics</div><div class="subtitle">${g.chats} chats · ${g.groups} groups</div></div>
  <div class="back">${themeButton()} <a href="index.html">← All chats</a></div>
</div></header>
<div class="stats-wrap">
  <div class="stats-grid">
    ${card(g.total.toLocaleString(), 'Total messages')}
    ${card(g.fromMe.toLocaleString(), 'Sent by you')}
    ${card(g.media.toLocaleString(), 'Media files')}
    ${card(g.chats.toLocaleString(), 'Chats')}
    ${card(g.groups.toLocaleString(), 'Groups')}
  </div>
  <div class="stats-section"><h3>Most active chats</h3>${topChatBars}</div>
  <div class="stats-section"><h3>Messages by weekday</h3>${barRows(weekdayBars, maxWeekday)}</div>
  <div class="stats-section"><h3>Activity by hour</h3><div class="heatmap">${hourCells}</div><div class="heat-axis">${hourAxis}</div></div>
  ${emojiCloud ? `<div class="stats-section"><h3>Top emojis</h3><div class="emoji-cloud">${emojiCloud}</div></div>` : ''}
</div>`;
  return pageShell({ title: 'WhatsApp Backup — Overall stats', cssPrefix: '', body, withChrome: false });
}

/* ---------------- Assets ---------------- */

function writeAssets(outputDir, logoSourcePath) {
  const assetsDir = path.join(outputDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'templates', 'styles.css'), path.join(assetsDir, 'styles.css'));
  fs.copyFileSync(path.join(__dirname, 'templates', 'app.js'), path.join(assetsDir, 'app.js'));
  let hasLogo = false;
  if (logoSourcePath && fs.existsSync(logoSourcePath)) {
    fs.copyFileSync(logoSourcePath, path.join(assetsDir, 'logo.png'));
    hasLogo = true;
  }
  return { hasLogo };
}

module.exports = {
  renderChatPage,
  renderGalleryPage,
  renderStatsPage,
  renderMembersPage,
  renderIndexPage,
  renderGlobalStatsPage,
  writeAssets,
  initials,
};
