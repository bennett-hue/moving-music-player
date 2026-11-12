// movingmusicTV routes for the mmp-sync worker.
//
//   POST /tv-inbox       The "Send to movingmusicTV" button on Bennett's phone.
//                        Body, as JSON or a form: { key, url, note }. key must
//                        match the TV_INBOX_KEY secret. note is Bennett's line:
//                        one sentence of commentary, shown under the video as
//                        he wrote it. The video is stored in KV under tvin:<id>
//                        and shows on the TV within a minute. Sending the same
//                        video again with a new line replaces the line.
//                        Add ?format=text for a one-line reply the phone can show.
//   GET  /tv-finds.json  Everything the TV and the Atlas show beyond the Atlas
//                        data: tv/finds.json from the repo plus the inbox.
//
// Ids match item_id() in scripts/build_tv.py, so once Claude files a video in
// tv/finds.json with its place, tradition, and tags, that copy replaces the
// bare inbox copy everywhere. A line sent after filing is newer than the filed
// line (noted is later), so it shows until the weekly filing copies it over.

const REPO = 'bennett-hue/moving-music-player';
export const TV_DATA_REF = 'main';
const INBOX_PREFIX = 'tvin:';
const INBOX_TTL = 60 * 60 * 24 * 365;  // a year; Claude files each video long before
const FINDS_CACHE_KEY = 'https://mmp-sync.internal/tv-finds.json';
const FINDS_TTL = 60;
const NAME = { yt: 'YouTube', ig: 'Instagram', fb: 'Facebook', tt: 'TikTok', file: 'Video' };
const PLATFORM = { yt: 'youtube', ig: 'instagram', fb: 'facebook', tt: 'tiktok', file: 'file' };
export const LINE_MAX = 280;
const META_MAX = 1000;  // KV metadata holds at most 1024 bytes

// Bennett's line, as he wrote it, with three exceptions: whitespace collapses, an
// em dash or double hyphen becomes a comma (the site never prints them), and a
// line over LINE_MAX is cut at a word, with an ellipsis.
export function cleanLine(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/\s*(?:\u2014|-{2,})\s*/g, ', ')
    .replace(/^[,\s]+|[,\s]+$/g, '');
}

export function cutLine(s, max) {
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  if (sp > max * 0.6) cut = cut.slice(0, sp);
  return cut.replace(/[\s,.;:]+$/, '') + '\u2026';
}

// ISO time to the second, the same form tv_intake.py writes, so the two compare as strings.
export function stamp(d) {
  return (d || new Date()).toISOString().replace(/\.\d+Z$/, 'Z');
}

function metaBytes(m) {
  return new TextEncoder().encode(JSON.stringify(m)).length;
}

// Shorten the line until the metadata fits in KV. Only a very long Facebook link
// leaves less than a full line of room.
function fitMeta(m) {
  while (m.note && metaBytes(m) > META_MAX) {
    const max = m.note.length - 20;
    m.note = max < 20 ? '' : cutLine(m.note.replace(/\u2026$/, ''), max);
  }
  if (m.from && metaBytes(m) > META_MAX) m.from = m.from.slice(0, 40);
  return metaBytes(m) <= META_MAX;
}

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

