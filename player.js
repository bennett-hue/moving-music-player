/*!
 * Moving Music Player v0.1.1
 * Fixed-bottom playlist audio player for movingmusic.works
 * https://github.com/bennett-hue/moving-music-player
 */
(() => {
  'use strict';

  const CONFIG = {
    contentApiKey: '4bb24d5f52e1f7397cb4fe24a5',
    apiBase: 'https://moving-music.ghost.io/ghost/api/content',
    storageKey: 'mmp-state-v1',
    accentColor: '#d4a019',
    panelBg: '#f3f1ec',
  };

  const CSS = `
    .mmp-bar {
      position: fixed; left: 0; right: 0; bottom: 0;
      z-index: 99999;
      background: #fff;
      border-top: 1px solid #d8d4cc;
      box-shadow: 0 -4px 20px rgba(0,0,0,0.08);
      font-family: inherit;
      transform: translateY(110%);
      transition: transform 0.25s ease;
      max-height: 80vh;
      display: flex; flex-direction: column;
    }
    .mmp-bar.is-visible { transform: translateY(0); }
    .mmp-progress {
      position: absolute; top: 0; left: 0; right: 0;
      height: 3px; background: rgba(0,0,0,0.08);
      cursor: pointer;
    }
    .mmp-progress-fill {
      height: 100%; background: ${CONFIG.accentColor};
      width: 0%;
    }
    .mmp-mini {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px;
      min-height: 56px;
    }
    .mmp-thumb {
      width: 40px; height: 40px; flex: 0 0 40px;
      border-radius: 4px;
      background: ${CONFIG.panelBg};
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; color: #999;
    }
    .mmp-title {
      flex: 1 1 auto; min-width: 0;
      font-size: 14px; font-weight: 500;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      color: #333;
    }
    .mmp-title-empty { color: #999; font-style: italic; }
    .mmp-controls {
      display: flex; align-items: center; gap: 2px;
      flex: 0 0 auto;
    }
    .mmp-btn {
      background: transparent; border: 0; padding: 8px;
      cursor: pointer; color: #333;
      width: 36px; height: 36px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 50%;
      transition: background 0.15s;
      touch-action: manipulation;
    }
    .mmp-btn:hover { background: rgba(0,0,0,0.06); }
    .mmp-btn svg { width: 20px; height: 20px; fill: currentColor; }
    .mmp-btn-play svg { width: 24px; height: 24px; }
    .mmp-btn-play { background: ${CONFIG.accentColor}; color: #fff; }
    .mmp-btn-play:hover { background: ${CONFIG.accentColor}; opacity: 0.9; }
    .mmp-btn:disabled { opacity: 0.3; cursor: not-allowed; }
    .mmp-expanded {
      flex: 1 1 auto; overflow-y: auto;
      border-top: 1px solid #e8e4dc;
      padding: 8px 0;
      max-height: 50vh;
      display: none;
    }
    .mmp-bar.is-open .mmp-expanded { display: block; }
    .mmp-queue-header {
      padding: 6px 16px;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
      color: #777; font-weight: 600;
    }
    .mmp-queue-item {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 16px;
      cursor: pointer;
      transition: background 0.12s;
    }
    .mmp-queue-item:hover { background: rgba(0,0,0,0.04); }
    .mmp-queue-item.is-current {
      background: ${CONFIG.panelBg};
      font-weight: 600;
    }
    .mmp-queue-item.is-current .mmp-queue-title { color: ${CONFIG.accentColor}; }
    .mmp-queue-item.is-locked { opacity: 0.55; }
    .mmp-queue-num {
      width: 22px; text-align: right;
      font-size: 12px; color: #999;
      flex: 0 0 22px;
    }
    .mmp-queue-title {
      flex: 1 1 auto; min-width: 0;
      font-size: 14px; color: #333;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .mmp-queue-icon {
      flex: 0 0 auto; font-size: 12px; color: #999;
    }
    .mmp-time {
      font-size: 11px; color: #777;
      font-variant-numeric: tabular-nums;
      padding: 0 6px;
    }
    .mmp-time-display {
      font-size: 11px; color: #777;
      font-variant-numeric: tabular-nums;
      margin-left: auto;
      padding-right: 8px;
    }
    .mmp-card-play {
      position: absolute;
      top: 8px; left: 8px;
      z-index: 10;
      display: inline-flex; align-items: center; justify-content: center;
      width: 36px; height: 36px;
      background: transparent;
      color: #111;
      border: 0; padding: 0; margin: 0;
      cursor: pointer;
      touch-action: manipulation;
      pointer-events: auto;
      transition: transform 0.15s;
    }
    body.mm-signed-in .mmp-card-play { color: ${CONFIG.accentColor}; }
    .mmp-card-play.is-current { color: #333; }
    .mmp-card-play.is-locked { color: #999; }
    .mmp-card-play:hover { transform: scale(1.12); }
    .mmp-card-play svg { width: 28px; height: 28px; fill: currentColor; }
    .mmp-bar.is-loading .mmp-btn-play svg { animation: mmp-spin 1s linear infinite; }
    @keyframes mmp-spin { to { transform: rotate(360deg); } }
    @media (max-width: 600px) {
      .mmp-thumb { display: none; }
      .mmp-mini { padding: 8px 8px; gap: 6px; }
      .mmp-btn { width: 32px; height: 32px; padding: 6px; }
      .mmp-time-display { display: none; }
    }
    /* Hide native Ghost audio card play button — we hijack it */
    body.mmp-active .kg-audio-card .kg-audio-play-icon { display: none; }
  `;

  const ICONS = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>',
    expand: '<svg viewBox="0 0 24 24"><path d="M7 14l5-5 5 5z"/></svg>',
    collapse: '<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>',
    note: '<svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>',
  };

  // ----- state -----
  let state = {
    queue: [],          // [{slug, title, audioUrl, locked, loaded}]
    currentIdx: -1,
    expanded: false,
  };
  let audio = null;
  let barEl = null;
  let lastSaveAt = 0;

  // ----- helpers -----
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function slugFromHref(href) {
    if (!href) return null;
    try {
      const u = new URL(href, location.origin);
      return u.pathname.replace(/^\/|\/$/g, '');
    } catch (e) { return null; }
  }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ----- content api -----
  async function fetchAudioUrl(slug) {
    const url = `${CONFIG.apiBase}/posts/slug/${encodeURIComponent(slug)}/?key=${CONFIG.contentApiKey}&fields=html,visibility,title`;
    try {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) return { error: `http_${r.status}` };
      const data = await r.json();
      const post = data.posts && data.posts[0];
      if (!post) return { error: 'not_found' };
      const html = post.html || '';
      const m = html.match(/<audio[^>]+src=["']([^"']+)["']/i);
      if (!m) {
        return { locked: true, visibility: post.visibility, title: post.title };
      }
      return { audioUrl: m[1], visibility: post.visibility, title: post.title };
    } catch (e) {
      return { error: e.message || String(e) };
    }
  }

  // ----- state persistence -----
  function saveState() {
    const now = Date.now();
    if (now - lastSaveAt < 2000) return;
    lastSaveAt = now;
    try {
      const t = state.queue[state.currentIdx];
      if (!t) return;
      localStorage.setItem(CONFIG.storageKey, JSON.stringify({
        slug: t.slug,
        title: t.title,
        audioUrl: t.audioUrl,
        position: audio ? audio.currentTime : 0,
        savedAt: now,
      }));
    } catch (e) {}
  }

  function loadSavedTrack() {
    try {
      const raw = localStorage.getItem(CONFIG.storageKey);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.audioUrl) return null;
      if (Date.now() - (s.savedAt || 0) > 1000 * 60 * 60 * 24) return null;
      return s;
    } catch (e) { return null; }
  }

  // ----- queue building -----
  function buildQueue() {
    const items = [];
    const seen = new Set();

    // Single-post page: real audio card
    $$('.kg-audio-card').forEach(card => {
      const a = card.querySelector('audio');
      const t = card.querySelector('.kg-audio-title');
      if (!a || !a.src) return;
      const slug = slugFromHref(location.pathname) || a.src;
      if (seen.has(slug)) return;
      seen.add(slug);
      items.push({
        slug,
        title: (t && t.textContent.trim()) || document.title,
        audioUrl: a.src,
        locked: false,
        loaded: true,
        cardEl: card,
      });
    });

    // Feed pages: article.feed.post (or .feed) cards
    $$('article.feed.post, article.post-card, article.feed').forEach(card => {
      const link = card.querySelector('a[href]');
      const titleEl = card.querySelector('.feed-title, .post-card-title, h2, h3, .gh-card-title');
      if (!link || !titleEl) return;
      const slug = slugFromHref(link.getAttribute('href'));
      if (!slug || seen.has(slug)) return;
      seen.add(slug);
      items.push({
        slug,
        title: titleEl.textContent.trim(),
        audioUrl: null,
        locked: false,
        loaded: false,
        cardEl: card,
      });
    });

    return items;
  }

  // ----- audio -----
  function initAudio() {
    audio = new Audio();
    audio.preload = 'metadata';
    audio.volume = 1.0;
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', () => renderPlayPause());
    audio.addEventListener('pause', () => renderPlayPause());
    audio.addEventListener('loadedmetadata', () => renderTimes());
    audio.addEventListener('error', (e) => {
      console.warn('[mmp] audio error', audio.error, audio.src);
    });
  }

  async function playIdx(idx) {
    if (idx < 0 || idx >= state.queue.length) return;
    const track = state.queue[idx];
    state.currentIdx = idx;
    showBar();
    renderTrack();
    renderQueue();
    renderCardButtons();

    if (!track.loaded) {
      barEl.classList.add('is-loading');
      const result = await fetchAudioUrl(track.slug);
      barEl.classList.remove('is-loading');
      if (result.error) {
        console.warn('[mmp] could not fetch', track.slug, result.error);
        return advance(+1, idx);
      }
      if (result.locked) {
        track.locked = true;
        track.loaded = true;
        renderQueue();
        renderCardButtons();
        // Pause anything currently playing
        audio.pause();
        triggerSignup();
        return;
      }
      track.audioUrl = result.audioUrl;
      track.loaded = true;
      if (result.title) track.title = result.title;
      renderTrack();
    }

    if (track.locked) {
      triggerSignup();
      return advance(+1, idx);
    }

    if (audio.src !== track.audioUrl) {
      audio.src = track.audioUrl;
    }
    try {
      await audio.play();
    } catch (e) {
      console.warn('[mmp] play() rejected', e);
    }
    saveState();
  }

  function advance(delta, fromIdx) {
    // Skip locked tracks in the given direction
    let i = (fromIdx == null ? state.currentIdx : fromIdx) + delta;
    while (i >= 0 && i < state.queue.length && state.queue[i].locked) {
      i += delta;
    }
    if (i < 0 || i >= state.queue.length) {
      audio.pause();
      return;
    }
    playIdx(i);
  }

  function togglePlay() {
    if (state.currentIdx < 0) {
      // Nothing loaded; play first non-locked item
      const idx = state.queue.findIndex(t => !t.locked);
      if (idx >= 0) playIdx(idx);
      return;
    }
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  function onTimeUpdate() {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    $('.mmp-progress-fill', barEl).style.width = pct + '%';
    renderTimes();
    saveState();
  }

  function onEnded() {
    advance(+1);
  }

  function triggerSignup() {
    const trigger = document.querySelector('[data-portal="signup"]');
    if (trigger) trigger.click();
    else location.hash = '#/portal/signup';
  }

  // ----- UI -----
  function injectStyles() {
    if (document.getElementById('mmp-styles')) return;
    const s = document.createElement('style');
    s.id = 'mmp-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function createBar() {
    barEl = document.createElement('div');
    barEl.className = 'mmp-bar';
    barEl.innerHTML = `
      <div class="mmp-progress" role="slider" aria-label="Seek">
        <div class="mmp-progress-fill"></div>
      </div>
      <div class="mmp-mini">
        <div class="mmp-thumb">${ICONS.note}</div>
        <div class="mmp-title mmp-title-empty">Nothing playing</div>
        <div class="mmp-time-display"><span class="mmp-time-cur">0:00</span> / <span class="mmp-time-dur">0:00</span></div>
        <div class="mmp-controls">
          <button class="mmp-btn mmp-btn-prev" aria-label="Previous">${ICONS.prev}</button>
          <button class="mmp-btn mmp-btn-play" aria-label="Play">${ICONS.play}</button>
          <button class="mmp-btn mmp-btn-next" aria-label="Next">${ICONS.next}</button>
          <button class="mmp-btn mmp-btn-expand" aria-label="Show queue">${ICONS.expand}</button>
          <button class="mmp-btn mmp-btn-close" aria-label="Close player">${ICONS.close}</button>
        </div>
      </div>
      <div class="mmp-expanded">
        <div class="mmp-queue-header">Up next</div>
        <div class="mmp-queue-list"></div>
      </div>
    `;
    document.body.appendChild(barEl);
    document.body.classList.add('mmp-active');

    $('.mmp-btn-prev', barEl).addEventListener('click', () => advance(-1));
    $('.mmp-btn-play', barEl).addEventListener('click', togglePlay);
    $('.mmp-btn-next', barEl).addEventListener('click', () => advance(+1));
    $('.mmp-btn-expand', barEl).addEventListener('click', toggleExpanded);
    $('.mmp-btn-close', barEl).addEventListener('click', closeBar);
    $('.mmp-progress', barEl).addEventListener('click', onProgressClick);
  }

  function onProgressClick(e) {
    if (!audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
  }

  function showBar() { barEl.classList.add('is-visible'); }
  function closeBar() {
    audio.pause();
    barEl.classList.remove('is-visible');
    barEl.classList.remove('is-open');
    state.currentIdx = -1;
    state.expanded = false;
    try { localStorage.removeItem(CONFIG.storageKey); } catch (e) {}
    renderCardButtons();
  }

  function toggleExpanded() {
    state.expanded = !state.expanded;
    barEl.classList.toggle('is-open', state.expanded);
    $('.mmp-btn-expand', barEl).innerHTML = state.expanded ? ICONS.collapse : ICONS.expand;
  }

  function renderTrack() {
    const t = state.queue[state.currentIdx];
    const titleEl = $('.mmp-title', barEl);
    if (!t) {
      titleEl.textContent = 'Nothing playing';
      titleEl.classList.add('mmp-title-empty');
    } else {
      titleEl.textContent = t.title;
      titleEl.classList.remove('mmp-title-empty');
    }
    renderPlayPause();
  }

  function renderPlayPause() {
    const btn = $('.mmp-btn-play', barEl);
    btn.innerHTML = (audio && !audio.paused) ? ICONS.pause : ICONS.play;
    btn.setAttribute('aria-label', audio && !audio.paused ? 'Pause' : 'Play');
    renderCardButtons();
  }

  function renderTimes() {
    if (!audio) return;
    $('.mmp-time-cur', barEl).textContent = fmtTime(audio.currentTime);
    $('.mmp-time-dur', barEl).textContent = fmtTime(audio.duration);
  }

  function renderQueue() {
    const list = $('.mmp-queue-list', barEl);
    if (!list) return;
    list.innerHTML = state.queue.map((t, i) => {
      const classes = ['mmp-queue-item'];
      if (i === state.currentIdx) classes.push('is-current');
      if (t.locked) classes.push('is-locked');
      const iconHtml = t.locked ? ICONS.lock : '';
      return `<div class="${classes.join(' ')}" data-idx="${i}">
        <div class="mmp-queue-num">${i + 1}</div>
        <div class="mmp-queue-title">${escapeHtml(t.title)}</div>
        <div class="mmp-queue-icon">${iconHtml}</div>
      </div>`;
    }).join('');
    $$('.mmp-queue-item', list).forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx, 10);
        const t = state.queue[idx];
        if (t.locked) { triggerSignup(); return; }
        playIdx(idx);
      });
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ----- card play buttons -----
  function handleCardPlayClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    const btn = e.currentTarget;
    const idx = parseInt(btn.dataset.idx, 10);
    const track = state.queue[idx];
    if (!track) return;
    if (track.locked) { triggerSignup(); return; }
    if (idx === state.currentIdx) { togglePlay(); return; }
    playIdx(idx);
  }

  function renderCardButtons() {
    state.queue.forEach((t, i) => {
      if (!t.cardEl) return;
      let btn = t.cardEl.querySelector(':scope > .mmp-card-play');
      if (!btn) {
        btn = document.createElement('button');
        btn.className = 'mmp-card-play';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Play');
        btn.dataset.idx = String(i);
        btn.addEventListener('click', handleCardPlayClick);
        // Make the card a positioning context so the absolute button sits over it
        if (getComputedStyle(t.cardEl).position === 'static') {
          t.cardEl.style.position = 'relative';
        }
        // Insert as a direct child of the card, OUTSIDE any <a> link wrapper inside
        t.cardEl.insertBefore(btn, t.cardEl.firstChild);
      } else {
        btn.dataset.idx = String(i);
      }
      btn.classList.toggle('is-current', i === state.currentIdx);
      btn.classList.toggle('is-locked', !!t.locked);
      btn.innerHTML = (i === state.currentIdx && audio && !audio.paused)
        ? ICONS.pause
        : (t.locked ? ICONS.lock : ICONS.play);
    });
  }

  // ----- init -----
  function init() {
    if (window.__mmpInited) return;
    window.__mmpInited = true;
    injectStyles();
    initAudio();
    createBar();
    state.queue = buildQueue();
    renderQueue();
    renderCardButtons();

    // Resume saved track if found and present in queue
    const saved = loadSavedTrack();
    if (saved) {
      const idx = state.queue.findIndex(t => t.slug === saved.slug);
      if (idx >= 0) {
        const t = state.queue[idx];
        if (saved.audioUrl) { t.audioUrl = saved.audioUrl; t.loaded = true; }
        state.currentIdx = idx;
        showBar();
        renderTrack();
        renderQueue();
        renderCardButtons();
        // Don't autoplay on load; user can tap play. Just preload position.
        if (t.audioUrl) {
          audio.src = t.audioUrl;
          audio.currentTime = saved.position || 0;
        }
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
