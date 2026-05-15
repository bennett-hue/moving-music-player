/*!
 * Moving Music Player v0.10.0
 * Fixed-bottom playlist audio player for movingmusic.works
 * https://github.com/bennett-hue/moving-music-player
 *
 * v0.2.0 model: cards have a `+` button that ADDS songs to a user-curated
 * playlist (persists in localStorage across pages). Once added, the icon
 * flips to ✓ — click again to remove. The bar plays through the playlist;
 * skip/prev navigates it. The first add auto-starts playback.
 *
 * v0.4.0: signed-in members' playlists sync across devices via a Cloudflare
 * Worker keyed by Ghost member UUID. Signed-out users get localStorage only.
 *
 * v0.5.0: drag-to-reorder the queue (SortableJS lazy-loaded) + Save/Load
 * named setlists. The queue IS the setlist — Save snapshots it under a
 * name, Load swaps the queue back in. localStorage-only for now; Worker
 * KV sync for named setlists is the next step.
 *
 * v0.6.0: share named setlists via a public link. Owner taps Share on a
 * saved setlist → Worker stores the snapshot under a random shareId →
 * URL is `?setlist={shareId}`. Anyone who opens that URL sees an import
 * banner with "Save to my setlists" / "Play now" / dismiss. Worker route
 * /shared/:shareId is open-read, open-write — shareId is the secret.
 *
 * v0.7.0: shared setlists are LIVE (Google-Doc-style read-only). Loading
 * or saving a setlist "links" the queue to that saved setlist via
 * state.linkedSetlistId. Every queue mutation (add, remove, reorder)
 * flows back to the saved setlist, and — if it has a shareId — pushes
 * a debounced update to the Worker. Recipients always see the latest
 * version on next page load. Save button becomes "Save as new" while
 * editing a linked setlist, so forking is one click away.
 *
 * v0.10.0: starter setlists — six built-in, tag-driven setlists pinned to
 * the top of Saved Setlists for every visitor. Virtual: songs are pulled
 * live from the Content API for each tag and cached for 6h, so the lists
 * auto-update as tag membership changes. Built-ins have no delete/share
 * buttons; users who want to edit one tap it then Save as a copy.
 */
