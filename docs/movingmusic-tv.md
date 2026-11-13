# movingmusicTV

> Nov 13, 2026: movingmusicTV is now part of the Worksong Atlas. The feed is called the Scroll. One Ghost page, `/atlas/`, holds both views: it opens in the Scroll, and the Map button loads the full map (`atlas-map.html?embed=scroll`) in place of the videos. A popup's "Watch in the Scroll" link plays that tradition. `/tv/` forwards to `/atlas/` with the same link. `/atlas/#tradition=slug` opens that tradition's first video, or the map when it has none. `/atlas/#tradition=slug&view=map` opens the map. File names, the worker routes, the Send shortcut, and the inbox keep their old "tv" names. `ghost/atlas.card.html` is now written by `scripts/build_tv.py`, and `ghost/tv.card.html` is the forwarder. Where this document says "the TV", read "the Scroll".


movingmusicTV is a scrolling feed of worksong videos at movingmusic.works/tv/. It plays every Atlas video that can play in place, plus the videos Bennett sends from Instagram, Facebook, TikTok, and YouTube with the Send button.

At launch it holds 220 videos from 114 places: 210 YouTube, 8 Instagram, 1 Facebook, and 1 video file.

## How it ties to the Atlas

- Channels are the Atlas uses, numbered 1 to 10: hauling, rowing, pounding, carrying, walking, solo pacing, signaling, animal calls, work parties, devotional. Two more channels sit in front: All, and Bennett's picks.
- Newest order, the default, puts the latest finds first and then follows the journey. Journey order starts in Belfast, Maine and goes to the nearest place each time.
- The map follows along. It is drawn from the Atlas base map in the same projection, so a dot on the TV sits where the pin sits on the Atlas.
- Every card from an Atlas tradition links to its pin: `/atlas/#tradition=slug`.
- Every Atlas popup with a playable video links back: "Watch on movingmusicTV" opens `/tv/#tradition=slug`.
- Finds reach the Atlas too, live. A find filed under a tradition is listed in that tradition's popup under "Bennett's picks". A find with a place but no tradition gets its own dot with a brick ring. A find with no place yet shows on the TV only.
- Inside the Ghost page, YouTube cards have "Play in bar": the video moves to the site's player bar and keeps playing while the visitor browses.

## Links

- `/tv/` opens with the newest finds.
- `/tv/#v=yt-QZQNe4GJz1c` opens one video. "Copy link" on each card makes these.
- `/tv/#tradition=menhaden-chanteys` opens the first video of a tradition.
- `/tv/#channel=rowing` opens a channel. Use these for QR codes: a rowing handout can point at the rowing channel.

## Files

- `atlas-map.html`: the Atlas data, still the source of truth for traditions. It also fetches the live finds.
- `tv/finds.json`: filed finds, the hide list, and saved posts that were skipped, with the reason. The live feed reads this file from `main`.
- `tv/youtube-meta.json`: YouTube channel names and frame shapes, for credit lines.
- `tv/template.html`: the TV page: markup, style, and script.
- `scripts/build_tv.py`: builds `tv.html` and `ghost/tv.card.html`.
- `scripts/tv_intake.py`: lists inbox videos and files them into `tv/finds.json`.
- `worker/tv.js`: the worker routes `/tv-finds.json` (live finds) and `/tv-inbox` (the Send button).
- `worker/suggest.js`: viewer suggestions from the Atlas, and Bennett's review page.
- `tv.html`: the built page. Do not edit it by hand.
- `ghost/tv.card.html`: the body of the HTML card on the Ghost page `/tv/`.

## Send a video

The Send button is an iPhone shortcut in the share menu of every app. Claude can build it as a signed file you open on the Mac: it asks for the inbox key once and syncs to the phone through iCloud. To build it by hand:

1. Open the Shortcuts app and tap +. Name the shortcut Send to movingmusicTV.
2. Tap the info button at the bottom and turn on Show in Share Sheet. In the first block, keep only URLs and Text as input.
3. Add the action Ask for Input. Set the prompt to: Your line (optional)
4. Add the action Get Name, set to the Shortcut Input variable. It gives the post's title as the share menu shows it.
5. Add the action Get Contents of URL with this URL: `https://mmp-sync.bennett-727.workers.dev/tv-inbox?format=text`. Open its options: Method POST, Request Body JSON. Add four text fields: `key` set to the inbox key, `url` set to the Shortcut Input variable, `note` set to the Provided Input variable, and `title` set to the Name variable.
6. Add the action Show Notification, set to Contents of URL.

