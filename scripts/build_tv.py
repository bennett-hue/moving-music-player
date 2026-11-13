#!/usr/bin/env python3
"""Build movingmusicTV (tv.html) from the Atlas data and Bennett's finds.

Sources (edit these, never tv.html):
    atlas-map.html          the Atlas: one object per tradition, videos in v[]
    tv/finds.json           Bennett's finds: videos saved from Instagram, Facebook,
                            TikTok, or YouTube that are not on the Atlas yet
    tv/youtube-meta.json    YouTube channel names and frame shapes (a cache)
    tv/template.html        the TV page: markup, style, and script

Outputs:
    tv.html                 self-contained page, served by the worker at /tv.html
    ghost/atlas.card.html   body of the HTML card on the Ghost page /atlas/
    ghost/tv.card.html      body of the HTML card on the Ghost page /tv/, which forwards to /atlas/

Usage:
    python3 scripts/build_tv.py                    # validate, then build
    python3 scripts/build_tv.py --check            # validate only
    python3 scripts/build_tv.py --refresh-youtube  # re-check every YouTube video first (needs network)
"""
import base64
import datetime
import hashlib
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_atlas_pages as atlas  # noqa: E402  (shares the Atlas loader and labels)

ROOT = atlas.ROOT
TV_DIR = os.path.join(ROOT, 'tv')
FINDS = os.path.join(TV_DIR, 'finds.json')
YT_META = os.path.join(TV_DIR, 'youtube-meta.json')
TEMPLATE = os.path.join(TV_DIR, 'template.html')
OUT_PAGE = os.path.join(ROOT, 'tv.html')
OUT_CARD = os.path.join(ROOT, 'ghost', 'tv.card.html')
OUT_ATLAS_CARD = os.path.join(ROOT, 'ghost', 'atlas.card.html')

SITE = 'https://movingmusic.works'
TV_WORKER_URL = 'https://mmp-sync.bennett-727.workers.dev/tv.html'
TV_LIVE_URL = 'https://mmp-sync.bennett-727.workers.dev/tv-finds.json'  # finds plus the Send button inbox
HOME = (44.43, -69.01)  # Belfast, Maine: the journey starts here
LINE_MAX = 280  # Bennett's line under a video; LINE_MAX in worker/tv.js matches

# Short labels for the channel buttons, in the Atlas order.
CHIP = {
    'hauling': 'Hauling', 'rowing': 'Rowing', 'pounding': 'Pounding', 'carrying': 'Carrying',
    'walking': 'Walking', 'solo-pacing': 'Solo pacing', 'signaling': 'Signaling',
    'animal-directed': 'Animal calls', 'communal-work-party': 'Work parties', 'devotional': 'Devotional',
}
SHOWS = {
    'at-work': ['People at work', atlas.DELIVERY_COLOR['at-work']],
    'shared': ['People sharing songs', atlas.DELIVERY_COLOR['shared']],
    'concert': ['People in concert', atlas.DELIVERY_COLOR['concert']],
}
SHOWS_ORDER = {'at-work': 0, 'shared': 1, 'concert': 2, '': 3}
PLATFORMS = ('instagram', 'facebook', 'tiktok', 'youtube', 'file')
NO_CREDIT = {'release', 'n/a', ''}
LAND_COLS = 120


# ---------- parsing ----------

def parse_video(url):
    """Return {p, k, st, o} for a playable URL, or None. p is the platform code."""
    u = (url or '').strip()
    m = re.search(r'(?:youtube(?:-nocookie)?\.com/(?:watch\?(?:[^#]*?&)?v=|embed/|shorts/|live/)|youtu\.be/)([\w-]{11})', u)
    if m:
        st = re.search(r'[?&#](?:t|start)=(\d+)', u)
        return {'p': 'yt', 'k': m.group(1), 'st': int(st.group(1)) if st else 0,
                'o': 'v' if '/shorts/' in u else 'h'}
    m = re.search(r'instagram\.com/(?:[\w.]+/)?(reels?|p|tv)/([\w-]+)', u)
    if m:
        kind = 'reel' if m.group(1).startswith('reel') else m.group(1)
        return {'p': 'ig', 'k': kind + '/' + m.group(2), 'st': 0, 'o': 'v'}
    m = re.search(r'tiktok\.com/(?:@[\w.-]+/video/|player/v1/|embed/v2/)(\d+)', u)
    if m:
        return {'p': 'tt', 'k': m.group(1), 'st': 0, 'o': 'v'}
    if re.search(r'(?:^|//|\.)(?:facebook\.com|fb\.watch)/', u):
        return {'p': 'fb', 'k': u, 'st': 0, 'o': 'v' if '/reel/' in u else 'h'}
    if re.search(r'\.(?:mp4|webm|m4v)(?:\?|$)', u, re.I):
        return {'p': 'file', 'k': u, 'st': 0, 'o': 'h'}
    return None


