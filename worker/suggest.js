// Viewer suggestions for the Worksong Atlas, phase 1 (Nov 2026): a video for a
// tradition that still has none (a grey dot), and a correction to any dot.
//
//   GET  /suggest-config          { open, sitekey }. The Atlas shows its asks only
//                                 when open: both Turnstile settings are in place.
//   POST /suggest                 One suggestion. Checked by Cloudflare Turnstile,
//                                 rate limited, stored privately in KV as sugg:<id>.
//                                 Nothing about it is public.
//   GET  /suggest-count           { pending }. Public, no content. The daily filing
//                                 reads it.
//   GET  /review.html             Bennett's review page. It asks for the inbox key once.
//   GET  /suggestions             Every waiting suggestion. Needs the inbox key.
//   POST /suggestions/<id>/add    A video joins the Send button inbox, tied to its
//                                 tradition and credited to the sender. The
//                                 suggestion, email included, is deleted.
//   POST /suggestions/<id>/drop   Deletes the suggestion, email included.
//
// Settings: TURNSTILE_SITEKEY and TURNSTILE_SECRET (wrangler secrets), and the
// SUGGEST_LIMIT rate limit in wrangler.toml. The review API uses TV_INBOX_KEY.

import { inboxAdd, safeEqual } from './tv.js';

const PREFIX = 'sugg:';
const TTL = 60 * 60 * 24 * 365;
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const HOSTS = ['mmp-sync.bennett-727.workers.dev', 'movingmusic.works'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIND_ID = /^(?:yt|ig|fb|tt|file)-[\w-]{4,40}$/;
const SUGG_ID = /^[a-z0-9]{6,12}-[a-f0-9]{8}$/;
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,100}\.[^@\s]{2,24}$/;

function json(status, obj, cache) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache || 'no-store' },
  });
}