To send a video, tap Share in Instagram, Facebook, TikTok, or YouTube, then More or Share to, then Send to movingmusicTV. Type or dictate one sentence of commentary: what to watch or listen for. Name the place when you know it. The post's title helps the daily filing, but your line may still be its best clue to where a video is from. For example: "Cape Coast, Ghana. Watch the caller time each line to the pull." To send a video with no line, tap Done with the box empty. The notification names the video, such as "On movingmusicTV: “Pulling the seine at dawn”, with your line." With no title, it names the platform and says what the phone sent: "On movingmusicTV: Instagram video. Your phone sent no title."

Your line shows under the video, marked Bennett, on the TV and in the video's Atlas popup. It goes live within a minute, with no review step.

- To change a line, send the same video again with the new line. The notification says "Line updated."
- To add a line to a video that is already on the TV, send it again with the line.
- Lines over 280 characters are cut at a word, and the notification says so.

The key lives in the shortcut and in the worker secret `TV_INBOX_KEY`, never in this repo. If it leaks, set a new one in both places.

## How a sent video moves

1. The worker checks the key, finds the video id in the link, strips share-tracking parameters, and follows short links (vm.tiktok.com, fb.watch, facebook.com/share) to the real video. Facebook links come out as plain www.facebook.com links.
2. It finds the post's title. YouTube and TikTok titles and channels come from their public oEmbed. Facebook and Instagram offer titles only to approved apps, and no longer return them even then, so their titles come from the phone: the name the share menu shows, minus view counts, the site name, and trailing hashtags. "Reel by Name" on Facebook becomes the credit, and so does an Instagram handle in the title. A title in another language is put into English by Workers AI (the worker's `AI` binding); the original stays with the inbox copy as `title_orig` for the daily filing. Without the binding, or if the translation fails, the title stays as it came.
3. It stores the video in KV as `tvin:<id>`, with the link, the title and credit, your line, the time of the line, and the date. The same video sent twice is stored once. A new line replaces the old one. A video stored without a title gets one when it is sent again.
4. Within a minute it is on the TV, first in Newest, under Bennett's picks, with your line under it. Its title is the post's title, or the platform, such as "Instagram video", when there is none. It has no place yet, so it has no map dot and no Atlas presence.
5. Every day a scheduled task files the day's videos: place, coordinates, Atlas tradition, uses, what the video shows, credit. It runs `python3 scripts/tv_intake.py pull` to list what's waiting, then `python3 scripts/tv_intake.py add --url ... --label ... --place ... --la ... --lo ...` for each. Guesses go in `--check`.
6. It runs `python3 scripts/tv_intake.py lines`, which copies your lines into `tv/finds.json` word for word, including new lines on videos filed earlier. Claude never writes or rewrites your line. If you ask Claude to change one, `add --note` stamps the change, so an older send can't overwrite it.
7. It runs `python3 scripts/build_tv.py --check`, commits `tv/finds.json` to `main`, and pushes. Within about five minutes the filed copy replaces the inbox copy on the TV, and the Atlas picks it up.

Instagram and Facebook block captions from servers, so Claude files those from your line, or from the post itself when your Mac is on with the Claude app open.

## The @work_songs backlog

Before the Send button, Bennett forwarded videos by direct message to The Worksong Project (@work_songs) on Instagram and to its Facebook page. Claude can pull them from his Instagram thread through the built-in browser while his Mac is on with the Claude app open. For Facebook, the built-in browser has to be signed in first.

The first pass, on Nov 12, 2026, read the Instagram "Worksongs" saved collection instead: 13 posts, 8 playable reels. Four were photos and one is gone.

## Viewer suggestions on the Atlas

Visitors can help fill the Atlas. Nothing they send goes public until you add it.

