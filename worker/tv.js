// movingmusicTV routes for the mmp-sync worker.
//
//   POST /tv-inbox       The "Send to movingmusicTV" button on Bennett's phone.
//                        Body, as JSON or a form: { key, url, note }. key must
//                        match the TV_INBOX_KEY secret. The video is stored in
//                        KV under tvin:<id> and shows on the TV within a minute.
//                        Add ?format=text for a one-line reply the phone can show.
//   GET  /tv-finds.json  Everything the TV and the Atlas show beyond the Atlas
//                        data: tv/finds.json from the repo plus the inbox.
//
// Ids match item_id() in scripts/build_tv.py, so once Claude files a video in
// tv/finds.json with its place, tradition, and tags, that copy replaces the
// bare inbox copy everywhere.

const REPO = 'bennett-hue/moving-music-player';
export const TV_DATA_REF = 'main';
const INBOX_PREFIX = 'tvin:';
const INBOX_TTL = 60 * 60 * 24 * 365;  // a year; Claude files each video long before
const FINDS_CACHE_KEY = 'https://mmp-sync.internal/tv-finds.json';
const FINDS_TTL = 60;
const NAME = { yt: 'YouTube', ig: 'Instagram', fb: 'Facebook', tt: 'TikTok', file: 'Video' };
const PLATFORM = { yt: 'youtube', ig: 'instagram', fb: 'facebook', tt: 'tiktok', file: 'file' };