def canonical(url, pv):
    """One URL per video, the same as canonical() in worker/tv.js: share-tracking
    parameters (igsh, si, mibextid, utm_*) go, so a video sent twice gets one id."""
    if pv['p'] == 'yt':
        v = pv['o'] == 'v'
        out = ('https://www.youtube.com/shorts/' if v else 'https://www.youtube.com/watch?v=') + pv['k']
        return out + ((('?t=' if v else '&t=') + str(pv['st'])) if pv['st'] else '')
    if pv['p'] == 'ig':
        return 'https://www.instagram.com/' + pv['k'] + '/'
    if pv['p'] == 'tt':
        return re.split(r'[?#]', url)[0]
    if pv['p'] == 'fb':
        parts = urllib.parse.urlsplit(url)
        # Share links resolve to m.facebook.com; the embed plays www links.
        host = parts.netloc
        if parts.hostname and re.search(r'(?:^|\.)facebook\.com$', parts.hostname):
            host = 'www.facebook.com'
        reel = re.search(r'/reel/(\d+)', parts.path)
        if reel:
            return 'https://www.facebook.com/reel/' + reel.group(1) + '/'
        # Keep only the parameters that name a video or post; the rest is share tracking.
        keep = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
                if re.match(r'^(v|story_fbid|id|fbid|set|type)$', k)]
        return urllib.parse.urlunsplit((parts.scheme, host, parts.path, urllib.parse.urlencode(keep), ''))
    return url


def item_id(pv):
    if pv['p'] == 'yt':
        return 'yt-' + pv['k'] + ('-' + str(pv['st']) if pv['st'] else '')
    if pv['p'] == 'ig':
        return 'ig-' + pv['k'].split('/')[1]
    if pv['p'] == 'tt':
        return 'tt-' + pv['k']
    if pv['p'] == 'fb':
        nums = re.findall(r'\d{9,}', pv['k'])
        return 'fb-' + (nums[-1] if nums else hashlib.sha1(pv['k'].encode()).hexdigest()[:10])
    return 'file-' + hashlib.sha1(pv['k'].encode()).hexdigest()[:10]


def credit(name):
    name = (name or '').strip()
    name = re.sub(r'\s+-\s+Topic$', '', name).strip()
    return '' if name.lower() in NO_CREDIT else name


def has_dash(s):
    return '—' in s or '--' in s


# ---------- projection (same constants and formula as atlas-map.html) ----------

def projection_constants(src):
    nums = {}
    for name in ('IMGW', 'IMGH', 'AX', 'BX', 'AY', 'BY', 'LAM0'):
        m = re.search(r'\b%s\s*=\s*(-?[\d.]+)' % name, src)
        if not m:
            raise SystemExit('atlas-map.html: projection constant %s not found' % name)
        nums[name] = float(m.group(1))
    return nums


def make_project(P):
    def project(lat, lon):
        lon2 = ((lon - P['LAM0'] + 180) % 360) - 180
        lam = math.radians(lon2)
        phi = math.radians(lat)
        a = abs(phi)
        y = phi * (1 + a * a * (0.112579 + a * (-0.107505 + a * 0.0273759)))
        x = math.log(1 + 0.11679 * abs(lam)) / 0.31255
        if a <= 1.36258:
            x *= 1.22172 + math.sqrt(max(0.0, 2.115292 - y * y))
        else:
            t = 4.5848 + abs(y)
            x *= math.sqrt(abs(38.4304449 - t * t))
        if lam < 0:
            x = -x
        return P['AX'] * x + P['BX'], P['AY'] * y + P['BY']  # image px from the left, from the top
    return project


