// Moving Music Player sync — Cloudflare Worker + KV
//
// Routes:
//   GET  /playlist/:uuid       → stored playlist JSON (or "null")
//   PUT  /playlist/:uuid       → stores playlist JSON for this member
//   GET  /shared/:shareId      → stored shared setlist JSON (public)
//   PUT  /shared/:shareId      → stores a setlist under a shareable id
//   OPTIONS                    → CORS preflight
//
// Security model (v1): UUID-in-URL trust. Anyone with the UUID can
// read/write that playlist; the UUID is server-side except for the
// signed-in user, so this is acceptable for non-sensitive data.
//
// Shared setlists use a separate KV namespace prefix (`shared:`) and a
// short random shareId as the secret. Anyone with the shareId can read
// or overwrite the entry. Acceptable for the "share my gig setlist with
// a co-performer" use case; harden later if abuse appears.

const ALLOWED_ORIGIN = 'https://movingmusic.works';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
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
