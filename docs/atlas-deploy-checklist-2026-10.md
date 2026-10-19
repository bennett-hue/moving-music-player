# Atlas deploy checklist for Takt (October 19, 2026)

Everything is committed and pushed on `main` (commits 3323bbe and 24554a7). Nothing is live yet. Three steps make it live.

## 1. Deploy the worker (map)

```bash
cd ~/moving-music-player && git pull
cd worker && wrangler deploy
curl -s https://mmp-sync.bennett-727.workers.dev/atlas-map.html | grep -c Wanderlieder   # expect 1
```

The worker's `ATLAS_MAP_SHA` is already `3323bbe`.

## 2. Point the Ghost map page at the worker

Ghost Admin, Pages, "Worksong Atlas: Map" (`/atlas/`). The HTML card still embeds `raw.githack.com/.../d64503a/atlas-map.html`, which is the August 28 build. Replace the whole card with the contents of `ghost/atlas.card.html`. After this, map updates only need steps 1 and the SHA bump; the Ghost page stays as is.

## 3. Paste the two list pages

- "Worksong Atlas: By Place" (`/atlas-regions/`): replace the HTML card with `ghost/atlas-regions.card.html`.
- "Worksong Atlas: By Activity" (`/atlas-uses/`): replace the HTML card with `ghost/atlas-uses.card.html`.

Both files are large (200 KB and 245 KB). Paste into the card's HTML editor, not the rich text editor. If the Ghost editor refuses the paste, push each through the Admin API with the page's `html` field and `source=html`, same as the song pipeline.

## 4. Check on the live site

- `/atlas/`: a brown dot in Berlin (Wanderlieder), the "walking" pill in the use row, and "video shows" as the first row label. Click Dinka ox songs: Nat Geo Live loads first and a description sits under the place name.
- `/atlas-regions/`: Jump to, Japan. The page should land on Japan, not the top. Open Dinka ox songs on a phone and scroll the popup.
- `/atlas-uses/`: a "Walking and marching" group with eight traditions.
- Play in bar from a popup still hands the video to the transport bar.

## Not done, for later

- Re-pin player.js only when the next player change ships; the "Jump to" fix (commit 4bb96c1, Oct 17) is already in the pinned 7ce7206 build.
- player.js: anchor scroll after an in-place page swap, the next-song skip, and the mid-playlist click (see docs/atlas-feedback-2026-10.md, last section).
