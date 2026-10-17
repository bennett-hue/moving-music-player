// Moving Music Player sync — Cloudflare Worker + KV
//
// Routes:
//   GET  /playlist/:uuid       → stored playlist JSON (or "null")
//   PUT  /playlist/:uuid       → stores playlist JSON for this member
//   GET  /shared/:shareId      → stored shared setlist JSON (public)
//   PUT  /shared/:shareId      → stores a setlist under a shareable id
//   POST /pick-route           → write "route-<slug>" label on a Ghost
//                                member via the Ghost Admin API. Body:
//                                { uuid, route }. Preserves existing
//                                non-route labels, replaces any prior
//                                route-* label.
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

const ALLOWED_ORIGIN = 'https://movingmusic.works';

// Allowed route slugs. Must match Ghost tag slugs on movingmusic.works.
// Keep in sync with picker.js ROUTES.
const ALLOWED_ROUTES = [
  'rowing', 'sea-shanties', 'walking', 'farm', 'woods',
  'maine', 'shaker', 'love', 'gathering'
];

const GHOST_ADMIN_HOST = 'https://moving-music.ghost.io';

// Repo the atlas map is served from. Bumped by editing this constant.
const ATLAS_MAP_REPO = 'bennett-hue/moving-music-player';
const ATLAS_MAP_SHA = '27252a8';

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

  // Preserve existing non-route labels; replace any route-* with the
  // new one. Keep legacy-free if present (should never happen since
  // legacy-free members skip the picker, but defensive).
  const existing = (member.labels || [])
    .map(function (l) { return l.slug; })
    .filter(function (slug) {
      return slug && slug.indexOf('route-') !== 0;
    });
  const nextSlugs = existing.concat(['route-' + route]);
  const nextLabels = nextSlugs.map(function (slug) {
    return { slug: slug };
  });

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

  return new Response(
    JSON.stringify({ ok: true, route: route }),
    { status: 200, headers: jsonHeaders() }
  );
}

async function serveAtlasMap(request) {
  const upstream = `https://raw.githubusercontent.com/${ATLAS_MAP_REPO}/${ATLAS_MAP_SHA}/atlas-map.html`;
  const upstreamRes = await fetch(upstream, {
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!upstreamRes.ok) {
    return new Response('atlas map upstream error', { status: 502 });
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
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);

    // Public route: serve the atlas map HTML via Cloudflare so airport /
    // hotel Wi-Fi that blocks raw.githack.com still works.
    if (url.pathname === '/atlas-map.html' && request.method === 'GET') {
      return serveAtlasMap(request);
    }

    // Route picker: writes "route-<slug>" label on a Ghost member.
    if (url.pathname === '/pick-route' && request.method === 'POST') {
      return pickRouteHandler(request, env);
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