- A grey dot, a tradition still seeking a video, has "Know a video of this? Send it" in its popup.
- Every popup, and every find with its own dot, has "Suggest an improvement".
- Each ask opens a short form: the link or the fix, an optional name, an optional email for a reply, and Cloudflare Turnstile, a free bot check. A hidden field catches simple bots, and each address can send five a minute.
- The worker stores each suggestion privately in KV as `sugg:<id>`, for up to a year. It keeps no IP address and no bot token.

To review, open `https://mmp-sync.bennett-727.workers.dev/review.html` on your phone. The first time, enter the inbox key from your Send button shortcut; the page remembers it.

- A video has Add to the TV and Drop. Add puts it in the Send button inbox, tied to its tradition and credited with the sender's first name: "suggested by Ana" in the Atlas popup. The daily filing gives it a place and a label. To add your line, send it with the Send button.
- A link that is not YouTube, Instagram, Facebook, or TikTok can't be added in one tap. Add it by hand with Claude, or drop it.
- An improvement has Copy and Done. Copy it to Claude, then mark it done.
- Add, Drop, and Done delete the suggestion, email included.

The daily filing tells you how many suggestions wait, with the link. It sees only the count: `python3 scripts/tv_intake.py suggestions`.

The asks stay hidden until Takt sets the two Turnstile secrets.

Not yet: written write-ups of traditions, asks on the TV, and video asks on colored dots. Add them once you see what arrives.

## Publish

Takt runs these in `~/moving-music-player`.

1. Merge `claude/movingmusic-tv-2026-11-12` into `main` and push. It is based on `claude/build-queue-2026-11-11`. The live finds read `tv/finds.json` from `main`, so this step turns them on.
2. Set the inbox key: `cd worker && wrangler secret put TV_INBOX_KEY`, then paste the key.
3. Turn on viewer suggestions. In the Cloudflare dashboard, open Turnstile and add a widget: name Atlas suggestions, mode Managed, hostnames `mmp-sync.bennett-727.workers.dev` and `movingmusic.works`. Then run `wrangler secret put TURNSTILE_SITEKEY` and paste the site key, and `wrangler secret put TURNSTILE_SECRET` and paste the secret key. Until both are set, the asks stay hidden.
4. Deploy: `wrangler deploy`. The new `TV_INBOX_LIMIT` and `SUGGEST_LIMIT` bindings need wrangler 4.36 or later. `TV_SHA` and `ATLAS_MAP_SHA` are already pinned to the TV commit. The live Atlas was byte-identical to this branch's Atlas before the TV changes, so the Atlas pin adds only the TV links, the live finds with Bennett's lines, the viewer asks, and one fix: opening a popup no longer throws "Maximum call stack size exceeded". The popups' keepInView setting fought the map's edge limits, so it is gone.
5. In Ghost Admin, add a page titled movingmusicTV with the slug `tv`. Give it one HTML card holding the contents of `ghost/tv.card.html`. Publish.
6. To list it in the site menu, add movingmusicTV, `/tv/`, in Ghost Admin, Settings, Navigation.
7. Check the live site:
   - `curl -s https://mmp-sync.bennett-727.workers.dev/tv-finds.json | head -c 300` returns JSON with the 8 finds.
   - Send one video with the shortcut. Within a minute it is first on `/tv/`.
   - `/tv/#tradition=menhaden-chanteys` opens on the Menhaden chanteys, and a YouTube card plays.
   - On `/atlas/`, a popup shows "Watch on movingmusicTV", and the Fosen boat launch has a ringed dot in Norway.
   - "Play in bar" on a YouTube card starts the video in the player bar.
   - On a phone, cards snap one at a time and the map strip follows.
   - On `/atlas/`, the Quern songs popup shows "Know a video of this? Send it". Send a test suggestion, open `/review.html` on the worker, enter the inbox key, and drop it.

Before the pin, preview any pushed commit at `https://raw.githack.com/bennett-hue/moving-music-player/<commit>/tv.html`.

After a later rebuild of `tv.html` or a change to `atlas-map.html`, bump the matching pin and deploy. Finds need no deploy.

## Rights

