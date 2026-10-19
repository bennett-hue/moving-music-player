# Moving Music Player

Fixed-bottom playlist audio player for [movingmusic.works](https://movingmusic.works).

## What it does

- Adds a small play button to every song card on feed/tag/index pages.
- Tapping play loads the song's audio (via Ghost Content API) and starts a queue from the visible cards in document order.
- Fixed bottom bar shows the current title, play/pause, prev/next, scrub progress, and time.
- Tap the **▲** chevron to expand the queue and see what's coming. Tap any item to jump to it.
- Auto-advances to the next track on `ended`, skipping locked (members-only) tracks.
- Tapping a locked track triggers the Ghost portal signup flow.
- Restores the last-played track + position across page navigations (24-hour TTL).

## Install (Ghost code injection)

Once the file is published on GitHub (this repo, `main` branch), it's reachable via jsDelivr:

```html
<script src="https://cdn.jsdelivr.net/gh/bennett-hue/moving-music-player@main/player.js" defer></script>
```

Paste that into **Ghost Admin → Settings → Code injection → Site Footer** (not Header — needs `defer` and the DOM).

To pin a specific version, replace `@main` with `@v0.1.0` (after tagging a release).

## Develop

```bash
cd ~/moving-music-player
# edit player.js
git add player.js
git commit -m "tweak"
git push
# jsDelivr picks up `@main` changes within ~10 min, or purge:
# curl https://purge.jsdelivr.net/gh/bennett-hue/moving-music-player@main/player.js
```

## Worksong Atlas

The Atlas is three Ghost pages fed by one data file.

- `atlas-map.html` holds the data (`var D = [...]`, one object per tradition) and the Leaflet map. It is the single source of truth. Field guide at the top of `scripts/build_atlas_pages.py`.
- The Cloudflare worker serves the map at `https://mmp-sync.bennett-727.workers.dev/atlas-map.html` from the commit pinned in `worker/worker.js` (`ATLAS_MAP_SHA`). The Ghost page `/atlas/` embeds that URL in an iframe.
- `scripts/build_atlas_pages.py` reads the data and writes `ghost/atlas-regions.card.html` (List By Place), `ghost/atlas-uses.card.html` (List By Activity), and `ghost/atlas.card.html` (the map page). Each file is the body of the HTML card on the matching Ghost page.

To publish a data change:

```bash
# 1. edit the D array in atlas-map.html, then
python3 scripts/build_atlas_pages.py          # validates the data, rebuilds ghost/*.card.html
git add atlas-map.html ghost scripts && git commit -m "Atlas: ..." && git push
# 2. pin the worker to the new commit
sed -i '' "s/ATLAS_MAP_SHA = '.*'/ATLAS_MAP_SHA = '$(git rev-parse --short HEAD)'/" worker/worker.js
git commit -am "Worker: bump ATLAS_MAP_SHA" && git push
cd worker && wrangler deploy
# 3. paste ghost/atlas-regions.card.html and ghost/atlas-uses.card.html into their Ghost pages
```

Step 3 is only needed when the data or the list-page code changed. Step 2 is only needed when atlas-map.html changed. The map page in Ghost never needs touching once it points at the worker URL.

## Roadmap

- v0.1 (this) — basic queue, play/pause/skip, expanded queue, auto-advance, signup on lock
- v0.2 — search/filter-aware queue rebuild on DOM mutation
- v0.3 — drag-to-reorder, queue persistence across pages
- v0.4 — move CSS into theme, migrate from code injection

## License

MIT — Bennett Konesni
