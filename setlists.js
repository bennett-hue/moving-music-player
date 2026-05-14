/* Moving Music Setlists v0.1.1 (Phase 2 MVP)
 *
 * Anonymous single setlist, persisted in localStorage.
 * Drag-to-reorder via SortableJS (lazy-loaded).
 * "Export JSON" copies the setlist to the clipboard for manual backup.
 *
 * Cross-device sync (Worker + KV), named setlists, /setlists/ page,
 * "Play in Player", Drive backup, and Performance Mode all land in Phase 3+.
 *
 * Repo: github.com/bennett-hue/moving-music-player
 * Loaded from code injection on movingmusic.works.
 */
(function () {
  if (window.__mmSetlistInited) return;
  window.__mmSetlistInited = true;

  // ---------- config ----------
  var STORAGE_KEY = 'mm.setlist.current.v1';
  var SORTABLE_CDN =
    'https://cdn.jsdelivr.net/npm/sortablejs@1.15.7/Sortable.min.js';
  var ACCENT = '#9FC600';

  // ---------- tiny dom helpers ----------
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.prototype.slice.call(
      (root || document).querySelectorAll(sel)
    );
  }
  function el(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (k === 'style') Object.assign(e.style, v);
        else if (k === 'class') e.className = v;
        else if (k === 'on') {
          Object.keys(v).forEach(function (ev) {
            e.addEventListener(ev, v[ev]);
          });
        } else if (
          k.indexOf('-') >= 0 ||
          k === 'role' ||
          k.indexOf('aria') === 0
        ) {
          e.setAttribute(k, v);
        } else {
          e[k] = v;
        }
      });
    }
    (kids || []).forEach(function (k) {
      if (k == null) return;
      if (typeof k === 'string') {
        e.appendChild(document.createTextNode(k));
      } else {
        e.appendChild(k);
      }
    });
    return e;
  }
  function slugFromHref(href) {
    if (!href) return null;
    var m = href.match(/^https?:\/\/[^/]+(\/.+)/);
    var path = m ? m[1] : href;
    var parts = path.split('?')[0].split('#')[0].split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  }

  // ---------- storage ----------
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { songs: [] };
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.songs)) return { songs: [] };
      return data;
    } catch (e) {
      return { songs: [] };
    }
  }
  function save(data) {
    data.savedAt = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {}
  }
  var state = load();

  // ---------- styles ----------
  var CSS =
    '.mm-sl-fab{' +
    'position:fixed;bottom:96px;right:16px;z-index:9990;' +
    'background:' + ACCENT + ';color:#1a1a1a;' +
    'border:none;border-radius:999px;padding:10px 16px;' +
    'font:600 14px/1.2 inherit;font-family:inherit;' +
    'box-shadow:0 4px 14px rgba(0,0,0,.2);cursor:pointer;' +
    '}' +
    '.mm-sl-fab[hidden]{display:none}' +
    '.mm-sl-add{' +
    'display:inline-flex;align-items:center;gap:4px;' +
    'padding:6px 12px;background:transparent;' +
    'border:1px solid ' + ACCENT + ';border-radius:999px;' +
    'font:600 13px/1.2 inherit;color:#1a1a1a;cursor:pointer;' +
    'vertical-align:middle;margin:8px 0 16px;' +
    '}' +
    '.mm-sl-add.is-added{background:' + ACCENT + '}' +
    '.mm-sl-card-add{' +
    'position:relative;z-index:60;pointer-events:auto;' +
    'flex:0 0 32px;width:32px;height:32px;' +
    'background:transparent;border:none;padding:0;' +
    'font:600 26px/1 inherit;color:' + ACCENT + ';' +
    'cursor:pointer;' +
    'display:inline-flex;align-items:center;' +
    'justify-content:center;margin-left:8px;' +
    'flex-shrink:0;' +
    '}' +
    '.mm-sl-card-add:hover{color:#7fa300}' +
    '.mm-sl-card-add.is-added{color:#1a1a1a}' +
    '.mm-sl-toolbar-pill{' +
    'display:inline-block;margin-right:auto;' +
    'padding:5px 12px;' +
    'font:600 11px/1.4 inherit;' +
    'letter-spacing:.08em;text-transform:uppercase;' +
    'border:1px solid ' + ACCENT + ';' +
    'border-radius:999px;background:transparent;' +
    'color:#1a1a1a;cursor:pointer;' +
    'transition:background .15s;' +
    '}' +
    '.mm-sl-toolbar-pill:hover{background:rgba(159,198,0,.12)}' +
    '.mm-sl-toolbar-pill .mm-sl-count{' +
    'margin-left:6px;font-weight:700;color:' + ACCENT + ';' +
    '}' +
    '.mm-sl-overlay{' +
    'position:fixed;inset:0;background:rgba(0,0,0,.5);' +
    'z-index:9995;opacity:0;pointer-events:none;' +
    'transition:opacity 200ms ease;' +
    '}' +
    '.mm-sl-overlay.is-open{opacity:1;pointer-events:auto}' +
    '.mm-sl-drawer{' +
    'position:fixed;bottom:0;left:0;right:0;' +
    'max-height:85vh;background:#fff;color:#1a1a1a;' +
    'border-radius:16px 16px 0 0;z-index:9996;' +
    'transform:translateY(100%);' +
    'transition:transform 220ms ease;' +
    'display:flex;flex-direction:column;' +
    'box-shadow:0 -4px 20px rgba(0,0,0,.2);' +
    '}' +
    '.mm-sl-drawer.is-open{transform:translateY(0)}' +
    '.mm-sl-drawer-head{' +
    'display:flex;align-items:center;' +
    'justify-content:space-between;' +
    'padding:14px 16px 10px;' +
    'border-bottom:1px solid #eee;' +
    '}' +
    '.mm-sl-drawer-title{' +
    'font:600 17px/1.2 inherit;margin:0;' +
    '}' +
    '.mm-sl-drawer-close{' +
    'background:none;border:none;font-size:28px;' +
    'line-height:1;cursor:pointer;padding:0 6px;color:#666;' +
    '}' +
    '.mm-sl-list{' +
    'list-style:none;margin:0;padding:8px 0;' +
    'overflow-y:auto;flex:1;' +
    '}' +
    '.mm-sl-list:empty::after{' +
    'content:"No songs yet. Tap + on any song to add it.";' +
    'display:block;padding:32px 16px;color:#888;' +
    'font-style:italic;text-align:center;' +
    '}' +
    '.mm-sl-row{' +
    'display:flex;align-items:center;' +
    'padding:10px 12px;' +
    'border-bottom:1px solid #f1f1f1;' +
    'background:#fff;' +
    '}' +
    '.mm-sl-handle{' +
    'flex:0 0 36px;cursor:grab;font-size:18px;' +
    'color:#999;user-select:none;text-align:center;' +
    'touch-action:none;' +
    '}' +
    '.mm-sl-row-title{' +
    'flex:1;min-width:0;font:500 15px/1.3 inherit;' +
    'overflow:hidden;text-overflow:ellipsis;' +
    'white-space:nowrap;' +
    '}' +
    '.mm-sl-row-remove{' +
    'flex:0 0 32px;background:none;border:none;' +
    'font-size:22px;cursor:pointer;color:#b33;' +
    'line-height:1;' +
    '}' +
    '.mm-sl-ghost{opacity:.5;background:#f6ffdf}' +
    '.mm-sl-drawer-foot{' +
    'display:flex;gap:8px;padding:12px 16px;' +
    'border-top:1px solid #eee;' +
    '}' +
    '.mm-sl-btn{' +
    'flex:1;padding:10px 14px;' +
    'border:1px solid #ccc;background:#fff;' +
    'border-radius:8px;font:600 14px/1.2 inherit;' +
    'cursor:pointer;color:#1a1a1a;' +
    '}' +
    '.mm-sl-btn.is-primary{' +
    'background:' + ACCENT + ';border-color:' + ACCENT + ';' +
    '}' +
    '.mm-sl-toast{' +
    'position:fixed;bottom:170px;left:50%;' +
    'transform:translateX(-50%);' +
    'background:rgba(0,0,0,.85);color:#fff;' +
    'padding:10px 16px;border-radius:999px;' +
    'font:500 13px/1.2 inherit;z-index:9999;' +
    'opacity:0;pointer-events:none;' +
    'transition:opacity 200ms ease;' +
    'max-width:80vw;text-align:center;' +
    '}' +
    '.mm-sl-toast.is-open{opacity:1}' +
    '@media (max-width:600px){' +
    '.mm-sl-fab{bottom:80px;right:12px;padding:9px 14px;font-size:13px}' +
    '}';

  function injectStyles() {
    if (document.getElementById('mm-sl-styles')) return;
    var s = document.createElement('style');
    s.id = 'mm-sl-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ---------- state ops ----------
  function inSetlist(slug) {
    return state.songs.findIndex(function (s) {
      return s.slug === slug;
    });
  }
  function addSong(song) {
    if (!song || !song.slug || inSetlist(song.slug) >= 0) return false;
    state.songs.push({ slug: song.slug, title: song.title });
    save(state);
    refreshAll();
    showToast('Added: ' + song.title);
    return true;
  }
  function removeSong(slug) {
    var idx = inSetlist(slug);
    if (idx < 0) return;
    state.songs.splice(idx, 1);
    save(state);
    refreshAll();
  }
  function clearAll() {
    if (state.songs.length === 0) return;
    if (!confirm('Clear the setlist?')) return;
    state.songs = [];
    save(state);
    refreshAll();
    showToast('Setlist cleared');
  }
  function exportJson() {
    var payload = {
      name: 'Setlist',
      exportedAt: new Date().toISOString(),
      songs: state.songs,
    };
    var json = JSON.stringify(payload, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(
        function () { showToast('Copied JSON to clipboard'); },
        function () {
          showToast('Copy blocked — JSON in console');
          console.log(json);
        }
      );
    } else {
      console.log(json);
      showToast('JSON logged to console');
    }
  }

  // ---------- discovery (cards to attach buttons to) ----------
  function getCardsOnPage() {
    var out = [];

    // Single-post page
    if (document.body.classList.contains('post-template')) {
      var titleEl =
        $('article.feed h1.single-title') ||
        $('article h1.single-title') ||
        $('h1.single-title');
      var slug = slugFromHref(location.pathname);
      if (titleEl && slug) {
        out.push({
          kind: 'post',
          anchor: titleEl,
          slug: slug,
          title: titleEl.textContent.trim(),
        });
      }
    }

    // Tag / feed pages (match the player.js card scan)
    $$('article.feed.post, article.post-card, article.feed').forEach(
      function (card) {
        if (
          !card.matches('.tag-library, .tag-songs, .tag-songs-2')
        ) return;
        var wrap = card.querySelector('.feed-wrapper') || card;
        var link =
          card.querySelector('a.u-permalink') ||
          card.querySelector(
            'a[href]:not([href*="/tag/"]):not([href*="/author/"])'
          );
        var t = card.querySelector(
          '.feed-title, .post-card-title, h2, h3, .gh-card-title'
        );
        if (!link || !t) return;
        var slug = slugFromHref(link.getAttribute('href'));
        if (!slug) return;
        if (slug.indexOf('tag/') === 0) return;
        if (slug.indexOf('author/') === 0) return;
        out.push({
          kind: 'card',
          anchor: wrap,
          slug: slug,
          title: t.textContent.trim(),
        });
      }
    );

    return out;
  }

  // ---------- button rendering ----------
  function paintToggleBtn(btn, isIn, isPost) {
    if (isIn) {
      btn.classList.add('is-added');
      btn.textContent = isPost ? '✓ In setlist' : '✓';
      btn.setAttribute(
        'aria-label',
        isPost ? 'Remove from setlist' : 'Remove from setlist'
      );
    } else {
      btn.classList.remove('is-added');
      btn.textContent = isPost ? '+ Add to setlist' : '+';
      btn.setAttribute(
        'aria-label',
        isPost ? 'Add to setlist' : 'Add to setlist'
      );
    }
  }

  function renderPostButton(c) {
    if (c.anchor.parentNode.querySelector('.mm-sl-add')) return;
    var btn = el('button', {
      class: 'mm-sl-add',
      type: 'button',
      on: {
        click: function () { handleToggle(c, btn, true); },
      },
    });
    paintToggleBtn(btn, inSetlist(c.slug) >= 0, true);
    c.anchor.parentNode.insertBefore(btn, c.anchor.nextSibling);
  }

  function renderCardButton(c) {
    if (c.anchor.querySelector('.mm-sl-card-add')) return;
    var btn = el('button', {
      class: 'mm-sl-card-add',
      type: 'button',
      on: {
        click: function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          handleToggle(c, btn, false);
        },
      },
    });
    paintToggleBtn(btn, inSetlist(c.slug) >= 0, false);
    c.anchor.appendChild(btn);
  }

  function handleToggle(c, btn, isPost) {
    if (inSetlist(c.slug) >= 0) {
      removeSong(c.slug);
    } else {
      addSong({ slug: c.slug, title: c.title });
    }
  }

  // ---------- toolbar pill (next to Show tags) ----------
  var toolbarPillEl = null;
  var toolbarCountEl = null;

  function ensureToolbarPill() {
    var wrap = document.querySelector('.mmp-add-all-wrap');
    if (!wrap) return false;
    if (wrap.querySelector('.mm-sl-toolbar-pill')) return true;
    toolbarPillEl = el('button', {
      class: 'mm-sl-toolbar-pill',
      type: 'button',
      'aria-label': 'Open setlist',
      on: { click: openDrawer },
    });
    toolbarPillEl.appendChild(document.createTextNode('Setlist'));
    toolbarCountEl = el('span', { class: 'mm-sl-count' }, [
      String(state.songs.length),
    ]);
    toolbarPillEl.appendChild(toolbarCountEl);
    var showTags = wrap.querySelector('.mmp-show-tags');
    if (showTags && showTags.nextSibling) {
      wrap.insertBefore(toolbarPillEl, showTags.nextSibling);
    } else if (showTags) {
      wrap.appendChild(toolbarPillEl);
    } else {
      wrap.appendChild(toolbarPillEl);
    }
    return true;
  }

  function refreshToolbarPill() {
    if (toolbarCountEl) {
      toolbarCountEl.textContent = String(state.songs.length);
    }
  }

  function watchForToolbar() {
    var feed = document.querySelector('.post-feed');
    if (!feed) return;
    if (ensureToolbarPill()) return;
    var obs = new MutationObserver(function (muts, o) {
      if (ensureToolbarPill()) o.disconnect();
    });
    obs.observe(feed, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); }, 5000);
  }

  function renderButtons() {
    getCardsOnPage().forEach(function (c) {
      if (c.kind === 'post') renderPostButton(c);
      else renderCardButton(c);
    });
  }

  function repaintButtons() {
    getCardsOnPage().forEach(function (c) {
      var btn =
        c.kind === 'post'
          ? c.anchor.parentNode.querySelector('.mm-sl-add')
          : c.anchor.querySelector('.mm-sl-card-add');
      if (btn) paintToggleBtn(btn, inSetlist(c.slug) >= 0, c.kind === 'post');
    });
  }

  // ---------- FAB ----------
  var fabEl = null;
  function ensureFab() {
    if (fabEl) return;
    fabEl = el('button', {
      class: 'mm-sl-fab',
      type: 'button',
      'aria-label': 'Open setlist',
      on: { click: openDrawer },
    });
    document.body.appendChild(fabEl);
  }
  function refreshFab() {
    ensureFab();
    fabEl.textContent = '🎵 ' + state.songs.length;
    fabEl.hidden = state.songs.length === 0 && !drawerOpen();
  }

  // ---------- drawer ----------
  var overlayEl = null;
  var drawerEl = null;
  var listEl = null;
  var sortable = null;
  var sortableLoading = false;

  function ensureDrawer() {
    if (drawerEl) return;
    overlayEl = el('div', {
      class: 'mm-sl-overlay',
      on: { click: closeDrawer },
    });
    listEl = el('ul', { class: 'mm-sl-list' });
    drawerEl = el('div', { class: 'mm-sl-drawer' }, [
      el('div', { class: 'mm-sl-drawer-head' }, [
        el('h2', { class: 'mm-sl-drawer-title' }, ['Setlist']),
        el('button', {
          class: 'mm-sl-drawer-close',
          type: 'button',
          'aria-label': 'Close setlist',
          on: { click: closeDrawer },
        }, ['×']),
      ]),
      listEl,
      el('div', { class: 'mm-sl-drawer-foot' }, [
        el('button', {
          class: 'mm-sl-btn',
          type: 'button',
          on: { click: exportJson },
        }, ['Export JSON']),
        el('button', {
          class: 'mm-sl-btn',
          type: 'button',
          on: { click: clearAll },
        }, ['Clear']),
      ]),
    ]);
    document.body.appendChild(overlayEl);
    document.body.appendChild(drawerEl);
  }

  function drawerOpen() {
    return drawerEl && drawerEl.classList.contains('is-open');
  }

  function openDrawer() {
    ensureDrawer();
    refreshList();
    requestAnimationFrame(function () {
      overlayEl.classList.add('is-open');
      drawerEl.classList.add('is-open');
    });
    loadSortable();
  }

  function closeDrawer() {
    if (!drawerEl) return;
    overlayEl.classList.remove('is-open');
    drawerEl.classList.remove('is-open');
    refreshFab();
  }

  function refreshList() {
    if (!listEl) return;
    listEl.innerHTML = '';
    state.songs.forEach(function (s) {
      var row = el(
        'li',
        { class: 'mm-sl-row', 'data-id': s.slug },
        [
          el('span', { class: 'mm-sl-handle' }, ['☰']),
          el(
            'a',
            {
              class: 'mm-sl-row-title',
              href: '/' + s.slug + '/',
              on: {
                click: function (ev) {
                  if (drawerOpen()) closeDrawer();
                  // Let navigation proceed.
                },
              },
            },
            [s.title]
          ),
          el('button', {
            class: 'mm-sl-row-remove',
            type: 'button',
            'aria-label': 'Remove ' + s.title,
            on: { click: function () { removeSong(s.slug); } },
          }, ['×']),
        ]
      );
      listEl.appendChild(row);
    });
    initSortable();
  }

  // ---------- SortableJS ----------
  function loadSortable() {
    if (window.Sortable) {
      initSortable();
      return;
    }
    if (sortableLoading) return;
    sortableLoading = true;
    var s = document.createElement('script');
    s.src = SORTABLE_CDN;
    s.onload = function () { initSortable(); };
    s.onerror = function () {
      sortableLoading = false;
      showToast('Drag-reorder failed to load');
    };
    document.head.appendChild(s);
  }

  function initSortable() {
    if (!listEl || !window.Sortable) return;
    if (sortable) {
      try { sortable.destroy(); } catch (e) {}
      sortable = null;
    }
    sortable = new window.Sortable(listEl, {
      animation: 150,
      delay: 150,
      delayOnTouchOnly: true,
      touchStartThreshold: 5,
      handle: '.mm-sl-handle',
      ghostClass: 'mm-sl-ghost',
      onEnd: function () {
        var order = sortable.toArray();
        var bySlug = {};
        state.songs.forEach(function (s) { bySlug[s.slug] = s; });
        state.songs = order
          .map(function (slug) { return bySlug[slug]; })
          .filter(Boolean);
        save(state);
      },
    });
  }

  // ---------- toast ----------
  var toastEl = null;
  var toastTimer = null;
  function showToast(msg) {
    if (!toastEl) {
      toastEl = el('div', { class: 'mm-sl-toast' });
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('is-open');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('is-open');
    }, 2200);
  }

  // ---------- glue ----------
  function refreshAll() {
    repaintButtons();
    refreshFab();
    refreshToolbarPill();
    refreshList();
  }

  function init() {
    injectStyles();
    renderButtons();
    refreshFab();
    watchForToolbar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
