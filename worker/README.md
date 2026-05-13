# Moving Music Player sync backend

A tiny Cloudflare Worker + KV store that lets a signed-in member's
playlist follow them across devices. Cost is $0 within Cloudflare's free
tier (100k reads / 1k writes per day).

## One-time deploy (≈10 minutes)

1. **Install Wrangler** (Cloudflare's CLI) and log in:

    ```bash
    npm install -g wrangler
    wrangler login
    ```

    `wrangler login` opens a browser tab to authorize. If you don't have
    a Cloudflare account yet, the auth flow prompts you to create one
    (free, no credit card required).

2. **Create the KV namespace**:

    ```bash
    cd ~/moving-music-player/worker
    wrangler kv namespace create MMP_KV
    ```

    It prints something like:

    ```
    🌀 Creating namespace with title "mmp-sync-MMP_KV"
    ✨ Success!
    Add the following to your configuration file in your kv_namespaces array:
    { binding = "MMP_KV", id = "abc123def456..." }
    ```

    Open `wrangler.toml` and replace `PASTE_KV_NAMESPACE_ID_HERE` with
    the printed `id` value.

3. **Deploy**:

    ```bash
    wrangler deploy
    ```

    Wrangler prints your Worker URL, e.g.
    `https://mmp-sync.<your-subdomain>.workers.dev`.

4. **Paste that URL back to Claude.** Claude will then wire `player.js`
   to call it, push the updated injection to the Google Doc, and you
   paste into Ghost as usual.

## What's in here

- `worker.js` — the Worker itself. ~50 lines. Three endpoints:
    - `GET /playlist/:uuid` → returns the stored JSON, or `"null"`.
    - `PUT /playlist/:uuid` → stores up to 100KB of JSON.
    - `OPTIONS` → CORS preflight, allows `https://movingmusic.works`.
- `wrangler.toml` — deploy config + KV binding.

## How sync works

- On page load, `player.js` calls Ghost's `/members/api/member` to find
  out who's signed in. If a UUID comes back, it fetches the saved
  playlist from this Worker and uses that instead of localStorage.
- Any time the playlist changes (you tap `+` or `✕`), `player.js`
  debounces a PUT to this Worker (~2 s after the last change).
- If you're signed out, the player keeps using localStorage only.

## Security note (v1)

This Worker trusts the UUID in the URL — anyone who has your member
UUID can read or write your playlist. The UUID is server-side except to
the signed-in browser, so this is fine for non-sensitive playlist data.
If we ever want to harden it, we'd validate the request against Ghost
server-side by forwarding the user's session cookie.
