// Moving Music Player sync — Cloudflare Worker + KV
//
// movingmusicTV routes (/tv.html, /tv-finds.json, /tv-inbox) are in tv.js.
//
// Routes:
//   GET  /playlist/:uuid       → stored playlist JSON (or "null")
//   PUT  /playlist/:uuid       → stores playlist JSON for this member
//   GET  /shared/:shareId      → stored shared setlist JSON (public)
//   PUT  /shared/:shareId      → stores a setlist under a shareable id
//   POST /pick-route           → write "route-<slug>" label on a Ghost
//                                member via the Ghost Admin API. Body:
//                                { uuid, route }. Preserves existing
//                                non-route labels. One pick per
//                                member: 409 if a route-* label is
//                                already on the member.
//   OPTIONS                    → CORS preflight
//
// Security model (v1): UUID-in-URL trust. Anyone with the UUID can
// read/write that playlist; the UUID is server-side except for the
// signed-in user, so this is acceptable for non-sensitive data.
//
// /pick-route uses the same trust model: whoever has a member's UUID
// can write that member's own route label. The UUID is only exposed
// to the signed-in member via /members/api/member/, so this is
// acceptable for a tier-2 content preference.
//
// Shared setlists use a separate KV namespace prefix (`shared:`) and a
// short random shareId as the secret. Anyone with the shareId can read
// or overwrite the entry. Acceptable for the "share my gig setlist with
// a co-performer" use case; harden later if abuse appears.

import { tvFindsGet, tvInboxPost } from './tv.js';
import { suggestConfigGet, suggestPost, suggestCountGet, suggestionsGet, suggestionAct, reviewPage } from './suggest.js';

const ALLOWED_ORIGIN = 'https://movingmusic.works';

// Allowed route slugs. Must match Ghost tag slugs on movingmusic.works.
// Keep in sync with picker.js ROUTES.
const ALLOWED_ROUTES = [
  'rowing', 'sea-shanties', 'walking', 'farm', 'woods',
  'maine', 'shaker', 'love', 'gathering'
];

// Allowed songbook slugs for the Nov 2026 picker. Must match Ghost
// tag slugs. Keep in sync with picker.js PICKABLE.
const PICKABLE = [
  'walking', 'rowing', 'gathering', 'field-forest',
  'originals', 'dance-instrumentals'
];

// Ghost normalizes the colon in a label name `pick:walking` to a
// hyphen on save, so the slug lands as `pick-walking`. Detect either.
function pickFromLabel(label) {
  if (!label) return null;
  const slug = label.slug || '';
  const name = label.name || '';
  if (slug.indexOf('pick-') === 0) return slug.substring(5);
  if (name.indexOf('pick:') === 0) return name.substring(5);
  return null;
}

const UUID_RE = /^[A-Za-z0-9_-]{8,64}$/;

const GHOST_ADMIN_HOST = 'https://moving-music.ghost.io';

// Repo the atlas map is served from. Bumped by editing this constant.
const ATLAS_MAP_REPO = 'bennett-hue/moving-music-player';
const ATLAS_MAP_SHA = '4ff9fc4';
// Commit movingmusicTV (tv.html) is served from. Bump after each TV rebuild.
const TV_SHA = '47e361a';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonHeaders() {
  return { ...corsHeaders(), 'Content-Type': 'application/json' };
}

// Per-IP throttle through Cloudflare's Rate Limiting binding:
// PICK_GET_LIMIT (60 a minute) and PICK_POST_LIMIT (10 a minute), set in
// wrangler.toml. It replaces a KV counter that could not count bursts:
// KV takes one write per key per second, the extra writes threw, and
// the throttle failed open, so 62 GETs in a minute all went through
// (Nov 11, 2026 test). It also spent a KV write on every /pick request.
// Fails open if the binding is missing or errors, so a limiter problem
// never blocks a legitimate pick.
async function rateLimit(env, kind, ip) {
  if (!ip) return { ok: true };
  const limiter = kind === 'pick-get' ? env.PICK_GET_LIMIT
    : kind === 'pick-post' ? env.PICK_POST_LIMIT
    : kind === 'tv-inbox' ? env.TV_INBOX_LIMIT
    : kind === 'suggest' ? env.SUGGEST_LIMIT
    : null;
  if (!limiter) return { ok: true };
  try {
    const { success } = await limiter.limit({ key: ip });
    return success ? { ok: true } : { ok: false, retryAfter: 60 };
  } catch (e) {
    return { ok: true };
  }
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip')
      || request.headers.get('x-real-ip')
      || '';
}

