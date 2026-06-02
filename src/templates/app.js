/* Client-side behaviour for chat pages: theme toggle, in-chat full-text search
   (highlight + prev/next navigation), jump-to-month, and an image lightbox.
   Vanilla JS, no dependencies. Loaded by every chat page and the index. */
(function () {
  'use strict';

  /* ---------- Theme ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('wa-theme', t); } catch (e) { /* ignore */ }
    var btn = document.getElementById('theme-btn');
    if (btn) btn.textContent = t === 'light' ? 'Dark' : 'Light';
  }
  window.toggleTheme = function () {
    var cur = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  };
  (function initTheme() {
    var saved = 'dark';
    try { saved = localStorage.getItem('wa-theme') || 'dark'; } catch (e) { /* ignore */ }
    applyTheme(saved);
  })();

  /* ---------- In-chat search ---------- */
  var marks = [];
  var activeMark = -1;

  function clearHighlights() {
    marks.forEach(function (m) {
      var parent = m.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
    marks = [];
    activeMark = -1;
  }

  function highlight(el, q) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var n;
    // eslint-disable-next-line no-cond-assign
    while ((n = walker.nextNode())) {
      if (n.nodeValue && n.nodeValue.toLowerCase().indexOf(q) !== -1) nodes.push(n);
    }
    nodes.forEach(function (node) {
      var text = node.nodeValue;
      var lower = text.toLowerCase();
      var frag = document.createDocumentFragment();
      var idx = 0;
      var pos;
      // eslint-disable-next-line no-cond-assign
      while ((pos = lower.indexOf(q, idx)) !== -1) {
        if (pos > idx) frag.appendChild(document.createTextNode(text.slice(idx, pos)));
        var mk = document.createElement('mark');
        mk.className = 'wa-mark';
        mk.textContent = text.slice(pos, pos + q.length);
        frag.appendChild(mk);
        marks.push(mk);
        idx = pos + q.length;
      }
      if (idx < text.length) frag.appendChild(document.createTextNode(text.slice(idx)));
      node.parentNode.replaceChild(frag, node);
    });
  }

  function setActive(i) {
    if (!marks.length) return;
    if (activeMark >= 0 && marks[activeMark]) marks[activeMark].classList.remove('active');
    activeMark = (i + marks.length) % marks.length;
    var m = marks[activeMark];
    m.classList.add('active');
    m.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var c = document.getElementById('search-count');
    if (c) c.textContent = (activeMark + 1) + '/' + marks.length;
  }

  window.runSearch = function (q) {
    clearHighlights();
    q = (q || '').trim().toLowerCase();
    var c = document.getElementById('search-count');
    if (q.length < 2) { if (c) c.textContent = ''; return; }
    var scope = document.querySelectorAll('.bubble .text, .bubble .sender, .system-msg');
    scope.forEach(function (el) { highlight(el, q); });
    if (c) c.textContent = marks.length ? '1/' + marks.length : '0';
    if (marks.length) setActive(0);
  };
  window.nextMatch = function () { setActive(activeMark + 1); };
  window.prevMatch = function () { setActive(activeMark - 1); };

  document.addEventListener('keydown', function (e) {
    var box = document.getElementById('chat-search-box');
    if (box && document.activeElement === box && e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) window.prevMatch(); else window.nextMatch();
    }
    if (e.key === 'Escape') {
      var lb = document.getElementById('lightbox');
      if (lb) lb.classList.remove('open');
    }
  });

  /* ---------- Jump to month ---------- */
  window.jumpToMonth = function (val) {
    if (!val) return;
    var target = document.querySelector('[data-month="' + val + '"]');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ---------- Lightbox ---------- */
  window.openLightbox = function (src) {
    var lb = document.getElementById('lightbox');
    if (!lb) return;
    document.getElementById('lightbox-img').src = src;
    lb.classList.add('open');
  };
}());
