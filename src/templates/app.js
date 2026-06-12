/* Client-side behaviour for the generated archive: theme toggle (system-aware,
   no flash — see the inline bootstrap in <head>), in-chat full-text search with
   highlight + prev/next, jump-to-month, chat-list filtering (text + type tabs),
   an image lightbox with keyboard/arrow navigation, keyboard shortcuts
   ("/" focuses search, Esc closes/clears) and a scroll-to-top button.
   Vanilla JS, no dependencies. Loaded by every generated page. */
(function () {
  'use strict';

  /* ---------- Theme ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('wa-theme', t); } catch (e) { /* ignore */ }
    var btn = document.getElementById('theme-btn');
    if (btn) {
      btn.textContent = t === 'light' ? '🌙' : '☀️';
      btn.setAttribute('title', t === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    }
  }
  window.toggleTheme = function () {
    var cur = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  };
  // The <head> bootstrap already set the attribute pre-paint; this just syncs
  // the button icon and persists a system-derived default.
  applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');

  /* ---------- In-chat search ---------- */
  var marks = [];
  var activeMark = -1;
  var searchTimer = null;

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

  function doSearch(q) {
    clearHighlights();
    var c = document.getElementById('search-count');
    if (q.length < 2) { if (c) c.textContent = ''; return; }
    var scope = document.querySelectorAll('.bubble .text, .bubble .sender, .system-msg');
    scope.forEach(function (el) { highlight(el, q); });
    if (c) c.textContent = marks.length ? '1/' + marks.length : '0';
    if (marks.length) setActive(0);
  }

  // Debounced so typing in huge chats stays responsive.
  window.runSearch = function (q) {
    q = (q || '').trim().toLowerCase();
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { doSearch(q); }, 180);
  };
  window.nextMatch = function () { setActive(activeMark + 1); };
  window.prevMatch = function () { setActive(activeMark - 1); };

  /* ---------- Chat-list filtering (index page) ---------- */
  var kindFilter = 'all';

  function applyChatFilter() {
    var box = document.getElementById('chat-search');
    var q = box ? box.value.toLowerCase().trim() : '';
    var any = false;
    document.querySelectorAll('.chat-card').forEach(function (c) {
      var nameOk = !q || (c.getAttribute('data-name') || '').indexOf(q) !== -1;
      var kindOk = kindFilter === 'all' || c.getAttribute('data-kind') === kindFilter;
      var show = nameOk && kindOk;
      c.style.display = show ? '' : 'none';
      if (show) any = true;
    });
    var empty = document.getElementById('no-results');
    if (empty) empty.hidden = any;
  }
  window.filterChats = applyChatFilter;
  window.setKindFilter = function (btn) {
    kindFilter = btn.getAttribute('data-kind') || 'all';
    document.querySelectorAll('.filter-tabs .ftab').forEach(function (b) {
      var on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    applyChatFilter();
  };

  /* ---------- Jump to month ---------- */
  window.jumpToMonth = function (val) {
    if (!val) return;
    var target = document.querySelector('[data-month="' + val + '"]');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ---------- Lightbox with prev/next ---------- */
  var lbImages = [];
  var lbIndex = -1;

  function collectImages() {
    if (lbImages.length) return;
    document.querySelectorAll('.media-img img, .gallery a > img').forEach(function (img) {
      var a = img.closest('a');
      lbImages.push(a && a.href ? a.href : img.src);
    });
  }

  function showLightbox(i) {
    var lb = document.getElementById('lightbox');
    if (!lb || !lbImages.length) return;
    lbIndex = (i + lbImages.length) % lbImages.length;
    document.getElementById('lightbox-img').src = lbImages[lbIndex];
    var counter = document.getElementById('lb-counter');
    if (counter) counter.textContent = (lbIndex + 1) + ' / ' + lbImages.length;
    lb.classList.add('open');
    lb.setAttribute('aria-hidden', 'false');
  }

  window.openLightbox = function (src) {
    collectImages();
    var i = lbImages.indexOf(src);
    if (i === -1) { lbImages.push(src); i = lbImages.length - 1; }
    showLightbox(i);
  };
  window.closeLightbox = function () {
    var lb = document.getElementById('lightbox');
    if (!lb) return;
    lb.classList.remove('open');
    lb.setAttribute('aria-hidden', 'true');
  };
  window.lightboxStep = function (d) { showLightbox(lbIndex + d); };

  // Click on the backdrop (not the image/buttons) closes.
  var lbEl = document.getElementById('lightbox');
  if (lbEl) {
    lbEl.addEventListener('click', function (e) {
      if (e.target === lbEl) window.closeLightbox();
    });
  }

  /* ---------- Keyboard shortcuts ---------- */
  document.addEventListener('keydown', function (e) {
    var lb = document.getElementById('lightbox');
    var lbOpen = lb && lb.classList.contains('open');
    var box = document.getElementById('chat-search-box') || document.getElementById('chat-search');
    var typing = document.activeElement
      && /^(input|select|textarea)$/i.test(document.activeElement.tagName);

    if (lbOpen) {
      if (e.key === 'Escape') window.closeLightbox();
      else if (e.key === 'ArrowLeft') window.lightboxStep(-1);
      else if (e.key === 'ArrowRight') window.lightboxStep(1);
      return;
    }
    if (e.key === 'Escape') {
      if (box && box.value) { box.value = ''; box.dispatchEvent(new Event('input')); }
      if (typing) document.activeElement.blur();
      return;
    }
    if (e.key === '/' && !typing && box) {
      e.preventDefault();
      box.focus();
      return;
    }
    if (box && document.activeElement === box && e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) window.prevMatch(); else window.nextMatch();
    }
  });

  /* ---------- Scroll-to-top ---------- */
  var toTop = document.getElementById('to-top');
  if (toTop) {
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        toTop.hidden = window.scrollY < 600;
        ticking = false;
      });
    }, { passive: true });
  }
}());