function routeKey(pathname) {
  let m = pathname.match(/^\/playlist\/([A-Za-z0-9_-]{8,64})$/);
  if (m) return `playlist:${m[1]}`;
  m = pathname.match(/^\/shared\/([A-Za-z0-9_-]{8,32})$/);
  if (m) return `shared:${m[1]}`;
  return null;
}

// ---------------------------------------------------------------
// Ghost Admin JWT. GHOST_ADMIN_KEY is a secret of the form
// "<keyid>:<secret-hex>" set via `wrangler secret put GHOST_ADMIN_KEY`.
// ---------------------------------------------------------------

function b64url(input) {
  // input may be a Uint8Array or an ArrayBuffer
  const bytes = input instanceof Uint8Array
    ? input : new Uint8Array(input);
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return btoa(s)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

async function ghostJwt(adminKey) {
  const [kid, secretHex] = adminKey.split(':');
  const header = { alg: 'HS256', typ: 'JWT', kid };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + 300, aud: '/admin/' };
  const enc = new TextEncoder();
  const headerB64 = b64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = b64url(enc.encode(JSON.stringify(payload)));
  const signingInput = headerB64 + '.' + payloadB64;
  const key = await crypto.subtle.importKey(
    'raw',
    hexToBytes(secretHex),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC', key, enc.encode(signingInput)
  );
  return signingInput + '.' + b64url(sig);
}

async function memberLabelsHandler(request, env, uuid) {
  if (!env.GHOST_ADMIN_KEY) {
    return new Response(
      'server misconfigured: no admin key',
      { status: 500, headers: corsHeaders() }
    );
  }
  if (!UUID_RE.test(uuid)) {
    return new Response(
      'bad uuid', { status: 400, headers: corsHeaders() }
    );
  }
  const token = await ghostJwt(env.GHOST_ADMIN_KEY);
  const url = GHOST_ADMIN_HOST +
    '/ghost/api/admin/members/?' +
    'filter=' + encodeURIComponent('uuid:' + uuid) +
    '&include=labels&limit=1';
  const r = await fetch(url, {
    headers: { Authorization: 'Ghost ' + token }
  });
  if (!r.ok) {
    return new Response(
      'ghost lookup failed: ' + r.status,
      { status: 502, headers: corsHeaders() }
    );
  }
  const data = await r.json();
  const m = data.members && data.members[0];
  if (!m) {
    return new Response(
      JSON.stringify({ uuid: uuid, labels: [], found: false }),
      { status: 200, headers: jsonHeaders() }
    );
  }
  const labels = (m.labels || []).map(function (l) {
    return { slug: l.slug, name: l.name };
  });
  return new Response(
    JSON.stringify({
      uuid: uuid,
      labels: labels,
      status: m.status,
      found: true
    }),
    { status: 200, headers: jsonHeaders() }
  );
}

