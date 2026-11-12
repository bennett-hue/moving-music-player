# movingmusicTV

movingmusicTV is a scrolling feed of worksong videos at movingmusic.works/tv/. It plays every Atlas video that can play in place, plus videos Bennett saves on Instagram, Facebook, TikTok, and YouTube.

At launch it holds 220 videos from 114 places: 210 YouTube, 8 Instagram, 1 Facebook, and 1 video file.

## How it ties to the Atlas

- Channels are the Atlas uses, numbered 1 to 10: hauling, rowing, pounding, carrying, walking, solo pacing, signaling, animal calls, work parties, devotional. Two more channels sit in front: All, and Bennett's finds.
- Journey order starts in Belfast, Maine and goes to the nearest place each time. The map follows along. It is drawn from the Atlas base map, in the same projection, so a dot on the TV sits where the pin sits on the Atlas.
- Every card from an Atlas tradition links to its pin: `/atlas/#tradition=slug`.
- Every Atlas popup with a playable video links back: "Watch on movingmusicTV" opens `/tv/#tradition=slug`.
- A find that matches a tradition joins that tradition. A find with no tradition is a candidate for a new Atlas pin.
- Inside the Ghost page, YouTube cards have "Play in bar": the video moves to the site's player bar and keeps playing while the visitor browses. It uses the same message the Atlas popups send.

## Links

- `/tv/` opens at the start of the journey.
- `/tv/#v=yt-QZQNe4GJz1c` opens one video. "Copy link" on each card makes these.
- `/tv/#tradition=menhaden-chanteys` opens the first video of a tradition.
- `/tv/#channel=rowing` opens a channel. Use these for QR codes: a rowing handout can point at the rowing channel.

## Files

- `atlas-map.html`: the Atlas data. Still the source of truth for traditions and their videos.
- `tv/finds.json`: Bennett's finds, the hide list, and the saved posts that were skipped, with the reason.
- `tv/youtube-meta.json`: YouTube channel names and frame shapes, used for credit lines.
- `tv/template.html`: the TV page: markup, style, and script.
- `scripts/build_tv.py`: builds `tv.html` and `ghost/tv.card.html` from the four files above.
- `tv.html`: the built page. Do not edit it by hand.
- `ghost/tv.card.html`: the body of the HTML card on the Ghost page `/tv/`.

## Add finds

1. Save videos where you save them now: the Instagram collection "Worksongs". For Facebook, make a saved collection with the same name. For TikTok, use Favorites. For YouTube, use a playlist.
2. Claude reads the collection, skips photos and dead posts, and adds each new video to `tv/finds.json`. Anything Claude guessed from the caption (place, tradition, uses, what the video shows) goes in that find's `check` list.
3. Confirm or fix the `check` fields, then clear the list. Add a `note` in your own words if a video needs one; it shows on the card.
4. Run `python3 scripts/build_tv.py`, then publish.

The first pass on Nov 12, 2026 read the Instagram "Worksongs" collection: 13 posts, 8 playable reels. Four were photos and one is gone. The built-in browser is not signed in to Facebook, so Facebook saves were not read.

## Publish

Takt runs these in `~/moving-music-player`.

1. Merge the branch `claude/movingmusic-tv-2026-11-12`. It is based on `claude/build-queue-2026-11-11`, which carries the Nov 12 worker and site footer.
2. Run `python3 scripts/build_tv.py`. It validates the data and rebuilds `tv.html`.
3. Pin the worker. Set `TV_SHA` in `worker/worker.js` to the commit that holds the `tv.html` to serve. Set `ATLAS_MAP_SHA` to the commit that holds the Atlas popup link (the same commit works). Commit, push, then `cd worker && wrangler deploy`.
4. In Ghost Admin, add a page titled movingmusicTV with the slug `tv`. Give it one HTML card holding the contents of `ghost/tv.card.html`. Publish.
5. To list it in the site menu, add movingmusicTV, `/tv/`, in Ghost Admin, Settings, Navigation.
6. Check the live site:
   - `/tv/` loads, and a YouTube card plays.
   - `/tv/#channel=finds` shows 8 Instagram reels, and one plays.
   - `/tv/#tradition=menhaden-chanteys` opens on the Menhaden chanteys.
   - On `/atlas/`, a popup shows "Watch on movingmusicTV", and the link opens the TV at that tradition.
   - "Play in bar" on a YouTube card starts the video in the player bar.
   - On a phone, cards snap one at a time and the map strip follows.

Before the pin, preview any pushed commit at `https://raw.githack.com/bennett-hue/moving-music-player/<commit>/tv.html`.

## Rights

- The TV embeds. It never copies a video. Each video plays from the post it came from, so the owner keeps control: if they delete the post or make it private, it stops playing on the TV too.
- Every card credits the account that posted the video and links to the original.
- To take a video down, add its id to `hide` in `tv/finds.json`, rebuild, pin, and deploy. The hide list works for Atlas videos too.
- Some owners block embedding. Facebook says so inside the player: "This video can't be embedded". Put those ids in `hide`. The Menhaden net-hauling demonstration is the first one.
- Ask the person who posted a video before you feature it in an email or a social post. A message you can adapt:

  > Hi [name]. I'm Bennett Konesni. I collect worksongs, the songs people sing while they work, at movingmusic.works. I'd like to include your video of [what it shows] on movingmusicTV, credited to you and linked to your post. It plays from your post, so if you ever take it down, it comes off my site too. Is that all right with you?

- For a clip you want to feature often, ask for the file and for permission to host it. A hosted file plays like the Atlantic Challenge coxswain video: no platform frame, it moves to the next video when it ends, and it survives a deleted post. Add it as a find with the file's URL.

Legal context, not legal advice (Claude is not a lawyer): embedding is common practice, and the Ninth Circuit held in Hunley v. Instagram (2023) that embedding does not make the embedding site a direct infringer. District courts in New York have ruled the other way, and the First Circuit, which covers Maine, has not ruled.

## Limits

- Instagram and Facebook players show their own frame and do not report when a video ends, so autoplay stops on those cards. YouTube, TikTok, and video files move on by themselves.
- Some viewers see a login prompt inside Instagram's player.
- `python3 scripts/build_tv.py --refresh-youtube` re-checks every YouTube video (200 plays, 401 embedding off, 404 gone). Instagram and Facebook links need a browser check, which Claude can run.
- The TV has no analytics yet.
- Thumbnails come from YouTube's image server. Other platforms get a drawn postcard of the place instead of a copied still.

## Production checklist

Checked against the 111-concept list, for the items that apply to a static page:

- Caching and CDN: the worker serves `tv.html` through Cloudflare's cache, one hour at the edge and five minutes in the browser.
- Rollbacks: the live page changes only when `TV_SHA` changes. To roll back, set the old commit and deploy.
- XSS: every text field is escaped before it reaches the page, and the data block cannot close its own script tag.
- postMessage: the TV listens only to the TikTok player it created, and sends only play messages to the page around it.
- Secrets: none. The TV uses no API key and no Meta app token.
- Latency: one 127 KB page. Posters load as you scroll. No third-party player loads until someone presses play.
- Privacy: YouTube plays from youtube-nocookie.com. Instagram, Facebook, and TikTok load only on play.
- Monitoring and alerts: none yet. A monthly link check as a scheduled task would cover it.

## Open decisions

- Intake: keep saving to platform collections for Claude to read, or add a share-sheet shortcut that drops links into a sheet.
- Whether movingmusicTV goes in the site menu.
- Which songbook each channel points to, for a "songs for this work" link on every card.
