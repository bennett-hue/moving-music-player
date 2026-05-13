// Moving Music Player sync — Cloudflare Worker + KV
//
// Stores a member's playlist by Ghost member UUID. Tiny key-value API:
//   GET  /playlist/:uuid → returns the stored JSON (or "null" if none)
//   PUT  /playlist/:uuid → stores the request body (JSON, ≤100KB)
//   OPTIONS → CORS preflight
//
// Security model (v1): the endpoint trusts the request — anyone with the
// UUID can read/write that playlist. The UUID is server-side except for
// the signed-in user, so this is acceptable for non-sensitive data.

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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const m = url.pathname.match(/^\/playlist\/([A-Za-z0-9_-]{8,64})$/);
    if (!m) {
      return new Response('not found', { status: 404, headers: corsHeaders() });
    }
    const key = `playlist:${m[1]}`;

    if (request.method === 'GET') {
      const value = await env.MMP_KV.get(key);
      return new Response(value ?? 'null', {
        status: 200,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
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