def land_mask(src, P, project):
    """Downsample the Atlas base map (white land on black) to a bitmask of LAND_COLS columns."""
    from PIL import Image
    import io
    m = re.search(r'L\.imageOverlay\("data:image/gif;base64,([A-Za-z0-9+/=]+)"', src)
    if not m:
        raise SystemExit('atlas-map.html: base map image not found')
    im = Image.open(io.BytesIO(base64.b64decode(m.group(1)))).convert('L')
    W, H = im.size
    if (W, H) != (int(P['IMGW']), int(P['IMGH'])):
        raise SystemExit('base map is %dx%d, expected %dx%d' % (W, H, P['IMGW'], P['IMGH']))
    for lat, lon, want in ((44.4, -69.0, True), (0.0, -30.0, False), (-25.0, 134.0, True)):
        px, py = project(lat, lon)
        if (im.getpixel((int(px), int(py))) > 128) != want:
            raise SystemExit('base map check failed at %s,%s: land is not white on this image' % (lat, lon))
    cols = LAND_COLS
    rows = int(round(H * cols / W))
    small = im.resize((cols, rows), Image.BOX)
    bits = bytearray((cols * rows + 7) // 8)
    n = 0
    for r in range(rows):
        for c in range(cols):
            if small.getpixel((c, r)) > 0.32 * 255:
                k = r * cols + c
                bits[k >> 3] |= 1 << (k & 7)
                n += 1
    return {'cols': cols, 'rows': rows, 'bits': base64.b64encode(bytes(bits)).decode(), 'dots': n}


def outline(P, project):
    e = 1e-6
    right = [project(lat, P['LAM0'] + 180 - e) for lat in range(90, -91, -3)]
    left = [project(lat, P['LAM0'] - 180 + e) for lat in range(-90, 91, 3)]
    return [[round(x, 1), round(y, 1)] for x, y in right + left]


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


# ---------- data ----------

def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def validate_finds(finds, slugs):
    problems = []
    seen = set()
    for f in finds:
        fid = f.get('id', '?')
        for k in ('id', 'platform', 'url', 'label', 'place', 'la', 'lo', 'tradition', 'uses', 'shows', 'orient', 'added'):
            if k not in f:
                problems.append('%s: missing field %s' % (fid, k))
        if fid in seen:
            problems.append('%s: duplicate id' % fid)
        seen.add(fid)
        if f.get('platform') not in PLATFORMS:
            problems.append('%s: platform must be one of %s' % (fid, ', '.join(PLATFORMS)))
        pv = parse_video(f.get('url', ''))
        if not pv:
            problems.append('%s: cannot play this URL: %s' % (fid, f.get('url')))
        elif item_id(pv) != fid:
            problems.append('%s: id should be %s (from the URL)' % (fid, item_id(pv)))
        if f.get('tradition') and f['tradition'] not in slugs:
            problems.append('%s: no Atlas tradition with slug %s' % (fid, f['tradition']))
        for u in f.get('uses', []):
            if u not in atlas.USE_LABEL_D:
                problems.append('%s: unknown use %s' % (fid, u))
        if f.get('shows', '') not in SHOWS_ORDER:
            problems.append('%s: shows must be at-work, shared, concert, or empty' % fid)
        if f.get('orient') not in ('v', 'h'):
            problems.append('%s: orient must be v or h' % fid)
        la, lo = f.get('la'), f.get('lo')
        if (la is None) != (lo is None):
            problems.append('%s: give both la and lo, or neither' % fid)
        elif la is not None and not (-90 <= la <= 90 and -180 <= lo <= 180):
            problems.append('%s: coordinates out of range' % fid)
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', f.get('added', '')):
            problems.append('%s: added must be YYYY-MM-DD' % fid)
        for k in ('label', 'place', 'note', 'by'):
            if has_dash(str(f.get(k, ''))):
                problems.append('%s: em dash or double hyphen in %s' % (fid, k))
        if len(str(f.get('note', ''))) > LINE_MAX:
            problems.append('%s: note is over %d characters' % (fid, LINE_MAX))
        if f.get('noted') and not re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$', str(f['noted'])):
            problems.append('%s: noted must be YYYY-MM-DDTHH:MM:SSZ' % fid)
    return problems


def clean_label(t):
    """Atlas labels say where a video opens; on the TV every video plays in place."""
    return re.sub(r'\s*\((?:Facebook|Instagram|TikTok) video, opens elsewhere\)', '', t).strip()


def slim_find(f):
    """The fields the page needs; check, from, and the rest stay in the repo."""
    keep = ('id', 'platform', 'url', 'by', 'label', 'place', 'la', 'lo', 'tradition', 'uses', 'shows',
            'orient', 'added', 'note')
    return {k: f[k] for k in keep if k in f and f[k] not in ('', None, [])}


def build_data(entries, finds, ytmeta, src, hide=()):
    """Atlas stops and videos, plus the finds as they are. The page merges the finds
    (and the live inbox) and works out the order, so the same code serves both."""
    P = projection_constants(src)
    project = make_project(P)
    hide = set(hide)
    stops, items, notes, seen = [], [], [], {}

    # Every Atlas tradition is a stop, so a find can join any of them.
    for e in entries:
        slug = atlas.slugify(e['n'])
        si = len(stops)
        x, y = project(e['la'], e['lo'])
        stops.append({'id': slug, 'n': e['n'], 'p': e['p'], 'la': e['la'], 'lo': e['lo'],
                      'x': round(x, 1), 'y': round(y, 1), 's': e.get('s', ''), 'u': e['u'], 'atlas': 1})
        for v in e['v']:
            pv = parse_video(v['u'])
            if not pv or item_id(pv) in hide:
                continue
            iid = item_id(pv)
            if iid in seen:
                notes.append('video %s is on two traditions (%s, %s); TV shows it once' % (
                    iid, stops[seen[iid]['s']]['id'], slug))
                continue
            by, ar = '', '16:9'
            if pv['p'] == 'yt':
                meta = ytmeta.get(pv['k'])
                if not meta:
                    notes.append('%s: not in tv/youtube-meta.json; run --refresh-youtube' % iid)
                else:
                    by = credit(meta[0])
                    ar = '4:3' if meta[2] and meta[1] and meta[2] / meta[1] > 0.66 else '16:9'
            elif pv['p'] == 'fb':
                m = re.search(r'facebook\.com/([^/?#]+)/', v['u'])
                by = m.group(1) if m and m.group(1) not in ('watch', 'reel', 'share', 'plugins') else ''
            elif pv['p'] == 'file':
                by = re.sub(r'^www\.', '', urllib.parse.urlparse(v['u']).hostname or '')
            if pv['o'] == 'v':
                ar = '9:16'
            it = {'id': iid, 'p': pv['p'], 'k': pv['k'], 'u': v['u'], 't': clean_label(v['t']), 'by': by,
                  'st': pv['st'], 'ar': ar, 'sh': v.get('d', ''), 's': si, 'f': 0}
            seen[iid] = it
            items.append(it)

    kept = []
    for f in finds:
        if f['id'] in hide:
            continue
        if f['id'] in seen:
            notes.append('%s is already on the Atlas (%s); the TV shows the Atlas copy' % (
                f['id'], stops[seen[f['id']]['s']]['id']))
            continue
        kept.append(slim_find(f))

    land = land_mask(src, P, project)
    data = {
        'built': datetime.date.today().isoformat(),
        'site': SITE,
        'live': TV_LIVE_URL,
        'home': list(HOME),
        'proj': P,
        'uses': [[slug, CHIP[slug], label] for slug, label in atlas.USE_LABEL],
        'shows': SHOWS,
        'stops': stops,
        'items': items,
        'finds': kept,
        'hide': sorted(hide),
        'img': [P['IMGW'], P['IMGH']],
        'land': {'cols': land['cols'], 'rows': land['rows'], 'bits': land['bits']},
        'outline': outline(P, project),
    }
    used = {it['s'] for it in items}
    stats = {'stops': len(used), 'items': len(items) + len(kept), 'finds': len(kept),
             'unplaced': sum(1 for f in kept if f.get('la') is None), 'land_dots': land['dots'],
             'platforms': {p: sum(1 for it in items if it['p'] == p) for p in ('yt', 'ig', 'fb', 'tt', 'file')}}
    for f in kept:
        code = (parse_video(f['url']) or {}).get('p')
        if code:
            stats['platforms'][code] += 1
    return data, stats, notes


# ---------- outputs ----------

def build_page(data):
    tpl = open(TEMPLATE, encoding='utf-8').read()
    if '__TV_DATA__' not in tpl:
        raise SystemExit('tv/template.html: placeholder __TV_DATA__ not found')
    blob = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    blob = blob.replace('</', '<\\/')  # never close the script tag from inside the data
    return tpl.replace('__TV_DATA__', blob)


def build_card():
    """The Ghost page /atlas/: one HTML card. The mm theme puts page content on a paper card at most
    820px wide, which squeezed the TV into its phone layout. On this page the card loses its paper
    and width limit, the footer goes, and the TV fills the window between the site header and the
    player bar. The page then has nothing to scroll, so the header stays put."""
    return ('<style>\n'
            '  body:is(.page-tv,.page-atlas) .mm-pagewrap{padding:10px 0 0!important}\n'
            '  body:is(.page-tv,.page-atlas) .mm-pagewrap .mm-wrap{max-width:1460px;'
            'padding-left:max(10px,env(safe-area-inset-left,0px));padding-right:max(10px,env(safe-area-inset-right,0px))}\n'
            '  body:is(.page-tv,.page-atlas) .mm-page-island{max-width:none;padding:0;background:none;box-shadow:none}\n'
            '  body:is(.page-tv,.page-atlas) .gh-content.mm-prose > .tv-embed-wrap{margin:0}\n'
            '  body:is(.page-tv,.page-atlas) .mm-foot{display:none}\n'
            '  body:is(.page-tv,.page-atlas) .mm-pagehead,body:is(.page-tv,.page-atlas) .mm-band{display:none}\n'
            '  body:is(.page-tv,.page-atlas){padding-bottom:0!important}\n'
            '  body:is(.page-tv,.page-atlas) .site{min-height:0!important}\n'
            '  #tv-iframe{display:block;width:100%;height:calc(100vh - 190px);height:calc(100svh - 190px);'
            'min-height:360px;border:0;border-radius:6px;background:#1b1814}\n'
            '  @media (max-width:700px){body:is(.page-tv,.page-atlas) .mm-pagewrap .mm-wrap{padding-left:0;padding-right:0}'
            '#tv-iframe{border-radius:0}}\n'
            # Wide windows: the TV covers the window down to the player bar, and the site header is
            # laid over the TV's left column, whose width the TV reports (--tv-left).
            '  body.tv-wide #tv-iframe{position:fixed;top:0;left:0;width:100vw;border-radius:0;z-index:10}\n'
            '  body.tv-wide .mm-head{position:fixed;top:0;left:0;width:var(--tv-left,340px);z-index:11;'
            'margin:0;padding:10px 16px 0;background:none;border:0;box-shadow:none;box-sizing:border-box}\n'
            '  body.tv-wide .mm-head-inner{display:flex!important;flex-wrap:wrap;align-items:center;gap:5px 12px;'
            'max-width:none;margin:0;padding:0}\n'
            '  body.tv-wide .mm-brand{flex:1 1 100%;gap:1px}\n'
            '  body.tv-wide .mm-lockup{gap:8px}\n'
            '  body.tv-wide .mm-lockup .l1{font-size:16px;letter-spacing:.12em}\n'
            '  body.tv-wide .mm-lockup .l2{font-size:14.5px}\n'
            '  body.tv-wide .mm-strap{font-size:12.5px;gap:0 6px}\n'
            '  body.tv-wide .mm-nav{flex:0 1 auto;margin:0;gap:3px 12px;justify-content:flex-start}\n'
            '  body.tv-wide .mm-head-inner .mm-nav{margin-top:0}\n'
            '  body.tv-wide .mm-nav a.menu{font-size:12px}\n'
            '  body.tv-wide .mm-login,body.tv-wide .mm-sub{padding:3px 9px;font-size:12px;border-width:1px}\n'
            '</style>\n'
            '<div class="tv-embed-wrap">\n'
            '  <iframe id="tv-iframe" data-src="__TV_URL__" title="Worksong Atlas"'
            ' allow="autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write; web-share"'
            ' allowfullscreen></iframe>\n'
            '</div>\n'
            '<script data-mark="tv-iframe-forward">(function(){var i=document.getElementById("tv-iframe");if(!i)return;'
            'var s=i.getAttribute("data-src");if(location.hash){var sep=s.indexOf("?")>-1?"&":"?";'
            's+=sep+"state="+encodeURIComponent(location.hash.substring(1));}i.setAttribute("src",s);})();</script>\n'
            # Fit the TV between the header and the player bar, at any header height. The page loses
            # its footer and the padding it keeps for the bar, so it is no taller than the window and
            # has nothing to scroll.
            '<script data-mark="tv-iframe-fit">(function(){var i=document.getElementById("tv-iframe");if(!i)return;'
            'var raf=0,B=document.body,H=document.querySelector(".mm-head");'
            'function wide(){return B.classList.contains("tv-wide");}'
            'function fit(){raf=0;var top=wide()?0:i.getBoundingClientRect().top+(window.scrollY||0);'
            'var bar=document.querySelector(".mmp-bar.is-visible");var b=(bar?bar.getBoundingClientRect().height:0)+(wide()?0:10);'
            'i.style.height=Math.max(360,Math.floor(window.innerHeight-top-b))+"px";head();}'
            'function head(){try{i.contentWindow.postMessage({source:"mmtv-host",action:"head",'
            'h:wide()&&H?Math.ceil(H.getBoundingClientRect().height):0},"*");}catch(e){}}'
            'addEventListener("message",function(ev){var d=ev.data;'
            'if(ev.source!==i.contentWindow||!d||d.source!=="mmtv"||d.action!=="layout")return;'
            'var l=Math.max(0,Math.min(4000,Math.round(+d.left||0)));'
            'B.classList.toggle("tv-wide",l>0&&!!H);B.style.setProperty("--tv-left",l+"px");fit();});'
            'if(window.ResizeObserver&&H)new ResizeObserver(head).observe(H);'
            'function soon(){if(!raf)raf=requestAnimationFrame(fit);}'
            'fit();addEventListener("resize",soon);addEventListener("orientationchange",soon);'
            'setTimeout(soon,600);setTimeout(soon,2000);'
            'if(window.MutationObserver)new MutationObserver(soon).observe(document.body,{childList:true});})();</script>'
            ).replace('__TV_URL__', TV_WORKER_URL)


def build_forward_card():
    """The Ghost page /tv/, the Scroll's old address: it sends the visitor on to /atlas/ with the same link."""
    return ('<script data-mark="tv-forward">location.replace("/atlas/"+location.hash);</script>\n'
            '<p><a href="/atlas/">The Worksong Atlas has moved here.</a></p>')


def refresh_youtube(entries, meta):
    """Ask YouTube's oEmbed endpoint about every Atlas video: 200 playable, 401 embedding off, 404 gone."""
    ids = []
    for e in entries:
        for v in e['v']:
            pv = parse_video(v['u'])
            if pv and pv['p'] == 'yt' and pv['k'] not in ids:
                ids.append(pv['k'])
    bad = []
    for n, vid in enumerate(ids, 1):
        url = 'https://www.youtube.com/oembed?format=json&url=' + urllib.parse.quote(
            'https://www.youtube.com/watch?v=' + vid, safe='')
        try:
            with urllib.request.urlopen(url, timeout=15) as r:
                j = json.load(r)
                meta['videos'][vid] = [j.get('author_name', ''), j.get('width'), j.get('height')]
        except urllib.error.HTTPError as err:
            bad.append((vid, err.code))
        except Exception as err:  # network trouble: keep the cached entry
            bad.append((vid, str(err)[:60]))
        if n % 25 == 0:
            print('  checked %d of %d' % (n, len(ids)))
    meta['_checked'] = datetime.date.today().isoformat()
    with open(YT_META, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
        f.write('\n')
    for vid, code in bad:
        print('  YouTube %s: %s (401 = embedding off, 404 = gone or private)' % (vid, code))
    return bad


def main():
    src = open(atlas.MAP, encoding='utf-8').read()
    entries = atlas.load_entries()
    finds_doc = load_json(FINDS)
    meta = load_json(YT_META)
    if '--refresh-youtube' in sys.argv:
        refresh_youtube(entries, meta)
    slugs = {atlas.slugify(e['n']) for e in entries}
    problems = validate_finds(finds_doc.get('finds', []), slugs)
    if problems:
        print('Problems in tv/finds.json (%d):' % len(problems))
        for p in problems:
            print('  -', p)
        sys.exit(1)
    hidden = [h['id'] for h in finds_doc.get('hide', [])]
    data, stats, notes = build_data(entries, finds_doc['finds'], meta.get('videos', {}), src, hidden)
    if hidden:
        print('  hidden on the TV: ' + ', '.join(hidden))
    for n in notes:
        print('  note:', n)
    print('TV: %(items)d videos (%(finds)d finds, %(unplaced)d without a place), Atlas videos at %(stops)d '
          'traditions, %(land_dots)d land dots' % stats)
    print('    by platform: ' + ', '.join('%s %d' % kv for kv in stats['platforms'].items()))
    if '--check' in sys.argv:
        return
    page = build_page(data)
    with open(OUT_PAGE, 'w', encoding='utf-8') as f:
        f.write(page)
    with open(OUT_ATLAS_CARD, 'w', encoding='utf-8') as f:
        f.write(build_card() + '\n')
    with open(OUT_CARD, 'w', encoding='utf-8') as f:
        f.write(build_forward_card() + '\n')
    print('wrote tv.html (%d bytes), ghost/atlas.card.html and ghost/tv.card.html' % len(page.encode('utf-8')))


if __name__ == '__main__':
    main()