- The TV embeds. It never copies a video. Each video plays from the post it came from, so the owner keeps control: if they delete the post or make it private, it stops playing on the TV too.
- Every card credits the account that posted the video and links to the original.
- To take a video down: `python3 scripts/tv_intake.py hide --id <id> --why "<reason>"`, then commit to `main`. It drops off the TV and the Atlas within about five minutes, Atlas videos included. No deploy.
- Some owners block embedding. Facebook says so inside the player: "This video can't be embedded". Hide those. The Menhaden net-hauling demonstration is the first one.
- Ask the person who posted a video before you feature it in an email or a social post. A message you can adapt:

  > Hi [name]. I'm Bennett Konesni. I collect worksongs, the songs people sing while they work, at movingmusic.works. I'd like to include your video of [what it shows] on movingmusicTV, credited to you and linked to your post. It plays from your post, so if you ever take it down, it comes off my site too. Is that all right with you?

- For a clip you want to feature often, ask for the file and for permission to host it. A hosted file plays like the Atlantic Challenge coxswain video: no platform frame, it moves to the next video when it ends, and it survives a deleted post.

Legal context, not legal advice (Claude is not a lawyer): embedding is common practice, and the Ninth Circuit held in Hunley v. Instagram (2023) that embedding does not make the embedding site a direct infringer. District courts in New York have ruled the other way, and the First Circuit, which covers Maine, has not ruled.

## Limits

- Instagram and Facebook players show their own frame and do not report when a video ends, so autoplay stops on those cards. YouTube, TikTok, and video files move on by themselves.
- Some viewers see a login prompt inside Instagram's player.
- A sent video shows at the end of the journey until it is filed with a place, because it has none. Newest order shows it first.
- Your line publishes as sent. There is no review step, only a re-send to replace it.
- `python3 scripts/build_tv.py --refresh-youtube` re-checks every YouTube video (200 plays, 401 embedding off, 404 gone). Instagram and Facebook links need a browser check.
- The TV has no analytics yet.

## Production checklist

Checked against the 111-concept list, for the items that apply:

- Authentication: the inbox takes a key, compared in constant time. No key set, no inbox (503).
- Rate limiting: 30 sends a minute per address through Cloudflare's rate limiting binding.
- Idempotency: one KV key per video id, so a repeat send adds nothing. A repeat send with a new line replaces the line and keeps the link and date. If two sends of the same video with different lines land at once, the later write wins.
- Validation: only YouTube, Instagram, Facebook, TikTok, and video-file links get in. Lines are cut to 280 characters at a word, and shorter if a very long link leaves less room in the 1,024-byte KV metadata. Em dashes and double hyphens become commas. The TV and the Atlas escape every text field before it reaches the page.
- Data integrity: a line carries the time it was set (`noted`). The newer of the sent line and the filed line shows, so a later send beats the filing and a later edit beats an older send. `lines` copies the text as stored, with no retyping.
- Caching and CDN: `/tv-finds.json` caches for 60 seconds at the edge and in the browser; a send clears that data center's copy. `tv.html` and `atlas-map.html` cache for an hour at the edge.
- Rollbacks: page code changes only when a pin changes. Finds roll back with `git revert` on `main`.
- Retries and failure: if `/tv-finds.json` fails, the TV shows the finds built into the page and the Atlas shows its own data. Nothing breaks.
- Secrets: the inbox key and the Turnstile secret are worker secrets. Nothing secret is in the repo. The Turnstile site key is public by design and is a secret only so it needs no code change.
- Abuse: viewer suggestions pass Turnstile (checked against the hostname and the `suggest` action), a hidden honeypot field, a 5-a-minute limit per address, and length caps. Bodies over 8,000 characters are refused.
- Authorization: the review list and its actions need the inbox key in an `Authorization: Bearer` header, compared in constant time. No cookies, so no cross-site request forgery.
- Privacy: suggestions keep no IP address. Email is optional, shown only on the review page, and deleted with the suggestion. A video added from a suggestion carries only the sender's first name.
- Data retention: inbox entries expire after a year. Claude files them long before.
- Privacy: YouTube plays from youtube-nocookie.com. Instagram, Facebook, and TikTok load only on play.
- Monitoring and alerts: none yet. A scheduled filing run that reports what it filed covers the inbox.

## Open decisions

- Whether movingmusicTV goes in the site menu.
- Which songbook each channel points to, for a "songs for this work" link on every card.