export function safeEqual(a, b) {
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

// Put a video in the inbox: the Send button, and viewer suggestions Bennett approves.
// opts: note (Bennett's line), tradition (an Atlas slug), from (credit). Returns
// { status, message, id, line }.
export async function inboxAdd(env, text, opts) {
  const o = opts || {};
  // The share sheet sometimes passes a caption with the link inside it.
  let raw = String(text || '').trim();
  const found = raw.match(/https?:\/\/[^\s<>"]+/);
  if (found) raw = found[0];
  if (!raw || raw.length > 800) return { status: 400, message: 'No link found.' };

  let pv = parseVideo(raw);
  if (!pv || isShortLink(raw)) {
    const resolved = await resolveRedirects(raw);
    const pv2 = resolved && parseVideo(resolved);
    if (pv2 && (pv2.p !== 'fb' || !isShortLink(resolved))) { pv = pv2; raw = resolved; }
  }
  if (!pv) return { status: 422, message: 'That link is not a YouTube, Instagram, Facebook, or TikTok video.' };

  const url = canonical(raw, pv);
  const pvc = parseVideo(url) || pv;
  const id = await itemId(pvc);
  const wrote = cleanLine(o.note);
  const line = cutLine(wrote, LINE_MAX);
  const key = INBOX_PREFIX + id;
  const prev = await env.MMP_KV.getWithMetadata(key);
  const old = prev && prev.value !== null ? (prev.metadata || {}) : null;
  const what = NAME[pvc.p] + ' video';
  const tradition = String(o.tradition || '').slice(0, 100);

  let meta = null;
  if (!old) {
    meta = { id, url, note: line, p: pvc.p, added: new Date().toISOString().slice(0, 10) };
    if (tradition) meta.tradition = tradition;
    if (o.from) meta.from = String(o.from).slice(0, 100);
  } else if (line && line !== old.note) {
    meta = Object.assign({}, old, { note: line });  // a new line; link and date stay
  } else if (tradition && !old.tradition) {
    meta = Object.assign({}, old, { tradition });   // already sent; now tied to a tradition
  }
  if (!meta) return { status: 200, message: 'Already on movingmusicTV: ' + what + '.', id, line: old.note || '' };

  if (meta.note && meta.note !== (old && old.note)) meta.noted = stamp();
  if (!fitMeta(meta)) return { status: 400, message: 'That link is too long to store.' };
  await env.MMP_KV.put(key, '1', { expirationTtl: INBOX_TTL, metadata: meta });
  try { await caches.default.delete(new Request(FINDS_CACHE_KEY)); } catch (e) {}
  const cut = meta.note && meta.note !== wrote && wrote ? ' Your line was cut to ' + meta.note.length + ' characters.' : '';
  if (!old) return { status: 201, message: 'On movingmusicTV: ' + what + (meta.note ? ', with your line.' : '.') + cut, id, line: meta.note };
  if (meta.note !== old.note) return { status: 200, message: 'Line updated on this ' + what + '.' + cut, id, line: meta.note };
  return { status: 200, message: 'Already on movingmusicTV: ' + what + '. Now tied to its tradition.', id, line: meta.note || '' };
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
  const r = await inboxAdd(env, body.url || body.link, { note: body.note });
  return reply(r.status, r.message, r.id ? { id: r.id, line: r.line || '' } : undefined);
}

// The inbox copy of a video, before Claude files it: no place, tags, or credit yet.
function inboxFind(m) {
  const pv = parseVideo(m.url) || {};
  return {
    id: m.id, platform: PLATFORM[m.p] || m.p, url: m.url, by: '',
    label: (NAME[m.p] || 'Video') + ' video', place: '', la: null, lo: null,
    tradition: m.tradition || '', uses: [], shows: '', orient: pv.o || 'v', added: m.added || '',
    from: m.from || 'Send button', note: m.note || '', noted: m.noted || '', inbox: true,
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

  const at = new Map(finds.map((f, i) => [f && f.id, i]));
  const hidden = new Set(hide.map((h) => (h && h.id) || h));
  const inbox = [];
  try {
    let cursor;
    do {
      const page = await env.MMP_KV.list({ prefix: INBOX_PREFIX, cursor, limit: 1000 });
      for (const k of page.keys) {
        const m = k.metadata;
        if (!m || !m.id || hidden.has(m.id)) continue;
        if (at.has(m.id)) {
          // Filed already. A line Bennett sent after the filing wins until the
          // weekly filing copies it into tv/finds.json.
          const i = at.get(m.id), f = finds[i];
          if (m.note && m.noted && m.noted > String(f.noted || '') && m.note !== f.note) {
            finds[i] = Object.assign({}, f, { note: m.note, noted: m.noted });
          }
          continue;
        }
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
