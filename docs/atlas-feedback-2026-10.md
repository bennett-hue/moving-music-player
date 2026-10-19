# Worksong Atlas: October 2026 update from the COA copy-edit

Source: the "Worksong Atlas feedback" Google Doc from the College of the Atlantic worksongs class (12 copy-editors, due September 28, 2026), plus Bennett's two general comments in it. Applied October 19, 2026.

Result: 140 traditions (was 136), 219 videos (was 237), 30 traditions still seeking a video (was 30: eight gained a video, seven lost their only usable one, one new entry starts empty). Every video on the Atlas now contains the song. Footage of the work with no singing, interviews, stock tracks, and commercial music videos are gone.

## What changed on the site

- Every tradition has a one-line description: what the work is and how the song is used. It shows in the map popup, in the list popups, and under each entry on the two list pages. Search on the list pages now matches descriptions too, so "treadle" finds the spinning songs.
- The three video categories keep their names (People at work, People sharing songs, People in Concert) and now carry a definition in the legend and in the map intro. The map's filter row label changed from "delivery" to "video shows". Bennett's note that the Delivery tags were confusing drove this; the students applied the three categories without trouble once they saw the definitions.
- New activity tag "Walking and marching" (slug `walking`). Mchakamchaka and the US military cadence calls were tagged "hauling" because nothing else fit. They are now walking. Also walking: Lifela (Lesotho), Aboriginal songlines, Sangyeo sori, Kahar palanquin songs, Cante alentejano (sung walking to the fields), and the new German hiking songs. The "carrying" tag, which existed on the map but had no entries, now holds the palanquin, bier, porter, and roustabout songs.
- Within each tradition, videos are ordered at work, then sharing, then concert, so the embedded first video is the most work-centered one. Delivery tags on the tradition (`d`) are derived from its videos, so the dot color on the map always matches the first video.
- Video labels that just said "Watch" now carry the actual title, trimmed.
- The video popup on the list pages scrolls on its own (max height, overflow) and moves itself to the body when it opens, so it cannot be clipped by the page layout. This is the fix for "video pop-ups don't scroll".
- "Jump to" at the top of the list pages: the links were fine; the page was being reloaded and scrolled to the top by player.js on every hash change. That was fixed in player.js on October 17 (commit 4bb96c1). The students reviewed before that fix. Confirm on the live site after the next player.js re-pin.

## Per-tradition decisions

Each line names the student whose row drove the change.

### 1. Ahousaht through Brazil (Rowan)
- Paddle songs (Ahousaht): added "Ahousaht paddle dance" (sharing).
- Sponger songs (Bahamas): the second link in Rowan's section is the 1935 Andros fishermen recording "Blow Liza Blow"; added it to Sponger songs (sharing). Rowan had noted it was a fishermen's song, not a sponger song, so the label says so.
- Shearing songs: relabeled concert to sharing.
- Cantos de trabalho (Brazil): relabeled sharing to at work (people working on camera while singing).
- Hautū, Sari gan, Aboio: kept as is; Rowan's notes are about quality, not errors.

### 2. Bulgaria through Colombia (Gemma)
- Bulgarian harvest songs: dropped the scenic Rhodope video; added the two studio recordings Gemma found (Mir Stanke le; Bulgaria: Harvest Song).
- Aka polyphonic hunting songs: relabeled at work to sharing (no hunting shown).
- Minga (Chiloé): dropped the house-moving footage (no singing); added the minga song Gemma found.
- Hakka shan'ge: kept the 43-minute Xingguo film; added the album playlist as an audio link.
- Haozi (China): the Sichuan porters' video is gone from YouTube; removed.
- Llano work songs (Colombia): replaced the voiceover version with the UNESCO film Gemma found (at work).
- Milling frolic: the Celtic Colours video stays, labeled concert.

