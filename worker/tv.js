// movingmusicTV routes for the mmp-sync worker.
//
//   POST /tv-inbox       The "Send to movingmusicTV" button on Bennett's phone.
//                        Body, as JSON or a form: { key, url, note, title,
//                        page_title }. key must match the TV_INBOX_KEY secret.
//                        note is Bennett's line: one sentence of commentary,
//                        shown under the video as he wrote it. title and
//                        page_title are the phone's two guesses at the post's
//                        title (Facebook and Instagram give no other way to get
//                        it); YouTube and TikTok titles come from their oEmbed.
//                        The video is stored in KV under tvin:<id> and shows on
//                        the TV within a minute. Sending the same
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
// Shows in the X-MMP-Build header, so a deploy can be checked from outside.
export const BUILD = '2026-11-12.11';
const INBOX_PREFIX = 'tvin:';
const INBOX_TTL = 60 * 60 * 24 * 365;  // a year; Claude files each video long before
const FINDS_CACHE_KEY = 'https://mmp-sync.internal/tv-finds.json';
const FINDS_TTL = 60;
const NAME = { yt: 'YouTube', ig: 'Instagram', fb: 'Facebook', tt: 'TikTok', file: 'Video' };
const PLATFORM = { yt: 'youtube', ig: 'instagram', fb: 'facebook', tt: 'tiktok', file: 'file' };
export const LINE_MAX = 280;
const TITLE_MAX = 120;
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
  if ((m.pn || m.pp) && metaBytes(m) > META_MAX) { delete m.pn; delete m.pp; }
  if (m.orig && metaBytes(m) > META_MAX) delete m.orig;
  if (m.title && metaBytes(m) > META_MAX) m.title = cutLine(m.title.replace(/\u2026$/, ''), 60);
  while (m.note && metaBytes(m) > META_MAX) {
    const max = m.note.length - 20;
    m.note = max < 20 ? '' : cutLine(m.note.replace(/\u2026$/, ''), max);
  }
  if (m.from && metaBytes(m) > META_MAX) m.from = m.from.slice(0, 40);
  if (m.title && metaBytes(m) > META_MAX) delete m.title;
  if (m.by && metaBytes(m) > META_MAX) delete m.by;
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
      // Share links resolve to m.facebook.com; the embed plays www links.
      if (/(?:^|\.)facebook\.com$/.test(u.hostname)) u.hostname = 'www.facebook.com';
      const reel = u.pathname.match(/\/reel\/(\d+)/);
      if (reel) return 'https://www.facebook.com/reel/' + reel[1] + '/';
      // Keep only the parameters that name a video or post; the rest is share tracking.
      [...u.searchParams.keys()].forEach((k) => {
        if (!/^(v|story_fbid|id|fbid|set|type)$/.test(k)) u.searchParams.delete(k);
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

// A post's title without the platform's clutter: view and like counts, the site
// name, "Reel by X" (kept as the credit on Facebook), and hashtags at the end.
// Returns { title, by }; either may be empty.
const STAT = String.raw`[\d.,]+\s*[KMB]?\s+(?:views?|likes?|reactions?|comments?|shares?|plays?)`;
const STAT_SEG = new RegExp('^' + STAT + '(?:\\s*[\u00b7\u2022,]\\s*' + STAT + ')*$', 'i');
const SITE_SEG = /^(?:facebook|instagram|tiktok|youtube|reels?|watch|videos?|log ?in(?:to (?:facebook|instagram))?(?: or sign up)?(?: to (?:view|continue))?|sign up|instagram photos and videos)$/i;
export function cleanTitle(raw, p) {
  let s = String(raw || '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufffc]/g, ' ').replace(/\s+/g, ' ').trim();
  let by = '';
  if (!s || /^https?:\/\//i.test(s) || s.length > 2000) return { title: '', by };
  s = s.replace(/\s+[-|\u2013\u2014\u2022\u00b7]\s+(?:YouTube|TikTok|Facebook|Instagram)$/i, '');
  s = s.replace(/^(?:YouTube|TikTok|Facebook|Instagram)\s+[-|\u2013\u2014\u2022\u00b7]\s+/i, '');
  if (p === 'ig') {
    // 'Name (@handle) on Instagram: "caption"': the handle is the credit.
    const m = s.match(/^(.{0,80}?)\s+on Instagram:\s*["\u201c]([\s\S]*?)["\u201d]?$/);
    if (m) {
      const h = m[1].match(/\(@([\w.]{1,30})\)/);
      if (h) by = h[1];
      s = m[2];
    }
  }
  const keep = [];
  s.split(/\s+\|\s+/).forEach((seg, i) => {
    seg = seg.trim();
    const r = i > 0 && seg.match(/^(?:(?:reels?|video|post)\s+)?by\s+(.{1,60})$/i);
    if (r) { if (p === 'fb' && !by) by = r[1]; return; }
    if (seg && !STAT_SEG.test(seg) && !SITE_SEG.test(seg)) keep.push(seg);
  });
  s = keep.join(' | ').replace(/(?:\s*#[^\s#]+)+$/u, '').replace(/^["\u201c]([\s\S]*)["\u201d]$/, '$1').trim();
  if (SITE_SEG.test(s) || !/\p{L}/u.test(s)) s = '';  // a site name, or no words at all
  // Same dash rule as Bennett's line, so a kept title passes build_tv.py --check.
  s = cleanLine(s);
  return { title: s ? cutLine(s, TITLE_MAX) : '', by: cleanLine(by).slice(0, 60) };
}

// YouTube and TikTok publish titles through oEmbed; Facebook and Instagram need an
// approved app and no longer return titles or authors, so their titles come from
// the phone.
async function oembedTitle(pv, url) {
  const api = pv.p === 'yt' ? 'https://www.youtube.com/oembed?format=json&url=' +
      encodeURIComponent('https://www.youtube.com/watch?v=' + pv.k)
    : pv.p === 'tt' ? 'https://www.tiktok.com/oembed?url=' + encodeURIComponent(url) : '';
  if (!api) return null;
  try {
    const r = await fetch(api, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const j = await r.json();
    return {
      title: cleanTitle(j.title, pv.p).title,
      by: String((pv.p === 'tt' && j.author_unique_id) || j.author_name || '').trim().slice(0, 60),
    };
  } catch (e) {
    return null;
  }
}

// Titles show in English. Workers AI (the AI binding) translates a title in any
// other language and hands an English one back unchanged. Without the binding,
// or on any error or odd answer, the title stays as it came.
const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export async function inEnglish(env, s) {
  if (!s || !env || !env.AI) return s;
  try {
    const r = await Promise.race([
      env.AI.run(AI_MODEL, {
        messages: [
          { role: 'system', content: 'You translate the title of a short social video into natural English. Keep names of people, groups, and places. If the title is already English, reply with it unchanged. Reply with the English title only: no quotes, no notes.' },
          { role: 'user', content: s },
        ],
        max_tokens: 100,
        temperature: 0,
      }),
      new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 6000)),
    ]);
    let t = String((r && r.response) || '').split('\n').map((x) => x.trim()).filter(Boolean)[0] || '';
    t = t.replace(/^(?:english\s+)?(?:translation|title)\s*:\s*/i, '').replace(/^["\u201c']+|["\u201d']+$/g, '');
    t = cleanLine(t);
    if (!t || !/\p{L}/u.test(t) || t.length > s.length * 3 + 40) return s;
    return cutLine(t, TITLE_MAX);
  } catch (e) {
    return s;
  }
}

// The phone sends two guesses: the name the share menu gives the item (from
// Facebook and Instagram, only the link itself) and the title of the page as
// the phone opens it. The first one that reads as a title wins.
function phoneTitle(pv, url, guesses) {
  let by = '';  // Facebook's page title is often only "1.1K views | Reel by Name": keep the name
  for (const g of guesses) {
    const t = cleanTitle(g, pv.p);
    if (t.title && (url.includes(t.title) || /https?:\/\//i.test(t.title))) t.title = '';  // a link, not a title
    if (t.title) return { title: t.title, by: t.by || by };
    by = by || t.by;
  }
  return { title: '', by };
}

// Facebook and Instagram give titles through oEmbed to approved apps only, so
// for those two the worker reads the public page's own og: tags, under a user
// agent that names this project. A login wall, an error or a timeout returns
// null and the title is left to the weekly filing.
const PAGE_UA = 'movingmusicTV/1.0 (+https://movingmusic.works/tv/)';
const PAGE_MAX = 300000;

function decodeEntities(t) {
  return String(t || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export function ogTags(html) {
  const tag = (name) => {
    const a = html.match(new RegExp('<meta[^>]+(?:property|name)="' + name + '"[^>]+content="([^"]*)"', 'i'))
      || html.match(new RegExp('<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="' + name + '"', 'i'));
    return a ? decodeEntities(a[1]).replace(/\s+/g, ' ').trim() : '';
  };
  return { title: tag('og:title'), description: tag('og:description') || tag('description') };
}

// Turns a page's og: tags into { title, by }. Either may be empty.
export function pageTitleFromTags(tags, p) {
  let title = '', by = '';
  const generic = (t) => !t || !/\p{L}/u.test(t) || /^(?:log ?in(?:to)?|sign up|facebook|instagram)\b/i.test(t) || /log in or sign up|create an account or log in/i.test(t);
  if (p === 'fb') {
    const segs = tags.title.split(/\s+\|\s+/).map((x) => x.trim()).filter((x) => x && !STAT_SEG.test(x) && !SITE_SEG.test(x));
    const desc = generic(tags.description) ? '' : tags.description;
    if (segs.length >= 2) { by = segs.pop(); title = segs.join(' | '); }
    else if (segs.length === 1) {
      const only = segs[0];
      const m = only.match(/^(?:(?:reels?|video|post)\s+)?by\s+(.+)$/i);
      if (m) by = m[1];
      else if (desc && (desc.startsWith(only.slice(0, 20)) || only.startsWith(desc.slice(0, 20)))) title = only;
      else by = only;
    }
    if (!title && desc) title = desc;
  } else if (p === 'ig') {
    const t = tags.title.match(/^(.*?)\s+on Instagram(?::\s*["\u201c]([\s\S]*?)["\u201d]?)?$/i);
    if (t) {
      const h = t[1].match(/\(@([\w.]{1,30})\)/);
      by = h ? h[1] : t[1];
      title = t[2] || '';
    }
    const d = tags.description.match(/^[\d.,KMB]+\s+likes?,\s+[\d.,KMB]+\s+comments?\s+-\s+([\w.]{1,30})\s+on\s+[^:]{4,30}(?::\s*["\u201c]([\s\S]*?)["\u201d]?\.?)?$/i);
    if (d) {
      by = d[1];
      if (!title) title = d[2] || '';
    }
  }
  title = title.replace(/(?:\s*#[^\s#]+)+$/u, '').replace(/\s+/g, ' ').trim();
  if (generic(title)) title = '';
  return { title: cutLine(cleanLine(title), TITLE_MAX), by: cleanLine(by).slice(0, 60) };
}

async function pageTitle(url, pv) {
  if (pv.p !== 'fb' && pv.p !== 'ig') return null;
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': PAGE_UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.8' },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok || !r.body) return null;
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let html = '', bytes = 0;
    while (bytes < PAGE_MAX) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      html += dec.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
    const t = pageTitleFromTags(ogTags(html), pv.p);
    return t.title || t.by ? t : null;
  } catch (e) {
    return null;
  }
}

async function postTitle(env, pv, url, sent, page) {
  const api = await oembedTitle(pv, url);
  const phone = phoneTitle(pv, url, [sent, page]);
  const web = !api && !phone.title ? await pageTitle(url, pv) : null;
  let title = (api && api.title) || phone.title || (web && web.title) || '', orig = '';
  const by = (api && api.by) || (web && web.by) || phone.by;
  if (title) {
    const en = await inEnglish(env, title);
    if (en && en !== title) { orig = title; title = en; }
  }
  const said = (x) => String(x || '').replace(/\s+/g, ' ').trim();
  return { title, by, orig, sent: said(sent), page: said(page) };
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
  const tradition = String(o.tradition || '').slice(0, 100);
  const post = !old || !old.title ? await postTitle(env, pvc, url, o.title, o.pageTitle) : null;

  let meta = null;
  if (!old) {
    meta = { id, url, note: line, p: pvc.p, added: new Date().toISOString().slice(0, 10) };
    if (tradition) meta.tradition = tradition;
    if (o.from) meta.from = String(o.from).slice(0, 100);
    if (post && post.title) meta.title = post.title;
    if (post && post.orig) meta.orig = post.orig;
    if (post && post.by) meta.by = post.by;
  } else {
    const add = {};  // a new line, a tradition, a title it lacked; link and date stay
    if (line && line !== old.note) add.note = line;
    if (tradition && !old.tradition) add.tradition = tradition;
    if (post && post.title) add.title = post.title;
    if (post && post.title && post.orig) add.orig = post.orig;
    if (post && post.by && !old.by) add.by = post.by;
    if (Object.keys(add).length) meta = Object.assign({}, old, add);
  }
  // What the phone sent, kept with the inbox copy (phone_name, phone_page in
  // /tv-finds.json) so a missing title can be traced to the phone.
  if (o.phone && post) {
    const pn = cutLine(post.sent, 80), pp = cutLine(post.page, 80);
    const base = meta || old || {};
    if (base.pn !== pn || base.pp !== pp) meta = Object.assign({}, meta || old, { pn, pp });
  }
  const shown = (meta || old).title, credit = (meta || old).by;
  const what = shown ? '\u201c' + cutLine(shown, 60) + '\u201d' : NAME[pvc.p] + ' video' + (credit ? ' by ' + credit : '');
  // From the Send button with no usable title: say what the phone sent, so a
  // missing title can be traced to the phone or to the cleanup here.
  const why = !shown && !credit && o.phone ? (post && post.page
    ? ' The page title was \u201c' + cutLine(post.page, 50) + '\u201d.'
    : post && post.sent
    ? ' Your phone sent \u201c' + cutLine(post.sent, 50) + '\u201d, not a title.'
    : ' Your phone sent no title.') : '';
  if (!meta) return { status: 200, message: 'Already on movingmusicTV: ' + what + '.' + why, id, line: old.note || '' };

  if (meta.note && meta.note !== (old && old.note)) meta.noted = stamp();
  if (!fitMeta(meta)) return { status: 400, message: 'That link is too long to store.' };
  await env.MMP_KV.put(key, '1', { expirationTtl: INBOX_TTL, metadata: meta });
  try { await caches.default.delete(new Request(FINDS_CACHE_KEY)); } catch (e) {}
  const cut = meta.note && meta.note !== wrote && wrote ? ' Your line was cut to ' + meta.note.length + ' characters.' : '';
  if (!old) return { status: 201, message: 'On movingmusicTV: ' + what + (meta.note ? ', with your line.' : '.') + cut + why, id, line: meta.note };
  if (meta.note !== old.note) return { status: 200, message: 'Line updated on ' + (shown ? '' : 'this ') + what + '.' + cut + why, id, line: meta.note };
  if (meta.tradition !== old.tradition) return { status: 200, message: 'Already on movingmusicTV: ' + what + '. Now tied to its tradition.', id, line: meta.note || '' };
  if (meta.title && !old.title) return { status: 200, message: 'Already on movingmusicTV: ' + what + '. Title added.', id, line: meta.note || '' };
  if (meta.by && !old.by) return { status: 200, message: 'Already on movingmusicTV: ' + what + '. Credit added.', id, line: meta.note || '' };
  return { status: 200, message: 'Already on movingmusicTV: ' + what + '.' + why, id, line: meta.note || '' };
}

export async function tvInboxPost(request, env) {
  const asText = new URL(request.url).searchParams.get('format') === 'text';
  const reply = (status, message, extra) => asText
    ? new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-MMP-Build': BUILD } })
    : new Response(JSON.stringify({ ok: status < 300, message, ...(extra || {}) }),
      { status, headers: { 'Content-Type': 'application/json', 'X-MMP-Build': BUILD } });

  if (!env.TV_INBOX_KEY) return reply(503, 'The movingmusicTV inbox is not set up yet.');
  let body;
  try { body = await readBody(request); } catch (e) { return reply(400, 'Could not read what was sent.'); }
  if (!body || !safeEqual(String(body.key || ''), env.TV_INBOX_KEY)) return reply(401, 'Wrong key.');
  const r = await inboxAdd(env, body.url || body.link, { note: body.note, title: body.title, pageTitle: body.page_title, phone: true });
  return reply(r.status, r.message, r.id ? { id: r.id, line: r.line || '' } : undefined);
}

// The inbox copy of a video, before Claude files it: no place or tags yet, and the
// post's own title and credit when the phone or oEmbed gave them.
function inboxFind(m) {
  const pv = parseVideo(m.url) || {};
  // Links stored before a canonical() fix come out clean too.
  const url = pv.p ? canonical(m.url, pv) : m.url;
  return {
    id: m.id, platform: PLATFORM[m.p] || m.p, url, by: m.by || '',
    label: m.title || (NAME[m.p] || 'Video') + ' video', title_orig: m.orig || '', phone_name: m.pn || '', phone_page: m.pp || '', place: '', la: null, lo: null,
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
      'Access-Control-Expose-Headers': 'X-MMP-Build',
      'X-MMP-Build': BUILD,
    },
  });
  try {
    const put = caches.default.put(ck, res.clone());
    if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
  } catch (e) {}
  return res;
}