(() => {
  'use strict';

  const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';
  const ASSET_BASE = SCRIPT_SRC.replace(/\/player\.js.*$/, '');

  const CONFIG = {
    contentApiKey: '4bb24d5f52e1f7397cb4fe24a5',
    apiBase: 'https://moving-music.ghost.io/ghost/api/content',
    storageKey: 'mmp-state-v1',
    accentColor: '#2A8C82',
    panelBg: '#f3f1ec',
    syncUrl: 'https://mmp-sync.bennett-727.workers.dev',
    sortableCdn: 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.7/Sortable.min.js',
    namedSetlistsKey: 'mm-named-setlists-v1',
    starterCacheKey: 'mm-starter-setlists-v1',
    starterCacheTtl: 6 * 60 * 60 * 1000,
    starterSetlists: [
      { id: '_starter_intro', name: 'Intro Songs', tag: 'free' },
      { id: '_starter_courage', name: 'Songs of Courage', tag: 'courage' },
      { id: '_starter_woods', name: 'Forest & Wood', tag: 'woods' },
      { id: '_starter_sea', name: 'Sea Songs & Shanties', tag: 'sea-shanties' },
      { id: '_starter_field', name: 'In The Field, In The Dusk, In The Summer (2015)', tag: 'album-in-the-field' },
      { id: '_starter_mm', name: 'Mountain Mover (2026)', tag: 'album-mountain-mover' },
    ],
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
    .mmp-bar.is-fullscreen { top: 0; max-height: none; }
    .mmp-bar.is-fullscreen .mmp-expanded { max-height: none; }
    /* Ghost's audio card has a custom JS-rendered player UI (scrubber,
       speed, volume) that competes with our bar at the bottom. On post
       pages we hide the whole .kg-audio-card and insert a clean
       single-button replacement in its place. */
    body.mmp-active .kg-audio-card[data-mmp-simplified="1"] {
      display: none !important;
    }
    .mmp-simple-audio-wrapper { margin: 1.2em 0; }
    .mmp-simple-audio {
      display: flex; align-items: center; gap: 14px;
      width: 100%;
      padding: 14px 18px;
      background: ${CONFIG.panelBg};
      border: 1px solid #d8d4cc;
      border-radius: 8px;
      cursor: pointer;
      font-family: inherit;
      font-size: 15px;
      font-weight: 600;
      color: #222;
      text-align: left;
      transition: background 0.15s, border-color 0.15s;
      touch-action: manipulation;
    }
    .mmp-simple-audio:hover {
      background: rgba(42, 140, 130, 0.08);
      border-color: ${CONFIG.accentColor};
    }
    .mmp-simple-audio.is-current {
      border-color: ${CONFIG.accentColor};
      background: rgba(42, 140, 130, 0.06);
    }
    .mmp-simple-audio-icon {
      flex: 0 0 36px; width: 36px; height: 36px;
      border-radius: 50%;
      background: ${CONFIG.accentColor};
      color: #fff;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .mmp-simple-audio-icon svg { width: 20px; height: 20px; fill: currentColor; }
    .mmp-simple-audio-title {
      flex: 1 1 auto; min-width: 0;
      font-weight: 600; color: #222;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .mmp-progress {
      position: absolute; top: 0; left: 0; right: 0;
      height: 3px; background: rgba(0,0,0,0.08);
      cursor: pointer;
      touch-action: none;
    }
    .mmp-progress-fill {
      height: 100%; background: ${CONFIG.accentColor};
      width: 0%;
    }
    .mmp-progress-thumb {
      position: absolute; top: 50%; left: 0;
      width: 12px; height: 12px;
      margin-left: -6px;
      transform: translateY(-50%);
      background: ${CONFIG.accentColor};
      border: 2px solid #fff;
      border-radius: 50%;
      box-shadow: 0 1px 3px rgba(0,0,0,0.25);
      pointer-events: none;
      transition: opacity 0.15s ease;
    }
    .mmp-mini {
      position: relative;
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px;
      min-height: 56px;
      /* New layout: mini stays pinned to the bottom of the bar.
         The expanded panel grows upward above it. */
      flex: 0 0 auto;
    }
    .mmp-thumb {
      width: 40px; height: 40px; flex: 0 0 40px;
      border-radius: 4px;
      background: ${CONFIG.panelBg};
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; color: #999;
      overflow: hidden;
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
      display: flex; align-items: center; justify-content: space-between;
    }
    .mmp-queue-clear {
      background: transparent;
      border: 1px solid #d8d4cc;
      color: #777;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: color 0.15s, border-color 0.15s;
    }
    .mmp-queue-clear:hover { color: #b8451f; border-color: #b8451f; }
    .mmp-queue-clear:disabled { opacity: 0.35; cursor: default; }
    .mmp-add-all-wrap {
      margin: 0 0 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .mmp-show-tags {
      display: inline-block;
      margin-left: auto;
      padding: 5px 12px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border: 1px solid #d8d4cc;
      border-radius: 999px;
      background: transparent;
      color: #777;
      cursor: pointer;
      font-family: inherit;
      transition: color 0.15s, border-color 0.15s;
    }
    .mmp-show-tags:hover { color: #222; border-color: #999; }
    .mmp-add-all {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 12px;
      margin: 0;
      background: transparent;
      color: ${CONFIG.accentColor};
      border: 1px solid ${CONFIG.accentColor};
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s, transform 0.1s;
    }
    .mmp-add-all:hover { background: rgba(42, 140, 130, 0.1); }
    .mmp-add-all:active { transform: scale(0.97); }
    .mmp-add-all svg { width: 14px; height: 14px; fill: currentColor; }
    .mmp-queue-item {
      display: flex; align-items: center; gap: 8px;
      padding: 4px 14px;
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
    .mmp-queue-play {
      flex: 0 0 24px;
      width: 24px; height: 24px;
      background: transparent; border: 0; padding: 0;
      color: ${CONFIG.accentColor};
      cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 50%;
      touch-action: manipulation;
    }
    .mmp-queue-play svg { width: 14px; height: 14px; fill: currentColor; }
    .mmp-queue-play:hover { background: rgba(0,0,0,0.06); }
    .mmp-queue-title {
      flex: 1 1 auto; min-width: 0;
      font-size: 14px; color: #333;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      text-decoration: none;
    }
    .mmp-queue-title:hover { color: ${CONFIG.accentColor}; }
    .mmp-queue-item.is-current .mmp-queue-title { color: ${CONFIG.accentColor}; }
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
      width: 26px; height: 26px;
      background: transparent;
      color: #111;
      border: 0; padding: 4px;
      margin: 0 6px 0 0;
      vertical-align: middle;
      cursor: pointer;
      touch-action: manipulation;
      position: relative;
      z-index: 100;
      pointer-events: auto;
      border-radius: 50%;
      transition: background 0.15s, transform 0.1s;
      flex: 0 0 26px;
    }
    body.mm-signed-in .mmp-card-play { color: ${CONFIG.accentColor}; }
    .mmp-card-play.is-added { color: ${CONFIG.accentColor}; }
    .mmp-card-play.is-locked { color: #999; }
    .mmp-card-play:hover { background: rgba(42, 140, 130, 0.14); }
    .mmp-card-play:active { transform: scale(0.92); }
    .mmp-card-play, body.mmp-active .feed-title .mmp-card-play { pointer-events: auto; }
    .mmp-card-play svg { width: 18px; height: 18px; fill: currentColor; vertical-align: middle; pointer-events: none; }
    @media (max-width: 600px) {
      .mmp-card-play { width: 34px; height: 34px; padding: 7px; flex: 0 0 34px; }
      .mmp-card-play svg { width: 20px; height: 20px; }
    }
    .mmp-queue-empty {
      padding: 18px 16px; color: #777; font-size: 13px; font-style: italic;
    }
    .mmp-queue-remove {
      flex: 0 0 auto;
      width: 24px; height: 24px;
      background: transparent; border: 0; padding: 0;
      color: #999; cursor: pointer; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .mmp-queue-remove:hover { color: #333; background: rgba(0,0,0,0.06); }
    .mmp-queue-remove svg { width: 14px; height: 14px; fill: currentColor; }
    .mmp-bar.is-loading .mmp-btn-play svg { animation: mmp-spin 1s linear infinite; }
    @keyframes mmp-spin { to { transform: rotate(360deg); } }
    @media (max-width: 600px) {
      .mmp-thumb { width: 28px; height: 28px; flex: 0 0 28px; }
      .mmp-thumb img { width: 24px !important; height: 24px !important; }
      .mmp-mini { padding: 8px 8px; gap: 6px; }
      .mmp-btn { width: 32px; height: 32px; padding: 6px; }
      .mmp-time-display { display: none; }
      .mmp-progress { height: 14px; background: transparent; }
      .mmp-progress::before {
        content: ''; position: absolute;
        left: 0; right: 0; top: 50%;
        height: 4px; transform: translateY(-50%);
        background: rgba(0,0,0,0.12);
        border-radius: 2px;
      }
      .mmp-progress-fill {
        position: absolute; top: 50%;
        height: 4px; transform: translateY(-50%);
        border-radius: 2px;
      }
      .mmp-progress-thumb { width: 16px; height: 16px; margin-left: -8px; }
    }
    /* Hide native Ghost audio card play button — we hijack it */
    body.mmp-active .kg-audio-card .kg-audio-play-icon { display: none; }
    /* Toast: appears briefly when a song is added to the playlist */
    .mmp-toast {
      position: fixed;
      left: 50%;
      bottom: 90px;
      transform: translateX(-50%) translateY(20px);
      background: rgba(20, 20, 20, 0.92);
      color: #fff;
      padding: 11px 20px;
      border-radius: 999px;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 6px 24px rgba(0,0,0,0.28);
      z-index: 100000;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s ease, transform 0.2s ease;
      max-width: calc(100vw - 32px);
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .mmp-toast.is-visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    .mmp-queue-actions {
      display: inline-flex; gap: 6px; align-items: center;
    }
    .mmp-setlist-btn {
      background: transparent; color: #555;
      border: 1px solid #d8d4cc;
      border-radius: 999px;
      padding: 3px 10px;
      font: 600 11px/1.3 inherit;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      cursor: pointer;
      transition: color 0.15s, border-color 0.15s, background 0.15s;
    }
    .mmp-setlist-btn:hover {
      color: ${CONFIG.accentColor};
      border-color: ${CONFIG.accentColor};
    }
    .mmp-bar.is-setlists-mode .mmp-setlist-save,
    .mmp-bar.is-setlists-mode .mmp-setlist-share-toolbar,
    .mmp-bar.is-setlists-mode .mmp-queue-clear { display: none; }
    .mmp-setlist-share-toolbar { display: none; }
    .mmp-bar.is-linked-queue .mmp-setlist-share-toolbar { display: inline-block; }
    .mmp-queue-handle {
      flex: 0 0 22px;
      font-size: 16px; line-height: 1;
      color: #b9b3a8;
      cursor: grab;
      text-align: center;
      touch-action: none;
      user-select: none;
    }
    .mmp-queue-handle:active { cursor: grabbing; }
    .mmp-queue-ghost { opacity: 0.5; background: #f6ffdf; }
    .mmp-setlist-item {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 16px;
      cursor: pointer;
      transition: background 0.12s;
      border-bottom: 1px solid rgba(0,0,0,0.04);
    }
    .mmp-setlist-item:hover { background: rgba(0,0,0,0.04); }
    .mmp-setlist-name {
      flex: 1; min-width: 0;
      font-weight: 600; color: #222;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .mmp-setlist-meta {
      flex: 0 0 auto;
      font-size: 12px; color: #888;
    }
    .mmp-setlist-del {
      flex: 0 0 auto;
      width: 28px; height: 28px;
      background: transparent; border: 0; padding: 0;
      color: #999; cursor: pointer; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .mmp-setlist-del:hover { color: #b33; background: rgba(0,0,0,0.06); }
    .mmp-setlist-del svg { width: 14px; height: 14px; fill: currentColor; }
    .mmp-setlist-share {
      flex: 0 0 auto;
      width: 28px; height: 28px;
      background: transparent; border: 0; padding: 0;
      color: #999; cursor: pointer; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      margin-right: 2px;
    }
    .mmp-setlist-share:hover { color: ${CONFIG.accentColor}; background: rgba(0,0,0,0.06); }
    .mmp-setlist-share.is-shared { color: ${CONFIG.accentColor}; }
    .mmp-setlist-share svg { width: 14px; height: 14px; fill: currentColor; }
    .mmp-share-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 100000;
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
    }
    .mmp-share-modal {
      background: #fff; color: #222;
      border-radius: 12px;
      max-width: 480px; width: 100%;
      padding: 22px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.25);
    }
    .mmp-share-title {
      font-size: 17px; font-weight: 700; margin: 0 0 4px;
    }
    .mmp-share-sub {
      font-size: 13px; color: #666; margin: 0 0 14px;
    }
    .mmp-share-url {
      width: 100%; box-sizing: border-box;
      padding: 10px 12px;
      font-size: 13px; font-family: ui-monospace, Menlo, monospace;
      border: 1px solid #ddd; border-radius: 6px;
      background: #f6f4ee; color: #222;
    }
    .mmp-share-actions {
      display: flex; gap: 8px; margin-top: 14px;
      justify-content: flex-end;
    }
    .mmp-share-btn {
      padding: 8px 16px;
      font: 600 14px/1.2 inherit;
      border: 1px solid #ddd;
      border-radius: 6px;
      background: #fff; color: #333;
      cursor: pointer;
    }
    .mmp-share-btn.is-primary {
      background: ${CONFIG.accentColor};
      border-color: ${CONFIG.accentColor};
      color: #1a1a1a;
    }
    .mmp-import-banner {
      position: fixed; top: 0; left: 0; right: 0;
      background: #fffdf0;
      border-bottom: 1px solid ${CONFIG.accentColor};
      padding: 12px 14px;
      z-index: 99998;
      display: flex; align-items: center; gap: 12px;
      font-size: 14px; color: #222;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      transform: translateY(-110%);
      transition: transform 0.3s ease;
    }
    .mmp-import-banner.is-open { transform: translateY(0); }
    .mmp-import-text { flex: 1; min-width: 0; }
    .mmp-import-name { font-weight: 700; }
    .mmp-import-actions {
      display: inline-flex; gap: 6px; flex-shrink: 0;
    }
    .mmp-import-btn {
      padding: 6px 12px;
      font: 600 13px/1.2 inherit;
      border: 1px solid #ddd;
      border-radius: 999px;
      background: #fff; color: #333;
      cursor: pointer;
    }
    .mmp-import-btn.is-primary {
      background: ${CONFIG.accentColor};
      border-color: ${CONFIG.accentColor};
      color: #1a1a1a;
    }
    .mmp-import-dismiss {
      background: transparent; border: 0; padding: 4px 8px;
      font-size: 18px; cursor: pointer; color: #999;
    }
    @media (max-width: 600px) {
      .mmp-import-banner { flex-wrap: wrap; padding: 10px 12px; }
      .mmp-import-text { flex: 1 0 100%; margin-bottom: 8px; }
    }
  `;

  const ICONS = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>',
    expand: '<svg viewBox="0 0 24 24"><path d="M7 14l5-5 5 5z"/></svg>',
    collapse: '<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>',
    note: `<img src="${ASSET_BASE}/assets/note.png" alt="" style="width:34px;height:34px;object-fit:contain;display:block;">`,
    lock: '<svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M14 6H2v2h12V6zM14 10H2v2h12v-2zM2 16h8v-2H2v2zM16 12v3h-3v2h3v3h2v-3h3v-2h-3v-3z"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
    remove: '<svg viewBox="0 0 24 24"><path d="M19 13H5v-2h14z"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/></svg>',
    fullscreenOn: '<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zM5 10h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>',
    fullscreenOff: '<svg viewBox="0 0 24 24"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>',
  };

  // ----- state -----
  let state = {
    // queue = user-curated playlist (persisted in localStorage)
    queue: [],
    // cardsOnPage = scan of current DOM for rendering the per-card + buttons
    cardsOnPage: [],
    currentIdx: -1,
    expanded: false,
    fullscreen: false,
    // linkedSetlistId = the saved setlist the queue is currently editing.
    // null = ad-hoc queue (no link). When set, mutations to the queue
    // flow back to the saved setlist; if the setlist has a shareId, the
    // change also pushes to the Worker so recipients see live updates.
    linkedSetlistId: null,
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
      // Comprehensive YouTube ID extraction: embed, watch, shorts, youtu.be.
      // Also captures any trailing URL characters so we can parse `start`,
      // `t`, and `end` parameters (Ghost converts `?t=120` on a YouTube URL
      // into `?start=120` on the embed iframe). Lots of Bennett's posts cue
      // up a specific song inside one long Library of Congress recording.
      const ytMatch = html.match(/(?:(?:m\.|www\.)?youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?[^"'<>]*v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})([^"'<> ]*)/i);
      if (ytMatch) {
        // Ghost serves the iframe src with HTML-entity-encoded ampersands
        // (`&amp;start=1650`), so decode before parsing query params.
        const trailing = (ytMatch[2] || '').replace(/&amp;/g, '&');
        const startMatch = trailing.match(/[?&](?:start|t)=(\d+)/);
        const endMatch = trailing.match(/[?&]end=(\d+)/);
        const result = {
          youtubeId: ytMatch[1],
          startSeconds: startMatch ? parseInt(startMatch[1], 10) : 0,
          endSeconds: endMatch ? parseInt(endMatch[1], 10) : null,
        };
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
          ytStart: q.ytStart || 0,
          ytEnd: q.ytEnd || null,
        })),
        linkedSetlistId: state.linkedSetlistId || null,
        expanded: !!state.expanded,
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

  // ----- cross-device sync (Cloudflare Worker + KV) -----
  // Signed-in members' playlists sync via a tiny KV-backed Worker keyed by
  // Ghost member UUID. Signed-out users get localStorage only.
  let memberUuid = null;
  let memberName = null;
  let memberUuidFetched = false;
  let pushTimer = null;

  async function fetchMemberUuid() {
    if (memberUuidFetched) return memberUuid;
    memberUuidFetched = true;
    try {
      const r = await fetch('/members/api/member/', { credentials: 'same-origin' });
      if (r.status === 204 || !r.ok) return null;
      const d = await r.json();
      memberUuid = (d && d.uuid) || null;
      memberName = (d && (d.name || d.firstname)) || null;
      return memberUuid;
    } catch (e) { return null; }
  }

  async function fetchRemotePlaylist(uuid) {
    try {
      const r = await fetch(`${CONFIG.syncUrl}/playlist/${uuid}`);
      if (!r.ok) return null;
      const txt = await r.text();
      if (!txt || txt === 'null') return null;
      return JSON.parse(txt);
    } catch (e) { return null; }
  }

  function buildSyncPayload() {
    return {
      queue: state.queue.map(q => ({
        slug: q.slug, title: q.title,
        isPaid: !!q.isPaid, isMembers: !!q.isMembers,
        audioUrl: q.audioUrl || null,
        youtubeId: q.youtubeId || null,
        ytStart: q.ytStart || 0,
        ytEnd: q.ytEnd || null,
      })),
      savedAt: Date.now(),
    };
  }

  function pushPlaylistNow() {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    if (!memberUuid) return;
    try {
      fetch(`${CONFIG.syncUrl}/playlist/${memberUuid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSyncPayload()),
        keepalive: true,
      }).catch(() => {});
    } catch (e) {}
  }

  function schedulePush() {
    if (!memberUuid) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(pushPlaylistNow, 2000);
  }

  function applyRemoteQueue(remote) {
    if (!remote || !Array.isArray(remote.queue)) return;
    const currentSlug = state.currentIdx >= 0 && state.queue[state.currentIdx]
      ? state.queue[state.currentIdx].slug : null;
    const cardBySlug = new Map(state.cardsOnPage.map(c => [c.slug, c]));
    state.queue = remote.queue.map(sq => {
      const card = cardBySlug.get(sq.slug);
      const audioUrl = (card && card.audioUrl) || sq.audioUrl || null;
      const youtubeId = sq.youtubeId || null;
      const hasYtTimestamp = youtubeId && (sq.ytStart != null);
      return {
        slug: sq.slug,
        title: sq.title,
        isPaid: !!sq.isPaid,
        isMembers: !!sq.isMembers,
        audioUrl,
        youtubeId,
        ytStart: sq.ytStart || 0,
        ytEnd: sq.ytEnd || null,
        loaded: !!audioUrl || hasYtTimestamp,
        cardEl: card ? card.cardEl : null,
      };
    });
    if (currentSlug) {
      const newIdx = state.queue.findIndex(t => t.slug === currentSlug);
      state.currentIdx = newIdx;
    } else {
      state.currentIdx = -1;
    }
    persistStateNow();
    renderQueue();
    renderCardButtons();
    if (state.currentIdx < 0) renderTrack();
  }

  async function syncFromRemote() {
    const uuid = await fetchMemberUuid();
    if (!uuid) return;
    const remote = await fetchRemotePlaylist(uuid);
    if (remote && Array.isArray(remote.queue)) {
      applyRemoteQueue(remote);
    } else if (state.queue.length > 0) {
      pushPlaylistNow();
    }
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

  // ----- Replace Ghost's audio card with a clean single-button row.
  // Ghost's audio card has its own JS-rendered transport (scrubber,
  // speed, volume) that fights the bar at the bottom. We hide the
  // whole .kg-audio-card and insert a simpler row that just says
  // "▶ Western Wind w Belfast Bagaduce Community Chorus" — tap to
  // add+play through the bar. Skip-once via data-mmp-simplified.
  function simplifyAudioCards() {
    $$('.kg-audio-card').forEach((card, i) => {
      if (card.dataset.mmpSimplified === '1') return;
      const titleEl = card.querySelector('.kg-audio-title');
      const titleText = (titleEl && titleEl.textContent.trim()) || 'Audio';
      const audio = card.querySelector('audio');
      const audioUrl = (audio && audio.src) || '';
      const slug = slugFromHref(location.pathname) || ('audio-' + i);
      const wrap = document.createElement('div');
      wrap.className = 'mmp-simple-audio-wrapper';
      const btn = document.createElement('button');
      btn.className = 'mmp-simple-audio';
      btn.type = 'button';
      btn.dataset.slug = slug;
      btn.dataset.audioUrl = audioUrl;
      btn.dataset.title = titleText;
      btn.innerHTML = '<span class="mmp-simple-audio-icon">' + ICONS.play + '</span>' +
        '<span class="mmp-simple-audio-title">' + escapeHtml(titleText) + '</span>';
      btn.addEventListener('click', handleSimpleAudioClick);
      wrap.appendChild(btn);
      card.parentNode.insertBefore(wrap, card);
      card.dataset.mmpSimplified = '1';
    });
    refreshSimpleAudioState();
  }

  function handleSimpleAudioClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const btn = e.currentTarget;
    const slug = btn.dataset.slug;
    const existingIdx = inPlaylist(slug);
    // If this is the currently playing track, toggle play/pause —
    // matches the bar's behavior so users can pause from either spot.
    if (existingIdx >= 0 && existingIdx === state.currentIdx) {
      flipPlayIconsOptimistic(!isCurrentlyPlaying());
      requestAnimationFrame(togglePlay);
      return;
    }
    if (existingIdx >= 0) {
      flipPlayIconsOptimistic(true);
      const idxCopy = existingIdx;
      requestAnimationFrame(() => playIdx(idxCopy));
      return;
    }
    let card = state.cardsOnPage.find(c => c.slug === slug);
    if (!card) {
      card = {
        slug,
        title: btn.dataset.title || 'Audio',
        audioUrl: btn.dataset.audioUrl || null,
        isPaid: false, isMembers: false,
        loaded: !!btn.dataset.audioUrl,
        cardEl: btn.closest('.mmp-simple-audio-wrapper'),
      };
    }
    addToPlaylist(card);
  }

  function refreshSimpleAudioState() {
    const currentSlug = state.currentIdx >= 0 && state.queue[state.currentIdx]
      ? state.queue[state.currentIdx].slug : null;
    const playing = isCurrentlyPlaying();
    $$('.mmp-simple-audio').forEach(btn => {
      const slug = btn.dataset.slug;
      const isCurrent = !!slug && slug === currentSlug;
      btn.classList.toggle('is-current', isCurrent);
      const iconEl = btn.querySelector('.mmp-simple-audio-icon');
      if (iconEl) {
        const want = (isCurrent && playing) ? ICONS.pause : ICONS.play;
        // Only write innerHTML if it changed — every SVG swap inside
        // .gh-content otherwise wakes the MutationObserver, which
        // schedules a rebuild, which calls us again. Feedback loop.
        if (iconEl.innerHTML !== want) iconEl.innerHTML = want;
      }
      const label = (isCurrent && playing) ? 'Pause' : 'Play';
      if (btn.getAttribute('aria-label') !== label) {
        btn.setAttribute('aria-label', label);
      }
    });
  }

  function isCurrentlyPlaying() {
    if (typeof currentSourceIsYt === 'function' && currentSourceIsYt()) {
      return isYtPlaying();
    }
    // Match the bar's main play button check exactly. Earlier
    // versions also required currentTime>0, which left icons stuck
    // on ▶ for the first frame after a fresh play.
    return !!(audio && !audio.paused);
  }

  function refreshQueuePlayIcons() {
    if (!barEl) return;
    const playing = isCurrentlyPlaying();
    $$('.mmp-queue-item .mmp-queue-play', barEl).forEach(btn => {
      const idx = parseInt(btn.dataset.idx, 10);
      const isCurrent = idx === state.currentIdx;
      const want = (isCurrent && playing) ? ICONS.pause : ICONS.play;
      if (btn.innerHTML !== want) btn.innerHTML = want;
      const label = (isCurrent && playing) ? 'Pause' : 'Play';
      if (btn.getAttribute('aria-label') !== label) {
        btn.setAttribute('aria-label', label);
      }
    });
  }

  // Optimistic UI: flip every play/pause icon synchronously to the
  // intended state, before audio.play()'s "play" event round-trips.
  // The audio event handlers will re-run refresh* and reconcile if
  // playback ultimately fails (autoplay block, network error, etc).
  function flipPlayIconsOptimistic(willBePlaying) {
    const currentSlug = state.currentIdx >= 0 && state.queue[state.currentIdx]
      ? state.queue[state.currentIdx].slug : null;
    $$('.mmp-simple-audio').forEach(btn => {
      const slug = btn.dataset.slug;
      const isCurrent = !!slug && slug === currentSlug;
      const iconEl = btn.querySelector('.mmp-simple-audio-icon');
      if (iconEl) {
        const want = (isCurrent && willBePlaying) ? ICONS.pause : ICONS.play;
        if (iconEl.innerHTML !== want) iconEl.innerHTML = want;
      }
    });
    if (barEl) {
      $$('.mmp-queue-item .mmp-queue-play', barEl).forEach(btn => {
        const idx = parseInt(btn.dataset.idx, 10);
        const isCurrent = idx === state.currentIdx;
        const want = (isCurrent && willBePlaying) ? ICONS.pause : ICONS.play;
        if (btn.innerHTML !== want) btn.innerHTML = want;
      });
      const mainBtn = $('.mmp-btn-play', barEl);
      if (mainBtn) {
        const want = willBePlaying ? ICONS.pause : ICONS.play;
        if (mainBtn.innerHTML !== want) mainBtn.innerHTML = want;
      }
    }
  }

  // ----- playlist mutations -----
  function inPlaylist(slug) {
    return state.queue.findIndex(t => t.slug === slug);
  }

  function pushCardToQueue(card) {
    if (!card || inPlaylist(card.slug) >= 0) return false;
    state.queue.push({
      slug: card.slug,
      title: card.title,
      isPaid: !!card.isPaid,
      isMembers: !!card.isMembers,
      audioUrl: card.audioUrl || null,
      loaded: !!card.audioUrl,
      cardEl: card.cardEl,
    });
    return true;
  }

  function addToPlaylist(card) {
    const wasEmpty = state.queue.length === 0;
    if (!pushCardToQueue(card)) return;
    persistStateNow();
    schedulePush();
    syncLinkedSetlist();
    renderQueue();
    renderCardButtons();
    if (wasEmpty) {
      playIdx(0);
      showToast('Now playing: ' + card.title);
    } else {
      showToast('Added to playlist: ' + card.title);
    }
  }

  function addAllToPlaylist() {
    const wasEmpty = state.queue.length === 0;
    let count = 0;
    state.cardsOnPage.forEach(c => {
      if (lockedFor(c)) return;
      if (pushCardToQueue(c)) count++;
    });
    if (count === 0) {
      showToast('All songs already in playlist');
      return;
    }
    persistStateNow();
    schedulePush();
    syncLinkedSetlist();
    renderQueue();
    renderCardButtons();
    if (wasEmpty) playIdx(0);
    showToast('Added ' + count + ' ' + (count === 1 ? 'song' : 'songs') + ' to playlist');
  }

  function clearPlaylist() {
    if (state.queue.length === 0) {
      showToast('Playlist is already empty');
      return;
    }
    try { audio.pause(); audio.src = ''; } catch (e) {}
    try { if (ytPlayer && ytReady) ytPlayer.pauseVideo(); } catch (e) {}
    stopYtTimer();
    state.queue = [];
    state.currentIdx = -1;
    state.linkedSetlistId = null;
    setProgressPct(0);
    const titleEl = $('.mmp-title', barEl);
    if (titleEl) {
      titleEl.textContent = 'Tap + on a song to start';
      titleEl.classList.add('mmp-title-empty');
    }
    persistStateNow();
    schedulePush();
    renderQueue();
    renderCardButtons();
    renderPlayPause();
    showToast('Playlist cleared');
  }

  function ensureAddAllButton() {
    const feed = document.querySelector('.post-feed');
    if (!feed) return;
    // Skip on single-post pages or pages with too few cards to bother.
    if (!state.cardsOnPage || state.cardsOnPage.length < 2) return;
    const existing = document.querySelector('.mmp-add-all');
    if (existing) return;
    const wrap = document.createElement('div');
    wrap.className = 'mmp-add-all-wrap';
    const btn = document.createElement('button');
    btn.className = 'mmp-add-all';
    btn.type = 'button';
    btn.innerHTML = ICONS.plus + '<span>Add all to playlist</span>';
    btn.addEventListener('click', addAllToPlaylist);
    wrap.appendChild(btn);
    // On tag pages, also offer a Show/Hide tags toggle on the right side
    // of the same row. Previously this was a sticky button that overlapped
    // the tag description.
    if (/^\/tag\//.test(location.pathname)) {
      wrap.appendChild(buildShowTagsButton());
    }
    // Insert as first child of .post-feed so it inherits the same canvas
    // centering/padding as the article cards.
    feed.insertBefore(wrap, feed.firstChild);
    // Align horizontally with the first card's feed-title (Source theme
    // indents the title by the feed-calendar column width).
    requestAnimationFrame(() => alignAddAllButton(wrap, btn));
  }

  function buildShowTagsButton() {
    const TAGS_KEY = 'mm-tags-hidden';
    const tagBtn = document.createElement('button');
    tagBtn.className = 'mmp-show-tags';
    tagBtn.type = 'button';
    const refresh = () => {
      tagBtn.textContent = document.body.classList.contains('mm-tags-hidden')
        ? 'Show tags' : 'Hide tags';
    };
    if (localStorage.getItem(TAGS_KEY) === '1') {
      document.body.classList.add('mm-tags-hidden');
    }
    refresh();
    tagBtn.addEventListener('click', () => {
      const wasHidden = document.body.classList.contains('mm-tags-hidden');
      if (wasHidden) {
        document.body.classList.remove('mm-tags-hidden');
        localStorage.setItem(TAGS_KEY, '0');
      } else {
        document.body.classList.add('mm-tags-hidden');
        localStorage.setItem(TAGS_KEY, '1');
      }
      refresh();
    });
    return tagBtn;
  }

  function alignAddAllButton(wrap, btn) {
    const firstArticle = document.querySelector('.post-feed article.feed');
    if (!firstArticle) return;
    const title = firstArticle.querySelector('.feed-title');
    if (!title) return;
    const wrapRect = wrap.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const offset = titleRect.left - wrapRect.left;
    if (offset > 0 && offset < 400) {
      btn.style.marginLeft = Math.round(offset) + 'px';
    }
  }

  let toastEl = null;
  let toastTimer = null;
  function showToast(message) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'mmp-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    // Force reflow so the transition fires when we re-add the class.
    toastEl.classList.remove('is-visible');
    void toastEl.offsetWidth;
    toastEl.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastEl) toastEl.classList.remove('is-visible');
    }, 2400);
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
    schedulePush();
    syncLinkedSetlist();
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
        setProgressPct((cur / dur) * 100);
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
        track.ytStart = result.startSeconds || 0;
        track.ytEnd = result.endSeconds || null;
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
        const opts = { videoId: track.youtubeId };
        if (track.ytStart) opts.startSeconds = track.ytStart;
        if (track.ytEnd) opts.endSeconds = track.ytEnd;
        ytPlayer.loadVideoById(opts);
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

  function setProgressPct(pct) {
    const fill = $('.mmp-progress-fill', barEl);
    if (fill) fill.style.width = pct + '%';
    const thumb = $('.mmp-progress-thumb', barEl);
    if (thumb) thumb.style.left = pct + '%';
  }
  function onTimeUpdate() {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    setProgressPct(pct);
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
      <div class="mmp-expanded">
        <div class="mmp-queue-header">
          <span class="mmp-queue-label">Up next</span>
          <div class="mmp-queue-actions">
            <button class="mmp-setlist-btn mmp-setlist-save" aria-label="Save as setlist">Save</button>
            <button class="mmp-setlist-btn mmp-setlist-share-toolbar" aria-label="Share setlist">Share</button>
            <button class="mmp-setlist-btn mmp-setlist-load" aria-label="Load setlist">Load</button>
            <button class="mmp-setlist-btn mmp-queue-clear" aria-label="Clear playlist">Clear</button>
          </div>
        </div>
        <div class="mmp-queue-list"></div>
      </div>
      <div class="mmp-mini">
        <div class="mmp-progress" role="slider" aria-label="Seek">
          <div class="mmp-progress-fill"></div>
          <div class="mmp-progress-thumb"></div>
        </div>
        <div class="mmp-thumb">${ICONS.note}</div>
        <div class="mmp-title mmp-title-empty">Tap + on a song to start</div>
        <div class="mmp-time-display"><span class="mmp-time-cur">0:00</span> / <span class="mmp-time-dur">0:00</span></div>
        <div class="mmp-controls">
          <button class="mmp-btn mmp-btn-prev" aria-label="Previous">${ICONS.prev}</button>
          <button class="mmp-btn mmp-btn-play" aria-label="Play">${ICONS.play}</button>
          <button class="mmp-btn mmp-btn-next" aria-label="Next">${ICONS.next}</button>
          <button class="mmp-btn mmp-btn-clear-mini" aria-label="Clear playlist" title="Clear playlist">${ICONS.trash}</button>
          <button class="mmp-btn mmp-btn-expand" aria-label="Show queue">${ICONS.expand}</button>
          <button class="mmp-btn mmp-btn-fullscreen" aria-label="Full-screen queue" title="Full-screen queue">${ICONS.fullscreenOn}</button>
          <button class="mmp-btn mmp-btn-close" aria-label="Close player">${ICONS.close}</button>
        </div>
      </div>
    `;
    document.body.appendChild(barEl);
    document.body.classList.add('mmp-active');

    $('.mmp-btn-prev', barEl).addEventListener('click', () => advance(-1));
    $('.mmp-btn-play', barEl).addEventListener('click', togglePlay);
    $('.mmp-btn-next', barEl).addEventListener('click', () => advance(+1));
    $('.mmp-btn-expand', barEl).addEventListener('click', toggleExpanded);
    $('.mmp-btn-fullscreen', barEl).addEventListener('click', toggleFullscreen);
    $('.mmp-btn-close', barEl).addEventListener('click', closeBar);
    $('.mmp-queue-clear', barEl).addEventListener('click', clearPlaylist);
    $('.mmp-btn-clear-mini', barEl).addEventListener('click', clearPlaylist);
    $('.mmp-setlist-save', barEl).addEventListener('click', saveCurrentAsSetlist);
    $('.mmp-setlist-load', barEl).addEventListener('click', toggleSetlistsMode);
    $('.mmp-setlist-share-toolbar', barEl).addEventListener('click', () => {
      if (state.linkedSetlistId) shareSetlist(state.linkedSetlistId);
    });
    const progressEl = $('.mmp-progress', barEl);
    progressEl.addEventListener('pointerdown', onProgressPointerDown);
    progressEl.addEventListener('pointermove', onProgressPointerMove);
    progressEl.addEventListener('pointerup', onProgressPointerUp);
    progressEl.addEventListener('pointercancel', onProgressPointerUp);
  }

  let isScrubbing = false;
  function seekToPct(pct) {
    pct = Math.max(0, Math.min(1, pct));
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
  function pctFromEvent(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    return (e.clientX - rect.left) / rect.width;
  }
  function onProgressPointerDown(e) {
    isScrubbing = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    seekToPct(pctFromEvent(e));
  }
  function onProgressPointerMove(e) {
    if (!isScrubbing) return;
    seekToPct(pctFromEvent(e));
  }
  function onProgressPointerUp(e) {
    if (!isScrubbing) return;
    isScrubbing = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) {}
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
    // Exiting expanded also exits fullscreen.
    if (!state.expanded && state.fullscreen) {
      state.fullscreen = false;
      barEl.classList.remove('is-fullscreen');
      $('.mmp-btn-fullscreen', barEl).innerHTML = ICONS.fullscreenOn;
    }
  }

  function toggleFullscreen() {
    state.fullscreen = !state.fullscreen;
    // Going fullscreen auto-opens the expanded panel if it isn't already.
    if (state.fullscreen && !state.expanded) {
      state.expanded = true;
      barEl.classList.add('is-open');
      $('.mmp-btn-expand', barEl).innerHTML = ICONS.collapse;
    }
    barEl.classList.toggle('is-fullscreen', state.fullscreen);
    $('.mmp-btn-fullscreen', barEl).innerHTML = state.fullscreen
      ? ICONS.fullscreenOff
      : ICONS.fullscreenOn;
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
    refreshQueuePlayIcons();
  }

  function renderTimes() {
    if (!audio) return;
    $('.mmp-time-cur', barEl).textContent = fmtTime(audio.currentTime);
    $('.mmp-time-dur', barEl).textContent = fmtTime(audio.duration);
  }

  function renderQueue() {
    const list = $('.mmp-queue-list', barEl);
    if (!list) return;
    if (setlistsMode) { renderSetlistsList(list); return; }
    const label = $('.mmp-queue-label', barEl);
    const linked = state.linkedSetlistId
      ? (loadNamedSetlists()[state.linkedSetlistId] || null)
      : null;
    if (label) {
      label.textContent = linked ? linked.name : 'Up next';
    }
    const saveBtn = $('.mmp-setlist-save', barEl);
    if (saveBtn) saveBtn.textContent = linked ? 'Save as new' : 'Save';
    if (barEl) barEl.classList.toggle('is-linked-queue', !!linked);
    const shareToolbarBtn = $('.mmp-setlist-share-toolbar', barEl);
    if (shareToolbarBtn) {
      shareToolbarBtn.textContent = linked && linked.shareId ? 'Sharing' : 'Share';
    }
    if (state.queue.length === 0) {
      list.innerHTML = `<div class="mmp-queue-empty">Add songs with the + button on any track.</div>`;
      teardownQueueSortable();
      return;
    }
    list.innerHTML = state.queue.map((t, i) => {
      const locked = lockedFor(t);
      const classes = ['mmp-queue-item'];
      if (i === state.currentIdx) classes.push('is-current');
      if (locked) classes.push('is-locked');
      return `<div class="${classes.join(' ')}" data-idx="${i}" data-id="${escapeHtml(t.slug)}">
        <div class="mmp-queue-handle" aria-hidden="true">☰</div>
        <button class="mmp-queue-play" data-idx="${i}" aria-label="Play ${escapeHtml(t.title)}">${ICONS.play}</button>
        <a class="mmp-queue-title" href="/${escapeHtml(t.slug)}/" data-idx="${i}">${escapeHtml(t.title)}</a>
        <button class="mmp-queue-remove" data-slug="${escapeHtml(t.slug)}" aria-label="Remove">${ICONS.close}</button>
      </div>`;
    }).join('');
    $$('.mmp-queue-item', list).forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.mmp-queue-handle')) { e.stopPropagation(); return; }
        const remBtn = e.target.closest('.mmp-queue-remove');
        if (remBtn) {
          e.preventDefault();
          e.stopPropagation();
          removeFromPlaylist(remBtn.dataset.slug);
          return;
        }
        const playBtn = e.target.closest('.mmp-queue-play');
        if (playBtn) {
          e.preventDefault();
          e.stopPropagation();
          const idx = parseInt(playBtn.dataset.idx, 10);
          // If this row is the current track, tap toggles play/pause.
          if (idx === state.currentIdx) {
            flipPlayIconsOptimistic(!isCurrentlyPlaying());
            requestAnimationFrame(togglePlay);
            return;
          }
          const t = state.queue[idx];
          if (lockedFor(t)) { triggerSignup(); return; }
          flipPlayIconsOptimistic(true);
          requestAnimationFrame(() => playIdx(idx));
          return;
        }
        // Title link: let browser navigate to the post page.
        // Block navigation only for locked tracks (triggers signup instead).
        const linkEl = e.target.closest('.mmp-queue-title');
        if (linkEl) {
          const idx = parseInt(linkEl.dataset.idx, 10);
          const t = state.queue[idx];
          if (t && lockedFor(t)) {
            e.preventDefault();
            triggerSignup();
          }
        }
      });
    });
    ensureSortable().then(initQueueSortable);
    // Ensure the current row's play icon flips to ⏸ immediately after
    // a rebuild — don't wait for an audio 'play' event to round-trip.
    refreshQueuePlayIcons();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ----- named setlists (save / load) -----
  function loadNamedSetlists() {
    try {
      const raw = localStorage.getItem(CONFIG.namedSetlistsKey);
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) { return {}; }
  }
  function saveNamedSetlists(obj) {
    try { localStorage.setItem(CONFIG.namedSetlistsKey, JSON.stringify(obj)); } catch (e) {}
  }

  // ----- starter (virtual) setlists -----
  // Tag-driven setlists pinned to the top of Saved Setlists for every
  // visitor. Songs are pulled live from the Content API and cached, so
  // the lists auto-update as tag membership changes. Users can't delete
  // or edit a starter — to customize, load one then Save as a new copy.
  let starterSetlistsData = null;
  let starterFetchInFlight = null;

  function loadStarterCache() {
    try {
      const raw = localStorage.getItem(CONFIG.starterCacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.cachedAt) return null;
      if (Date.now() - parsed.cachedAt > CONFIG.starterCacheTtl) return null;
      return parsed.data || null;
    } catch (e) { return null; }
  }
  function saveStarterCache(data) {
    try {
      localStorage.setItem(CONFIG.starterCacheKey, JSON.stringify({
        cachedAt: Date.now(),
        data,
      }));
    } catch (e) {}
  }

  function visibilityToFlags(v) {
    if (v === 'paid' || v === 'tiers') return { isPaid: true, isMembers: false };
    if (v === 'members') return { isPaid: false, isMembers: true };
    return { isPaid: false, isMembers: false };
  }

  async function fetchStarterTagSongs(tagSlug) {
    const url = `${CONFIG.apiBase}/posts/?key=${CONFIG.contentApiKey}` +
      `&filter=${encodeURIComponent('tag:' + tagSlug)}` +
      `&limit=all&fields=slug,title,visibility&order=${encodeURIComponent('title ASC')}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('http_' + r.status);
    const data = await r.json();
    return (data.posts || []).map(p => {
      const v = visibilityToFlags(p.visibility);
      return {
        slug: p.slug,
        title: p.title,
        audioUrl: null,
        youtubeId: null,
        ytStart: 0,
        ytEnd: null,
        isPaid: v.isPaid,
        isMembers: v.isMembers,
      };
    });
  }

  async function refreshStarterSetlists() {
    if (starterFetchInFlight) return starterFetchInFlight;
    starterFetchInFlight = (async () => {
      try {
        const results = await Promise.all(
          CONFIG.starterSetlists.map(s =>
            fetchStarterTagSongs(s.tag)
              .then(songs => ({ id: s.id, name: s.name, tag: s.tag, songs }))
              .catch(e => { console.warn('[mmp] starter fetch failed', s.tag, e); return null; })
          )
        );
        const data = {};
        results.forEach(r => { if (r) data[r.id] = r; });
        starterSetlistsData = data;
        saveStarterCache(data);
        if (setlistsMode && barEl) renderQueue();
      } finally {
        starterFetchInFlight = null;
      }
    })();
    return starterFetchInFlight;
  }

  function ensureStarterSetlists() {
    if (!starterSetlistsData) {
      const cached = loadStarterCache();
      if (cached) starterSetlistsData = cached;
    }
    refreshStarterSetlists();
  }

  function loadStarterSetlist(id) {
    const set = starterSetlistsData && starterSetlistsData[id];
    if (!set || !Array.isArray(set.songs) || set.songs.length === 0) {
      showToast('Setlist is still loading…');
      refreshStarterSetlists();
      return;
    }
    if (state.queue.length > 0) {
      if (!window.confirm('Replace current queue with "' + set.name + '"?')) return;
    }
    const cardBySlug = new Map(state.cardsOnPage.map(c => [c.slug, c]));
    state.queue = set.songs.map(s => {
      const card = cardBySlug.get(s.slug);
      const audioUrl = (card && card.audioUrl) || null;
      return {
        slug: s.slug,
        title: s.title,
        isPaid: !!s.isPaid,
        isMembers: !!s.isMembers,
        audioUrl,
        youtubeId: null,
        ytStart: 0,
        ytEnd: null,
        loaded: !!audioUrl,
        cardEl: card ? card.cardEl : null,
      };
    });
    state.currentIdx = -1;
    state.linkedSetlistId = null;
    persistStateNow();
    schedulePush();
    setSetlistsMode(false);
    showBar();
    renderQueue();
    renderCardButtons();
    renderTrack();
    showToast('Loaded: ' + set.name);
    if (state.queue.length > 0) playIdx(0);
  }

  function saveCurrentAsSetlist() {
    if (state.queue.length === 0) {
      showToast('Nothing to save — queue is empty');
      return;
    }
    const all = loadNamedSetlists();
    const linked = state.linkedSetlistId && all[state.linkedSetlistId];
    const promptLabel = linked
      ? 'Save as a NEW setlist (the original "' + linked.name + '" keeps auto-saving):'
      : 'Setlist name:';
    const defaultName = linked ? linked.name + ' copy' : '';
    const name = (window.prompt(promptLabel, defaultName) || '').trim();
    if (!name) return;
    const id = 'sl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    all[id] = {
      id, name,
      songs: state.queue.map(t => ({
        slug: t.slug, title: t.title,
        isPaid: !!t.isPaid, isMembers: !!t.isMembers,
        audioUrl: t.audioUrl || null,
        youtubeId: t.youtubeId || null,
        ytStart: t.ytStart || 0,
        ytEnd: t.ytEnd || null,
      })),
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    saveNamedSetlists(all);
    state.linkedSetlistId = id;
    persistStateNow();
    renderQueue();
    showToast('Saved: ' + name);
  }

  function loadNamedSetlist(id) {
    const all = loadNamedSetlists();
    const set = all[id];
    if (!set) return;
    if (state.queue.length > 0) {
      if (!window.confirm('Replace current queue with "' + set.name + '"?')) return;
    }
    const cardBySlug = new Map(state.cardsOnPage.map(c => [c.slug, c]));
    state.queue = set.songs.map(s => {
      const card = cardBySlug.get(s.slug);
      const audioUrl = (card && card.audioUrl) || s.audioUrl || null;
      const youtubeId = s.youtubeId || null;
      return {
        slug: s.slug,
        title: s.title,
        isPaid: !!s.isPaid,
        isMembers: !!s.isMembers,
        audioUrl,
        youtubeId,
        ytStart: s.ytStart || 0,
        ytEnd: s.ytEnd || null,
        loaded: !!audioUrl || (youtubeId && s.ytStart != null),
        cardEl: card ? card.cardEl : null,
      };
    });
    state.currentIdx = -1;
    state.linkedSetlistId = id;
    persistStateNow();
    schedulePush();
    setSetlistsMode(false);
    showBar();
    renderQueue();
    renderCardButtons();
    renderTrack();
    showToast('Loaded: ' + set.name);
    if (state.queue.length > 0) playIdx(0);
  }

  function deleteNamedSetlist(id) {
    const all = loadNamedSetlists();
    if (!all[id]) return;
    if (!window.confirm('Delete "' + all[id].name + '"?')) return;
    delete all[id];
    saveNamedSetlists(all);
    renderQueue();
  }

  function setSetlistsMode(on) {
    setlistsMode = !!on;
    teardownQueueSortable();
    if (barEl) barEl.classList.toggle('is-setlists-mode', setlistsMode);
    const loadBtn = barEl && $('.mmp-setlist-load', barEl);
    if (loadBtn) loadBtn.textContent = setlistsMode ? 'Done' : 'Load';
    const label = barEl && $('.mmp-queue-label', barEl);
    if (label) label.textContent = setlistsMode ? 'Saved setlists' : 'Up next';
    renderQueue();
  }

  function toggleSetlistsMode() { setSetlistsMode(!setlistsMode); }

  function renderSetlistsList(list) {
    ensureStarterSetlists();
    const starterArr = CONFIG.starterSetlists.map(s => {
      const data = starterSetlistsData && starterSetlistsData[s.id];
      return {
        id: s.id, name: s.name,
        songs: (data && data.songs) || [],
        _starter: true,
        _loading: !data,
      };
    });
    const userAll = loadNamedSetlists();
    const userArr = Object.values(userAll).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    const all = [...starterArr, ...userArr];
    list.innerHTML = all.map(s => {
      if (s._starter) {
        const meta = s._loading
          ? 'loading…'
          : (s.songs.length + ' ' + (s.songs.length === 1 ? 'song' : 'songs'));
        return `
        <div class="mmp-setlist-item is-starter" data-id="${escapeHtml(s.id)}">
          <div class="mmp-setlist-name">${escapeHtml(s.name)}</div>
          <div class="mmp-setlist-meta">${meta}</div>
        </div>
      `;
      }
      const shareCls = s.shareId ? ' is-shared' : '';
      const shareLabel = s.shareId ? 'Open share link' : 'Share';
      return `
      <div class="mmp-setlist-item" data-id="${escapeHtml(s.id)}">
        <div class="mmp-setlist-name">${escapeHtml(s.name)}</div>
        <div class="mmp-setlist-meta">${s.songs.length} ${s.songs.length === 1 ? 'song' : 'songs'}</div>
        <button class="mmp-setlist-share${shareCls}" data-id="${escapeHtml(s.id)}" aria-label="${shareLabel}" title="${shareLabel}">${ICONS.share}</button>
        <button class="mmp-setlist-del" data-id="${escapeHtml(s.id)}" aria-label="Delete">${ICONS.close}</button>
      </div>
    `;
    }).join('');
    $$('.mmp-setlist-item', list).forEach(el => {
      el.addEventListener('click', (e) => {
        const id = el.dataset.id;
        if (id && id.indexOf('_starter_') === 0) {
          loadStarterSetlist(id);
          return;
        }
        const shareBtn = e.target.closest('.mmp-setlist-share');
        if (shareBtn) {
          e.stopPropagation();
          shareSetlist(shareBtn.dataset.id);
          return;
        }
        const delBtn = e.target.closest('.mmp-setlist-del');
        if (delBtn) {
          e.stopPropagation();
          deleteNamedSetlist(delBtn.dataset.id);
          return;
        }
        loadNamedSetlist(id);
      });
    });
  }

  // ----- share / import shared setlists -----
  function genShareId() {
    const a = Math.random().toString(36).slice(2, 10);
    const b = Math.random().toString(36).slice(2, 6);
    return (a + b).replace(/[^a-z0-9]/gi, '').slice(0, 12).padEnd(8, 'x');
  }

  async function shareSetlist(id) {
    const all = loadNamedSetlists();
    const set = all[id];
    if (!set) return;
    const shareId = set.shareId || genShareId();
    const payload = {
      shareId,
      name: set.name,
      songs: set.songs,
      owner_name: memberName || null,
      shared_at: Date.now(),
    };
    showToast('Creating share link…');
    let ok = false;
    try {
      const r = await fetch(`${CONFIG.syncUrl}/shared/${shareId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      ok = r.ok;
    } catch (e) {}
    if (!ok) {
      showToast('Share failed — check connection');
      return;
    }
    set.shareId = shareId;
    set.updated_at = Date.now();
    all[id] = set;
    saveNamedSetlists(all);
    const url = `${location.origin}/?setlist=${shareId}`;
    openShareModal(set, url);
    if (setlistsMode) renderQueue();
  }

  let shareOverlay = null;
  function openShareModal(set, url) {
    closeShareModal();
    shareOverlay = document.createElement('div');
    shareOverlay.className = 'mmp-share-overlay';
    shareOverlay.innerHTML = `
      <div class="mmp-share-modal" role="dialog" aria-label="Share setlist">
        <h3 class="mmp-share-title">Share &ldquo;${escapeHtml(set.name)}&rdquo;</h3>
        <p class="mmp-share-sub">View-only. Recipients see the latest version each time they open the link. They can save their own copy, but they can't change yours. ${set.songs.length} ${set.songs.length === 1 ? 'song' : 'songs'}.</p>
        <input class="mmp-share-url" type="text" readonly value="${escapeHtml(url)}">
        <div class="mmp-share-actions">
          <button class="mmp-share-btn mmp-share-close" type="button">Close</button>
          <button class="mmp-share-btn is-primary mmp-share-copy" type="button">Copy link</button>
        </div>
      </div>`;
    document.body.appendChild(shareOverlay);
    const input = $('.mmp-share-url', shareOverlay);
    setTimeout(() => { try { input.focus(); input.select(); } catch (e) {} }, 0);
    shareOverlay.addEventListener('click', (e) => {
      if (e.target === shareOverlay) closeShareModal();
    });
    $('.mmp-share-close', shareOverlay).addEventListener('click', closeShareModal);
    $('.mmp-share-copy', shareOverlay).addEventListener('click', () => {
      const txt = input.value;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(
          () => showToast('Link copied'),
          () => { try { input.select(); document.execCommand('copy'); showToast('Link copied'); } catch (e) { showToast('Copy failed'); } }
        );
      } else {
        try { input.select(); document.execCommand('copy'); showToast('Link copied'); }
        catch (e) { showToast('Copy failed'); }
      }
    });
  }
  function closeShareModal() {
    if (shareOverlay) {
      shareOverlay.remove();
      shareOverlay = null;
    }
  }

  async function fetchSharedSetlist(shareId) {
    try {
      const r = await fetch(`${CONFIG.syncUrl}/shared/${shareId}`);
      if (!r.ok) return null;
      const t = await r.text();
      if (!t || t === 'null') return null;
      return JSON.parse(t);
    } catch (e) { return null; }
  }

  function clearShareParam() {
    try {
      const u = new URL(location.href);
      u.searchParams.delete('setlist');
      const next = u.pathname + (u.search ? u.search : '') + u.hash;
      history.replaceState(null, '', next);
    } catch (e) {}
  }

  let importBanner = null;
  function detectIncomingShare() {
    let shareId = null;
    try {
      const p = new URLSearchParams(location.search);
      shareId = p.get('setlist');
    } catch (e) {}
    if (!shareId) return;
    if (!/^[A-Za-z0-9_-]{8,32}$/.test(shareId)) {
      clearShareParam();
      return;
    }
    fetchSharedSetlist(shareId).then(data => {
      if (data && Array.isArray(data.songs)) showImportBanner(data);
      else clearShareParam();
    });
  }

  function showImportBanner(data) {
    if (importBanner) importBanner.remove();
    const owner = data.owner_name ? escapeHtml(data.owner_name) : 'Someone';
    const count = data.songs.length;
    importBanner = document.createElement('div');
    importBanner.className = 'mmp-import-banner';
    importBanner.innerHTML = `
      <div class="mmp-import-text">
        ${owner} shared <span class="mmp-import-name">&ldquo;${escapeHtml(data.name || 'a setlist')}&rdquo;</span>
        with you · ${count} ${count === 1 ? 'song' : 'songs'}
      </div>
      <div class="mmp-import-actions">
        <button class="mmp-import-btn mmp-import-save" type="button">Save to my setlists</button>
        <button class="mmp-import-btn is-primary mmp-import-play" type="button">Play now</button>
        <button class="mmp-import-dismiss" type="button" aria-label="Dismiss">×</button>
      </div>`;
    document.body.appendChild(importBanner);
    requestAnimationFrame(() => importBanner.classList.add('is-open'));
    $('.mmp-import-save', importBanner).addEventListener('click', () => {
      importSharedAsCopy(data);
      dismissImportBanner();
    });
    $('.mmp-import-play', importBanner).addEventListener('click', () => {
      importSharedAsCopy(data);
      playSharedNow(data);
      dismissImportBanner();
    });
    $('.mmp-import-dismiss', importBanner).addEventListener('click', dismissImportBanner);
  }

  function dismissImportBanner() {
    if (!importBanner) return;
    importBanner.classList.remove('is-open');
    const el = importBanner;
    setTimeout(() => { try { el.remove(); } catch (e) {} }, 350);
    importBanner = null;
    clearShareParam();
  }

  function importSharedAsCopy(data) {
    const all = loadNamedSetlists();
    const id = 'sl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    const owner = data.owner_name ? ' (from ' + data.owner_name + ')' : ' (shared)';
    all[id] = {
      id,
      name: (data.name || 'Shared setlist') + owner,
      songs: data.songs,
      created_at: Date.now(),
      updated_at: Date.now(),
      from_shareId: data.shareId || null,
    };
    saveNamedSetlists(all);
    showToast('Saved a copy');
  }

  function playSharedNow(data) {
    const cardBySlug = new Map(state.cardsOnPage.map(c => [c.slug, c]));
    state.queue = (data.songs || []).map(s => {
      const card = cardBySlug.get(s.slug);
      const audioUrl = (card && card.audioUrl) || s.audioUrl || null;
      const youtubeId = s.youtubeId || null;
      return {
        slug: s.slug,
        title: s.title,
        isPaid: !!s.isPaid,
        isMembers: !!s.isMembers,
        audioUrl,
        youtubeId,
        ytStart: s.ytStart || 0,
        ytEnd: s.ytEnd || null,
        loaded: !!audioUrl || (youtubeId && s.ytStart != null),
        cardEl: card ? card.cardEl : null,
      };
    });
    state.currentIdx = -1;
    persistStateNow();
    schedulePush();
    showBar();
    renderQueue();
    renderCardButtons();
    renderTrack();
    if (state.queue.length > 0) playIdx(0);
  }

  // ----- SortableJS lazy load + queue drag-reorder -----
  let queueSortable = null;
  let sortableLoading = null;
  function ensureSortable() {
    if (window.Sortable) return Promise.resolve();
    if (sortableLoading) return sortableLoading;
    sortableLoading = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = CONFIG.sortableCdn;
      s.onload = () => resolve();
      s.onerror = () => { sortableLoading = null; resolve(); };
      document.head.appendChild(s);
    });
    return sortableLoading;
  }
  function teardownQueueSortable() {
    if (queueSortable) {
      try { queueSortable.destroy(); } catch (e) {}
      queueSortable = null;
    }
  }
  function initQueueSortable() {
    if (!window.Sortable || setlistsMode) return;
    const list = barEl && $('.mmp-queue-list', barEl);
    if (!list) return;
    teardownQueueSortable();
    queueSortable = new window.Sortable(list, {
      animation: 150,
      handle: '.mmp-queue-handle',
      delay: 120,
      delayOnTouchOnly: true,
      touchStartThreshold: 5,
      ghostClass: 'mmp-queue-ghost',
      onEnd: handleQueueReorder,
    });
  }
  function handleQueueReorder() {
    if (!queueSortable) return;
    const order = queueSortable.toArray();
    const currentSlug = state.currentIdx >= 0 && state.queue[state.currentIdx]
      ? state.queue[state.currentIdx].slug : null;
    const bySlug = new Map(state.queue.map(t => [t.slug, t]));
    const next = order.map(slug => bySlug.get(slug)).filter(Boolean);
    if (next.length !== state.queue.length) return;
    state.queue = next;
    state.currentIdx = currentSlug
      ? state.queue.findIndex(t => t.slug === currentSlug)
      : -1;
    persistStateNow();
    schedulePush();
    syncLinkedSetlist();
    renderQueue();
  }
  let setlistsMode = false;

  // ----- live sync of linked setlist -----
  // When the queue is linked to a saved setlist (state.linkedSetlistId),
  // every queue mutation flows back to the saved setlist's songs[] and
  // — if the setlist is shared — pushes a debounced update to the Worker
  // at /shared/{shareId} so recipients see the latest on next page load.
  let sharedPushTimer = null;
  function syncLinkedSetlist() {
    if (!state.linkedSetlistId) return;
    const all = loadNamedSetlists();
    const set = all[state.linkedSetlistId];
    if (!set) {
      state.linkedSetlistId = null;
      return;
    }
    set.songs = state.queue.map(t => ({
      slug: t.slug, title: t.title,
      isPaid: !!t.isPaid, isMembers: !!t.isMembers,
      audioUrl: t.audioUrl || null,
      youtubeId: t.youtubeId || null,
      ytStart: t.ytStart || 0,
      ytEnd: t.ytEnd || null,
    }));
    set.updated_at = Date.now();
    all[state.linkedSetlistId] = set;
    saveNamedSetlists(all);
    if (set.shareId) scheduleSharedPush(set);
  }
  function scheduleSharedPush(set) {
    if (sharedPushTimer) clearTimeout(sharedPushTimer);
    sharedPushTimer = setTimeout(() => {
      sharedPushTimer = null;
      pushSharedSetlistNow(set);
    }, 2000);
  }
  function pushSharedSetlistNow(set) {
    if (!set || !set.shareId) return;
    const payload = {
      shareId: set.shareId,
      name: set.name,
      songs: set.songs,
      owner_name: memberName || null,
      shared_at: Date.now(),
    };
    try {
      fetch(`${CONFIG.syncUrl}/shared/${set.shareId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    } catch (e) {}
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
    refreshSimpleAudioState();
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
    simplifyAudioCards();
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
      const meaningful = mutations.some(m => {
        return Array.from(m.addedNodes).concat(Array.from(m.removedNodes))
          .some(n => {
            if (n.nodeType !== 1) return false;
            // Ignore our own injected/updated markup so SVG icon
            // swaps don't trigger a rebuild → refresh → swap loop.
            if (n.classList && n.classList.contains('mmp-card-play')) return false;
            if (n.classList && n.classList.contains('mmp-simple-audio-wrapper')) return false;
            if (n.closest && n.closest('.mmp-simple-audio')) return false;
            if (n.closest && n.closest('.mmp-card-play')) return false;
            if (n.closest && n.closest('.mmp-simple-audio-wrapper')) return false;
            if (n.closest && n.closest('.mmp-bar')) return false;
            return true;
          });
      });
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

    // Navigating to a post page tears down the audio element, and browser
    // autoplay rules often prevent a clean auto-resume on the new page. If
    // audio is actively playing when the user clicks a song link, open the
    // post in a new tab so the original tab keeps playing.
    document.addEventListener('click', (e) => {
      // Let the browser handle modifier-clicks (cmd/ctrl/shift/middle) and
      // anything that's not a primary left click — those already open new
      // tabs or windows on their own.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target.closest('a.u-permalink');
      if (!link) return;
      const playing = (audio && !audio.paused && audio.currentTime > 0) || isYtPlaying();
      if (!playing) return;
      e.preventDefault();
      e.stopPropagation();
      window.open(link.href, '_blank', 'noopener');
    }, true);
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
    simplifyAudioCards();
    const cardBySlug = new Map(state.cardsOnPage.map(c => [c.slug, c]));

    if (saved && Array.isArray(saved.queue)) {
      state.queue = saved.queue.map(sq => {
        const card = cardBySlug.get(sq.slug);
        const audioUrl = (card && card.audioUrl) || sq.audioUrl || null;
        const youtubeId = sq.youtubeId || null;
        // YT tracks from pre-v0.3.4 don't have ytStart/ytEnd, so refetch on
        // first play to get the timestamp. HTML5 audio URLs are complete on
        // their own.
        const hasYtTimestamp = youtubeId && (sq.ytStart != null);
        return {
          slug: sq.slug,
          title: sq.title,
          isPaid: !!sq.isPaid,
          isMembers: !!sq.isMembers,
          audioUrl,
          youtubeId,
          ytStart: sq.ytStart || 0,
          ytEnd: sq.ytEnd || null,
          loaded: !!audioUrl || hasYtTimestamp,
          cardEl: card ? card.cardEl : null,
        };
      });
    }
    if (saved && saved.linkedSetlistId) {
      state.linkedSetlistId = saved.linkedSetlistId;
    }
    if (saved && saved.expanded) {
      state.expanded = true;
      barEl.classList.add('is-open');
      $('.mmp-btn-expand', barEl).innerHTML = ICONS.collapse;
    }

    renderQueue();
    renderCardButtons();
    ensureAddAllButton();
    startObserver();

    showBar();

    setTimeout(() => ensureStarterSetlists(), 800);

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

    window.addEventListener('pagehide', () => {
      persistStateNow();
      if (pushTimer && memberUuid) pushPlaylistNow();
    });
    window.addEventListener('beforeunload', () => {
      persistStateNow();
      if (pushTimer && memberUuid) pushPlaylistNow();
    });

    // Fire-and-forget remote sync. Local state renders first so signed-out
    // users (and signed-in users on slow networks) see their playlist
    // immediately; the remote fetch reconciles a moment later.
    syncFromRemote();

    // If we arrived via a setlist share link, fetch and show the import banner.
    detectIncomingShare();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
