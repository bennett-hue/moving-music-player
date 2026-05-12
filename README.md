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

## Roadmap

- v0.1 (this) — basic queue, play/pause/skip, expanded queue, auto-advance, signup on lock
- v0.2 — search/filter-aware queue rebuild on DOM mutation
- v0.3 — drag-to-reorder, queue persistence across pages
- v0.4 — move CSS into theme, migrate from code injection

## License

MIT — Bennett Konesni
