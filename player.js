/*!
 * Moving Music Player v0.3.3
 * Fixed-bottom playlist audio player for movingmusic.works
 * https://github.com/bennett-hue/moving-music-player
 *
 * v0.2.0 model: cards have a `+` button that ADDS songs to a user-curated
 * playlist (persists in localStorage across pages). Once added, the icon
 * flips to ✓ — click again to remove. The bar plays through the playlist;
 * skip/prev navigates it. The first add auto-starts playback.
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
    /* Source theme gives .feed-title { opacity: 0.8 }, which creates a
       stacking context that traps our button's z-index — without an
       explicit z-index on .feed-title, our button can't actually beat
       .u-permalink (z:50). So we raise .feed-title to z:60 AND make it
       pointer-events: none so title-text clicks fall through to the
       overlay link (post navigation), while the button re-enables
       pointer-events: auto so it still receives its own clicks. */
    body.mmp-active .feed-title { position: relative; z-index: 60; pointer-events: none; }
    body.mmp-active .feed-title a { pointer-events: auto; }
    .mmp-card-play {
      display: inline-flex; align-items: center; justify-content: center;
      width: 40px; height: 40px;
      background: transparent;
      color: #111;
      border: 0; padding: 8px;
      margin: 0 6px 0 -8px;
      vertical-align: middle;
      cursor: pointer;
      touch-action: manipulation;
      position: relative;
      z-index: 100;
      pointer-events: auto;
      border-radius: 50%;
      transition: background 0.15s, transform 0.1s;
    }
    body.mm-signed-in .mmp-card-play { color: ${CONFIG.accentColor}; }
    .mmp-card-play.is-added { color: ${CONFIG.accentColor}; }
    .mmp-card-play.is-locked { color: #999; }
    .mmp-card-play:hover { background: rgba(212, 160, 25, 0.15); }
    .mmp-card-play:active { transform: scale(0.92); }
    .mmp-card-play, body.mmp-active .feed-title .mmp-card-play { pointer-events: auto; }
    .mmp-card-play svg { width: 24px; height: 24px; fill: currentColor; vertical-align: middle; pointer-events: none; }
    .mmp-queue-empty {
      padding: 18px 16px; color: #777; font-size: 13px; font-style: italic;
    }
    .mmp-queue-remove {
      flex: 0 0 auto;
      width: 28px; height: 28px;
      background: transparent; border: 0; padding: 0;
      color: #999; cursor: pointer; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .mmp-queue-remove:hover { color: #333; background: rgba(0,0,0,0.06); }
    .mmp-queue-remove svg { width: 14px; height: 14px; fill: currentColor; }
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
    plus: '<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
    remove: '<svg viewBox="0 0 24 24"><path d="M19 13H5v-2h14z"/></svg>',
  };

  // ----- state -----
  let state = {
    // queue = user-curated playlist (persisted in localStorage)
    queue: [],
    // cardsOnPage = scan of current DOM for rendering the per-card + buttons
    cardsOnPage: [],
    currentIdx: -1,
    expanded: false,
  };
  let audio = null;
  let barEl = null;
  let lastSaveAt = 0;

  // ----- helpers -----
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // Auth state — checked LAZILY at render time. Ghost portal + Bennett's nav
  // injection add the signal asynchronously; on this site `a.mm-loggedin`
  // (the gold "Logged In" link Bennett swaps in for signed-in members) is
  // the most reliable indicator because his body-class poller times out
  // before Ghost portal finishes initializing.
  function isSignedIn() {
    return document.body.classList.contains('mm-signed-in')
      || !!document.querySelector('a.mm-loggedin')
      || !!document.querySelector('[data-portal="account"]');
  }
  function lockedFor(t) {
    if (!t) return false;
    if (t.lockedFromFetch) return true;
    if (isSignedIn()) return false;
    return !!(t.isPaid || t.isMembers);
  }
  function hasStartedPlayback() {
    return !!audio && audio.played && audio.played.length > 0;
  }

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

  // Album-tag pages append a `.album-tier-badge` ("No account needed" /
  // "Full access with membership" / "Free to all this week!") to .feed-title.
  // Read the title without that suffix (and without the visibility-icon block).
  function cleanTitle(titleEl) {
    if (!titleEl) return '';
    const clone = titleEl.cloneNode(true);
    clone.querySelectorAll('.album-tier-badge, .feed-visibility, .mmp-card-play').forEach(b => b.remove());
    return clone.textContent.trim();
  }

  // ----- audio URL resolution -----
  // Fetch the rendered post HTML directly so the member session cookie is
  // honored. The Content API serves only public previews, which means paid
  // posts come back without the <audio> tag even for paying members.
  // Falls back to a YouTube embed if present (played via the IFrame API).
  const audioUrlCache = new Map();
  async function fetchAudioUrl(slug) {
    if (audioUrlCache.has(slug)) return audioUrlCache.get(slug);
    try {
      const r = await fetch(`/${encodeURIComponent(slug)}/`, { credentials: 'same-origin' });
      if (!r.ok) return { error: `http_${r.status}` };
      const html = await r.text();
      const audioMatch = html.match(/<audio[^>]+src=["']([^"']+)["']/i);
      if (audioMatch) {
        const result = { audioUrl: audioMatch[1] };
        audioUrlCache.set(slug, result);
        return result;
      }
      // Comprehensive YouTube ID extraction: embed, watch, shorts, youtu.be
      const ytMatch = html.match(/(?:(?:m\.|www\.)?youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?[^"'<>]*v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i);
      if (ytMatch) {
        const result = { youtubeId: ytMatch[1] };
        audioUrlCache.set(slug, result);
        return result;
      }
      console.warn('[mmp] no audio or YouTube in', slug);
      const result = { unplayable: true };
      audioUrlCache.set(slug, result);
      return result;
    } catch (e) {
      return { error: e.message || String(e) };
    }
  }

  // ----- state persistence (cross-page) -----
  function saveState() {
    const now = Date.now();
    if (now - lastSaveAt < 2000) return;
    lastSaveAt = now;
    persistStateNow();
  }
  function persistStateNow() {
    try {
      const t = state.currentIdx >= 0 ? state.queue[state.currentIdx] : null;
      let position = 0;
      let isPlaying = false;
      if (t && t.youtubeId && !t.audioUrl) {
        if (ytPlayer && ytReady) {
          try { position = ytPlayer.getCurrentTime(); } catch (e) {}
          isPlaying = isYtPlaying();
        }
      } else if (audio) {
        position = audio.currentTime;
        isPlaying = !audio.paused;
      }
      localStorage.setItem(CONFIG.storageKey, JSON.stringify({
        slug: t ? t.slug : null,
        title: t ? t.title : null,
        audioUrl: t ? t.audioUrl : null,
        youtubeId: t ? t.youtubeId : null,
        position,
        isPlaying,
        queue: state.queue.map(q => ({
          slug: q.slug, title: q.title,
          isPaid: !!q.isPaid, isMembers: !!q.isMembers,
          audioUrl: q.audioUrl || null,
          youtubeId: q.youtubeId || null,
        })),
        savedAt: Date.now(),
      }));
    } catch (e) {}
  }

  function loadSavedTrack() {
    try {
      const raw = localStorage.getItem(CONFIG.storageKey);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.slug) return null;
      if (Date.now() - (s.savedAt || 0) > 1000 * 60 * 60 * 24) return null;
      return s;
    } catch (e) { return null; }
  }

  // ----- card scan (separate from the user's playlist) -----
  // Scans the current DOM for song cards so we know where to render the
  // `+` / `✓` buttons. Does NOT populate the playback queue — the user's
  // playlist (state.queue) is curated by clicking those buttons.
  function scanCards() {
    const items = [];
    const seen = new Set();

    // Single-post page: real audio card (already-decoded URL, no fetch needed)
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
        isPaid: false, isMembers: false,
        loaded: true,
        cardEl: card,
      });
    });

    // Feed pages: article.feed.post (or .feed) cards.
    // `tag-library` is the canonical "all songs" tag on this site — present
    // on every song, regardless of whether the universal `tag-songs` got
    // detached during the duplicate-tag cleanup. Filtering by library is
    // safer than filtering by songs.
    $$('article.feed.post, article.post-card, article.feed').forEach(card => {
      if (!card.matches('.tag-library, .tag-songs, .tag-songs-2')) return;
      // Source theme's `.u-permalink` is the canonical post link covering
      // each card. Using a bare `a[href]` selector grabs the first link in
      // the article, which may be an inline tag link (e.g. /tag/originals/)
      // and gives a wrong slug.
      const link = card.querySelector('a.u-permalink') || card.querySelector('a[href]:not([href*="/tag/"]):not([href*="/author/"])');
      const titleEl = card.querySelector('.feed-title, .post-card-title, h2, h3, .gh-card-title');
      if (!link || !titleEl) return;
      const slug = slugFromHref(link.getAttribute('href'));
      if (!slug || slug.startsWith('tag/') || slug.startsWith('author/') || seen.has(slug)) return;
      seen.add(slug);
      items.push({
        slug,
        title: cleanTitle(titleEl),
        audioUrl: null,
        isPaid: !!card.querySelector('.feed-visibility-paid'),
        isMembers: !!card.querySelector('.feed-visibility-members'),
        loaded: false,
        cardEl: card,
      });
    });

    return items;
  }

  // ----- playlist mutations -----
  function inPlaylist(slug) {
    return state.queue.findIndex(t => t.slug === slug);
  }

  function addToPlaylist(card) {
    if (!card || inPlaylist(card.slug) >= 0) return;
    const wasEmpty = state.queue.length === 0;
    state.queue.push({
      slug: card.slug,
      title: card.title,
      isPaid: !!card.isPaid,
      isMembers: !!card.isMembers,
      audioUrl: card.audioUrl || null,
      loaded: !!card.audioUrl,
      cardEl: card.cardEl,
    });
    persistStateNow();
    renderQueue();
    renderCardButtons();
    if (wasEmpty) {
      // First add: auto-play immediately (this click is a user gesture so
      // browser autoplay rules are satisfied).
      playIdx(0);
    }
  }

  function removeFromPlaylist(slug) {
    const idx = inPlaylist(slug);
    if (idx < 0) return;
    const wasCurrent = state.currentIdx === idx;
    state.queue.splice(idx, 1);
    if (wasCurrent) {
      if (audio) audio.pause();
      state.currentIdx = state.queue.length > 0 ? Math.min(idx, state.queue.length - 1) : -1;
      if (state.currentIdx >= 0) renderTrack();
      else {
        const titleEl = $('.mmp-title', barEl);
        if (titleEl) {
          titleEl.textContent = 'Empty playlist';
          titleEl.classList.add('mmp-title-empty');
        }
        renderPlayPause();
      }
    } else if (state.currentIdx > idx) {
      state.currentIdx--;
    }
    persistStateNow();
    renderQueue();
    renderCardButtons();
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

  // ----- YouTube IFrame Player (for posts that have a YouTube embed but no Ghost <audio>) -----
  let ytPlayer = null;
  let ytReady = false;
  let ytTimer = null;
  let ytApiLoading = false;
  function loadYtApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (ytApiLoading) return ytApiLoading;
    ytApiLoading = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) try { prev(); } catch (e) {} resolve(); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    });
    return ytApiLoading;
  }
  async function ensureYtPlayer() {
    await loadYtApi();
    if (ytPlayer) return ytPlayer;
    let holder = document.getElementById('mmp-yt-holder');
    if (!holder) {
      holder = document.createElement('div');
      holder.id = 'mmp-yt-holder';
      holder.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:200px;height:120px;pointer-events:none;';
      const inner = document.createElement('div');
      inner.id = 'mmp-yt-player';
      holder.appendChild(inner);
      document.body.appendChild(holder);
    }
    await new Promise(resolve => {
      ytPlayer = new YT.Player('mmp-yt-player', {
        height: '120', width: '200',
        playerVars: { autoplay: 0, controls: 0, modestbranding: 1, playsinline: 1, rel: 0 },
        events: {
          onReady: () => { ytReady = true; resolve(); },
          onStateChange: onYtStateChange,
        },
      });
    });
    return ytPlayer;
  }
  function onYtStateChange(e) {
    if (!window.YT) return;
    if (e.data === YT.PlayerState.ENDED) { onEnded(); return; }
    if (e.data === YT.PlayerState.PLAYING) { startYtTimer(); renderPlayPause(); }
    if (e.data === YT.PlayerState.PAUSED) { renderPlayPause(); }
  }
  function startYtTimer() {
    stopYtTimer();
    ytTimer = setInterval(ytTick, 500);
  }
  function stopYtTimer() {
    if (ytTimer) { clearInterval(ytTimer); ytTimer = null; }
  }
  function ytTick() {
    if (!ytPlayer || !ytReady) return;
    try {
      const cur = ytPlayer.getCurrentTime();
      const dur = ytPlayer.getDuration();
      if (dur > 0) {
        const pct = (cur / dur) * 100;
        const fill = $('.mmp-progress-fill', barEl);
        if (fill) fill.style.width = pct + '%';
        const c = $('.mmp-time-cur', barEl);
        const d = $('.mmp-time-dur', barEl);
        if (c) c.textContent = fmtTime(cur);
        if (d) d.textContent = fmtTime(dur);
      }
    } catch (e) {}
    saveState();
  }
  function isYtPlaying() {
    if (!ytPlayer || !ytReady || !window.YT) return false;
    try { return ytPlayer.getPlayerState() === YT.PlayerState.PLAYING; } catch (e) { return false; }
  }
  function currentSourceIsYt() {
    const t = state.queue[state.currentIdx];
    return !!(t && t.youtubeId && !t.audioUrl);
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
      if (result.unplayable) {
        // No audio AND no YouTube in the post HTML. Skip silently — do NOT
        // pop the Ghost portal modal because that interrupts everything and
        // is the wrong UX when the user clicked + on a track that just
        // happens to lack playable media (e.g. legacy post with neither).
        console.warn('[mmp] track has no playable media, skipping:', track.slug);
        track.unplayable = true;
        track.loaded = true;
        renderQueue();
        renderCardButtons();
        return advance(+1, idx);
      }
      if (result.locked) {
        track.lockedFromFetch = true;
        track.loaded = true;
        renderQueue();
        renderCardButtons();
        try { audio.pause(); } catch (e) {}
        triggerSignup();
        return;
      }
      if (result.youtubeId) {
        track.youtubeId = result.youtubeId;
      } else if (result.audioUrl) {
        track.audioUrl = result.audioUrl;
      }
      track.loaded = true;
      if (result.title) track.title = result.title;
      renderTrack();
    }

    if (lockedFor(track)) {
      triggerSignup();
      return advance(+1, idx);
    }

    if (track.audioUrl) {
      // HTML5 audio path — stop any YT playback first
      if (ytPlayer && ytReady) { try { ytPlayer.pauseVideo(); } catch (e) {} }
      stopYtTimer();
      if (audio.src !== track.audioUrl) audio.src = track.audioUrl;
      try { await audio.play(); }
      catch (e) { console.warn('[mmp] play() rejected', e); }
    } else if (track.youtubeId) {
      // YouTube path — stop HTML5 audio first
      try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (e) {}
      await ensureYtPlayer();
      try {
        ytPlayer.loadVideoById(track.youtubeId);
        ytPlayer.playVideo();
      } catch (e) { console.warn('[mmp] yt play rejected', e); }
    }
    saveState();
  }

  function advance(delta, fromIdx) {
    // Idle bar: prev/next do nothing until user starts something
    if (state.currentIdx < 0 && fromIdx == null) return;
    let start = (fromIdx == null ? state.currentIdx : fromIdx);
    let i = start + delta;
    while (i >= 0 && i < state.queue.length && lockedFor(state.queue[i])) {
      i += delta;
    }
    if (i < 0 || i >= state.queue.length) {
      if (audio) audio.pause();
      return;
    }
    playIdx(i);
  }

  function togglePlay() {
    if (state.currentIdx < 0) {
      const idx = state.queue.findIndex(t => !lockedFor(t));
      if (idx >= 0) playIdx(idx);
      return;
    }
    const t = state.queue[state.currentIdx];
    if (lockedFor(t)) { triggerSignup(); return; }
    if (!t) { return; }
    // YouTube source
    if (t.youtubeId && !t.audioUrl) {
      if (!ytPlayer || !ytReady) { playIdx(state.currentIdx); return; }
      if (isYtPlaying()) { try { ytPlayer.pauseVideo(); } catch (e) {} }
      else { try { ytPlayer.playVideo(); } catch (e) {} }
      return;
    }
    // HTML5 audio source
    if (!t.audioUrl || audio.src !== t.audioUrl) {
      playIdx(state.currentIdx);
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
        <div class="mmp-title mmp-title-empty">Tap + on a song to start</div>
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
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    if (currentSourceIsYt()) {
      if (!ytPlayer || !ytReady) return;
      try {
        const dur = ytPlayer.getDuration();
        if (dur > 0) ytPlayer.seekTo(pct * dur, true);
      } catch (e) {}
    } else if (audio.duration) {
      audio.currentTime = pct * audio.duration;
    }
  }

  function showBar() { barEl.classList.add('is-visible'); }
  function closeBar() {
    try { audio.pause(); } catch (e) {}
    try { if (ytPlayer && ytReady) ytPlayer.pauseVideo(); } catch (e) {}
    stopYtTimer();
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
      titleEl.textContent = state.queue.length === 0
        ? 'Tap + on a song to start'
        : 'Tap play to begin';
      titleEl.classList.add('mmp-title-empty');
    } else {
      titleEl.textContent = t.title;
      titleEl.classList.remove('mmp-title-empty');
    }
    renderPlayPause();
  }

  function renderPlayPause() {
    const btn = $('.mmp-btn-play', barEl);
    const playing = currentSourceIsYt()
      ? isYtPlaying()
      : !!(audio && !audio.paused);
    btn.innerHTML = playing ? ICONS.pause : ICONS.play;
    btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
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
    if (state.queue.length === 0) {
      list.innerHTML = `<div class="mmp-queue-empty">Add songs with the + button on any track.</div>`;
      return;
    }
    list.innerHTML = state.queue.map((t, i) => {
      const locked = lockedFor(t);
      const classes = ['mmp-queue-item'];
      if (i === state.currentIdx) classes.push('is-current');
      if (locked) classes.push('is-locked');
      return `<div class="${classes.join(' ')}" data-idx="${i}">
        <div class="mmp-queue-num">${i + 1}</div>
        <div class="mmp-queue-title">${escapeHtml(t.title)}</div>
        <button class="mmp-queue-remove" data-slug="${escapeHtml(t.slug)}" aria-label="Remove">${ICONS.close}</button>
      </div>`;
    }).join('');
    $$('.mmp-queue-item', list).forEach(el => {
      el.addEventListener('click', (e) => {
        const remBtn = e.target.closest('.mmp-queue-remove');
        if (remBtn) {
          e.stopPropagation();
          removeFromPlaylist(remBtn.dataset.slug);
          return;
        }
        const idx = parseInt(el.dataset.idx, 10);
        const t = state.queue[idx];
        if (lockedFor(t)) { triggerSignup(); return; }
        playIdx(idx);
      });
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ----- card buttons (+ / ✓ / lock) -----
  function handleCardClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    const slug = e.currentTarget.dataset.slug;
    const card = state.cardsOnPage.find(c => c.slug === slug);
    if (!card) return;
    if (lockedFor(card)) { triggerSignup(); return; }
    if (inPlaylist(slug) >= 0) {
      removeFromPlaylist(slug);
    } else {
      addToPlaylist(card);
    }
  }

  function renderCardButtons() {
    state.cardsOnPage.forEach(card => {
      if (!card.cardEl) return;
      let btn = card.cardEl.querySelector('.mmp-card-play');
      if (!btn) {
        btn = document.createElement('button');
        btn.className = 'mmp-card-play';
        btn.type = 'button';
        btn.dataset.slug = card.slug;
        btn.addEventListener('click', handleCardClick);
        btn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        btn.addEventListener('touchstart', (e) => { e.stopPropagation(); }, { passive: true });
        const titleEl = card.cardEl.querySelector('.feed-title, .post-card-title, .kg-audio-title, h2, h3');
        if (titleEl) titleEl.insertBefore(btn, titleEl.firstChild);
        else card.cardEl.insertBefore(btn, card.cardEl.firstChild);
      } else {
        btn.dataset.slug = card.slug;
      }
      const locked = lockedFor(card);
      const added = !locked && inPlaylist(card.slug) >= 0;
      btn.classList.toggle('is-locked', locked);
      btn.classList.toggle('is-added', added);
      btn.setAttribute('aria-label', locked ? 'Locked' : (added ? 'Remove from playlist' : 'Add to playlist'));
      btn.innerHTML = locked ? ICONS.lock : (added ? ICONS.check : ICONS.plus);
    });
  }

  // ----- DOM observer: refresh per-page card scan when sort/pagination changes -----
  let observeDebounce = null;
  function rebuildFromDom() {
    state.cardsOnPage = scanCards();
    // Re-attach fresh cardEl refs onto matching playlist entries
    const cardBySlug = new Map(state.cardsOnPage.map(c => [c.slug, c]));
    state.queue.forEach(t => {
      const c = cardBySlug.get(t.slug);
      if (c) t.cardEl = c.cardEl;
    });
    renderCardButtons();
  }

  function startObserver() {
    const target = document.querySelector('main, .gh-main, .gh-content') || document.body;
    const obs = new MutationObserver((mutations) => {
      const meaningful = mutations.some(m => Array.from(m.addedNodes).concat(Array.from(m.removedNodes))
        .some(n => n.nodeType === 1 && !n.classList?.contains('mmp-card-play')));
      if (!meaningful) return;
      clearTimeout(observeDebounce);
      observeDebounce = setTimeout(rebuildFromDom, 150);
    });
    obs.observe(target, { childList: true, subtree: true });

    // Ghost portal adds [data-portal="account"] / body.mm-signed-in asynchronously.
    // When that flips, re-render so paid tracks unlock for the signed-in user.
    let lastAuth = isSignedIn();
    const authObs = new MutationObserver(() => {
      const now = isSignedIn();
      if (now !== lastAuth) {
        lastAuth = now;
        renderQueue();
        renderCardButtons();
      }
    });
    authObs.observe(document.body, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
  }

  // ----- init -----
  function init() {
    if (window.__mmpInited) return;
    window.__mmpInited = true;
    injectStyles();
    initAudio();
    createBar();

    // The user's playlist is the persisted source of truth — load it,
    // then scan the current page just to render the per-card +/✓ icons.
    const saved = loadSavedTrack();
    state.cardsOnPage = scanCards();
    const cardBySlug = new Map(state.cardsOnPage.map(c => [c.slug, c]));

    if (saved && Array.isArray(saved.queue)) {
      state.queue = saved.queue.map(sq => {
        const card = cardBySlug.get(sq.slug);
        const audioUrl = (card && card.audioUrl) || sq.audioUrl || null;
        const youtubeId = sq.youtubeId || null;
        return {
          slug: sq.slug,
          title: sq.title,
          isPaid: !!sq.isPaid,
          isMembers: !!sq.isMembers,
          audioUrl,
          youtubeId,
          loaded: !!(audioUrl || youtubeId),
          cardEl: card ? card.cardEl : null,
        };
      });
    }

    renderQueue();
    renderCardButtons();
    startObserver();

    showBar();

    // If the user was actively playing when they navigated, resume that
    // exact track at the saved position (must be in the persisted playlist).
    const age = saved ? Date.now() - (saved.savedAt || 0) : Infinity;
    if (saved && saved.slug && saved.isPlaying && age < 10 * 1000) {
      const idx = state.queue.findIndex(t => t.slug === saved.slug);
      if (idx >= 0) {
        state.currentIdx = idx;
        const t = state.queue[idx];
        if (saved.audioUrl) {
          t.audioUrl = saved.audioUrl;
          t.loaded = true;
          try {
            audio.src = saved.audioUrl;
            audio.currentTime = saved.position || 0;
          } catch (e) {}
          renderTrack(); renderQueue(); renderCardButtons();
          audio.play().catch(() => {});
        } else if (saved.youtubeId) {
          t.youtubeId = saved.youtubeId;
          t.loaded = true;
          renderTrack(); renderQueue(); renderCardButtons();
          ensureYtPlayer().then(() => {
            try {
              ytPlayer.loadVideoById({ videoId: saved.youtubeId, startSeconds: saved.position || 0 });
              ytPlayer.playVideo();
            } catch (e) {}
          });
        } else {
          renderTrack(); renderQueue(); renderCardButtons();
        }
      }
    } else {
      renderTrack();
    }

    window.addEventListener('pagehide', persistStateNow);
    window.addEventListener('beforeunload', persistStateNow);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