// Plain text from a visitor: no control characters except line breaks, trimmed, capped.
function clean(s, max, oneLine) {
  let t = String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ');
  if (oneLine) t = t.replace(/\s+/g, ' ');
  return t.replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

function isOpen(env) {
  return !!(env.TURNSTILE_SITEKEY && env.TURNSTILE_SECRET && env.MMP_KV);
}

export function suggestConfigGet(env) {
  const open = isOpen(env);
  return json(200, { open, sitekey: open ? env.TURNSTILE_SITEKEY : '' }, 'public, max-age=300');
}

async function verifyTurnstile(env, token, ip) {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  if (ip) form.set('remoteip', ip);
  try {
    const r = await fetch(SITEVERIFY, { method: 'POST', body: form });
    const j = await r.json();
    if (!j || j.success !== true) return false;
    if (j.action && j.action !== 'suggest') return false;
    if (j.hostname && HOSTS.indexOf(j.hostname) < 0) return false;
    return true;
  } catch (e) {
    return false;
  }
}

function newId() {
  const b = crypto.getRandomValues(new Uint8Array(4));
  return Date.now().toString(36) + '-' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function suggestPost(request, env, ip) {
  const bad = (message) => json(400, { ok: false, message });
  if (!isOpen(env)) return json(503, { ok: false, message: 'Suggestions are not open yet.' });
  let body;
  try {
    const text = await request.text();
    if (text.length > 8000) return json(413, { ok: false, message: 'That is too long.' });
    body = JSON.parse(text);
  } catch (e) {
    return bad('Could not read what was sent.');
  }
  if (!body || typeof body !== 'object') return bad('Could not read what was sent.');
  // Bots fill the hidden website field; people never see it. Say thanks, store nothing.
  if (body.website) return json(201, { ok: true });

  const kind = body.kind === 'video' || body.kind === 'fix' ? body.kind : '';
  const tradition = clean(body.tradition, 100, true);
  const find = clean(body.find, 50, true);
  const rec = {
    kind,
    tradition: SLUG.test(tradition) ? tradition : '',
    find: FIND_ID.test(find) ? find : '',
    title: clean(body.title, 120, true),
    link: clean(body.link, 800, true),
    text: clean(body.text, kind === 'fix' ? 1000 : 500),
    name: clean(body.name, 80, true),
    email: clean(body.email, 120, true),
  };
  if (!kind) return bad('Pick what you are sending.');
  if (!rec.tradition && !rec.find) return bad('This suggestion is missing its place on the Atlas.');
  if (kind === 'video') {
    let u = null;
    try { u = new URL(rec.link); } catch (e) {}
    if (!rec.tradition) return bad('A video suggestion needs its tradition.');
    if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) return bad('Paste a link that starts with https://');
  } else {
    rec.link = '';
    if (!rec.text) return bad('Say what should change.');
  }
  if (rec.email && !EMAIL.test(rec.email)) return bad('That email address looks wrong.');
  if (!(await verifyTurnstile(env, body.token, ip))) {
    return json(403, { ok: false, message: 'The bot check did not pass. Try again.' });
  }

  rec.id = newId();
  rec.at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  await env.MMP_KV.put(PREFIX + rec.id, JSON.stringify(rec), {
    expirationTtl: TTL,
    metadata: { kind: rec.kind, tradition: rec.tradition, find: rec.find, at: rec.at },
  });
  return json(201, { ok: true });
}

async function listKeys(env) {
  const keys = [];
  let cursor;
  do {
    const page = await env.MMP_KV.list({ prefix: PREFIX, cursor, limit: 1000 });
    keys.push(...page.keys);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && keys.length < 5000);
  return keys;
}

export async function suggestCountGet(env) {
  let pending = 0;
  try { pending = (await listKeys(env)).length; } catch (e) {}
  return json(200, { pending, review: 'https://mmp-sync.bennett-727.workers.dev/review.html' }, 'public, max-age=60');
}

function authorized(request, env) {
  const h = request.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return !!(env.TV_INBOX_KEY && m && safeEqual(m[1].trim(), env.TV_INBOX_KEY));
}

export async function suggestionsGet(request, env) {
  if (!env.TV_INBOX_KEY) return json(503, { ok: false, message: 'The inbox key is not set up yet.' });
  if (!authorized(request, env)) return json(401, { ok: false, message: 'Wrong key.' });
  const keys = await listKeys(env);
  const out = [];
  for (const k of keys) {
    const v = await env.MMP_KV.get(k.name);
    if (!v) continue;
    try { out.push(JSON.parse(v)); } catch (e) {}
  }
  out.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return json(200, { ok: true, suggestions: out });
}

export async function suggestionAct(request, env, id, action) {
  if (!env.TV_INBOX_KEY) return json(503, { ok: false, message: 'The inbox key is not set up yet.' });
  if (!authorized(request, env)) return json(401, { ok: false, message: 'Wrong key.' });
  if (!SUGG_ID.test(id)) return json(400, { ok: false, message: 'No such suggestion.' });
  const key = PREFIX + id;
  const v = await env.MMP_KV.get(key);
  if (!v) return json(404, { ok: false, message: 'Already handled.' });
  if (action === 'drop') {
    await env.MMP_KV.delete(key);
    return json(200, { ok: true, message: 'Dropped.' });
  }
  let rec;
  try { rec = JSON.parse(v); } catch (e) { return json(500, { ok: false, message: 'Could not read it.' }); }
  if (rec.kind !== 'video') return json(400, { ok: false, message: 'Only a video can be added. Mark an improvement done.' });
  const first = String(rec.name || '').split(' ')[0];
  const r = await inboxAdd(env, rec.link, { tradition: rec.tradition, from: first ? 'Suggested by ' + first : 'Suggested by a visitor' });
  if (r.status >= 300) return json(r.status, { ok: false, message: r.message + ' Add it by hand, or drop it.' });
  await env.MMP_KV.delete(key);
  return json(200, { ok: true, id: r.id, message: 'Added. It is on the TV and the Atlas within a minute. The daily filing gives it a place and credit.' });
}

export function reviewPage() {
  return new Response(REVIEW_HTML, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export const REVIEW_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Atlas suggestions</title>
<style>
  :root { --ink: #231f1b; --brick: #8a2f22; --paper: #f3ede1; --line: #d9ccb6; --muted: #6b6157; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 18px 16px 60px; }
  h1 { font: 600 26px/1.2 Georgia, serif; margin: 4px 0 14px; }
  .lbl { font-weight: 700; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  .card { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 14px; margin: 12px 0; }
  .card h2 { font: 600 19px/1.25 Georgia, serif; margin: 3px 0 6px; }
  .card h2 a { color: var(--ink); }
  .link { word-break: break-all; }
  .text { white-space: pre-wrap; margin: 8px 0; padding-left: 10px; border-left: 3px solid var(--line); }
  .who { color: var(--muted); font-size: 14px; }
  .acts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  button { font: 700 13px/1 system-ui, sans-serif; letter-spacing: .05em; text-transform: uppercase; padding: 10px 14px; border-radius: 5px; border: 1px solid var(--ink); background: transparent; color: var(--ink); cursor: pointer; }
  button.primary { background: var(--ink); color: var(--paper); }
  button:disabled { opacity: .5; cursor: default; }
  .msg { margin-top: 8px; font-size: 14px; color: var(--brick); }
  input { font: inherit; padding: 10px; width: 100%; border: 1px solid var(--line); border-radius: 5px; margin: 6px 0 10px; }
  #state { color: var(--muted); }
</style>
</head>
<body>
<main>
  <div class="lbl">Worksong Atlas</div>
  <h1>Suggestions</h1>
  <form id="unlock" hidden>
    <label class="lbl" for="key">Inbox key, the one in your Send button shortcut</label>
    <input id="key" type="password" autocomplete="current-password" required>
    <button class="primary" type="submit">Open</button>
  </form>
  <p id="state">Loading.</p>
  <div id="list"></div>
</main>
<script>
(function () {
  var API = 'https://mmp-sync.bennett-727.workers.dev';
  var KEY_NAME = 'mmp-inbox-key';
  var key = '';
  try { key = localStorage.getItem(KEY_NAME) || ''; } catch (e) {}
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function words(slug) { return String(slug || '').replace(/-/g, ' '); }
  function api(path, method) {
    return fetch(API + path, { method: method || 'GET', headers: { Authorization: 'Bearer ' + key } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; return j; }); });
  }
  function askKey(msg) {
    $('unlock').hidden = false;
    $('state').textContent = msg || '';
    $('list').innerHTML = '';
  }
  $('unlock').addEventListener('submit', function (e) {
    e.preventDefault();
    key = $('key').value.trim();
    try { localStorage.setItem(KEY_NAME, key); } catch (err) {}
    load();
  });
  function card(s) {
    var where = s.tradition
      ? '<a href="https://movingmusic.works/atlas/#tradition=' + encodeURIComponent(s.tradition) + '" target="_blank" rel="noopener">' + esc(s.title || words(s.tradition)) + '</a>'
      : '<a href="https://movingmusic.works/tv/#v=' + encodeURIComponent(s.find) + '" target="_blank" rel="noopener">' + esc(s.title || s.find) + '</a>';
    var who = [s.name ? esc(s.name) : 'No name', s.email ? '<a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a>' : 'no email'].join(', ');
    var acts = s.kind === 'video'
      ? '<button class="primary" data-a="add">Add to the TV</button><button data-a="drop">Drop</button>'
      : '<button data-a="copy">Copy</button><button class="primary" data-a="drop">Done</button>';
    return '<article class="card" data-id="' + esc(s.id) + '">' +
      '<div class="lbl">' + (s.kind === 'video' ? 'A video for' : 'An improvement for') + ' &middot; ' + esc(String(s.at || '').slice(0, 10)) + '</div>' +
      '<h2>' + where + '</h2>' +
      (s.link ? '<div class="link"><a href="' + esc(s.link) + '" target="_blank" rel="noopener noreferrer">' + esc(s.link) + '</a></div>' : '') +
      (s.text ? '<div class="text">' + esc(s.text) + '</div>' : '') +
      '<div class="who">' + who + '</div>' +
      '<div class="acts">' + acts + '</div><div class="msg"></div></article>';
  }
  var items = {};
  function load() {
    $('state').textContent = 'Loading.';
    api('/suggestions').then(function (j) {
      if (j.status === 401) { try { localStorage.removeItem(KEY_NAME); } catch (e) {} key = ''; return askKey('Wrong key. Try again.'); }
      if (!j.ok) return askKey(j.message || 'Could not load.');
      $('unlock').hidden = true;
      items = {};
      (j.suggestions || []).forEach(function (s) { items[s.id] = s; });
      $('state').textContent = j.suggestions.length ? j.suggestions.length + ' waiting.' : 'Nothing waiting.';
      $('list').innerHTML = j.suggestions.map(card).join('');
    }).catch(function () { $('state').textContent = 'Could not reach the server.'; });
  }
  $('list').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-a]');
    if (!b) return;
    var c = b.closest('.card'), id = c.getAttribute('data-id'), s = items[id], a = b.getAttribute('data-a'), msg = c.querySelector('.msg');
    if (a === 'copy') {
      var t = (s.title || words(s.tradition) || s.find) + ': ' + s.text;
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { msg.textContent = 'Copied. Paste it to Claude.'; });
      return;
    }
    if (a === 'drop' && !confirm(s.kind === 'video' ? 'Drop this suggestion? It is deleted, email included.' : 'Mark this done? It is deleted, email included.')) return;
    [].forEach.call(c.querySelectorAll('button'), function (x) { x.disabled = true; });
    api('/suggestions/' + encodeURIComponent(id) + '/' + a, 'POST').then(function (j) {
      msg.textContent = j.message || (j.ok ? 'Done.' : 'That did not work.');
      if (j.ok) { delete items[id]; c.querySelector('.acts').remove(); }
      else [].forEach.call(c.querySelectorAll('button'), function (x) { x.disabled = false; });
    });
  });
  if (key) load(); else askKey('');
})();
</script>
</body>
</html>
`;