async function pickRouteHandler(request, env) {
  if (!env.GHOST_ADMIN_KEY) {
    return new Response(
      'server misconfigured: no admin key',
      { status: 500, headers: corsHeaders() }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(
      'invalid json', { status: 400, headers: corsHeaders() }
    );
  }

  const uuid = body && body.uuid;
  const route = body && body.route;

  if (!uuid || typeof uuid !== 'string' ||
      !/^[A-Za-z0-9_-]{8,64}$/.test(uuid)) {
    return new Response(
      'bad uuid', { status: 400, headers: corsHeaders() }
    );
  }
  if (!route || typeof route !== 'string' ||
      ALLOWED_ROUTES.indexOf(route) === -1) {
    return new Response(
      'bad route', { status: 400, headers: corsHeaders() }
    );
  }

  const token = await ghostJwt(env.GHOST_ADMIN_KEY);

  // Look up the member by uuid. The admin API supports filter=uuid:xxx
  const findUrl =
    GHOST_ADMIN_HOST +
    '/ghost/api/admin/members/?' +
    'filter=' + encodeURIComponent('uuid:' + uuid) +
    '&include=labels&limit=1';

  const findRes = await fetch(findUrl, {
    headers: { Authorization: 'Ghost ' + token }
  });
  if (!findRes.ok) {
    return new Response(
      'ghost lookup failed: ' + findRes.status,
      { status: 502, headers: corsHeaders() }
    );
  }
  const findData = await findRes.json();
  const member = findData.members && findData.members[0];
  if (!member) {
    return new Response(
      'member not found', { status: 404, headers: corsHeaders() }
    );
  }

  // One pick per member. A member who already holds a route-* label
  // keeps it; the only way to another category is the Full Songbook.
  // Bennett can still change a label by hand in Ghost Admin.
  const current = (member.labels || []).find(function (l) {
    return l && (l.slug || '').indexOf('route-') === 0;
  });
  if (current) {
    return new Response(
      JSON.stringify({ ok: false, reason: 'already picked',
        route: current.slug.substring(6) }),
      { status: 409, headers: jsonHeaders() }
    );
  }

  // Preserve existing non-route labels. Keep legacy-free if present
  // (should never happen since legacy-free members skip the picker,
  // but defensive).
  //
  // Ghost's Member model drops any label object that has no `name`
  // on save (and answers 200 anyway), then matches the ones it keeps
  // to existing labels case-insensitively by name, creating the label
  // when none exists. So every label here carries `name`. A slug-only
  // list used to wipe the member's labels while reporting success.
  const existing = (member.labels || [])
    .filter(function (l) {
      return l && l.name &&
        (l.slug || '').indexOf('route-') !== 0 &&
        l.name.indexOf('route-') !== 0;
    })
    .map(function (l) {
      return { id: l.id, name: l.name, slug: l.slug };
    });
  const nextLabels = existing.concat([{
    name: 'route-' + route,
    slug: 'route-' + route
  }]);

  // Need updated_at for the collision check.
  const updateUrl =
    GHOST_ADMIN_HOST +
    '/ghost/api/admin/members/' + member.id + '/';
  const updateRes = await fetch(updateUrl, {
    method: 'PUT',
    headers: {
      Authorization: 'Ghost ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      members: [{
        id: member.id,
        labels: nextLabels,
        updated_at: member.updated_at
      }]
    })
  });
  if (!updateRes.ok) {
    const txt = await updateRes.text();
    return new Response(
      'ghost update failed: ' + updateRes.status + ' ' + txt,
      { status: 502, headers: corsHeaders() }
    );
  }

  // Ghost can accept the write and still drop the label (see above),
  // so confirm it is on the member before reporting success.
  let saved = null;
  try {
    const upd = await updateRes.json();
    saved = upd.members && upd.members[0];
  } catch (e) {
    saved = null;
  }
  const savedSlugs = ((saved && saved.labels) || [])
    .map(function (l) { return l.slug; });
  if (savedSlugs.indexOf('route-' + route) === -1) {
    return new Response(
      'ghost accepted the write but the label is missing: ' +
        JSON.stringify(savedSlugs),
      { status: 502, headers: corsHeaders() }
    );
  }

  return new Response(
    JSON.stringify({ ok: true, route: route, labels: savedSlugs }),
    { status: 200, headers: jsonHeaders() }
  );
}

// ---------------------------------------------------------------
// /pick: songbook picker for the Nov 2026 rebuild. One pick per
// free member. Separate from the earlier /pick-route handler
// (which used route-* labels and a 9-way list); kept so the old
// code path, which was never wired to the live site, does not
// break if anything still touches it.
// ---------------------------------------------------------------

async function pickGetHandler(request, env) {
  if (!env.GHOST_ADMIN_KEY) {
    return new Response('server misconfigured: no admin key',
      { status: 500, headers: corsHeaders() });
  }
  const rl = await rateLimit(env, 'pick-get', clientIp(request));
  if (!rl.ok) {
    return new Response('rate limited',
      { status: 429, headers: { ...corsHeaders(),
        'Retry-After': String(rl.retryAfter || 60) } });
  }
  const url = new URL(request.url);
  const uuid = url.searchParams.get('uuid');
  if (!uuid || !UUID_RE.test(uuid)) {
    return new Response('bad uuid', { status: 400, headers: corsHeaders() });
  }
  const token = await ghostJwt(env.GHOST_ADMIN_KEY);
  const findUrl = GHOST_ADMIN_HOST +
    '/ghost/api/admin/members/?' +
    'filter=' + encodeURIComponent('uuid:' + uuid) +
    '&include=labels&limit=1';
  const r = await fetch(findUrl,
    { headers: { Authorization: 'Ghost ' + token } });
  if (!r.ok) {
    return new Response('ghost lookup failed: ' + r.status,
      { status: 502, headers: corsHeaders() });
  }
  const data = await r.json();
  const member = data.members && data.members[0];
  if (!member) {
    return new Response(
      JSON.stringify({ pick: null, found: false }),
      { status: 404, headers: jsonHeaders() });
  }
  let pick = null;
  for (const lab of (member.labels || [])) {
    const p = pickFromLabel(lab);
    if (p) { pick = p; break; }
  }
  return new Response(
    JSON.stringify({ pick: pick }),
    { status: 200, headers: jsonHeaders() });
}