### 3. DR Congo through France (Léa)
- Net-hunting songs: the only video was an Aka recording from the Central African Republic. Moved it to the Aka entry, added Léa's net-hunting short to the Aka entry (at work), and re-anchored the DRC entry as "Mbuti net-hunting songs" in the Ituri Forest, now seeking a video (Hugh Tracey and Colin Turnbull recordings exist).
- Corn-grinding songs (Diné): kept the audio; added Léa's community grinding video from 6:20.
- Jahuay (Ecuador): added Léa's harvest video (at work) and the Chimborazo recording from the August research.
- Coxswain and crew calls: added the Atlantic Challenge USA Belfast, Maine clip as a video-file link. Bennett: your own singing rows belong here or as their own entry.
- Regilaul (Estonia): retagged from solo pacing to communal work party, as Léa found (leader and chorus). Added the Setu leigotamine, the Setomaa archive hay song, and the Tormis choral arrangement (concert).
- Shaduf and Ethiopia: still seeking.

### 4. Georgia through Iceland (Genny)
- Orovela: added the two better recordings (Kelaptari, concert; folk song, sharing).
- Georgian farm and herding songs: replaced the unavailable Basiani Odoia with "Odoia, Samegrelo". Qanuri is now named in the description.
- Spinnstube (Germany): still seeking. The Wagner Spinnerlied is an opera chorus, not a work song, so it was not added.
- Seine-hauling (Ghana): dropped the 2-minute Seeger clip, kept the full 13-minute film with a proper label.
- Greek work songs: dropped the two mastic videos (no song).
- Carriacou: kept the Lomax 1962 launching chantey and the Windward boat launch (short chantey as the boat goes in); dropped the five talking, silent, or multi-hour videos.
- Konbit (Haiti): added "Konbit Zaka" (sharing).
- Holehole bushi: both documentaries stay. The video Genny put in this row is a Hawaiian paddle chant, so it went to Paddling chants (Hawai'i) as a concert video.
- German hiking song: became its own tradition, "Wanderlieder (hiking songs)", under walking.

### 5. India through Iran (Louisiane)
- Grindmill ovi: description added; more PARI videos are a follow-up.
- Jhumur: description notes that it is mostly performed on stage now.
- Kahar palanquin songs: the suggested video is a Shiv charcha devotional music video, not a work song; not added. Still seeking.
- Water-lifting and paddy songs: the Instagram reel cannot be embedded and needs a login; not added. Still seeking.
- Bhojpuri women's cycle: dropped the two commercial music videos; kept the jantsar grinding song.
- Vanchipattu: dropped the BBC news report and the vlog; four boat-race videos remain.
- Bushehr neymeh: dropped the homemade music video.
- Caspian rice-paddy songs: all three dropped (no singing, or piano over photos). Seeking.

### 6. Italy through Japan (CJ)
- Canto dei battipali: dropped the spoken explanation and the duplicate Coro Marmolada recording; the Bertelli recording is labeled concert; three performances remain.
- Funauta (Japan): the only video was instrumental; removed. Seeking a sung Kumagawa funauta.
- Kiyari and jizuki-uta: dropped the royalty-free stock track.
- Mondine, Cialoma, Trallalero, Yaeyama: descriptions now say what the work is.

### 7. Korea through Marshall Islands (Silas)
- Ieodo sana: added the Haenyeo divers' sea song (sharing) as the first video; description says it is the divers' rowing song.
- Gimmaegi sori: the only video was a talk show; removed. Seeking.
- Sutartinės: relabeled sharing to concert; description explains the work connection.
- Bamana and Senufo hoeing: kept the UNESCO balafon film and the Senufo balafon piece; dropped the village documentary, the Bamako balafon clip, and the concert.
- Marshallese roro: all six videos were sailing footage without singing; removed. Seeking.
- Dainas, Lifela, Kuu: still seeking.

### 8. Mongolia through Russia (Aguamar)
- Tiwizi (Morocco): added the Facebook video as an external link.
- Hausa grinding songs: all three dropped (pounding without singing; one video was from Arunachal, India). Seeking.
- Norwegian lokk: dropped the concert item, kept the two herding-call demonstrations and Synnøve's slåttestev.
- Ivatan kalusan: kept the folk-song medley only.
- Haylli (Peru): still seeking.
- Cante alentejano and Burlak: a video showing the work is still wanted.

### 9. Saudi Arabia through Spain (Anna)
- Waulking songs: first two relabeled at work; the Nan MacKinnon audio labeled sharing.
- Hees hawleed: dropped the camel-milking vlog and the 1943 Camel Corps newsreel.
- Dinka ox songs: dropped the 2-hour and 28-minute videos; Nat Geo Live now leads; the two cattle-camp vlogs are labeled sharing.
- Tonades de feina: first video relabeled concert; dropped the unavailable "De Segar" track (same singer and song as the remaining Maria del Mar Bonet video).
- Gumboot, Cantes de trilla: descriptions added.
- Quern, Spinning, Ilima: still seeking.

### 10. Sri Lanka through Tanzania (Kayleigh)
- Sri Lankan kavi cycle: dropped the private video and the mostly-talking Karaththa Kavi troupe video.
- Mchakamchaka: dropped the instrumental first video. The last video reported unavailable is back online and stays.
- Bequia, Sjömansvisor: still seeking.

### 11. Thailand through Zimbabwe (Veren)
- Thai harvest and boat songs: dropped the interview and the phleng e-saew video (a different genre); added Veren's rice-sickling song and the Karekarad troupe boat-song workshop.
- Arga (Tibet): added the Into Tibet 2020 video (shows the work and dance).
- Ganda: dropped the dead royal regatta video and two generic performances; added Veren's two hunting-song performances; renamed to "Ganda canoe paddling and hunting songs".
- Zhnyvarski pisni: added the Ukrainian Village Voices performance; both labeled concert.
- Uzbek work songs: dropped the stage performance that could not be tied to work. Seeking.
- Hò giã gạo: kept, labeled audio.
- Nhimbe, Canu cethrain: Nhimbe still seeking; the Welsh videos stay as concert.

### 12. United States (G)
- Field hollers: added the 1939 Arwhoolie recording.
- Levee camp hollers: added the 1978 Savage and Brown hollers.
- Menhaden chanteys: added the short Menhaden Chanteymen video and the net-hauling demonstration (Facebook link).
- Cowboy night-herding songs: added the Roy Rogers 1940 film performance (concert). The other suggested video has embedding disabled.
- Military cadence calls: relabeled at work to sharing (audio only).
- Corn shucking songs: kept with the full title; whether "Corn Shucking Time" was sung at shuckings is unverified.

### Traditions to add
- Added: Herring gutters' songs (Scotland), Shepherd's doina (Romania, flute recording), Romanian harvest songs (seeking), Wanderlieder (Germany).
- Not added: Pennsylvania Dutch work songs (no source given). The Romanian harvest video (https://youtu.be/9v-o_yFJVfc) is titled "Cantecul Sergentului", a sergeant's song, so it needs a listen before it goes on.

## Checks that could not be done here

- Four label-channel audio uploads (Hò giã gạo, Diné Corn Grinding Song, Digging Songs: Kisander, Rustavi Naduri) report "Video unavailable" from a datacenter IP but exist and are embeddable per YouTube's oEmbed. The students could play them in September. Kept.
- Tobar an Dualchais blocks automated requests, so the two herring-gutter tracks are unverified links.
- No browser here, so the modal scrolling fix and the layout were checked in jsdom, not on a phone. Open a long popup (Dinka ox songs) on a phone after publishing.

## Still seeking a video (30)

Quern songs, Spinning songs, Sjömansvisor, Dainas, Spinnstube, Holavar, Shaduf, Ilima, Lifela, Nhimbe, Mbuti net-hunting songs, Kuu, Ethiopian plowing and grinding songs, Kahar palanquin songs, Tamil water-lifting songs, Funauta, Mago-uta, Gimmaegi sori, Bequia chanteys, Haylli, Hausa grinding songs, Uzbek work songs, Caspian rice-paddy songs, Marshallese roro, Dutch shanties, Danish opsange, Maine coasting-schooner shanties, Massachusetts whaling shanties, Aboriginal songlines, Romanian harvest songs.

This list is the second assignment for the class if there is one. Rules for them: the video must contain the song; field recordings and archive audio count; footage of the work with no singing does not.

## Not in this pass (player.js, separate from the Atlas)

- Skipping to the next song sometimes skips a song in the bottom player (Léa).
- Clicking a song in the middle of the playlist starts the first song (Léa).
- "Show tags" in the songbook cuts some tags off (Léa).
- When audio is playing and a link to a list page carries an anchor (for example /atlas-regions/#japan), the in-place page swap scrolls to the top instead of the anchor. Fix: in `spaSwapTo`, after the swap, scroll to `location.hash` if that element exists.