// Same rules as parse_video() in scripts/build_tv.py.
export function parseVideo(url) {
  const u = String(url || '').trim();
  let m = u.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*?&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  if (m) {
    const st = u.match(/[?&#](?:t|start)=(\d+)/);
    return { p: 'yt', k: m[1], st: st ? Number(st[1]) : 0, o: /\/shorts\//.test(u) ? 'v' : 'h' };
  }
  m = u.match(/instagram\.com\/(?:[\w.]+\/)?(reels?|p|tv)\/([\w-]+)/);
  if (m) return { p: 'ig', k: (m[1].startsWith('reel') ? 'reel' : m[1]) + '/' + m[2], st: 0, o: 'v' };
  m = u.match(/tiktok\.com\/(?:@[\w.-]+\/video\/|player\/v1\/|embed\/v2\/)(\d+)/);
  if (m) return { p: 'tt', k: m[1], st: 0, o: 'v' };
  if (/(?:^|\/\/|\.)(?:facebook\.com|fb\.watch)\//.test(u)) return { p: 'fb', k: u, st: 0, o: /\/reel\//.test(u) ? 'v' : 'h' };
  if (/\.(?:mp4|webm|m4v)(?:\?|$)/i.test(u)) return { p: 'file', k: u, st: 0, o: 'h' };
  return null;
}

async function sha1hex(s) {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Same rules as item_id() in scripts/build_tv.py.
export async function itemId(pv) {
  if (pv.p === 'yt') return 'yt-' + pv.k + (pv.st ? '-' + pv.st : '');
  if (pv.p === 'ig') return 'ig-' + pv.k.split('/')[1];
  if (pv.p === 'tt') return 'tt-' + pv.k;
  if (pv.p === 'fb') {
    const nums = pv.k.match(/\d{9,}/g);
    return 'fb-' + (nums ? nums[nums.length - 1] : (await sha1hex(pv.k)).slice(0, 10));
  }
  return 'file-' + (await sha1hex(pv.k)).slice(0, 10);
}

// One URL per video: share-tracking parameters (igsh, si, mibextid, utm_*) go,
// so the same video sent twice gets the same id.
export function canonical(url, pv) {
  if (pv.p === 'yt') {
    return (pv.o === 'v' ? 'https://www.youtube.com/shorts/' + pv.k : 'https://www.youtube.com/watch?v=' + pv.k) +
      (pv.st ? (pv.o === 'v' ? '?t=' : '&t=') + pv.st : '');
  }
  if (pv.p === 'ig') return 'https://www.instagram.com/' + pv.k + '/';
  if (pv.p === 'tt') return url.split(/[?#]/)[0];
  if (pv.p === 'fb') {
    try {
      const u = new URL(url);
      [...u.searchParams.keys()].forEach((k) => {
        if (/^(mibextid|rdid|share_url|sfnsn|s|fs|extid|ref|__cft__\[0\]|__tn__|utm_.*)$/.test(k)) u.searchParams.delete(k);
      });
      u.hash = '';
      return u.toString();
    } catch (e) {
      return url;
    }
  }
  return url;
}

function isShortLink(u) {
  return /(?:vm|vt)\.tiktok\.com\/|tiktok\.com\/t\/|fb\.watch\/|facebook\.com\/share\/|youtube\.com\/shorts\/\w+\?feature=share/.test(u);
}

// Follow up to three redirects without loading the page.
async function resolveRedirects(u) {
  let cur = u;
  for (let hop = 0; hop < 3; hop++) {
    let r;
    try {
      r = await fetch(cur, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' } });
    } catch (e) {
      return cur === u ? null : cur;
    }
    const loc = r.headers.get('location');
    if (!loc || r.status < 300 || r.status > 399) return cur === u ? null : cur;
    cur = new URL(loc, cur).toString();
    if (parseVideo(cur) && !isShortLink(cur)) return cur;
  }
  return cur === u ? null : cur;
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readBody(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) return await request.json();
  if (type.includes('form')) return Object.fromEntries((await request.formData()).entries());
  const text = await request.text();
  try { return JSON.parse(text); } catch (e) { return Object.fromEntries(new URLSearchParams(text)); }
}

export async function tvInboxPost(request, env) {
  const asText = new URL(request.url).searchParams.get('format') === 'text';
  const reply = (status, message, extra) => asText
    ? new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    : new Response(JSON.stringify({ ok: status < 300, message, ...(extra || {}) }),
      { status, headers: { 'Content-Type': 'application/json' } });

  if (!env.TV_INBOX_KEY) return reply(503, 'The movingmusicTV inbox is not set up yet.');
  let body;
  try { body = await readBody(request); } catch (e) { return reply(400, 'Could not read what was sent.'); }
  if (!body || !safeEqual(String(body.key || ''), env.TV_INBOX_KEY)) return reply(401, 'Wrong key.');

  // The share sheet sometimes passes a caption with the link inside it.
  let raw = String(body.url || body.link || '').trim();
  const found = raw.match(/https?:\/\/[^\s<>"]+/);
  if (found) raw = found[0];
  if (!raw || raw.length > 800) return reply(400, 'No link found.');

  let pv = parseVideo(raw);
  if (!pv || isShortLink(raw)) {
    const resolved = await resolveRedirects(raw);
    const pv2 = resolved && parseVideo(resolved);
    if (pv2 && (pv2.p !== 'fb' || !isShortLink(resolved))) { pv = pv2; raw = resolved; }
  }
  if (!pv) return reply(422, 'That link is not a YouTube, Instagram, Facebook, or TikTok video.');

  const url = canonical(raw, pv);
  const pvc = parseVideo(url) || pv;
  const id = await itemId(pvc);
  const note = String(body.note || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const key = INBOX_PREFIX + id;
  const already = await env.MMP_KV.get(key);
  if (!already) {
    await env.MMP_KV.put(key, '1', {
      expirationTtl: INBOX_TTL,
      metadata: { id, url, note, p: pvc.p, added: new Date().toISOString().slice(0, 10) },
    });
    try { await caches.default.delete(new Request(FINDS_CACHE_KEY)); } catch (e) {}
  }
  const what = NAME[pvc.p] + ' video' + (note ? ': ' + note : '');
  return reply(already ? 200 : 201, (already ? 'Already on movingmusicTV. ' : 'On movingmusicTV. ') + what, { id });
}

function inboxFind(m) {
  const pv = parseVideo(m.url) || {};
  return {
    id: m.id, platform: PLATFORM[m.p] || m.p, url: m.url, by: '',
    label: m.note || (NAME[m.p] || 'Video') + ' video', place: '', la: null, lo: null,
    tradition: '', uses: [], shows: '', orient: pv.o || 'v', added: m.added || '',
    from: 'Send button', note: '', inbox: true,
  };
}

export async function tvFindsGet(request, env, ctx) {
  const ck = new Request(FINDS_CACHE_KEY);
  try {
    const hit = await caches.default.match(ck);
    if (hit) return hit;
  } catch (e) {}

  let finds = [], hide = [];
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${TV_DATA_REF}/tv/finds.json`,
      { cf: { cacheTtl: 60, cacheEverything: true } });
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j.finds)) finds = j.finds;
      if (Array.isArray(j.hide)) hide = j.hide;
    }
  } catch (e) {}

  const have = new Set(finds.map((f) => f && f.id));
  const hidden = new Set(hide.map((h) => (h && h.id) || h));
  const inbox = [];
  try {
    let cursor;
    do {
      const page = await env.MMP_KV.list({ prefix: INBOX_PREFIX, cursor, limit: 1000 });
      for (const k of page.keys) {
        const m = k.metadata;
        if (!m || !m.id || have.has(m.id) || hidden.has(m.id)) continue;
        inbox.push(inboxFind(m));
      }
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor && inbox.length < 3000);
  } catch (e) {}
  inbox.sort((a, b) => (b.added || '').localeCompare(a.added || ''));

  const res = new Response(JSON.stringify({ updated: new Date().toISOString(), finds: finds.concat(inbox), hide }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${FINDS_TTL}`,
      'Access-Control-Allow-Origin': '*',
    },
  });
  try {
    const put = caches.default.put(ck, res.clone());
    if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
  } catch (e) {}
  return res;
}