async function pickPostHandler(request, env) {
  if (!env.GHOST_ADMIN_KEY) {
    return new Response('server misconfigured: no admin key',
      { status: 500, headers: corsHeaders() });
  }
  const rl = await rateLimit(env, 'pick-post', clientIp(request));
  if (!rl.ok) {
    return new Response('rate limited',
      { status: 429, headers: { ...corsHeaders(),
        'Retry-After': String(rl.retryAfter || 60) } });
  }
  let body;
  try { body = await request.json(); }
  catch (e) {
    return new Response('invalid json',
      { status: 400, headers: corsHeaders() });
  }
  const uuid = body && body.uuid;
  const pick = body && body.pick;
  if (!uuid || typeof uuid !== 'string' || !UUID_RE.test(uuid)) {
    return new Response('bad uuid',
      { status: 400, headers: corsHeaders() });
  }
  if (!pick || typeof pick !== 'string' ||
      PICKABLE.indexOf(pick) === -1) {
    return new Response('bad pick',
      { status: 400, headers: corsHeaders() });
  }

  const token = await ghostJwt(env.GHOST_ADMIN_KEY);
  const findUrl = GHOST_ADMIN_HOST +
    '/ghost/api/admin/members/?' +
    'filter=' + encodeURIComponent('uuid:' + uuid) +
    '&include=labels&limit=1';
  const findRes = await fetch(findUrl,
    { headers: { Authorization: 'Ghost ' + token } });
  if (!findRes.ok) {
    return new Response('ghost lookup failed: ' + findRes.status,
      { status: 502, headers: corsHeaders() });
  }
  const findData = await findRes.json();
  const member = findData.members && findData.members[0];
  if (!member) {
    return new Response('member not found',
      { status: 404, headers: corsHeaders() });
  }

  // One pick per member.
  for (const lab of (member.labels || [])) {
    const existingPick = pickFromLabel(lab);
    if (existingPick) {
      return new Response(
        JSON.stringify({ pick: existingPick, alreadyPicked: true }),
        { status: 409, headers: jsonHeaders() });
    }
  }

  // Preserve existing non-pick labels (name required or Ghost drops).
  const existing = (member.labels || [])
    .filter(function (l) { return l && l.name && !pickFromLabel(l); })
    .map(function (l) {
      return { id: l.id, name: l.name, slug: l.slug };
    });
  const nextLabels = existing.concat([{
    name: 'pick:' + pick,
    slug: 'pick-' + pick
  }]);

  const updateUrl = GHOST_ADMIN_HOST +
    '/ghost/api/admin/members/' + member.id + '/';
  const updateRes = await fetch(updateUrl, {
    method: 'PUT',
    headers: {
      Authorization: 'Ghost ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      members: [{
        id: member.id,
        labels: nextLabels,
        updated_at: member.updated_at
      }]
    })
  });
  if (!updateRes.ok) {
    const txt = await updateRes.text();
    return new Response('ghost update failed: ' + updateRes.status +
      ' ' + txt, { status: 502, headers: corsHeaders() });
  }

  // Confirm the label landed. Ghost silently drops labels without a
  // name field, and matches names case-insensitively.
  let saved = null;
  try {
    const upd = await updateRes.json();
    saved = upd.members && upd.members[0];
  } catch (e) { saved = null; }
  let savedPick = null;
  for (const lab of ((saved && saved.labels) || [])) {
    const p = pickFromLabel(lab);
    if (p) { savedPick = p; break; }
  }
  if (savedPick !== pick) {
    return new Response(
      'ghost accepted the write but the pick label is missing: ' +
        JSON.stringify((saved && saved.labels) || []),
      { status: 502, headers: corsHeaders() });
  }

  return new Response(
    JSON.stringify({ pick: pick }),
    { status: 200, headers: jsonHeaders() });
}

async function serveAtlasMap(request) {
  return servePinnedPage('atlas-map.html', ATLAS_MAP_SHA);
}

async function serveTv(request) {
  return servePinnedPage('tv.html', TV_SHA);
}

