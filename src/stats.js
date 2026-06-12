'use strict';

/**
 * Analytics engine — turns a normalized message list into a "WhatsApp Wrapped"
 * style stats object: totals, per-sender breakdown, activity by weekday/hour/
 * month, media mix, top emojis and top words. Pure + dependency-free so it is
 * fully unit-testable without a live WhatsApp session.
 */

const { weekdayName, monthKey } = require('./utils');

// Emoji matcher (covers the common pictographic ranges + ZWJ sequences).
const EMOJI_RE = /(\p{Extended_Pictographic}(‍\p{Extended_Pictographic})*)/gu;

// Minimal multilingual-ish stopword set for top-words (kept short on purpose).
const STOPWORDS = new Set([
  'the', 'and', 'you', 'are', 'for', 'that', 'this', 'with', 'have', 'not',
  'but', 'was', 'all', 'can', 'will', 'your', 'they', 'from', 'what', 'how',
  'mama', 'eka', 'oya', 'oyaa', 'mata', 'eke', 'nam', 'naa', 'hari',
  'ok', 'okay', 'yes', 'no', 'lol', 'haha', 'https', 'http', 'www', 'com',
]);

function emptyBuckets(n) {
  return new Array(n).fill(0);
}

/** Increment a counter inside a plain object map. */
function bump(map, key, by = 1) {
  if (!key && key !== 0) return;
  map[key] = (map[key] || 0) + by;
}

function topEntries(obj, n) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

/**
 * Compute statistics for one chat.
 * @param {object[]} messages  normalized messages (see fetcher.normalizeMessage)
 * @param {boolean} isGroup
 */
function computeChatStats(messages, isGroup) {
  const stats = {
    total: 0,
    fromMe: 0,
    fromOthers: 0,
    media: { image: 0, video: 0, audio: 0, file: 0 },
    voiceNotes: 0,
    bySender: {},
    byWeekday: emptyBuckets(7),
    byHour: emptyBuckets(24),
    byMonth: {},
    emojis: {},
    words: {},
    firstDate: null,
    lastDate: null,
    activeDaySet: new Set(),
    links: 0,
  };

  for (const m of messages) {
    if (m.system) continue;
    stats.total += 1;
    if (m.fromMe) stats.fromMe += 1; else stats.fromOthers += 1;

    const d = m.date;
    if (!stats.firstDate || d < stats.firstDate) stats.firstDate = d;
    if (!stats.lastDate || d > stats.lastDate) stats.lastDate = d;
    stats.byWeekday[d.getDay()] += 1;
    stats.byHour[d.getHours()] += 1;
    bump(stats.byMonth, monthKey(d));
    stats.activeDaySet.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);

    bump(stats.bySender, m.fromMe ? 'You' : (m.senderName || 'Unknown'));

    if (m.media && !m.media.error && !m.media.skipped) {
      const k = m.media.kind || 'file';
      if (stats.media[k] !== undefined) stats.media[k] += 1; else stats.media.file += 1;
      if (m.media.isVoiceNote) stats.voiceNotes += 1;
    }

    if (m.body) {
      // Emojis
      const found = m.body.match(EMOJI_RE);
      if (found) for (const e of found) bump(stats.emojis, e);
      // Links
      if (/\bhttps?:\/\/|\bwww\./i.test(m.body)) stats.links += 1;
      // Words
      const tokens = m.body
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
      for (const w of tokens) bump(stats.words, w);
    }
  }

  const activeDays = stats.activeDaySet.size || 1;
  const spanDays = stats.firstDate && stats.lastDate
    ? Math.max(1, Math.round((stats.lastDate - stats.firstDate) / 86400000) + 1)
    : 1;

  return {
    isGroup: !!isGroup,
    total: stats.total,
    fromMe: stats.fromMe,
    fromOthers: stats.fromOthers,
    media: stats.media,
    mediaTotal: stats.media.image + stats.media.video + stats.media.audio + stats.media.file,
    voiceNotes: stats.voiceNotes,
    links: stats.links,
    firstDate: stats.firstDate,
    lastDate: stats.lastDate,
    activeDays,
    spanDays,
    avgPerActiveDay: Math.round((stats.total / activeDays) * 10) / 10,
    byWeekday: stats.byWeekday,
    byHour: stats.byHour,
    byMonth: stats.byMonth,
    topSenders: topEntries(stats.bySender, 12),
    topEmojis: topEntries(stats.emojis, 10),
    topWords: topEntries(stats.words, 15),
    busiestWeekday: weekdayName(new Date(2023, 0, 1 + stats.byWeekday.indexOf(Math.max(...stats.byWeekday)))),
    busiestHour: stats.byHour.indexOf(Math.max(...stats.byHour)),
  };
}

/** Aggregate chat-level summaries into a global picture for the index/stats. */
function computeGlobalStats(perChat) {
  const g = {
    chats: perChat.length,
    groups: 0,
    total: 0,
    fromMe: 0,
    media: 0,
    byWeekday: emptyBuckets(7),
    byHour: emptyBuckets(24),
    byMonth: {},
    emojis: {},
    topChats: [],
  };
  for (const c of perChat) {
    if (!c.stats) continue;
    if (c.stats.isGroup) g.groups += 1;
    g.total += c.stats.total;
    g.fromMe += c.stats.fromMe;
    g.media += c.stats.mediaTotal;
    for (let i = 0; i < 7; i += 1) g.byWeekday[i] += c.stats.byWeekday[i];
    for (let i = 0; i < 24; i += 1) g.byHour[i] += c.stats.byHour[i];
    for (const [k, v] of Object.entries(c.stats.byMonth)) bump(g.byMonth, k, v);
    for (const e of c.stats.topEmojis) bump(g.emojis, e.key, e.count);
    g.topChats.push({ name: c.chatName, total: c.stats.total, isGroup: c.stats.isGroup });
  }
  g.topChats.sort((a, b) => b.total - a.total);
  g.topChats = g.topChats.slice(0, 15);
  g.topEmojis = topEntries(g.emojis, 12);
  return g;
}

module.exports = { computeChatStats, computeGlobalStats, topEntries };