// Serve one HTML file from the repo at a pinned commit, so the page only
// changes when the pin changes.
async function servePinnedPage(path, sha) {
  const upstream = `https://raw.githubusercontent.com/${ATLAS_MAP_REPO}/${sha}/${path}`;
  const upstreamRes = await fetch(upstream, {
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!upstreamRes.ok) {
    return new Response(path + ' upstream error', { status: 502 });
  }
  const body = await upstreamRes.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
      // Allow embedding on movingmusic.works
      'X-Frame-Options': 'ALLOWALL',
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);

    // Public route: serve the atlas map HTML via Cloudflare so airport /
    // hotel Wi-Fi that blocks raw.githack.com still works.
    if (url.pathname === '/atlas-map.html' && request.method === 'GET') {
      return serveAtlasMap(request);
    }

    // Public route: movingmusicTV, embedded on the Ghost page /tv/.
    if (url.pathname === '/tv.html' && request.method === 'GET') {
      return serveTv(request);
    }

    // movingmusicTV live data (public) and the Send button inbox (keyed).
    if (url.pathname === '/tv-finds.json' && request.method === 'GET') {
      return tvFindsGet(request, env, ctx);
    }
    if (url.pathname === '/tv-inbox' && request.method === 'POST') {
      const rl = await rateLimit(env, 'tv-inbox', clientIp(request));
      if (!rl.ok) return new Response('rate limited', { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });
      return tvInboxPost(request, env);
    }

    // Viewer suggestions for the Atlas (worker/suggest.js). Public: the config,
    // the form post, and a bare count. Keyed: the review list and its actions.
    if (url.pathname === '/suggest-config' && request.method === 'GET') {
      return suggestConfigGet(env);
    }
    if (url.pathname === '/suggest' && request.method === 'POST') {
      const ip = clientIp(request);
      const rl = await rateLimit(env, 'suggest', ip);
      if (!rl.ok) return new Response(JSON.stringify({ ok: false, message: 'Too many sends. Try again in a minute.' }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfter) } });
      return suggestPost(request, env, ip);
    }
    if (url.pathname === '/suggest-count' && request.method === 'GET') {
      return suggestCountGet(env);
    }
    if (url.pathname === '/review.html' && request.method === 'GET') {
      return reviewPage();
    }
    const sm = url.pathname.match(/^\/suggestions(?:\/([^/]+)\/(add|drop))?$/);
    if (sm && (sm[1] ? request.method === 'POST' : request.method === 'GET')) {
      const rl = await rateLimit(env, 'tv-inbox', 'review:' + clientIp(request));
      if (!rl.ok) return new Response('rate limited', { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });
      return sm[1] ? suggestionAct(request, env, sm[1], sm[2]) : suggestionsGet(request, env);
    }

    // Route picker: writes "route-<slug>" label on a Ghost member.
    if (url.pathname === '/pick-route' && request.method === 'POST') {
      return pickRouteHandler(request, env);
    }

    // Songbook picker (Nov 2026): pick:<slug> label.
    if (url.pathname === '/pick' && request.method === 'GET') {
      return pickGetHandler(request, env);
    }
    if (url.pathname === '/pick' && request.method === 'POST') {
      return pickPostHandler(request, env);
    }

    // Member labels: GET /member/<uuid> returns {uuid, labels, status}.
    // The frontend /members/api/member/ endpoint doesn't expose labels,
    // so this proxies the Admin API.
    const mm = url.pathname.match(/^\/member\/([A-Za-z0-9_-]{8,64})$/);
    if (mm && request.method === 'GET') {
      return memberLabelsHandler(request, env, mm[1]);
    }

    const key = routeKey(url.pathname);
    if (!key) {
      return new Response('not found', { status: 404, headers: corsHeaders() });
    }

    if (request.method === 'GET') {
      const value = await env.MMP_KV.get(key);
      return new Response(value ?? 'null', { status: 200, headers: jsonHeaders() });
    }

    if (request.method === 'PUT') {
      const body = await request.text();
      if (body.length > 100 * 1024) {
        return new Response('payload too large', { status: 413, headers: corsHeaders() });
      }
      try { JSON.parse(body); }
      catch (e) {
        return new Response('invalid json', { status: 400, headers: corsHeaders() });
      }
      await env.MMP_KV.put(key, body);
      return new Response('ok', { status: 200, headers: corsHeaders() });
    }

    return new Response('method not allowed', { status: 405, headers: corsHeaders() });
  },
};
